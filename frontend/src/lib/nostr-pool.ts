/** nostr-pool — camada de pub/sub sobre relays Nostr hardcoded.
 *
 *  Singleton `SimplePool` do `nostr-tools/pool` — uma instância para todo o
 *  app. Encapsula publish/subscribe em TODOS os relays hardcoded (ver
 *  `nostr-relays.ts`) para que a camada de recuperação social (NIP-17/59 +
 *  SSSS) não precise saber quais relays usar.
 *
 *  Decisões de design (Track 2A da Fase 2):
 *  - Publish em TODOS os 3 relays (redundância — recovery funciona meses
 *    depois mesmo se 1-2 relays caírem).
 *  - Subscribe em round-robin (ouve todos simultaneamente; `SimplePool`
 *    desduplica eventos por `id` automaticamente via `seenOn`).
 *  - Sem NIP-42 AUTH e sem NIP-65 dinâmico (hardcoded).
 *
 *  Esta camada NÃO implementa NIP-17/44/59 gift-wrap (Track 2B) nem SSSS
 *  (já feito pela librarian). Ela só transporta eventos kind 1059 brutos.
 *
 *  Armadilhas da API do SimplePool no browser:
 *  - `pool.publish()` retorna `Promise<string>[]` (uma por relay), NÃO
 *    `PromiseSettledResult[]`. Cada promise resolve com a URL do relay ou
 *    rejeita. Usamos `Promise.allSettled()` (ES2020) para esperar e checar
 *    quantos aceitaram — `Promise.any()` (ES2021) não está disponível porque
 *    o `tsconfig.json` tem `target: "ES2020"`.
 *  - `pool.list()` NÃO existe nesta versão do nostr-tools. Para buscar
 *    múltiplos eventos, usar `pool.querySync()` (síncrono após EOSE).
 *  - `pool.subscribe()` retorna `SubCloser` com método `.close()`, não
 *    um handle numérico. O cleanup chama `sub.close()`.
 *  - `RELAYS` é `as const` (readonly tuple); métodos do pool aceitam
 *    `string[]` (mutável), por isso usamos `[...RELAYS]` nas chamadas.
 */

import { SimplePool } from "nostr-tools/pool";
import type { NostrEvent } from "nostr-tools/core";
import { RELAYS } from "./nostr-relays";

// Singleton pool — uma instância para todo o app.
let pool: SimplePool | null = null;

function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool();
  }
  return pool;
}

/** Publica um evento em TODOS os relays hardcoded.
 *
 *  Retorna `true` quando pelo menos 1 relay aceita o evento, `false` se
 *  todos falharam (rede offline, relays indisponíveis, evento rejeitado).
 *
 *  Usa `Promise.allSettled()` (ES2020) em vez de `Promise.any()` (ES2021)
 *  porque o `tsconfig.json` tem `target: "ES2020"`. Isso significa que
 *  esperamos todos os relays settlearem (aceitar ou rejeitar) antes de
 *  retornar — o que é um pouco mais lento no caminho de sucesso, mas o
 *  `SimplePool` tem `publishTimeout` interno que limita a espera. A
 *  vantagem é evitar unhandled rejections nas promises dos relays lentos.
 *
 *  @param event - evento Nostr assinado (kind 1059 gift-wrap, ou outro)
 *  @returns `true` se ≥1 relay aceitou, `false` se todos falharam
 */
export async function publishEvent(event: NostrEvent): Promise<boolean> {
  const p = getPool();
  // pool.publish retorna Promise<string>[] — uma por relay. Cada uma resolve
  // com a URL do relay que aceitou, ou rejeita com erro.
  const publishPromises = p.publish([...RELAYS], event);

  const results = await Promise.allSettled(publishPromises);
  const succeeded = results.filter((r) => r.status === "fulfilled");

  if (succeeded.length > 0) {
    return true;
  }

  const errors = results
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason);
  console.error(
    "[nostr-pool] publishEvent: todos os relays falharam para evento",
    event.id,
    errors,
  );
  return false;
}

/** Busca eventos gift-wrap (kind 1059) endereçados a um npub.
 *
 *  Faz um query síncrono (espera EOSE em todos os relays) e retorna o
 *  array de eventos encontrados. Usado para baixar wraps pendentes quando
 *  a usuária abre o app (recuperação de sessão / inbox offline).
 *
 *  Não usa `since` — busca histórico completo para não perder wraps
 *  enviados enquanto a usuária estava offline.
 *
 *  @param pubkeyHex - hex da chave pública (não npub bech32)
 *  @returns array de eventos kind 1059 endereçados a `pubkeyHex`
 */
export async function fetchWrapsForNpub(pubkeyHex: string): Promise<NostrEvent[]> {
  const p = getPool();
  // querySync espera EOSE em todos os relays e retorna todos os eventos
  // que deram match. (pool.list() não existe nesta versão do nostr-tools.)
  const events = await p.querySync([...RELAYS], {
    kinds: [1059],
    "#p": [pubkeyHex],
  });
  return events;
}

/** Inscreve para receber gift-wraps (kind 1059) em tempo real.
 *
 *  Abre uma subscription em todos os relays hardcoded. O callback
 *  `onEvent` é chamado para cada novo gift-wrap que chega (deduplicado
 *  por `id` — o `SimplePool` não emite duplicatas).
 *
 *  Usa `since: Math.floor(Date.now() / 1000)` para não re-baixar
 *  histórico antigo — apenas eventos novos a partir de agora. Para
 *  buscar histórico pendente, use `fetchWrapsForNpub()` antes de
 *  inscrever.
 *
 *  @param pubkeyHex - hex da chave pública (não npub bech32)
 *  @param onEvent - callback chamado para cada novo gift-wrap
 *  @returns função de cleanup (chamar para parar a inscrição)
 */
export function subscribeWrapsForNpub(
  pubkeyHex: string,
  onEvent: (event: NostrEvent) => void,
): () => void {
  const p = getPool();
  const sub = p.subscribe(
    [...RELAYS],
    {
      kinds: [1059],
      "#p": [pubkeyHex],
      since: Math.floor(Date.now() / 1000),
    },
    {
      onevent: (event) => {
        onEvent(event);
      },
    },
  );

  // Retorna cleanup que fecha a subscription (não o pool inteiro).
  return () => {
    sub.close();
  };
}

/** Fecha o pool e limpa recursos. Chamar no unmount do app.
 *
 *  Fecha conexões WebSocket com todos os relays hardcoded e descarta o
 *  singleton. A próxima chamada a qualquer função deste módulo criará
 *  um novo pool.
 */
export function closePool(): void {
  if (pool) {
    pool.close([...RELAYS]);
    pool = null;
  }
}
