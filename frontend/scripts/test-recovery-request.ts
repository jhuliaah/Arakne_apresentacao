/** Smoke test para src/lib/recovery-request.ts (Track 4A da Fase 4).
 *
 *  Rode com:  npx tsx scripts/test-recovery-request.ts
 *
 *  Valida o fluxo completo de pedido de recuperação em novo dispositivo:
 *  1. Gera identidade da dona (nsec + npub) + 2 avalistas + 1 shadow
 *  2. Distribui shares SSSS via NIP-59 (distributeShares — Track 3A)
 *  3. Gera nsec efêmero (simula startRecoveryRequest sem chamar o backend)
 *  4. Subscribe nas respostas no npub efêmero
 *  5. Simula resposta da avalista 1 (gift-wrap de volta com share 0)
 *  6. Simula resposta da avalista 2 (gift-wrap de volta com share 1)
 *  7. tryCombineShares([resp1, resp2], donaNpub) → nsec reconstruído
 *  8. Verifica: getPublicKey(reconstructedNsec) === donaPubHex
 *  9. Teste negativo: tryCombineShares com wrongOwnerNpub → null
 *
 *  Por que NÃO chama startRecoveryRequest: essa função busca npub e
 *  avalistas no backend (HTTP), que não está disponível neste smoke test.
 *  Em vez disso, simulamos o pedido diretamente com wrapToRecipient.
 *
 *  CUIDADO: passos 2, 5 e 6 fazem publish real nos relays hardcoded
 *  (wss://relay.damus.io, nos.lol, relay.nostr.band). Pode falhar se a
 *  rede estiver indisponível. Se falhar, o teste faz fallback: testa
 *  tryCombineShares diretamente com as shares (sem pub/sub).
 *
 *  Requer Node 22+ (WebSocket nativo) ou o pacote `ws` instalado.
 */

// Polyfill mínimo de localStorage para Node/tsx — em produção, o browser
// fornece localStorage nativamente. Necessário porque importar api.ts
// (transitivamente, via pattern-storage) referencia localStorage em
// funções que podem ser chamadas indiretamente.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
}

