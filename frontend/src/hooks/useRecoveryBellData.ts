/** useRecoveryBellData — encapsula listener de recuperação + apelidos.
 *
 *  Track 4D (continuação Lane C): widget sino auto-contido para as páginas
 *  principais (TrilhasPage, FinancialPage, PerfilPage, etc.) plugar no
 *  slot `children` do `<Header>`.
 *
 *  Problema resolvido: o `useRecoveryListener` precisa do nsec destravado
 *  e do padrão, que vivem no estado do App.tsx. As páginas internas não
 *  têm acesso direto a esse estado. Este hook aceita `avalistaNsec` e
 *  `avalistaPattern` opcionais — quando a Lane D os passa às páginas
 *  (ou quando uma página os obtém de outra forma), o listener inicia e
 *  o sino aparece. Sem eles, o hook não inicia o listener (não há
 *  pedidos) e o sino simplesmente não renderiza — comportamento seguro.
 *
 *  Responsabilidades:
 *  1. Inicia `useRecoveryListener` (quando nsec + pattern disponíveis).
 *  2. Carrega o mapa npub → apelido via `getAvalistasRecuperacao`
 *     (best-effort — se o backend não tiver o campo apelido ainda, o
 *     sino faz fallback para npub truncado).
 *  3. Retorna `{ requests, apelidos, clearRequest, isUnlocked, nsec,
 *     pattern }` para o `RecoveryBellHost` consumir.
 *
 *  Nota: o listener é por-instância. Se múltiplas páginas montarem o
 *  `RecoveryBellHost` simultaneamente (improvável — só uma view ativa),
 *  cada uma teria seu próprio listener. Como o App.tsx renderiza só uma
 *  view por vez, isso não é problema na prática.
 */

import { useEffect, useState } from "react";
import { useRecoveryListener } from "./useRecoveryListener";
import {
  getAvalistasRecuperacao,
  ensureToken,
  isUnlockedThisSession,
  type AvalistaRecuperacao,
} from "../api";

/** Retorno do hook — consumido pelo RecoveryBellHost. */
export interface UseRecoveryBellDataResult {
  /** Pedidos recebidos (vindos do listener, se ativo). */
  requests: ReturnType<typeof useRecoveryListener>["requests"];
  /** Mapa npub → apelido (best-effort). */
  apelidos: Record<string, string>;
  /** Remove um pedido específico do estado. */
  clearRequest: (initiatorNpub: string) => void;
  /** Se a sessão está destravada (nsec em memória). */
  isUnlocked: boolean;
  /** nsec da tecelã (ou null se não disponível). */
  nsec: Uint8Array | null;
  /** Padrão hexagonal da tecelã (ou null se não disponível). */
  pattern: number[] | null;
}

/**
 * @param avalistaNsec - nsec da tecelã destravado (bytes), ou null.
 *   Necessário para o listener escutar pedidos e para o
 *   RecoveryQRGenerator assinar a resposta NIP-59.
 * @param avalistaPattern - padrão hexagonal da tecelã, ou null.
 *   Necessário para descriptografar as shares guardadas no localStorage
 *   (cache em memória populado em `loadSharesIntoCache`).
 */
export function useRecoveryBellData(
  avalistaNsec: Uint8Array | null,
  avalistaPattern: number[] | null,
): UseRecoveryBellDataResult {
  // Sessão desbloqueada? Verifica sessionStorage (flag da aba) — usado
  // para decidir se vale a pena buscar apelidos no backend.
  const [sessaoDestravada] = useState(() => isUnlockedThisSession());

  const listener = useRecoveryListener(
    avalistaNsec !== null && avalistaPattern !== null,
    avalistaNsec,
    avalistaPattern,
  );

  const [apelidos, setApelidos] = useState<Record<string, string>>({});

  // Carrega apelidos (best-effort) quando a sessão está destravada.
  // Reusa a lógica do App.tsx: busca avalistas de recuperação da
  // usuária logada e constrói mapa npub → apelido.
  useEffect(() => {
    if (!sessaoDestravada) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureToken();
        if (!token || cancelled) return;
        const lista: AvalistaRecuperacao[] | null =
          await getAvalistasRecuperacao(token);
        if (cancelled || !lista) return;
        const mapa: Record<string, string> = {};
        for (const a of lista) {
          if (a.apelido) {
            mapa[a.npub_avaliadora] = a.apelido;
          }
        }
        if (!cancelled) setApelidos(mapa);
      } catch (err) {
        console.warn(
          "[useRecoveryBellData] falha ao buscar apelidos para o sino:",
          err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessaoDestravada]);

  return {
    requests: listener.requests,
    apelidos,
    clearRequest: listener.clearRequest,
    isUnlocked: listener.isUnlocked,
    nsec: listener.nsec,
    pattern: listener.pattern,
  };
}
