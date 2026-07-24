/** recovery-types — tipos das mensagens de recuperação social de conta.
 *
 *  O Arakne implementa recuperação social via Nostr: os shards do nsec
 *  (divididos por SSSS) são distribuídos a avalistas como gift-wraps (NIP-59).
 *  Esta fase define o formato do *rumor* (kind 1, não assinado) que vai dentro
 *  do envelope. O content do rumor é sempre JSON estruturado com um campo
 *  `type` discriminando a variante.
 *
 *  Pipeline NIP-59: rumor (kind 1) → seal (kind 13, NIP-44) → wrap (kind 1059).
 *  Sem NIP-17 wrapper semântico (cortado para simplificar).
 *  Sem NIP-31 `alt` tag (kind 1 é standard).
 *
 *  Decidido pela librarian na Fase 0 do plano de recuperação Nostr.
 */

/** Rumor de recuperação — vai no `content` (JSON) de um rumor kind 1.
 *
 *  Discriminated union em `type`:
 *  - `shard`:    avalista → owner. Entrega de um shard do nsec.
 *  - `request`:  owner → avalista. Pedido de reenvio/liberação de shard.
 *  - `response`: avalista → owner. Resposta (aprovada ou não) a um request.
 */
export type RecoveryRumor =
  | {
      type: "shard";
      /** npub (bech32) da dona do vault — para quem o shard pertence. */
      ownerNpub: string;
      /** Identificador opaco do vault (gerado no cadastro do backup). */
      vaultId: string;
      /** Limiar SSSS (ex.: 3 de 5). */
      threshold: number;
      /** Total de shares geradas. */
      totalShares: number;
      /** Índice (0-based) deste shard dentro do conjunto. */
      shareIndex: number;
      /** Shard codificada em base64. */
      share: string;
      /** Esquema de splitting usado (para versionamento futuro). */
      scheme: "gf256_v1";
      /** Timestamp de criação (segundos Unix). */
      createdAt: number;
    }
  | {
      type: "request";
      /** npub da dona do vault. */
      ownerNpub: string;
      /** Identificador do vault sendo recuperado. */
      vaultId: string;
      /** npub de quem iniciou o pedido (pode ser a própria owner ou outra). */
      initiatorNpub: string;
      /** Mensagem opcional (ex.: motivo do pedido). */
      message?: string;
      /** Timestamp de criação (segundos Unix). */
      createdAt: number;
    }
  | {
      type: "response";
      /** Identificador do vault. */
      vaultId: string;
      /** Event ID (hex) do rumor `request` que originou esta resposta. */
      requestEventId: string;
      /** Se o avalista aprovou o reenvio do shard. */
      approved: boolean;
      /** Shard codificada em base64 — só presente se `approved === true`. */
      share?: string;
      /** Motivo opcional da recusa (se `approved === false`). */
      reason?: string;
      /** Timestamp de criação (segundos Unix). */
      createdAt: number;
    };

/** Tags `t` usadas nos rumors de recuperação (para filtragem no relay).
 *
 *  O NIP-12 indexa tags `t` no relay, permitindo subscrever apenas eventos
 *  de recuperação sem baixar todo o kind 1059 da inbox.
 */
export const RECOVERY_TAGS = {
  shard: "arakne-recovery-shard",
  request: "arakne-recovery-request",
  response: "arakne-recovery-response",
} as const;
