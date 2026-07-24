/** Smoke test para src/lib/recovery-respond.ts (Track 4B).
 *
 *  Rode com:  npx tsx scripts/test-recovery-respond.ts
 *
 *  Valida:
 *  1. storeReceivedShare / listReceivedShares / removeReceivedShare (round-trip)
 *  2. loadSharesIntoCache / getCachedShares / clearSharesCache
 *  3. Fluxo completo pub/sub:
 *     - Gera 2 identidades (avalista + pedinte efêmero)
 *     - Avalista guarda uma share fictícia + popula cache
 *     - Inicia listener na avalista
 *     - Pedinte gift-wrap um `type: "request"` para a avalista e publica
 *     - Listener detecta, busca share no cache, gift-wrap `type: "response"`
 *       de volta ao npub efêmero do pedinte e publica
 *     - Subscribe no npub do pedinte recebe a response
 *     - Verifica: share recebida bate com a share guardada
 *
 *  CUIDADO: este teste faz pub/sub real nos relays Nostr públicos
 *  (wss://relay.damus.io, wss://nos.lol, wss://relay.nostr.band).
 *  Pode falhar por rede, firewall, ou se os relays estiverem indisponíveis.
 *  Se falhar por rede, tudo bem — é só teste manual.
 *
 *  Requer Node 22+ (WebSocket nativo) ou o pacote `ws` instalado.
 */

// ── localStorage mock (Node não tem localStorage nativo) ─────────
const store = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, String(value));
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => {
    store.clear();
  },
  key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
  get length(): number {
    return store.size;
  },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

// ── WebSocket polyfill (Node 22+ tem nativo, senão usa `ws`) ────
import { useWebSocketImplementation } from "nostr-tools/pool";

