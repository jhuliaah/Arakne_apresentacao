/** Carteira Lightning individual da usuária — Breez SDK (Spark, nodeless).
 *
 *  Não-custodial de verdade: a chave/seed nunca sai do dispositivo dela,
 *  nunca é enviada ao backend. Isso é estrutural, não convenção — é o que
 *  diferencia essa camada do pool (services/exchange.py + LNbits no backend,
 *  que É custodial de propósito, ver seção 6 do doc mestre). Nunca use este
 *  módulo para a wallet do pool.
 *
 *  Requer uma API key da Breez (gratuita, cadastro em
 *  https://breez.technology — formulário "Request API Key"). Sem ela, o
 *  connect() abaixo falha — não existe modo mock aqui, diferente dos
 *  serviços do backend, porque não faz sentido "simular" uma carteira
 *  não-custodial: ou ela é real, ou não existe.
 *
 *  ── Sobre a seed: por que deriva do nsec, não é NIP-06 ──────────────
 *  A identidade Nostr do app (src/lib/nostr-keys.ts) NÃO usa mais NIP-06 —
 *  o nsec é 32 bytes aleatórios direto, sem mnemonic (decisão registrada
 *  no próprio nostr-keys.ts: NIP-06 é `unrecommended` pelo protocolo, e o
 *  modelo de recuperação atual — NIP-17/59 + SSSS — não depende de seed
 *  frase). O Breez SDK, por sua vez, exige uma mnemonic BIP-39 como
 *  formato de entrada da seed.
 *
 *  Resolvemos isso sem reintroduzir NIP-06: os mesmos 32 bytes do nsec
 *  são reinterpretados como *entropia* BIP-39 (mnemonicFromNsecBytes
 *  abaixo) — uma transformação determinística e reversível, não uma nova
 *  seed independente. "Uma chave mestra, dois formatos de saída": o Nostr
 *  usa os bytes crus, o Breez usa a mesma entropia codificada como 24
 *  palavras (formato que o SDK exige). Isso preserva a ideia original de
 *  "uma seed → identidade + carteira" sem contradizer a decisão de
 *  abandonar NIP-06.
 *
 *  ⚠️ Partes deste módulo (nomes exatos de método/campo em
 *  receivePayment/prepareSendPayment) foram escritas com base na família
 *  de SDKs Breez (Liquid/Spark/Greenlight compartilham desenho de API),
 *  mas a versão Spark é recente e a API pode ter mudado. CONFIRA o
 *  autocomplete do TypeScript contra a versão instalada antes de confiar
 *  cegamente — está marcado inline onde a incerteza é maior.
 */

import { entropyToMnemonic } from "bip39";

// A importação exata do subpath varia por ambiente (web/nodejs/ssr) — ver
// https://sdk-doc-spark.breez.technology/guide/install.html. Para uma SPA
// Vite/React rodando no navegador, o subpath correto é "/web".
import init, {
  connect,
  defaultConfig,
  type BreezSdk,
  type PrepareSendPaymentResponse,
} from "@breeztech/breez-sdk-spark/web";

/** Converte os 32 bytes do nsec numa mnemonic BIP-39 de 24 palavras.
 *
 *  Determinístico: o mesmo nsec sempre produz a mesma mnemonic, então a
 *  carteira Breez de uma usuária é sempre recuperável a partir da mesma
 *  identidade Nostr dela — sem precisar guardar/mostrar a mnemonic
 *  separadamente em lugar nenhum da UI.
 */
