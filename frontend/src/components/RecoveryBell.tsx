/** RecoveryBell — sino de notificação disfarçado para pedidos de recuperação.
 *
 *  Track 4D da Fase 4 do plano de recuperação Nostr do Arakne (Opção E).
 *
 *  Aparece no Header quando a usuária logada é tecelã (tem shares em cache
 *  ou o listener retornou pedidos). Mostra um badge com o número de pedidos
 *  pendentes e, ao clicar, abre um dropdown com a lista de pedidos recebidos
 *  — cada item mostra remetente (apelido se disponível, senão npub truncado),
 *  timestamp e um botão "Aceitar aula" (disfarçado) que chama `onHelp`.
 *
 *  Disfarce (§5.2 do mestre): o sino NÃO é um sino literal de notificação
 *  financeira. É um ícone de "novidades" sutil (laço de crochê) — vocabulário
 *  de "aulas pedidas" / "aceitar aula" mantém a fachada de app de crochê.
 *  Nenhuma palavra-chave de segurança/criptografia aparece no copy.
 *
 *  Segurança: o dropdown fecha ao clicar fora (overlay invisível) e ao
 *  pressionar Escape. Os npubs são truncados para não expor identificadores
 *  longos na tela (shoulder-surfing).
 */

import { useEffect, useRef, useState } from "react";
import type { IncomingRecoveryRequest } from "../lib/recovery-respond";

interface RecoveryBellProps {
  /** Pedidos pendentes (vindos do useRecoveryListener). */
  requests: IncomingRecoveryRequest[];
  /** Chamado quando a tecelã aceita ajudar uma convidada. */
  onHelp: (request: IncomingRecoveryRequest) => void;
  /** Mapa opcional npub → apelido (preenchido pela Lane A/B). */
  apelidos?: Record<string, string>;
}

/** Trunca npub bech32 para "npub1…abcd" (primeiros 8 + últimos 4). */
function truncarNpub(npub: string): string {
  if (!npub || npub.length < 16) return npub;
  return `${npub.slice(0, 8)}…${npub.slice(-4)}`;
}

/** Formata timestamp Unix (segundos) para "hh:mm" local. */
function formatarHora(tsSeg: number): string {
  try {
    const d = new Date(tsSeg * 1000);
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Resolve o nome a mostrar para o remetente do pedido. */
function nomeRemetente(
  req: IncomingRecoveryRequest,
  apelidos?: Record<string, string>,
): string {
  // O pedido vem da convidada (initiatorNpub = npub efêmero dela).
  // Apelido (se houver) é indexado pelo npub da dona (ownerNpub) — a
  // convidada é a dona pedindo ajuda. Preferimos ownerNpub porque o
  // initiatorNpub é efêmero (muda a cada pedido).
  if (apelidos && apelidos[req.ownerNpub]) {
    return apelidos[req.ownerNpub];
  }
  if (apelidos && apelidos[req.initiatorNpub]) {
    return apelidos[req.initiatorNpub];
  }
  return truncarNpub(req.ownerNpub);
}

export default function RecoveryBell({
  requests,
  onHelp,
  apelidos,
}: RecoveryBellProps) {
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef<HTMLButtonElement | null>(null);

  // Fecha o dropdown ao pressionar Escape.
  useEffect(() => {
    if (!aberto) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [aberto]);

  // Não renderiza o sino se não há pedidos pendentes. Assim o sino só
  // "aparece" quando chega um pedido — discreto por padrão.
  if (requests.length === 0) return null;

  const pendentes = requests.length;

  return (
    <>
      {/* Overlay invisível para fechar ao clicar fora. */}
      {aberto && (
        <div
          aria-hidden="true"
          onClick={() => setAberto(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20,
            background: "transparent",
          }}
        />
      )}

      <div
        className="recovery-bell"
        style={{ position: "relative", marginLeft: "0.75rem" }}
      >
        <button
          ref={botaoRef}
          type="button"
          className="recovery-bell__btn"
          onClick={() => setAberto((v) => !v)}
          aria-label={`${pendentes} ${pendentes === 1 ? "aula pedida" : "aulas pedidas"}`}
          aria-expanded={aberto}
          style={{
            position: "relative",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: "0.25rem 0.5rem",
            fontSize: "1.25rem",
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            color: "var(--color-primary)",
          }}
        >
          {/* Laço de crochê — disfarce de "novidades do ateliê". */}
          <span aria-hidden="true">🎀</span>
          <span
            className="recovery-bell__badge"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-2px",
              right: "-4px",
              minWidth: "16px",
              height: "16px",
              padding: "0 4px",
              borderRadius: "999px",
              background: "var(--color-accent)",
              color: "var(--color-on-accent, #fff)",
              fontSize: "0.65rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow)",
            }}
          >
            {pendentes > 9 ? "9+" : pendentes}
          </span>
        </button>

        {aberto && (
          <div
            className="recovery-bell__dropdown"
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: "260px",
              maxWidth: "90vw",
              background: "var(--color-surface)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              padding: "0.5rem 0",
              zIndex: 30,
              userSelect: "none",
            }}
          >
            <div
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "0.8rem",
                color: "var(--color-muted)",
                fontWeight: 600,
                borderBottom: "1px solid var(--color-bg)",
              }}
            >
              Aulas pedidas
            </div>

            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {requests.map((req) => (
                <li
                  key={`${req.initiatorNpub}-${req.ownerNpub}`}
                  style={{
                    padding: "0.625rem 0.75rem",
                    borderBottom: "1px solid var(--color-bg)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "0.5rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        color: "var(--color-text)",
                        wordBreak: "break-all",
                      }}
                    >
                      {nomeRemetente(req, apelidos)}
                    </span>
                    {req.createdAt !== undefined && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--color-muted)",
                          flexShrink: 0,
                        }}
                      >
                        {formatarHora(req.createdAt)}
                      </span>
                    )}
                  </div>

                  {req.message && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.78rem",
                        color: "var(--color-muted)",
                        fontStyle: "italic",
                        lineHeight: 1.35,
                      }}
                    >
                      {req.message}
                    </p>
                  )}

                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      setAberto(false);
                      onHelp(req);
                    }}
                    style={{
                      marginTop: "0.25rem",
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.82rem",
                      alignSelf: "flex-start",
                    }}
                  >
                    Aceitar aula
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
