/** recovery-respond — listener de recuperação (app da avalista).
 *
 *  Track 4B da Fase 4 do plano de recuperação Nostr do Arakne (Opção E).
 *
 *  Este módulo roda em background no app da avalista/convidadora:
 *  - Escuta gift-wraps (kind 1059) endereçados ao npub da avalista
 *  - Quando recebe um SHARD (RecoveryRumor type: "shard", enviado pela
 *    dona durante o onboarding em `distributeShares`):
 *    1. Desembrulha o gift-wrap com o nsec da avalista
 *    2. Monta um `StoredShare` a partir do rumor (decodifica base64)
 *    3. Persiste criptografado com o padrão da avalista via
 *       `storeReceivedShare(share, avalistaPattern)` (localStorage)
 *    4. Se o cache em memória está ativo (sessão destravada), mantém
 *       sincronizado para responder a pedidos imediatamente
 *    5. Chama `onShardReceived` (opcional, para UI notificar)
 *  - Quando recebe um PEDIDO (RecoveryRumor type: "request", enviado
 *    pela dona durante a recuperação em `startRecoveryRequest`):
 *    1. Desembrulha o gift-wrap com o nsec da avalista
 *    2. Chama `onRequest` (para UI mostrar notificação)
 *    3. Busca a share local guardada para o ownerNpub (no cache em
 *       memória, populado em `loadSharesIntoCache` no unlock)
 *    4. Se tem a share: gift-wrap de volta ao initiatorNpub com a share
 *    5. Publica em todos os relays
 *
 *  Modelo de resposta (decisão Track 4B — opção B):
 *  - Resposta automática — o listener mantém um cache em memória das
 *    shares descriptografadas durante a sessão. Quando a avalista faz
 *    unlock com o padrão, o cache é populado via
 *    `loadSharesIntoCache(pattern)`. O listener usa o cache para
 *    responder automaticamente sem precisar do padrão em memória (que
 *    já foi descartado após unlock).
 *  - O cache é limpo no logout via `clearSharesCache()`.
 *
 *  Armazenamento persistente (localStorage):
 *  - Shares guardadas criptografadas com o padrão da avalista
 *    (AES-GCM-256, PBKDF2 600k iterações — reusamos
 *    `encryptNsec`/`decryptNsec` que operam sobre bytes arbitrários).
 *  - Key: `arakne_received_share_<ownerNpub>` — blob base64
 *  - Índice: `arakne_received_shares_index` — JSON array de ownerNpubs
 *
 *  Armadilhas do listener em background:
 *  - O callback do `subscribeWrapsForNpub` é chamado de forma síncrona
 *    pelo `SimplePool`; se passarmos uma função async, o pool não
 *    aguarda a promise. Por isso envolvemos tudo em try/catch dentro do
 *    callback.
 *  - O listener só funciona enquanto o app está aberto e a aba ativa.
 *    Não há service worker nem push notification — se a avalista fechar
 *    o app, pedidos ficam aguardando nos relays até ela reabrir (e o
 *    subscribe usa `since: now`, então também é preciso chamar
 *    `fetchWrapsForNpub` na reabertura para baixar pendentes — Track
 *    4D cuida disso).
 */

import { getPublicKey } from "nostr-tools/pure";
import { wrapToRecipient, unwrapReceived } from "./gift-wrap";
import { publishEvent, subscribeWrapsForNpub } from "./nostr-pool";
import { bytesToBase64, base64ToBytes } from "./recovery-serialize";
import { encryptNsec, decryptNsec } from "./pattern-crypto";
import { decodeNpub } from "./nostr-keys";
import { RECOVERY_TAGS, type RecoveryRumor } from "./recovery-types";

// ── Tipos públicos ────────────────────────────────────────────

/** Share guardada pela avalista (recebida na Fase 3 via NIP-59). */
export interface StoredShare {
  /** npub da dona da share (bech32). */
  ownerNpub: string;
  /** Identificador opaco do vault. */
  vaultId: string;
  /** Índice (0-based) da share dentro do conjunto SSSS. */
  shareIndex: number;
  /** Bytes da share (33 bytes para SSSS 2-de-3 do nsec). */
  share: Uint8Array;
  /** Limiar SSSS (ex.: 2). */
  threshold: number;
  /** Total de shares geradas (ex.: 3). */
  totalShares: number;
}

