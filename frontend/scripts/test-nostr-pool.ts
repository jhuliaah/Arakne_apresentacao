/** Smoke test para src/lib/nostr-pool.ts.
 *
 *  Rode com:  npx tsx scripts/test-nostr-pool.ts
 *
 *  Não usa vitest (será configurado na Phase 4). Valida o fluxo completo
 *  da camada de pub/sub:
 *  - Gera identidade de teste (nsec/npub)
 *  - Cria e assina um evento kind 1059 (gift-wrap dummy — não é um NIP-59
 *    real, só um evento válido com kind 1059 e tag `p`)
 *  - Publica em todos os relays hardcoded
 *  - Inscreve para receber gift-wraps em tempo real
 *  - Verifica que recebe o próprio evento publicado
 *
 *  CUIDADO: isto requer conexão real com relays Nostr públicos
 *  (wss://relay.damus.io, wss://nos.lol, wss://relay.nostr.band).
 *  Pode falhar por rede, firewall, ou se os relays estiverem indisponíveis.
 *  Se falhar, tudo bem — é só teste manual.
 *
 *  Requer Node 22+ (WebSocket nativo) ou o pacote `ws` instalado.
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { useWebSocketImplementation } from "nostr-tools/pool";
import type { NostrEvent } from "nostr-tools/core";

// Node 22+ tem WebSocket nativo global. Se não tiver, tenta carregar `ws`.
if (typeof globalThis.WebSocket === "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WebSocket: WS } = await import("ws");
    useWebSocketImplementation(WS);
    console.log("[setup] WebSocket via pacote `ws`");
  } catch {
    console.error(
      "[setup] Sem WebSocket global e pacote `ws` não instalado. Instale com: npm i -D ws",
    );
    process.exit(1);
  }
} else {
  console.log("[setup] WebSocket nativo do Node 22+");
}

// Importa depois de configurar o WebSocket para que o SimplePool o use.
const { RELAYS } = await import("../src/lib/nostr-relays");
const {
  publishEvent,
  subscribeWrapsForNpub,
  fetchWrapsForNpub,
  closePool,
}: typeof import("../src/lib/nostr-pool") = await import("../src/lib/nostr-pool");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log("=== Smoke test: nostr-pool ===\n");

// 1) Gera identidade de teste
console.log("1) Gerando identidade de teste...");
const sk = generateSecretKey();
const pubkeyHex = getPublicKey(sk);
console.log(`   npub hex: ${pubkeyHex.slice(0, 12)}...`);
assert(pubkeyHex.length === 64, "pubkeyHex tem 64 chars");

// 2) Cria evento kind 1059 dummy (não é NIP-59 real — só valida o transporte)
console.log("\n2) Criando evento kind 1059 (gift-wrap dummy)...");
const template = {
  kind: 1059,
  created_at: Math.floor(Date.now() / 1000),
  tags: [["p", pubkeyHex]],
  content: "arakne-smoke-test-do-not-trust",
};
const event: NostrEvent = finalizeEvent(template, sk);
console.log(`   event id: ${event.id.slice(0, 12)}...`);
assert(event.kind === 1059, "kind === 1059");
assert(event.tags.some((t) => t[0] === "p" && t[1] === pubkeyHex), "tem tag p com nosso pubkey");
assert(typeof event.sig === "string" && event.sig.length === 128, "assinatura tem 128 chars hex");

// 3) Subscribe ANTES de publicar (para não perder o evento)
console.log("\n3) Inscrevendo para receber gift-wraps (tempo real)...");
let receivedEvent: NostrEvent | null = null;
const cleanup = subscribeWrapsForNpub(pubkeyHex, (ev) => {
  if (ev.id === event.id) {
    receivedEvent = ev;
    console.log(`   ✓ recebeu evento ${ev.id.slice(0, 12)}...`);
  }
});
assert(typeof cleanup === "function", "subscribe retornou função de cleanup");

// 4) Publica em todos os relays
console.log("\n4) Publicando evento em todos os relays...");
console.log(`   relays: ${RELAYS.join(", ")}`);
const published = await publishEvent(event);
assert(published, "publishEvent retornou true (≥1 relay aceitou)");

if (!published) {
  console.error("\n❌ Publish falhou — abortando teste (verifique rede/relays).");
  cleanup();
  closePool();
  process.exit(1);
}

// 5) Espera receber via subscription (timeout 15s)
console.log("\n5) Aguardando recebimento via subscription (timeout 15s)...");
const timeoutMs = 15_000;
const start = Date.now();
while (!receivedEvent && Date.now() - start < timeoutMs) {
  await new Promise((r) => setTimeout(r, 200));
}
assert(receivedEvent !== null, "recebeu o evento publicado via subscription");

if (receivedEvent !== null) {
  const ev: NostrEvent = receivedEvent; // TS não rastreia assignment via closure
  assert(ev.id === event.id, "evento recebido tem o mesmo id");
  assert(ev.kind === 1059, "evento recebido tem kind 1059");
}

// 6) Testa fetchWrapsForNpub (busca histórica)
console.log("\n6) Buscando wraps históricos com fetchWrapsForNpub...");
const historical = await fetchWrapsForNpub(pubkeyHex);
console.log(`   encontrados: ${historical.length} wrap(s)`);
assert(
  historical.some((e) => e.id === event.id),
  "fetchWrapsForNpub encontrou o evento publicado",
);

// 7) Cleanup
console.log("\n7) Cleanup...");
cleanup();
closePool();
console.log("   ✓ pool fechado");

console.log("\n=== Resultado ===");
if (failures === 0) {
  console.log("✅ Todos os checks passaram.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) falharam.`);
  process.exit(1);
}
