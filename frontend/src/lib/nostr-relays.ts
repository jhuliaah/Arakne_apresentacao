/** Relays Nostr hardcoded — camada de pub/sub para recuperação social.
 *
 *  O modelo de recuperação do Arakne (NIP-17/59 + SSSS M-of-N) depende de
 *  gift-wraps (kind 1059) chegarem a avalistas meses depois de enviados.
 *  Por isso usamos 3 relays públicos hardcoded com redundância:
 *
 *  - Publish em TODOS os 3 (se um cair, os outros 2 ainda têm o wrap).
 *  - Subscribe em round-robin (ouve todos simultaneamente).
 *
 *  Sem NIP-42 AUTH (cortado para simplificar) e sem NIP-65 dinâmico
 *  (Outbox model) — os relays são fixos e já estão na CSP do index.html.
 *
 *  Não adicione relays aqui sem atualizar a CSP em `frontend/index.html`
 *  (connect-src deve listar cada wss:// explicitamente).
 */

export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
] as const;

export type RelayUrl = (typeof RELAYS)[number];
