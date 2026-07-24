/** Smoke test para src/lib/gift-wrap.ts (NIP-59).
 *
 *  Rode com:  npx tsx scripts/test-gift-wrap.ts
 *
 *  Não usa vitest (será configurado na Phase 4). Valida:
 *  - wrapToRecipient produz kind 1059 com tag ["p", recipient] e pubkey efêmera
 *  - unwrapReceived round-trip: content.type/ownerNpub/tags/pubkey batem
 *  - unwrapReceived com chave errada → null (não lança erro)
 *
 *  Não toca em relay pool (Track 2A), SSSS (librarian), nem UI (Fase 3C/4D).
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { wrapToRecipient, unwrapReceived } from "../src/lib/gift-wrap";
import { bytesToBase64 } from "../src/lib/recovery-serialize";
import { RECOVERY_TAGS, type RecoveryRumor } from "../src/lib/recovery-types";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log("1) Gerar 2 pares de chaves (sender + recipient)");
const senderPriv = generateSecretKey();
const recipientPriv = generateSecretKey();
const senderPubHex = getPublicKey(senderPriv);
const recipientPubHex = getPublicKey(recipientPriv);
assert(
  senderPubHex.length === 64,
  `senderPubHex tem 64 chars (veio: ${senderPubHex.length})`,
);
assert(
  recipientPubHex.length === 64,
  `recipientPubHex tem 64 chars (veio: ${recipientPubHex.length})`,
);
assert(senderPubHex !== recipientPubHex, "sender e recipient têm pubkeys diferentes");

console.log("2) Criar RecoveryRumor de teste (type: shard)");
const rumor: RecoveryRumor = {
  type: "shard",
  ownerNpub: "npub1testowner000000000000000000000000000000000000000000000",
  vaultId: "vault-test-001",
  threshold: 3,
  totalShares: 5,
  shareIndex: 1,
  share: bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
  scheme: "gf256_v1",
  createdAt: Math.floor(Date.now() / 1000),
};
assert(rumor.share.length > 0, "share base64 não é vazia");

console.log("3) wrapToRecipient(senderPriv, recipientPubHex, rumor, tags)");
const wrap = wrapToRecipient(senderPriv, recipientPubHex, rumor, [
  ["t", RECOVERY_TAGS.shard],
]);

console.log("4) Verificar propriedades do wrap (kind 1059)");
assert(wrap.kind === 1059, `wrap.kind === 1059 (veio: ${wrap.kind})`);
const pTag = wrap.tags.find(
  (t) => t[0] === "p" && t[1] === recipientPubHex,
);
assert(pTag !== undefined, 'wrap.tags contém ["p", recipientPubHex]');
assert(wrap.pubkey !== senderPubHex, "wrap.pubkey é efêmera (≠ senderPubHex)");
assert(
  wrap.pubkey !== recipientPubHex,
  "wrap.pubkey é efêmera (≠ recipientPubHex)",
);
assert(
  typeof wrap.id === "string" && wrap.id.length === 64,
  "wrap.id é hex de 64 chars",
);
assert(
  typeof wrap.sig === "string" && wrap.sig.length === 128,
  "wrap.sig é hex de 128 chars (schnorr)",
);

console.log("5) unwrapReceived(wrap, recipientPriv)");
const unwrapped = unwrapReceived(wrap, recipientPriv);
assert(unwrapped !== null, "unwrap retorna não-null com chave certa");

console.log("6) Verificar conteúdo desembrulhado");
if (unwrapped) {
  assert(
    unwrapped.content.type === "shard",
    `content.type === "shard" (veio: ${unwrapped.content.type})`,
  );
  // if-block para narrowear o union type e acessar campos de shard
  if (unwrapped.content.type === "shard") {
    assert(
      unwrapped.content.ownerNpub === rumor.ownerNpub,
      "content.ownerNpub bate (round-trip)",
    );
    assert(
      unwrapped.content.vaultId === rumor.vaultId,
      "content.vaultId bate",
    );
    assert(
      unwrapped.content.share === rumor.share,
      "content.share bate (round-trip base64)",
    );
    assert(
      unwrapped.content.threshold === rumor.threshold,
      "content.threshold bate",
    );
    assert(
      unwrapped.content.totalShares === rumor.totalShares,
      "content.totalShares bate",
    );
    assert(
      unwrapped.content.shareIndex === rumor.shareIndex,
      "content.shareIndex bate",
    );
    assert(
      unwrapped.content.scheme === rumor.scheme,
      "content.scheme bate",
    );
  }
  assert(
    unwrapped.pubkey === senderPubHex,
    `pubkey === senderPubHex (veio: ${unwrapped.pubkey})`,
  );
  assert(
    unwrapped.tags.length === 1,
    `tags tem 1 entrada (veio: ${unwrapped.tags.length})`,
  );
  assert(
    unwrapped.tags[0][0] === "t" &&
      unwrapped.tags[0][1] === RECOVERY_TAGS.shard,
    'tags[0] === ["t", "arakne-recovery-shard"]',
  );
}

console.log("7) unwrapReceived com chave errada → null");
const wrongPriv = generateSecretKey();
const wrongResult = unwrapReceived(wrap, wrongPriv);
assert(wrongResult === null, "retorna null com chave errada (não lança erro)");

console.log();
if (failures === 0) {
  console.log("✅ Todos os checks passaram.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) falharam.`);
  process.exit(1);
}