/** Pedido de recuperação recebido (desembrulhado do gift-wrap). */
export interface IncomingRecoveryRequest {
  /** npub da dona do vault (para buscar a share certa). */
  ownerNpub: string;
  /** Identificador do vault (pode ser vazio — busca é por ownerNpub). */
  vaultId: string;
  /** npub efêmero para responder (bech32). */
  initiatorNpub: string;
  /** Mensagem opcional (ex.: motivo do pedido). */
  message?: string;
  /** Timestamp de criação do pedido (segundos Unix). Vem do rumor
   *  `request` (campo `createdAt`) — usado pela UI do sino para mostrar
   *  a hora. Opcional porque pedidos antigos (sem o campo) ainda podem
   *  existir em relays. */
  createdAt?: number;
}

// ── localStorage keys ──────────────────────────────────────────

const LS_SHARE_PREFIX = "arakne_received_share_";
const LS_INDEX = "arakne_received_shares_index";

// ── Cache em memória (session-scoped) ──────────────────────────
// Populado por `loadSharesIntoCache(pattern)` quando a avalista faz
// unlock. Usado pelo listener para responder automaticamente sem
// precisar do padrão em memória (que já foi descartado após unlock).
let sessionSharesCache: StoredShare[] = [];

// ── Serialização ──────────────────────────────────────────────

/** Forma serializável (JSON-safe) do StoredShare — share vira base64. */
interface SerializedShare {
  ownerNpub: string;
  vaultId: string;
  shareIndex: number;
  share: string;
  threshold: number;
  totalShares: number;
}

