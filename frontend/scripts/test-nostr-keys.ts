/** Smoke test rápido para src/lib/nostr-keys.ts.
 *
 *  Rode com:  npx tsx scripts/test-nostr-keys.ts
 *
 *  Não usa vitest (será configurado na Phase 4). Apenas valida que a API
 *  do nostr-tools (geração direta de nsec + NIP-19) funciona como esperado
 *  no fluxo de criar identidade.
 */

import {
  createNostrIdentity,
  decodeNsec,
  encodeNsec,
  decodeNpub,
} from "../src/lib/nostr-keys";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log("1) createNostrIdentity()");
const id = createNostrIdentity();
assert(id.nsec.startsWith("nsec1"), `nsec começa com "nsec1" (veio: ${id.nsec.slice(0, 8)}…)`);
assert(id.npub.startsWith("npub1"), `npub começa com "npub1" (veio: ${id.npub.slice(0, 8)}…)`);
assert(id.privateKeyHex.length === 64, `privateKeyHex tem 64 chars (veio: ${id.privateKeyHex.length})`);
assert(id.publicKeyHex.length === 64, "publicKeyHex tem 64 chars");

console.log("2) nsec tem 32 bytes (chave privada gerada direta)");
const privBytes = decodeNsec(id.nsec);
assert(privBytes.length === 32, `decodeNsec(nsec) retorna 32 bytes (veio: ${privBytes.length})`);
assert(privBytes.every((b) => b >= 0 && b <= 255), "todos os bytes estão em [0,255]");

console.log("3) decodeNsec / encodeNsec round-trip");
const reEncoded = encodeNsec(privBytes);
assert(reEncoded === id.nsec, "encodeNsec(decodeNsec(nsec)) === nsec");

console.log("4) decodeNpub");
const pubHex = decodeNpub(id.npub);
assert(pubHex === id.publicKeyHex, "decodeNpub(npub) === publicKeyHex");

console.log("5) cada createNostrIdentity gera chaves distintas");
const id2 = createNostrIdentity();
assert(id2.nsec !== id.nsec, "dois nsec gerados são diferentes");
assert(id2.npub !== id.npub, "dois npub gerados são diferentes");
assert(id2.privateKeyHex !== id.privateKeyHex, "dois privateKeyHex gerados são diferentes");

console.log();
if (failures === 0) {
  console.log("✅ Todos os checks passaram.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) falharam.`);
  process.exit(1);
}