// Node 22+ tem WebSocket nativo. Se não tiver, tenta carregar `ws`.
// Precisa configurar ANTES de importar nostr-pool (que cria SimplePool).
if (typeof globalThis.WebSocket === "undefined") {
  try {
    const { WebSocket: WS } = await import("ws");
    const { useWebSocketImplementation } = await import("nostr-tools/pool");
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

import { createNostrIdentity, decodeNpub, decodeNsec } from "../src/lib/nostr-keys";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { splitNsec } from "../src/lib/ssss";
import { distributeShares } from "../src/lib/recovery-distribute";
import { wrapToRecipient } from "../src/lib/gift-wrap";
import { publishEvent, closePool } from "../src/lib/nostr-pool";
import { bytesToBase64 } from "../src/lib/recovery-serialize";
import {
  subscribeToRecoveryResponses,
  tryCombineShares,
  type RecoveryResponse,
} from "../src/lib/recovery-request";
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("=== Smoke test: recovery-request (Track 4A) ===\n");

  console.log("1) Gerar identidade da dona + 2 avalistas + 1 shadow");
  const owner = createNostrIdentity();
  const avalista1 = createNostrIdentity();
  const avalista2 = createNostrIdentity();
  const shadow = createNostrIdentity();
  assert(owner.npub.startsWith("npub1"), "owner.npub começa com npub1");
  assert(
    avalista1.npub !== owner.npub &&
      avalista2.npub !== owner.npub &&
      shadow.npub !== owner.npub,
    "todos os npubs são distintos",
  );
  console.log(`   owner:    ${owner.npub.slice(0, 20)}...`);
  console.log(`   avalista1: ${avalista1.npub.slice(0, 20)}...`);
  console.log(`   avalista2: ${avalista2.npub.slice(0, 20)}...`);

  console.log("\n2) splitNsec(donaNsec) → 3 shares");
  const donaNsecBytes = decodeNsec(owner.nsec);
  const shares = await splitNsec(donaNsecBytes);
  assert(shares.length === 3, `3 shares geradas (veio: ${shares.length})`);
  assert(shares[0].length === 33, "share 0 tem 33 bytes");

  console.log("\n3) distributeShares(donaNsec, donaNpub, [3 npubs])");
  console.log("   (publish real nos relays — pode falhar se rede offline)");
  const distResult = await distributeShares(
    owner.nsec,
    owner.npub,
    [avalista1.npub, avalista2.npub, shadow.npub],
  );
  assert(
    distResult.published + distResult.failed === 3,
    `published + failed === 3 (veio: ${distResult.published}+${distResult.failed})`,
  );
  assert(
    distResult.published >= 1,
    `published >= 1 (veio: ${distResult.published}) — pode falhar se offline`,
  );
  console.log(`   vaultId: ${distResult.vaultId}`);
  console.log(`   published: ${distResult.published}, failed: ${distResult.failed}`);

  console.log("\n4) Gerar nsec efêmero (simula startRecoveryRequest sem backend)");
  const ephemeralNsec = generateSecretKey();
  const ephemeralPubHex = getPublicKey(ephemeralNsec);
  const ephemeralNpub = nip19.npubEncode(ephemeralPubHex);
  assert(ephemeralNpub.startsWith("npub1"), "ephemeralNpub começa com npub1");
  assert(ephemeralPubHex.length === 64, "ephemeralPubHex tem 64 chars");
  console.log(`   ephemeralNpub: ${ephemeralNpub.slice(0, 20)}...`);

  console.log("\n5) subscribeToRecoveryResponses no npub efêmero");
  const responses: RecoveryResponse[] = [];
  const cleanup = subscribeToRecoveryResponses(
    ephemeralNsec,
    (resp) => {
      console.log(`   ← resposta recebida de ${resp.avalistaNpub.slice(0, 20)}...`);
      responses.push(resp);
    },
    owner.npub,
  );
  assert(typeof cleanup === "function", "subscribe retornou função de cleanup");

  // Espera a subscription se estabelecer nos relays antes de publicar.
  console.log("   (aguardando 1s para subscription estabelecer...)");
  await sleep(1000);

  console.log("\n6) Simular resposta da avalista 1 (gift-wrap com share 0)");
  const responseRumor1: RecoveryRumor = {
    type: "response",
    vaultId: distResult.vaultId,
    requestEventId: "",
    approved: true,
    share: bytesToBase64(shares[0]),
    createdAt: Math.floor(Date.now() / 1000),
  };
  const wrap1 = wrapToRecipient(
    decodeNsec(avalista1.nsec),
    ephemeralPubHex,
    responseRumor1,
    [["t", RECOVERY_TAGS.response]],
  );
  assert(wrap1.kind === 1059, "wrap1 é kind 1059");
  const pub1Ok = await publishEvent(wrap1);
  assert(pub1Ok, "publish wrap1 (≥1 relay aceitou) — pode falhar se offline");

  console.log("\n7) Simular resposta da avalista 2 (gift-wrap com share 1)");
  const responseRumor2: RecoveryRumor = {
    type: "response",
    vaultId: distResult.vaultId,
    requestEventId: "",
    approved: true,
    share: bytesToBase64(shares[1]),
    createdAt: Math.floor(Date.now() / 1000),
  };
  const wrap2 = wrapToRecipient(
    decodeNsec(avalista2.nsec),
    ephemeralPubHex,
    responseRumor2,
    [["t", RECOVERY_TAGS.response]],
  );
  assert(wrap2.kind === 1059, "wrap2 é kind 1059");
  const pub2Ok = await publishEvent(wrap2);
  assert(pub2Ok, "publish wrap2 (≥1 relay aceitou) — pode falhar se offline");

  console.log("\n8) Aguardar respostas via subscription (timeout 10s)...");
  const timeoutMs = 10_000;
  const start = Date.now();
  while (responses.length < 2 && Date.now() - start < timeoutMs) {
    await sleep(200);
  }
  console.log(`   recebidas: ${responses.length} resposta(s) em ${Date.now() - start}ms`);

  // Cleanup a subscription antes de continuar.
  cleanup();

  console.log("\n9) tryCombineShares com respostas recebidas");
  if (responses.length >= 2) {
    const recovered = await tryCombineShares(responses, owner.npub);
    assert(recovered !== null, "tryCombineShares retornou nsec (não null)");
    if (recovered) {
      assert(recovered.length === 32, `nsec reconstruído tem 32 bytes (veio: ${recovered.length})`);
      const recoveredPubHex = getPublicKey(recovered);
      assert(
        recoveredPubHex === owner.publicKeyHex,
        "getPublicKey(recovered) === owner.publicKeyHex (round-trip via pub/sub)",
      );
    }
  } else {
    console.warn(
      "   ⚠ Aviso: não recebeu 2 respostas via relay — testando combine diretamente (fallback)",
    );
    failures++; // conta como falha (mas continua para testar o fallback)
  }

  console.log("\n10) Fallback: tryCombineShares com shares diretas (sem pub/sub)");
  const fakeResponses: RecoveryResponse[] = [
    {
      avalistaNpub: avalista1.npub,
      share: shares[0],
      vaultId: distResult.vaultId,
    },
    {
      avalistaNpub: avalista2.npub,
      share: shares[1],
      vaultId: distResult.vaultId,
    },
  ];
  const recoveredFallback = await tryCombineShares(fakeResponses, owner.npub);
  assert(recoveredFallback !== null, "tryCombineShares (fallback) retornou nsec");
  if (recoveredFallback) {
    assert(
      recoveredFallback.length === 32,
      `nsec fallback tem 32 bytes (veio: ${recoveredFallback.length})`,
    );
    const recoveredPubHex = getPublicKey(recoveredFallback);
    assert(
      recoveredPubHex === owner.publicKeyHex,
      "getPublicKey(recoveredFallback) === owner.publicKeyHex",
    );
    // Compara byte a byte com o nsec original
    let equal = recoveredFallback.length === donaNsecBytes.length;
    for (let i = 0; i < donaNsecBytes.length && equal; i++) {
      if (recoveredFallback[i] !== donaNsecBytes[i]) equal = false;
    }
    assert(equal, "nsec reconstruído bate com o original byte a byte");
  }

  console.log("\n11) Teste negativo: tryCombineShares com wrongOwnerNpub → null");
  const wrongResult = await tryCombineShares(fakeResponses, avalista1.npub);
  assert(wrongResult === null, "tryCombineShares retorna null com wrongOwnerNpub");

  console.log("\n12) Teste negativo: tryCombineShares com < 2 shares → null");
  const oneResponse = [fakeResponses[0]];
  const tooFew = await tryCombineShares(oneResponse, owner.npub);
  assert(tooFew === null, "tryCombineShares retorna null com < 2 shares");

  // Fecha o pool para o processo não ficar pendurado em WebSockets.
  closePool();

  console.log("\n=== Resultado ===");
  if (failures === 0) {
    console.log("✅ Todos os checks passaram.");
    process.exit(0);
  } else {
    console.error(`❌ ${failures} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Erro fatal no smoke test:", err);
  closePool();
  process.exit(1);
});
