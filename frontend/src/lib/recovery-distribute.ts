/** recovery-distribute — orquestra a distribuição de shares SSSS (Opção E).
 *
 *  Modelo Opção E: T=2, N=2.
 *  - Share 0: enviada à convidadora (única tecelã de confiança) via
 *    NIP-59 gift-wrap. Se a dona não tem convidadora
 *    (`avalistasNpubs.length === 0`), a share 0 fica como backup de
 *    papel — responsabilidade da UI/caller, não deste módulo.
 *  - Share 1: criptografada com o PIN da dona (AES-GCM-256 + PBKDF2 do
 *    PIN) e POSTada ao backend, que guarda como blob opaco.
 *
 *  Fluxo:
 *  1. Decodifica o nsec da dona (bech32 ou bytes).
 *  2. `splitNsec(nsec)` → 2 shares (33 bytes cada, threshold 2).
 *  3. Share 0: se houver convidadora, monta um `RecoveryRumor` (type:
 *     "shard") e envelopa com `wrapToRecipient()` (NIP-59) endereçado
 *     ao npub da convidadora. Publica em TODOS os relays hardcoded.
 *  4. Share 1: criptografa com `encryptWithPin(share1, pin)` e faz
 *     `uploadRecoveryShare(blob)` para o backend.
 *  5. Marca no localStorage que a distribuição foi feita (idempotência UI).
 *
 *  Modelo de ameaça: o nsec da dona é usado para assinar o seal (NIP-59
 *  exige que o remetente assine com sua chave). Isso é correto — a dona
 *  está enviando suas próprias shares. O wrap (kind 1059) usa uma chave
 *  efêmera aleatória, então o relay não sabe quem enviou. A share 1
 *  nunca sai do dispositivo em plaintext — o backend só vê o blob
 *  criptografado com o PIN (que o backend não conhece).
 */

import { splitNsec, N, T } from "./ssss";
import { wrapToRecipient } from "./gift-wrap";
import { publishEvent } from "./nostr-pool";
import { bytesToBase64 } from "./recovery-serialize";
import { decodeNsec, decodeNpub } from "./nostr-keys";
import { RECOVERY_TAGS, type RecoveryRumor } from "./recovery-types";
import { encryptWithPin } from "./pattern-crypto";
import { uploadRecoveryShare } from "../api";

/** Chaves de localStorage para o flag de distribuição. */
const LS_DISTRIBUTED = "arakne_recovery_distributed";
const LS_VAULT_ID = "arakne_recovery_vault_id";

/** Resultado de `distributeShares()`. */
export interface DistributeResult {
  /** Identificador opaco do vault (gerado nesta distribuição). */
  vaultId: string;
  /** Total de shares geradas (fixo em 2 — Opção E). */
  totalShares: number;
  /** Threshold SSSS (fixo em 2 — Opção E). */
  threshold: number;
  /** Quantas shares foram publicadas com sucesso (≥1 relay aceitou). */
  published: number;
  /** Quantas shares falharam ao publicar (todos os relays rejeitaram). */
  failed: number;
  /** True se a share 1 foi enviada ao backend com sucesso. */
  backendUploaded: boolean;
  /** Share 0 em base64 para backup de papel — presente apenas quando
   *  não há convidadora (avalistasNpubs.length === 0). A dona deve anotar
   *  este código em papel para recuperar sem convidadora (fallback E′). */
  paperBackupShare?: string;
}

/** Gera um UUID v4 se disponível, senão fallback determinístico-ish. */
function generateVaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Distribui shares SSSS do nsec: share 0 à convidadora (NIP-59) e
 * share 1 ao backend (criptografada com PIN).
 *
 * @param nsec - nsec da dona (bech32 `nsec1...` ou bytes 32) — a chave
 *   privada a ser protegida. NUNCA deve ser enviada ao backend.
 * @param ownerNpub - npub da dona (bech32 `npub1...`). Vai no campo
 *   `ownerNpub` do rumor para que a convidadora saiba de quem é o shard.
 * @param avalistasNpubs - npubs das tecelãs de confiança (Opção E: 0
 *   ou 1 entrada — a convidadora). 0 entradas significa que a dona não
 *   tem convidadora; a share 0 fica como backup de papel (caller cuida).
 * @param pin - PIN da dona, usado para criptografar a share 1 antes de
 *   enviar ao backend. A dona precisa lembrar do PIN para recuperar.
 * @returns resultado da distribuição (contagem de published/failed +
 *   flag `backendUploaded`)
 * @throws se `avalistasNpubs.length > N` ou se o nsec for inválido
 */
