/** useRecoveryListener — hook React que inicia o listener de recuperação.
 *
 *  Track 4B/4D da Fase 4 do plano de recuperação Nostr do Arakne (Opção E).
 *
 *  Inicia o listener no mount do componente quando a usuária está
 *  destravada (`isUnlocked`) e tem o nsec + padrão em memória. Retorna
 *  a lista de pedidos recebidos (para a UI mostrar notificações —
 *  Track 4D) e utilitários para a UI do sino consumir.
 *
 *  Fluxo do effect:
 *  1. Popula o cache em memória chamando `loadSharesIntoCache(pattern)`
 *     — descriptografa as shares guardadas no localStorage com o padrão
 *       da avalista. Sem isso, o listener detecta pedidos mas não
 *       consegue responder (cache vazio).
 *  2. Inicia o listener via `startRecoveryListener(nsec, pattern, ...)`
 *     — processa `type: "shard"` (persiste novas shares recebidas) e
 *       `type: "request"` (chama `onRequest` para a UI notificar; a
 *       resposta automática com a share 0 também é publicada pelo
 *       listener, mas o QR on-demand (Track 4D) é uma camada extra
 *       controlada pela tecelã via RecoveryQRGenerator).
 *  3. Cleanup no unmount ou quando deps mudam.
 *
 *  O listener é limpo no unmount ou quando `isUnlocked`/`avalistaNsec`/
 *  `avalistaPattern` mudam (re-subscribe com a nova chave).
 *
 *  Retorno (Track 4D): objeto com `requests`, `clearRequest`,
 *  `clearAll`, `isUnlocked`, `nsec`, `pattern` para a UI do sino
 *  (RecoveryBell) consumir. O App.tsx (Lane D) conecta esses campos
 *  ao Header.
 */

import { useCallback, useEffect, useState } from "react";
import {
  startRecoveryListener,
  loadSharesIntoCache,
  type IncomingRecoveryRequest,
} from "../lib/recovery-respond";

/** Retorno do hook — consumido pela UI do sino (RecoveryBell). */
export interface UseRecoveryListenerResult {
  /** Pedidos recebidos durante a sessão (acumulam até ser descartados). */
  requests: IncomingRecoveryRequest[];
  /** Remove um pedido específico do estado (quando a tecelã agiu). */
  clearRequest: (initiatorNpub: string) => void;
  /** Limpa todos os pedidos pendentes. */
  clearAll: () => void;
  /** Se a sessão está destravada (nsec em memória). */
  isUnlocked: boolean;
  /** nsec da avalista em memória (ou null). */
  nsec: Uint8Array | null;
  /** Padrão hexagonal da avalista (ou null). */
  pattern: number[] | null;
}

/**
 * @param isUnlocked - se a sessão está destravada (nsec em memória)
 * @param avalistaNsec - bytes da chave privada da avalista (32 bytes), ou null
 * @param avalistaPattern - padrão hexagonal da avalista, ou null
 * @returns objeto com a lista de pedidos + utilitários para a UI do sino
 */
export function useRecoveryListener(
  isUnlocked: boolean,
  avalistaNsec: Uint8Array | null,
  avalistaPattern: number[] | null,
): UseRecoveryListenerResult {
  const [requests, setRequests] = useState<IncomingRecoveryRequest[]>([]);

  useEffect(() => {
    if (!isUnlocked || !avalistaNsec || !avalistaPattern) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // 1. Popula o cache em memória com as shares descriptografadas
      //    do localStorage. Necessário para o listener responder a
      //    pedidos automaticamente.
      try {
        await loadSharesIntoCache(avalistaPattern);
      } catch (err) {
        console.warn(
          "[useRecoveryListener] loadSharesIntoCache falhou:",
          err,
        );
      }
      if (cancelled) return;

      // 2. Inicia o listener (processa shards e requests). O callback
      //    `onRequest` popula o array `requests` no estado — a UI do
      //    sino (RecoveryBell) consome para mostrar notificações.
      cleanup = startRecoveryListener(
        avalistaNsec,
        avalistaPattern,
        (request) => {
          setRequests((prev) => {
            // Evita duplicatas: mesmo initiatorNpub + ownerNpub.
            if (
              prev.some(
                (r) =>
                  r.initiatorNpub === request.initiatorNpub &&
                  r.ownerNpub === request.ownerNpub,
              )
            ) {
              return prev;
            }
            return [...prev, request];
          });
        },
      );
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [isUnlocked, avalistaNsec, avalistaPattern]);

  const clearRequest = useCallback((initiatorNpub: string) => {
    setRequests((prev) =>
      prev.filter((r) => r.initiatorNpub !== initiatorNpub),
    );
  }, []);

  const clearAll = useCallback(() => {
    setRequests([]);
  }, []);

  return {
    requests,
    clearRequest,
    clearAll,
    isUnlocked,
    nsec: avalistaNsec,
    pattern: avalistaPattern,
  };
}
