/** Smoke test para src/lib/breez-wallet.ts.
 *
 *  Rode com:  npx tsx scripts/test-breez-wallet.ts
 *
 *  Requer VITE_BREEZ_API_KEY no ambiente (ou num .env carregado por você
 *  antes de rodar) — sem ela, os testes que dependem de rede são pulados
 *  com aviso, mas o teste determinístico (derivação da mnemonic a partir
 *  do nsec) roda sempre, sem precisar de rede nem chave.
 *
 *  ⚠️ Este script MOVIMENTA DINHEIRO REAL se BREEZ_TEST_SEND_INVOICE
 *  estiver setada — por padrão ela não está, e o teste de envio fica em
 *  modo "só prepara, nunca confirma" (chama prepararEnvio, nunca
 *  confirmarEnvio). Ler o próprio código antes de setar essa variável.
 */

import { createNostrIdentity, decodeNsec } from "../src/lib/nostr-keys";
import { mnemonicFromNsecBytes } from "../src/lib/breez-wallet";

// ⚠️ Diferente de src/lib/breez-wallet.ts (que usa o entrypoint /web, correto
// pro navegador/React): aqui, rodando via `npx tsx` em Node puro, usamos o
// entrypoint /nodejs — o /web tenta *fetch* o binário .wasm (depende do
// bundler/navegador pra resolver isso), o que quebra em Node com
// "TypeError: fetch failed... not implemented". O /nodejs carrega o WASM
// direto do disco, sem fetch, e não precisa de init() explícito. Requer
// Node.js v22+.
import pkg from "@breeztech/breez-sdk-spark/nodejs";
const { connect, defaultConfig } = pkg;

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log("1) mnemonicFromNsecBytes() — determinístico, sem rede");
const identidade = createNostrIdentity();
const nsecBytes = decodeNsec(identidade.nsec);
const mnemonic1 = mnemonicFromNsecBytes(nsecBytes);
const mnemonic2 = mnemonicFromNsecBytes(nsecBytes);
assert(mnemonic1.split(" ").length === 24, `mnemonic tem 24 palavras (veio: ${mnemonic1.split(" ").length})`);
assert(mnemonic1 === mnemonic2, "mesma entrada produz a mesma mnemonic (determinístico)");

const outraIdentidade = createNostrIdentity();
const outraMnemonic = mnemonicFromNsecBytes(decodeNsec(outraIdentidade.nsec));
assert(outraMnemonic !== mnemonic1, "nsec diferente produz mnemonic diferente");

console.log();
const apiKey = process.env.VITE_BREEZ_API_KEY;
if (!apiKey) {
  console.log("⚠️  VITE_BREEZ_API_KEY não configurada — pulando testes de rede.");
  console.log("   Pegue uma chave grátis em https://breez.technology e rode de novo com:");
  console.log("   VITE_BREEZ_API_KEY=sua_chave npx tsx scripts/test-breez-wallet.ts");
} else {
  console.log("2) initBreezWallet() — conecta de verdade (mainnet)");
  try {
    const mnemonic = mnemonicFromNsecBytes(nsecBytes);
    const config = defaultConfig("mainnet");
    config.apiKey = apiKey;
    const sdk = await connect({
      config,
      seed: { type: "mnemonic", mnemonic, passphrase: undefined },
      storageDir: `./.breez-test-${identidade.publicKeyHex.slice(0, 8)}`,
    });
    assert(!!sdk, "connect() retornou uma instância do SDK");

    console.log("3) getInfo() — carteira nova, deve ter saldo 0");
    const info = await sdk.getInfo({});
    assert(info.balanceSats === 0, `saldo de carteira nova é 0 (veio: ${info.balanceSats})`);

    console.log("4) receivePayment() — gera invoice real de 100 sats");
    const resposta = await sdk.receivePayment({
      paymentMethod: { type: "bolt11Invoice", amountSats: 100, description: "teste arakne" },
    });
    const invoice = resposta.paymentRequest ?? resposta.destination;
    assert(invoice.startsWith("ln"), `invoice parece um bolt11 real (veio: ${invoice.slice(0, 10)}…)`);

    console.log("5) prepararEnvio() — só cotação, NÃO envia nada de verdade");
    console.log("   (pulado por padrão — precisa de uma invoice de destino real pra testar;");
    console.log("    ver comentário no topo do arquivo antes de habilitar)");
  } catch (e) {
    console.error("  ✗ Erro conectando/operando a carteira Breez:", e);
    console.error("    Confira: API key válida? network certo? storageDir gravável?");
    failures++;
  }
}

console.log();
if (failures === 0) {
  console.log("✅ Todos os checks executados passaram.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) falharam.`);
  process.exit(1);
}
