/** RecoveryBellHost — widget sino auto-contido para plugar no Header.
 *
 *  Track 4D (continuação Lane C): resolve o problema de ownership. As
 *  páginas internas (TrilhasPage, FinancialPage, PerfilPage, etc.) não
 *  têm acesso ao estado do App.tsx (nsec destravado, pattern, apelidos).
 *  Este componente encapsula tudo:
 *
 *  1. Chama `useRecoveryBellData()` (que por sua vez chama
 *     `useRecoveryListener` + carrega apelidos).
 *  2. Renderiza `<RecoveryBell>` com os dados.
 *  3. Quando a tecelã clica "Aceitar aula" (`onHelp`), abre um
 *     MODAL/overlay próprio com `<RecoveryQRGenerator>` sobre a página
 *     atual — em vez de navegar para uma view do App.tsx. Assim, nenhuma
 *     página precisa de callback do App.tsx para o sino funcionar.
 *  4. Quando a tecelã fecha o modal (botão Concluir/Cancelar do
 *     RecoveryQRGenerator), volta à página atual e remove o pedido do
 *     sino (clearRequest).
 *
 *  Props:
 *  - `avalistaNsec?`: nsec da tecelã destravado (bytes). Necessário para
 *    o listener escutar pedidos e para o RecoveryQRGenerator assinar a
 *    resposta NIP-59. Se não vier, o listener não inicia (sino não
 *    aparece) — comportamento seguro.
 *  - `avalistaPattern?`: padrão hexagonal da tecelã. Necessário para
 *    descriptografar as shares guardadas no localStorage (cache em
 *    memória populado em `loadSharesIntoCache`).
 *
 *  Decisão de design: o modal é um overlay fixed com fundo semi-opaco
 *  (rgba 0,0,0,0.5) e o RecoveryQRGenerator centralizado. O
 *  RecoveryQRGenerator já é auto-contido (renderiza seu próprio Header
 *  e botão Voltar) — o `onBack` dele fecha o modal.
 */

import { useState } from "react";
import RecoveryBell from "./RecoveryBell";
import RecoveryQRGenerator from "./RecoveryQRGenerator";
import { useRecoveryBellData } from "../hooks/useRecoveryBellData";
import type { IncomingRecoveryRequest } from "../lib/recovery-respond";

interface RecoveryBellHostProps {
  /** nsec da tecelã destravado (bytes), ou null/undefined se não
   *  disponível. Sem ele, o listener não inicia e o sino não aparece. */
  avalistaNsec?: Uint8Array | null;
  /** Padrão hexagonal da tecelã, ou null/undefined. Sem ele, o listener
   *  não inicia (não dá para descriptografar as shares do cache). */
  avalistaPattern?: number[] | null;
}

export default function RecoveryBellHost({
  avalistaNsec = null,
  avalistaPattern = null,
}: RecoveryBellHostProps) {
  const { requests, apelidos, clearRequest } = useRecoveryBellData(
    avalistaNsec,
    avalistaPattern,
  );

  // Pedido ativo (clicado "Aceitar aula") — quando setado, abre o modal
  // com o RecoveryQRGenerator.
  const [pedidoAtivo, setPedidoAtivo] =
    useState<IncomingRecoveryRequest | null>(null);

  // Sem nsec destravado, o listener não inicia → requests sempre vazio →
  // o sino não renderiza. Retornamos null para não criar um listener
  // inútil (o hook já lida com isso internamente, mas o RecoveryBell
  // também retorna null quando requests.length === 0).
  if (requests.length === 0 && pedidoAtivo === null) return null;

  return (
    <>
      <RecoveryBell
        requests={requests}
        apelidos={apelidos}
        onHelp={(req) => setPedidoAtivo(req)}
      />

      {pedidoAtivo && (
        <div
          className="recovery-bell__modal-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            overflowY: "auto",
          }}
          // Fechar o modal ao clicar no overlay (fora do conteúdo) —
          // mas não ao clicar dentro do RecoveryQRGenerator (ele para
          // a propagação implicitamente porque é um container próprio).
          onClick={() => setPedidoAtivo(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-surface, #fff)",
              borderRadius: "var(--radius, 12px)",
              boxShadow: "var(--shadow-lg)",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <RecoveryQRGenerator
              request={pedidoAtivo}
              avalistaNsec={avalistaNsec}
              onBack={() => {
                // Fecha o modal e remove o pedido do sino (a tecelã
                // já lidou com ele — não precisa ficar pendente).
                clearRequest(pedidoAtivo.initiatorNpub);
                setPedidoAtivo(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