export function mnemonicFromNsecBytes(nsecBytes: Uint8Array): string {
  if (nsecBytes.length !== 32) {
    throw new Error(`Esperado 32 bytes de entropia, recebido ${nsecBytes.length}.`);
  }
  const hex = Array.from(nsecBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return entropyToMnemonic(hex);
}

export interface BreezWalletConfig {
  apiKey: string;
  network?: "mainnet" | "regtest";
  /** Diretório/chave de armazenamento local do SDK (WASM). Ver ressalva no
   *  módulo: valor exato de storageDir para o alvo /web ainda precisa ser
   *  confirmado rodando de verdade — comece com algo simples como o
   *  identificador pseudônimo da usuária. */
  storageDir: string;
}

let wasmInitialized = false;

/** Inicializa e conecta a carteira Breez da usuária.
 *
 *  Chame uma vez por sessão (ex.: no login, depois de decodificar o nsec
 *  dela). Devolve a instância do SDK — guarde em memória/contexto React,
 *  nunca em localStorage (o exemplo oficial da Breez faz isso só para demo;
 *  o comentário deles no próprio repo já avisa "not suitable for
 *  production use").
 */
export async function initBreezWallet(
  nsecBytes: Uint8Array,
  config: BreezWalletConfig
): Promise<BreezSdk> {
  if (!wasmInitialized) {
    await init(); // carrega o módulo WebAssembly — precisa rodar antes de qualquer outra chamada
    wasmInitialized = true;
  }

  const mnemonic = mnemonicFromNsecBytes(nsecBytes);
  const sdkConfig = defaultConfig(config.network ?? "mainnet");
  sdkConfig.apiKey = config.apiKey;

  const sdk = await connect({
    config: sdkConfig,
    seed: { type: "mnemonic", mnemonic, passphrase: undefined },
    storageDir: config.storageDir,
  });

  return sdk;
}

/** Saldo atual da carteira, em sats. */
export async function getBalanceSats(sdk: BreezSdk): Promise<number> {
  const info = await sdk.getInfo({});
  // ⚠️ Campo exato (balanceSats vs walletInfo.balanceSats etc.) não
  // confirmado com 100% de certeza para esta versão — conferir no
  // autocomplete; ajustar se o shape for diferente.
  return info.balanceSats ?? 0;
}

/** Gera uma invoice Lightning para receber `amountSats`, com descrição
 *  (disfarçada — nunca "empréstimo", ver vocabulário da seção 2 do doc
 *  mestre) já embutida. */
export async function receberPagamento(
  sdk: BreezSdk,
  amountSats: number,
  descricao: string
): Promise<{ invoice: string; expiraEm?: number }> {
  const resposta = await sdk.receivePayment({
    paymentMethod: { type: "bolt11Invoice", amountSats, description: descricao },
  });
  return { invoice: resposta.paymentRequest };
}

export interface PrepararEnvioResultado {
  /** Taxa estimada, em sats — mostre isso pra usuária ANTES de confirmar. */
  feesSats: number;
  /** Passe este objeto de volta pra confirmarEnvio() — nunca reconstrua na mão. */
  prepareResponse: PrepareSendPaymentResponse;
}

/** Passo 1 de um envio: só cotação/preparação, NÃO move nada ainda.
 *  Sempre chame isso primeiro e mostre `feesSats` pra usuária confirmar. */
export async function prepararEnvio(
  sdk: BreezSdk,
  destino: string // bolt11 invoice, ou endereço Spark/on-chain
): Promise<PrepararEnvioResultado> {
  const prepareResponse = await sdk.prepareSendPayment({ paymentRequest: destino });
  return {
    feesSats: Number(prepareResponse.amount ?? 0n),
    prepareResponse,
  };
}

/** Passo 2 de um envio: executa de verdade, gastando sats reais.
 *  Só chame depois que a usuária confirmou explicitamente as taxas do
 *  passo 1 — nunca encadeie prepararEnvio → confirmarEnvio automaticamente
 *  sem uma confirmação humana no meio. */
export async function confirmarEnvio(
  sdk: BreezSdk,
  resultado: PrepararEnvioResultado
): Promise<{ sucesso: boolean }> {
  await sdk.sendPayment({
    prepareResponse: resultado.prepareResponse,
    idempotencyKey: crypto.randomUUID(),
  });
  return { sucesso: true };
}
