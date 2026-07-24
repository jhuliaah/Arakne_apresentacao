/** gift-wrap — primitiva NIP-59 (gift-wrap) para recuperação social no Arakne.
 *
 *  O NIP-59 cria uma camada de privacidade sobre mensagens Nostr:
 *  1. **Rumor** (kind 1, não assinado) — o conteúdo real. Tem `pubkey` do
 *     autor mas sem `sig`, então não é um evento publicável.
 *  2. **Seal** (kind 13) — assina o rumor com a chave do remetente e
 *     criptografa (NIP-44) para a chave pública do destinatário.
 *  3. **Wrap** (kind 1059) — envolve o seal com uma chave efêmera aleatória,
 *     criptografada (NIP-44) para o destinatário. Tag `p` = destinatário.
 *
 *  O relay só vê o wrap (kind 1059) com pubkey efêmera — não sabe quem enviou
 *  nem o conteúdo. O destinatário desembrulha com sua chave privada.
 *
 *  Módulos usados: `nostr-tools/nip59` (createRumor/createSeal/createWrap/
 *  unwrapEvent — exportados como funções avulsas, NÃO como namespace `nip59`)
 *  e `nostr-tools/pure` (getPublicKey, tipo NostrEvent).
 *
 *  Nota: `nostr-tools/types` não é um export válido do pacote — importamos
 *  `NostrEvent` de `nostr-tools/pure` (que re-exporta `core.ts`).
 *  Nota: o namespace `nip59` só existe no entrypoint principal `nostr-tools`;
 *  o subpath `nostr-tools/nip59` exporta as funções diretamente.
 */

import {
  createRumor,
  createSeal,
  createWrap,
  unwrapEvent,
} from "nostr-tools/nip59";
import { getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";
import type { RecoveryRumor } from "./recovery-types";

/** Resultado de unwrapReceived — o rumor decodificado + metadados do sender. */
export interface UnwrappedRumor {
  /** Content do rumor parseado como RecoveryRumor. */
  content: RecoveryRumor;
  /** Pubkey (hex) do remetente — derivada da chave que assinou o seal. */
  pubkey: string;
  /** Tags do rumor (ex.: [["t", "arakne-recovery-shard"]]). */
  tags: string[][];
  /** Timestamp do rumor (segundos Unix). */
  createdAt: number;
}

/**
 * Cria um gift-wrap (NIP-59) endereçado a um destinatário.
 *
 * Pipeline: rumor (kind 1, não assinado) → seal (kind 13, NIP-44) →
 * wrap (kind 1059, chave efêmera aleatória).
 *
 * @param senderPrivKey - bytes da chave privada do remetente (32 bytes)
 * @param recipientPubKeyHex - hex da chave pública do destinatário (64 chars, NÃO npub bech32)
 * @param rumorContent - objeto RecoveryRumor que vai no content do rumor
 * @param rumorTags - tags adicionais do rumor (ex.: ["t", "arakne-recovery-shard"])
 * @returns evento kind 1059 (gift wrap) assinado, pronto para publicar
 */
export function wrapToRecipient(
  senderPrivKey: Uint8Array,
  recipientPubKeyHex: string,
  rumorContent: RecoveryRumor,
  rumorTags: string[][] = [],
): NostrEvent {
  const rumorTemplate = {
    kind: 1,
    content: JSON.stringify(rumorContent),
    tags: rumorTags,
    created_at: Math.floor(Date.now() / 1000),
  };
  // createRumor preenche pubkey (do sender) e id (hash); não assina.
  const rumor = createRumor(rumorTemplate, senderPrivKey);
  // createSeal assina kind 13 com a chave do sender e NIP-44-criptografa
  // o rumor para o destinatário. created_at é randomizado (privacidade NIP-59).
  const seal = createSeal(rumor, senderPrivKey, recipientPubKeyHex);
  // createWrap gera chave efêmera, assina kind 1059, NIP-44-criptografa o seal.
  // Tag ["p", recipientPubKeyHex] é adicionada automaticamente.
  const wrap = createWrap(seal, recipientPubKeyHex);
  return wrap;
}

/**
 * Desembrulha um gift-wrap (NIP-59) recebido.
 *
 * @param wrap - evento kind 1059 recebido do relay
 * @param recipientPrivKey - bytes da chave privada do destinatário (32 bytes)
 * @returns o rumor desembrulhado, OU null se a chave estiver errada/evento inválido
 */
export function unwrapReceived(
  wrap: NostrEvent,
  recipientPrivKey: Uint8Array,
): UnwrappedRumor | null {
  try {
    // unwrapEvent desembrulha o wrap (kind 1059) → seal (kind 13) → rumor.
    // Lança exceção se a chave estiver errada (MAC mismatch no NIP-44).
    const rumor = unwrapEvent(wrap, recipientPrivKey);
    const parsed = JSON.parse(rumor.content) as unknown;
    if (!isRecoveryRumor(parsed)) {
      return null;
    }
    return {
      content: parsed,
      pubkey: rumor.pubkey,
      tags: rumor.tags,
      createdAt: rumor.created_at,
    };
  } catch {
    // Chave errada (MAC mismatch), content não-JSON, ou evento malformado.
    return null;
  }
}

/**
 * Cria um gift-wrap para si mesmo (self-wrap).
 *
 * Útil para o remetente guardar cópia da mensagem na própria inbox.
 * (NÃO usar para o backup automático — cortado do escopo. Só se necessário.)
 *
 * @param privKey - bytes da chave privada (32 bytes)
 * @param rumorContent - objeto RecoveryRumor
 * @param rumorTags - tags adicionais do rumor
 * @returns evento kind 1059 endereçado ao próprio dono da chave
 */
export function wrapSelf(
  privKey: Uint8Array,
  rumorContent: RecoveryRumor,
  rumorTags: string[][] = [],
): NostrEvent {
  const selfPubKeyHex = getPublicKey(privKey);
  return wrapToRecipient(privKey, selfPubKeyHex, rumorContent, rumorTags);
}

/** Type guard runtime para RecoveryRumor.
 *
 *  Valida que o objeto parseado tem um `type` válido e `createdAt` numérico.
 *  Não valida todos os campos de cada variante — confiamos no remetente
 *  (que é autenticado pela assinatura do seal). Validação completa de schema
 *  pode ser adicionada depois se necessário.
 */
function isRecoveryRumor(obj: unknown): obj is RecoveryRumor {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const o = obj as { type?: unknown; createdAt?: unknown };
  if (
    o.type !== "shard" &&
    o.type !== "request" &&
    o.type !== "response"
  ) {
    return false;
  }
  if (typeof o.createdAt !== "number") {
    return false;
  }
  return true;
}