if (typeof globalThis.WebSocket === "undefined") {
  try {
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

// ── Imports (após polyfills) ───────────────────────────────────
import { createNostrIdentity, decodeNsec } from "../src/lib/nostr-keys";
import { wrapToRecipient, unwrapReceived } from "../src/lib/gift-wrap";
import { publishEvent, subscribeWrapsForNpub, closePool } from "../src/lib/nostr-pool";
import { base64ToBytes } from "../src/lib/recovery-serialize";
import { RECOVERY_TAGS, type RecoveryRumor } from "../src/lib/recovery-types";
import {
  storeReceivedShare,
  listReceivedShares,
  removeReceivedShare,
  loadSharesIntoCache,
  getCachedShares,
  clearSharesCache,
  startRecoveryListener,
  type StoredShare,
  type IncomingRecoveryRequest,
} from "../src/lib/recovery-respond";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

// Padrão de teste: 8 vértices (mínimo de entropia do HexPatternCanvas).
const AVALISTA_PATTERN = [0, 1, 5, 10, 15, 20, 25, 30];
const AVALISTA_PATTERN_WRONG = [0, 2, 6, 11, 16, 21, 26, 31];

async function main(): Promise<void> {
  console.log("=== Smoke test: recovery-respond (Track 4B) ===\n");

  // ── Parte 1: armazenamento de shares (sem rede) ──────────────

  console.log("1) Gerar identidades: avalista + pedinte + owner fictício");
  const avalista = createNostrIdentity();
  const pedinte = createNostrIdentity();
  const owner = createNostrIdentity(); // dona fictícia do vault
  assert(avalista.npub.startsWith("npub1"), "avalista.npub começa com npub1");
  assert(pedinte.npub.startsWith("npub1"), "pedinte.npub começa com npub1");
  assert(owner.npub.startsWith("npub1"), "owner.npub começa com npub1");
  assert(
    avalista.npub !== pedinte.npub && avalista.npub !== owner.npub,
    "identidades são distintas",
  );

  console.log("\n2) storeReceivedShare(share, avalistaPattern)");
  const fakeShare: StoredShare = {
    ownerNpub: owner.npub,
    vaultId: "vault-test-4b-001",
    shareIndex: 0,
    share: crypto.getRandomValues(new Uint8Array(33)),
    threshold: 2,
    totalShares: 3,
  };
  await storeReceivedShare(fakeShare, AVALISTA_PATTERN);
  assert(
    store.has("arakne_received_share_" + owner.npub),
    "share guardada no localStorage com key correta",
  );
  assert(
    store.has("arakne_received_shares_index"),
    "índice criado no localStorage",
  );
  const indexRaw = store.get("arakne_received_shares_index");
  assert(
    indexRaw !== undefined && JSON.parse(indexRaw).includes(owner.npub),
    "índice contém owner.npub",
  );

  console.log("\n3) listReceivedShares(avalistaPattern) — round-trip");
  const listed = await listReceivedShares(AVALISTA_PATTERN);
  assert(listed.length === 1, `list retorna 1 share (veio: ${listed.length})`);
  if (listed.length === 1) {
    const s = listed[0];
    assert(s.ownerNpub === fakeShare.ownerNpub, "ownerNpub bate (round-trip)");
    assert(s.vaultId === fakeShare.vaultId, "vaultId bate");
    assert(s.shareIndex === fakeShare.shareIndex, "shareIndex bate");
    assert(s.threshold === fakeShare.threshold, "threshold bate");
    assert(s.totalShares === fakeShare.totalShares, "totalShares bate");
    assert(s.share.length === 33, `share tem 33 bytes (veio: ${s.share.length})`);
    let bytesEqual = s.share.length === fakeShare.share.length;
    for (let i = 0; i < fakeShare.share.length && bytesEqual; i++) {
      if (s.share[i] !== fakeShare.share[i]) bytesEqual = false;
    }
    assert(bytesEqual, "bytes da share batem (round-trip)");
  }

  console.log("\n4) listReceivedShares com padrão errado → array vazio");
  const listedWrong = await listReceivedShares(AVALISTA_PATTERN_WRONG);
  assert(
    listedWrong.length === 0,
    `padrão errado retorna 0 shares (veio: ${listedWrong.length})`,
  );

  console.log("\n5) loadSharesIntoCache + getCachedShares");
  await loadSharesIntoCache(AVALISTA_PATTERN);
  const cached = getCachedShares();
  assert(cached.length === 1, `cache tem 1 share (veio: ${cached.length})`);
  if (cached.length === 1) {
    assert(
      cached[0].ownerNpub === fakeShare.ownerNpub,
      "cache tem a share certa",
    );
  }

  console.log("\n6) clearSharesCache");
  clearSharesCache();
  assert(getCachedShares().length === 0, "cache limpo");

  // Re-popula para o teste de pub/sub
  await loadSharesIntoCache(AVALISTA_PATTERN);

  console.log("\n7) removeReceivedShare(ownerNpub)");
  // Não vamos remover ainda — precisamos para o teste de pub/sub.
  // Apenas verificamos que a função não lança erro e mantém o cache
  // sincronizado. Vamos criar uma share extra, remover, e checar.
  const extraOwner = createNostrIdentity();
  const extraShare: StoredShare = {
    ownerNpub: extraOwner.npub,
    vaultId: "vault-extra",
    shareIndex: 1,
    share: crypto.getRandomValues(new Uint8Array(33)),
    threshold: 2,
    totalShares: 3,
  };
  await storeReceivedShare(extraShare, AVALISTA_PATTERN);
  await loadSharesIntoCache(AVALISTA_PATTERN);
  assert(getCachedShares().length === 2, "cache tem 2 shares após add extra");
  removeReceivedShare(extraOwner.npub);
  assert(
    !store.has("arakne_received_share_" + extraOwner.npub),
    "share extra removida do localStorage",
  );
  assert(
    getCachedShares().length === 1,
    "cache tem 1 share após remover extra",
  );
  assert(
    getCachedShares()[0].ownerNpub === owner.npub,
    "share certa permanece no cache",
  );

  // ── Parte 2: fluxo completo pub/sub (rede real) ──────────────

  console.log("\n8) Fluxo pub/sub: pedinte envia request, avalista responde");
  console.log("   (requer conexão com relays Nostr públicos)");

  // Estado compartilhado entre listener e asserts
  let receivedRequest: IncomingRecoveryRequest | null = null;
  let receivedResponseContent: Extract<RecoveryRumor, { type: "response" }> | null = null;
  const pedinteNsecBytes = decodeNsec(pedinte.nsec);

  // 8a. Inicia listener na avalista (subscreve wraps no npub dela)
  console.log("   → iniciando listener na avalista...");
  const cleanupListener = startRecoveryListener(
    decodeNsec(avalista.nsec),
    (req) => {
      receivedRequest = req;
      console.log(
        `   ✓ listener detectou pedido de ${req.ownerNpub.slice(0, 12)}...`,
      );
    },
  );
  assert(typeof cleanupListener === "function", "listener retornou cleanup");

  // 8b. Inscreve no npub do pedinte para receber a response
  console.log("   → inscrevendo no npub do pedinte para receber response...");
  const cleanupPedinteSub = subscribeWrapsForNpub(
    pedinte.publicKeyHex,
    async (wrap) => {
      const unwrapped = unwrapReceived(wrap, pedinteNsecBytes);
      if (unwrapped && unwrapped.content.type === "response") {
        receivedResponseContent = unwrapped.content;
        console.log("   ✓ pedinte recebeu response");
      }
    },
  );
  assert(typeof cleanupPedinteSub === "function", "subscribe pedinte retornou cleanup");

  // 8c. Pequeno delay para os subs abrirem antes de publicar
  await new Promise((r) => setTimeout(r, 1500));

  // 8d. Pedinte cria rumor de request e gift-wrap para a avalista
  console.log("   → pedinte publicando request...");
  const requestRumor: RecoveryRumor = {
    type: "request",
    ownerNpub: owner.npub,
    vaultId: "vault-test-4b-001",
    initiatorNpub: pedinte.npub,
    message: "smoke test Track 4B",
    createdAt: Math.floor(Date.now() / 1000),
  };
  const requestWrap = wrapToRecipient(
    pedinteNsecBytes,
    avalista.publicKeyHex,
    requestRumor,
    [["t", RECOVERY_TAGS.request]],
  );
  const published = await publishEvent(requestWrap);
  assert(published, "request publicado em ≥1 relay");

  if (!published) {
    console.error(
      "\n❌ Publish falhou — abortando teste de pub/sub (verifique rede/relays).",
    );
    cleanupListener();
    cleanupPedinteSub();
    closePool();
    // Continua para o cleanup final e report
  } else {
    // 8e. Aguarda listener detectar + responder + pedinte receber (timeout 30s)
    console.log("   → aguardando listener detectar e responder (timeout 30s)...");
    const timeoutMs = 30_000;
    const start = Date.now();
    while (
      (!receivedRequest || !receivedResponseContent) &&
      Date.now() - start < timeoutMs
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }

    assert(receivedRequest !== null, "listener detectou o pedido");
    // TS não rastreia assignment via closure — re-tipamos para acessar campos.
    const req = receivedRequest as IncomingRecoveryRequest | null;
    if (req) {
      assert(
        req.ownerNpub === owner.npub,
        "request.ownerNpub bate com o do rumor enviado",
      );
      assert(
        req.initiatorNpub === pedinte.npub,
        "request.initiatorNpub bate com o do rumor enviado",
      );
      assert(
        req.vaultId === "vault-test-4b-001",
        "request.vaultId bate",
      );
    }

    assert(receivedResponseContent !== null, "pedinte recebeu response");
    const resp = receivedResponseContent as Extract<
      RecoveryRumor,
      { type: "response" }
    > | null;
    if (resp) {
      assert(resp.type === "response", "response.type === 'response'");
      assert(resp.approved === true, "response.approved === true");
      assert(
        resp.vaultId === "vault-test-4b-001",
        "response.vaultId bate",
      );
      assert(
        typeof resp.share === "string" && resp.share.length > 0,
        "response tem share base64 não-vazia",
      );
      assert(
        resp.requestEventId === requestWrap.id,
        "response.requestEventId === requestWrap.id",
      );
      if (resp.share) {
        const receivedShareBytes = base64ToBytes(resp.share);
        let equal = receivedShareBytes.length === fakeShare.share.length;
        for (let i = 0; i < fakeShare.share.length && equal; i++) {
          if (receivedShareBytes[i] !== fakeShare.share[i]) equal = false;
        }
        assert(
          equal,
          "share recebida na response bate com a share guardada (byte a byte)",
        );
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────
  console.log("\n9) Cleanup");
  cleanupListener();
  cleanupPedinteSub();
  closePool();
  console.log("   ✓ pool fechado");

  // Remove a share fictícia do localStorage
  removeReceivedShare(owner.npub);
  assert(
    !store.has("arakne_received_share_" + owner.npub),
    "share fictícia removida do localStorage",
  );
  const finalList = await listReceivedShares(AVALISTA_PATTERN);
  assert(finalList.length === 0, "listReceivedShares retorna 0 após cleanup");

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
  process.exit(1);
});