export async function distributeShares(
  nsec: string | Uint8Array,
  ownerNpub: string,
  avalistasNpubs: string[],
  pin: string,
): Promise<DistributeResult> {
  if (avalistasNpubs.length > N) {
    throw new Error(
      `distributeShares: esperado ≤${N} avalistas, recebido ${avalistasNpubs.length}`,
    );
  }

  // 1. Decodifica o nsec (bech32 ou bytes direto).
  const nsecBytes: Uint8Array =
    typeof nsec === "string" ? decodeNsec(nsec) : nsec;
  if (nsecBytes.length !== 32) {
    throw new Error(
      `distributeShares: nsec deve ter 32 bytes, tem ${nsecBytes.length}`,
    );
  }

  // 2. Gera o vaultId (idempotente entre tentativas? Não — cada chamada
  //    gera um novo vault. A UI deve checar `isDistributed()` antes.)
  const vaultId = generateVaultId();

  // 3. Divide o nsec em 2 shares (threshold 2).
  const shares = await splitNsec(nsecBytes);

  let published = 0;
  let failed = 0;

  // 4. Share 0 → convidadora via NIP-59 gift-wrap (se houver convidadora).
  if (avalistasNpubs.length >= 1) {
    const share0 = shares[0];
    const convidadoraNpub = avalistasNpubs[0];
    const convidadoraPubKeyHex = decodeNpub(convidadoraNpub);

    const rumorContent: RecoveryRumor = {
      type: "shard",
      ownerNpub,
      vaultId,
      threshold: T,
      totalShares: N,
      shareIndex: 0,
      share: bytesToBase64(share0),
      scheme: "gf256_v1",
      createdAt: Math.floor(Date.now() / 1000),
    };

    const wrap = wrapToRecipient(
      nsecBytes,
      convidadoraPubKeyHex,
      rumorContent,
      [["t", RECOVERY_TAGS.shard]],
    );

    try {
      const ok = await publishEvent(wrap);
      if (ok) {
        published++;
      } else {
        failed++;
        console.error(
          "[recovery-distribute] share 0 (convidadora) falhou em todos os relays",
        );
      }
    } catch (err) {
      failed++;
      console.error(
        "[recovery-distribute] share 0 erro ao publicar:",
        err,
      );
    }
  }
  // else: sem convidadora — share 0 fica como backup de papel (caller).

  // Captura share 0 em base64 para backup de papel quando não há convidadora.
  const paperBackupShare =
    avalistasNpubs.length === 0 ? bytesToBase64(shares[0]) : undefined;

  // 5. Share 1 → backend (criptografada com PIN da dona).
  let backendUploaded = false;
  try {
    const share1 = shares[1];
    const blob = await encryptWithPin(share1, pin);
    backendUploaded = await uploadRecoveryShare(blob);
    if (!backendUploaded) {
      failed++;
      console.error(
        "[recovery-distribute] share 1 (backend) falhou ao enviar",
      );
    }
  } catch (err) {
    failed++;
    console.error(
      "[recovery-distribute] share 1 erro ao criptografar/enviar:",
      err,
    );
  }

  // 6. Marca no localStorage que a distribuição foi feita.
  markDistributed(vaultId);

  return {
    vaultId,
    totalShares: N,
    threshold: T,
    published,
    failed,
    backendUploaded,
    paperBackupShare,
  };
}

/** Marca no localStorage que a distribuição foi feita.
 *
 *  Guarda dois flags:
 *  - `arakne_recovery_distributed`: "1" (booleano serializado)
 *  - `arakne_recovery_vault_id`: o vaultId gerado (para referência futura)
 */
export function markDistributed(vaultId: string): void {
  try {
    localStorage.setItem(LS_DISTRIBUTED, "1");
    localStorage.setItem(LS_VAULT_ID, vaultId);
  } catch (err) {
    // localStorage pode estar indisponível (modo privado, quota cheia).
    // Não é fatal — a distribuição já foi publicada nos relays.
    console.warn(
      "[recovery-distribute] não foi possível escrever no localStorage:",
      err,
    );
  }
}

/** Verifica se a distribuição já foi feita (flag no localStorage). */
export function isDistributed(): boolean {
  try {
    return localStorage.getItem(LS_DISTRIBUTED) === "1";
  } catch {
    return false;
  }
}

/** Limpa o flag de distribuição (para re-distribuir ou resetar o app). */
export function clearDistributed(): void {
  try {
    localStorage.removeItem(LS_DISTRIBUTED);
    localStorage.removeItem(LS_VAULT_ID);
  } catch {
    // silencioso — localStorage indisponível não é fatal aqui
  }
}