/** Serializa StoredShare → JSON (com share em base64) → bytes. */
function serializeShare(share: StoredShare): Uint8Array {
  const payload: SerializedShare = {
    ownerNpub: share.ownerNpub,
    vaultId: share.vaultId,
    shareIndex: share.shareIndex,
    share: bytesToBase64(share.share),
    threshold: share.threshold,
    totalShares: share.totalShares,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** Deserializa bytes → JSON → StoredShare (com share como Uint8Array). */
function deserializeShare(bytes: Uint8Array): StoredShare {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as SerializedShare;
  return {
    ownerNpub: json.ownerNpub,
    vaultId: json.vaultId,
    shareIndex: json.shareIndex,
    share: base64ToBytes(json.share),
    threshold: json.threshold,
    totalShares: json.totalShares,
  };
}

// ── API pública: armazenamento de shares ───────────────────────

/**
 * Guarda uma share recebida (quando a avalista recebeu sua share na Fase 3).
 * A share fica criptografada com o padrão da avalista no localStorage.
 *
 * Reutiliza `encryptNsec` (AES-GCM-256 + PBKDF2) — apesar do nome, a função
 * opera sobre bytes arbitrários, não apenas nsec.
 *
 * @param share - dados da share (inclui bytes da share)
 * @param avalistaPattern - padrão hexagonal da avalista (para criptografar)
 */
export async function storeReceivedShare(
  share: StoredShare,
  avalistaPattern: number[],
): Promise<void> {
  const bytes = serializeShare(share);
  const blob = await encryptNsec(bytes, avalistaPattern);
  try {
    localStorage.setItem(LS_SHARE_PREFIX + share.ownerNpub, blob);
    // Atualiza índice (idempotente — não duplica)
    const index = readIndex();
    if (!index.includes(share.ownerNpub)) {
      index.push(share.ownerNpub);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    }
    // Se o cache já está populado (sessão ativa), mantém sincronizado
    if (sessionSharesCache.length > 0 || isCached(share.ownerNpub)) {
      const existingIdx = sessionSharesCache.findIndex(
        (s) => s.ownerNpub === share.ownerNpub,
      );
      if (existingIdx >= 0) {
        sessionSharesCache[existingIdx] = share;
      } else {
        sessionSharesCache.push(share);
      }
    }
  } catch (err) {
    console.error(
      "[recovery-respond] storeReceivedShare: falha ao escrever no localStorage:",
      err,
    );
    throw err;
  }
}

/**
 * Lista todas as shares guardadas (descriptografadas).
 * @param avalistaPattern - padrão da avalista
 */
export async function listReceivedShares(
  avalistaPattern: number[],
): Promise<StoredShare[]> {
  const index = readIndex();
  const shares: StoredShare[] = [];
  for (const ownerNpub of index) {
    const blob = localStorage.getItem(LS_SHARE_PREFIX + ownerNpub);
    if (!blob) continue;
    const bytes = await decryptNsec(blob, avalistaPattern);
    if (!bytes) {
      console.warn(
        `[recovery-respond] listReceivedShares: falha ao descriptografar share de ${ownerNpub}`,
      );
      continue;
    }
    try {
      shares.push(deserializeShare(bytes));
    } catch (err) {
      console.warn(
        `[recovery-respond] listReceivedShares: share de ${ownerNpub} malformada:`,
        err,
      );
    }
  }
  return shares;
}

/**
 * Remove uma share guardada (quando a dona migra de nsec).
 */
export function removeReceivedShare(ownerNpub: string): void {
  try {
    localStorage.removeItem(LS_SHARE_PREFIX + ownerNpub);
    const index = readIndex();
    const newIndex = index.filter((np) => np !== ownerNpub);
    localStorage.setItem(LS_INDEX, JSON.stringify(newIndex));
    // Mantém cache em memória sincronizado
    sessionSharesCache = sessionSharesCache.filter(
      (s) => s.ownerNpub !== ownerNpub,
    );
  } catch (err) {
    console.warn(
      "[recovery-respond] removeReceivedShare: falha no localStorage:",
      err,
    );
  }
}

// ── API pública: cache em memória (session-scoped) ─────────────

/**
 * Popula o cache em memória com as shares descriptografadas.
 * Chamar quando a avalista faz unlock com o padrão (antes de iniciar
 * o listener). O listener usa o cache para responder automaticamente.
 *
 * @param avalistaPattern - padrão da avalista (para descriptografar)
 */
export async function loadSharesIntoCache(
  avalistaPattern: number[],
): Promise<void> {
  sessionSharesCache = await listReceivedShares(avalistaPattern);
}

/**
 * Limpa o cache em memória (chamar no logout).
 */
export function clearSharesCache(): void {
  sessionSharesCache = [];
}

/**
 * Retorna as shares atualmente no cache (session-scoped).
 * Útil para a UI mostrar a lista sem precisar descriptografar de novo.
 */
export function getCachedShares(): StoredShare[] {
  return sessionSharesCache;
}

// ── API pública: listener de pedidos ──────────────────────────

/**
 * Inicia o listener de recuperação. Roda em background quando a
 * avalista/convidadora está logada.
 *
 * Processa dois tipos de rumor:
 *
 * 1. `type: "shard"` (dona → avalista, enviado em `distributeShares`
 *    durante o onboarding): monta um `StoredShare` (decodifica base64
 *    da share), persiste criptografado com `avalistaPattern` via
 *    `storeReceivedShare`, mantém o cache em memória sincronizado e
 *    chama `onShardReceived` (opcional). É assim que a convidadora
 *    guarda a share 0 da dona.
 *
 * 2. `type: "request"` (dona → avalista, enviado em
 *    `startRecoveryRequest` durante a recuperação): chama `onRequest`
 *    (para UI notificar), busca a share no cache em memória (populado
 *    em `loadSharesIntoCache` no unlock) e, se encontrar, gift-wrap de
 *    volta ao `initiatorNpub` com a share (resposta automática).
 *
 * @param avalistaNsec - nsec da avalista (para desembrulhar pedidos e
 *   assinar resposta)
 * @param avalistaPattern - padrão hexagonal da avalista (necessário
 *   para criptografar shares recebidas via `storeReceivedShare`)
 * @param onRequest - callback opcional chamado quando um pedido chega
 *   (para UI mostrar notificação)
 * @param onShardReceived - callback opcional chamado quando uma shard
 *   chega (para UI notificar — futuro Track 4D)
 * @returns função de cleanup (parar o listener)
 */
export function startRecoveryListener(
  avalistaNsec: Uint8Array,
  avalistaPattern: number[],
  onRequest?: (request: IncomingRecoveryRequest) => void,
  onShardReceived?: (ownerNpub: string) => void,
): () => void {
  // `getPublicKey` já retorna hex string (64 chars) — não precisa de bytesToHex.
  const avalistaPubHex = getPublicKey(avalistaNsec);

  const cleanup = subscribeWrapsForNpub(avalistaPubHex, async (wrap) => {
    try {
      const unwrapped = unwrapReceived(wrap, avalistaNsec);
      if (!unwrapped) return;

      const rumor = unwrapped.content;

      // ── Shard: dona distribuiu shares durante o onboarding ──
      // Persiste a share criptografada com o padrão da avalista para
      // responder a pedidos de recuperação depois.
      if (rumor.type === "shard") {
        try {
          let shareBytes: Uint8Array;
          try {
            shareBytes = base64ToBytes(rumor.share);
          } catch (err) {
            console.error(
              "[recovery-respond] shard com share base64 inválida, ignorando:",
              err,
            );
            return;
          }
          const stored: StoredShare = {
            ownerNpub: rumor.ownerNpub,
            vaultId: rumor.vaultId,
            shareIndex: rumor.shareIndex,
            share: shareBytes,
            threshold: rumor.threshold,
            totalShares: rumor.totalShares,
          };
          await storeReceivedShare(stored, avalistaPattern);
          // Notifica UI (Track 4D) — não bloqueia o fluxo.
          try {
            onShardReceived?.(rumor.ownerNpub);
          } catch (cbErr) {
            console.warn(
              "[recovery-respond] callback onShardReceived lançou erro:",
              cbErr,
            );
          }
        } catch (err) {
          console.error(
            "[recovery-respond] erro ao processar shard:",
            err,
          );
        }
        return;
      }

      // ── Request: dona pediu a share de volta (recuperação) ──
      if (rumor.type !== "request") return;

      const request = rumor;
      const incomingRequest: IncomingRecoveryRequest = {
        ownerNpub: request.ownerNpub,
        vaultId: request.vaultId,
        initiatorNpub: request.initiatorNpub,
        message: request.message,
        createdAt: request.createdAt,
      };

      // Notifica UI (Track 4D) — não bloqueia a resposta automática.
      try {
        onRequest?.(incomingRequest);
      } catch (cbErr) {
        console.warn(
          "[recovery-respond] callback onRequest lançou erro:",
          cbErr,
        );
      }

      // Resposta automática: busca share no cache em memória.
      const share = sessionSharesCache.find(
        (s) => s.ownerNpub === request.ownerNpub,
      );
      if (!share) {
        console.warn(
          `[recovery-respond] pedido de ${request.ownerNpub} mas nenhuma share no cache`,
        );
        return;
      }

      // Publica o gift-wrap de resposta (type: "response") à convidada.
      // Reusa a função pública `publishRecoveryResponse` (Track 4D) — o
      // QR on-demand é uma camada extra; a resposta automática continua
      // sendo publicada para o caso da convidada não escanear o QR.
      await publishRecoveryResponse(
        avalistaNsec,
        share,
        request.initiatorNpub,
        wrap.id,
      );
    } catch (err) {
      console.error("[recovery-respond] erro ao processar wrap:", err);
    }
  });

  return cleanup;
}

// ── API pública: resposta manual (Track 4D — QR on-demand) ────

/**
 * Busca a share guardada no cache em memória para um dado ownerNpub.
 * Usado pelo RecoveryQRGenerator (Track 4D) para desembrulhar a share 0
 * que a tecelã tem em cache e gerar o QR efêmero.
 *
 * @param ownerNpub - npub (bech32) da dona do vault
 * @returns a share guardada, ou null se não houver (cache vazio ou
 *   dona desconhecida)
 */
export function getShareForOwner(ownerNpub: string): StoredShare | null {
  const share = sessionSharesCache.find((s) => s.ownerNpub === ownerNpub);
  return share ?? null;
}

/**
 * Publica um gift-wrap `type:"response"` endereçado ao npub efêmero da
 * convidada, contendo a share 0. Usado pelo listener (resposta automática)
 * e pelo RecoveryQRGenerator (Track 4D — QR on-demand). Reusa a mesma
 * lógica de gift-wrap NIP-59 do listener.
 *
 * @param avalistaNsec - nsec da tecelã (assina o seal)
 * @param share - share guardada (vai no content do rumor, em base64)
 * @param initiatorNpub - npub efêmero da convidada (destinatário)
 * @param requestEventId - event id (hex) do rumor `request` original
 *   (referência de resposta — pode ser string vazia se desconhecido)
 * @returns true se publicou em ≥1 relay, false caso contrário
 */
export async function publishRecoveryResponse(
  avalistaNsec: Uint8Array,
  share: StoredShare,
  initiatorNpub: string,
  requestEventId: string,
): Promise<boolean> {
  // Cria rumor de resposta (type: "response") com a share.
  const responseRumor: RecoveryRumor = {
    type: "response",
    vaultId: share.vaultId,
    requestEventId,
    approved: true,
    share: bytesToBase64(share.share),
    createdAt: Math.floor(Date.now() / 1000),
  };

  // Decodifica initiatorNpub bech32 → hex para gift-wrap.
  const initiatorPubHex = decodeNpub(initiatorNpub);

  // Gift-wrap de volta ao initiator (NIP-59: rumor → seal → wrap).
  // O seal é assinado com o nsec da avalista (remetente).
  const responseWrap = wrapToRecipient(
    avalistaNsec,
    initiatorPubHex,
    responseRumor,
    [["t", RECOVERY_TAGS.response]],
  );

  // Publica em TODOS os relays hardcoded (redundância).
  const ok = await publishEvent(responseWrap);
  if (!ok) {
    console.error(
      "[recovery-respond] falha ao publicar resposta em todos os relays",
    );
  }
  return ok;
}

// ── Helpers internos ───────────────────────────────────────────

/** Lê o índice de ownerNpubs do localStorage (array de strings). */
function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Verifica se um ownerNpub está no cache em memória. */
function isCached(ownerNpub: string): boolean {
  return sessionSharesCache.some((s) => s.ownerNpub === ownerNpub);
}
