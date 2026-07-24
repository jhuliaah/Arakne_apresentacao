/** RecoverySetupPage — onboarding: distribuir os fios de sustentação.
 *
 *  Substitui a BackupPage no fluxo de onboarding (Track 3C, Fase 3 do
 *  plano de recuperação Nostr). Aparece DEPOIS de criar a conta e
 *  desenhar o Ponto Arakne, e ANTES de ir para o catálogo.
 *
 *  Disfarce: a tela inteira usa vocabulário de crochê/tecelagem.
 *  "Tecelãs de confiança" = avalistas de recuperação. "Fios de
 *  sustentação" = shares SSSS do nsec. Nenhuma palavra-chave de
 *  segurança ou criptografia aparece no copy.
 *
 *  Modelo Opção E: T=2, N=2.
 *  - Share 0: enviada à convidadora (1 tecelã) via NIP-59 gift-wrap.
 *    Se a dona não tem convidadora (0 slots), a share 0 fica como
 *    backup de papel — a UI mostra o "código de reserva" para anotar.
 *  - Share 1: criptografada com o PIN da dona e enviada ao backend.
 *
 *  Fluxo:
 *  1. Busca os avalistas do backend (GET /usuarias/me/avalistas-recuperacao).
 *     Retorna 0 (sem convidadora) ou 1 (a convidadora).
 *  2. Mostra a lista com npub truncado, label e badge "sombra".
 *  3. Botão "Distribuir fios de sustentação" → distributeShares(nsec,
 *     npub, npubs, pin) — envelopa NIP-59 (share 0) e envia share 1
 *     criptografada com PIN ao backend.
 *  4. Sucesso: "Sustentação configurada!" + mostra o "código de reserva"
 *     (o PIN gerado) para a dona anotar — disfarçado de código que
 *     "ajuda suas tecelãs a sustentar seu ateliê".
 *  5. Botão "Continuar" → onDone().
 *
 *  O nsec da dona é passado como prop (em memória, vindo do
 *  CreateAccountPage/AulaPage via App.tsx). Ele NUNCA é persistido em
 *  plaintext e NUNCA vai ao backend — só é usado aqui para assinar o
 *  seal NIP-59 da share 0 endereçada à convidadora.
 */

import { useEffect, useState } from "react";
import Header from "../../components/Header";
import { ensureToken, getAvalistasRecuperacao, markUnlockedThisSession, type AvalistaRecuperacao } from "../../api";
import { distributeShares, isDistributed, type DistributeResult } from "../../lib/recovery-distribute";
import { useDelayedFlag } from "../../lib/useDelayedFlag";

interface RecoverySetupPageProps {
  /** npub da dona (bech32 npub1...). */
  npub: string;
  /** nsec da dona (bech32 nsec1...) — passado a distributeShares.
   *  Existe só em memória entre CreateAccountPage/AulaPage e esta tela. */
  nsec: string;
  /** PIN da dona (gerado internamente em criarConta). Usado para
   *  criptografar a share 1 antes de enviar ao backend. A dona precisa
   *  anotar esse PIN (mostrado na tela de sucesso) para recuperar. */
  pin: string;
  /** Vai para o catálogo (fim do onboarding). */
  onDone: () => void;
  /** Volta para o passo anterior do onboarding. */
  onBack: () => void;
}

type Phase = "loading" | "ready" | "distributing" | "success" | "error";

/** Trunca um npub bech32 no formato `npub1...abc` (primeiros 8 + últimos 3). */
function truncarNpub(npub: string): string {
  if (npub.length <= 14) return npub;
  return `${npub.slice(0, 8)}...${npub.slice(-3)}`;
}

/** Rótulo de uma tecelã: prefere apelido (Mudança #7-frontend), com
 *  fallback para npub truncado quando o apelido não existe. */
function rotuloTecela(tec: AvalistaRecuperacao): string {
  return tec.apelido?.trim() || truncarNpub(tec.npub_avaliadora);
}

export default function RecoverySetupPage({ npub, nsec, pin, onDone, onBack }: RecoverySetupPageProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [avalistas, setAvalistas] = useState<AvalistaRecuperacao[]>([]);
  const [fetchError, setFetchError] = useState(false);
  const [result, setResult] = useState<DistributeResult | null>(null);
  const [alreadyDistributed, setAlreadyDistributed] = useState(false);

  // Anti-flicker: só mostra o skeleton se a busca demorar mais que 500ms.
  // Em carregamentos rápidos (rede local / cache), o skeleton pisca e
  // atrapalha — o useDelayedFlag evita esse flash.
  const showSkeleton = useDelayedFlag(phase === "loading", 500);

  // ── Busca os avalistas do backend ao montar ───────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureToken();
        if (!token) {
          if (!cancelled) {
            setFetchError(true);
            setPhase("ready");
          }
          return;
        }
        const lista = await getAvalistasRecuperacao(token);
        if (cancelled) return;
        if (!lista) {
          // Backend ainda não tem o endpoint ou erro de rede.
          // Mostramos a tela em modo degradado: o botão continua disponível
          // mas avisa que não há tecelãs configuradas.
          setFetchError(true);
          setAvalistas([]);
          setPhase("ready");
          return;
        }
        // Ordena por `ordem` para garantir slot 1 = convidadora.
        const ordenadas = [...lista].sort((a, b) => a.ordem - b.ordem);
        setAvalistas(ordenadas);
        setPhase("ready");
      } catch (err) {
        // Defensivo: se algo inesperado falhar (ex.: resposta fora do
        // formato esperado), não deixamos a tela presa no skeleton.
        console.error("[RecoverySetupPage] falha ao buscar avalistas:", err);
        if (!cancelled) {
          setFetchError(true);
          setAvalistas([]);
          setPhase("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Se já distribuímos antes (re-entrada), pula direto ao sucesso ─
  useEffect(() => {
    if (isDistributed()) {
      setAlreadyDistributed(true);
    }
  }, []);

  async function handleDistribute() {
    setPhase("distributing");
    try {
      const npubs = avalistas.map((a) => a.npub_avaliadora);
      // Opção E: 0 (sem convidadora — backup de papel) ou 1 (convidadora).
      if (npubs.length > 1) {
        // Defensivo: o backend não deveria retornar >1, mas defendemos.
        setPhase("error");
        return;
      }
      const res = await distributeShares(nsec, npub, npubs, pin);
      setResult(res);
      // Considera sucesso se ao menos o threshold (2) foi distribuído
      // (1 convidadora publicada + 1 backend uploaded, ou 0 convidadora
      // + 1 backend + 1 paper backup implícito — neste caso o caller
      // cuida do paper backup, mas o backendUploaded é o que importa).
      const distribuidos = res.published + (res.backendUploaded ? 1 : 0);
      if (distribuidos >= 2 || (res.published === 0 && res.backendUploaded)) {
        setPhase("success");
      } else {
        setPhase("error");
      }
    } catch (err) {
      console.error("[RecoverySetupPage] distributeShares falhou:", err);
      setPhase("error");
    }
  }

  function handleContinue() {
    markUnlockedThisSession();
    onDone();
  }

  // Opção E: sempre permite distribuir (0 slots = paper backup only,
  // 1 slot = convidadora + backend).
  const podeDistribuir = !alreadyDistributed;

  return (
    <div className="page">
      <Header />
      <main className="onboarding">
        <button className="onboarding__back" onClick={onBack}>← Voltar</button>
        <h1 className="onboarding__title">Suas tecelãs de confiança</h1>
        <p className="onboarding__tagline">
          Escolha quem sustenta seus fios quando precisar de ajuda.
        </p>

        {/* Lista de avalistas */}
        <ul className="tecelas-list">
          {showSkeleton && (
            <li className="tecelas-list__item tecelas-list__item--skeleton">
              <span className="skeleton skeleton--text" />
              <span className="skeleton skeleton--text skeleton--short" />
            </li>
          )}
          {!showSkeleton && phase !== "loading" && avalistas.length === 0 && (
            <li className="tecelas-list__empty">
              {fetchError
                ? "Não foi possível carregar suas tecelãs agora. Tente de novo em instantes."
                : "Você não indicou uma tecelã de confiança. Vamos guardar um fio de reserva no ateliê central e outro com você."}
            </li>
          )}
          {avalistas.map((a, i) => (
            <li
              key={a.id}
              className={`tecelas-list__item${a.is_shadow ? " tecelas-list__item--shadow" : ""}`}
            >
              <div className="tecelas-list__slot">#{i + 1}</div>
              <div className="tecelas-list__info">
                <span className="tecelas-list__npub">{rotuloTecela(a)}</span>
                <span className="tecelas-list__meta">
                  {a.is_shadow ? "Tecelã-sombra" : "Tecelã indicada por você"}
                </span>
              </div>
              {a.is_shadow && <span className="tecelas-list__badge">sombra</span>}
            </li>
          ))}
        </ul>

        {/* Explicação curta (disfarce: nada de "criptografia") */}
        <p className="tecelas-explain">
          Suas tecelãs guardam uma parte do seu fio. Se você perder seu
          Ponto Arakne, suas tecelãs e o ateliê central te ajudam a
          reconstruir seu ateliê.
        </p>

        {/* Estados */}
        {alreadyDistributed && phase !== "success" && (
          <div className="tecelas-note">
            Você já distribuiu seus fios de sustentação antes. Pode continuar.
          </div>
        )}

        {phase === "error" && (
          <div className="tecelas-error">
            <p>
              Não conseguimos distribuir seus fios agora. Verifique sua
              internet e tente de novo — seus fios de sustentação ficam
              guardados assim que a conexão voltar.
            </p>
          </div>
        )}

        {phase === "distributing" && (
          <div className="tecelas-loading">
            <span className="spinner" />
            <p>Tecendo seus fios de sustentação...</p>
          </div>
        )}

        {phase !== "success" && (
          <button
            className="btn btn--primary"
            onClick={handleDistribute}
            disabled={phase === "distributing" || !podeDistribuir}
          >
            Distribuir fios de sustentação
          </button>
        )}

        {phase === "success" && (
          <div className="tecelas-success">
            <div className="tecelas-success__icon">🧶</div>
            <h2 className="tecelas-success__title">Sustentação configurada!</h2>
            <p className="tecelas-success__text">
              Suas tecelãs estão guardando seus fios.
            </p>
            {result && (
              <p className="tecelas-success__detail">
                {result.published} fio{result.published === 1 ? "" : "s"} entregue{result.published === 1 ? "" : "s"} à tecelã
                {" · "}
                {result.backendUploaded ? "1 fio guardado no ateliê central" : "fio do ateliê central pendente"}.
              </p>
            )}
            {/* Código de reserva = PIN gerado. A dona precisa anotar para
                recuperar a share 1 do backend. Disfarçado de "código que
                ajuda suas tecelãs a sustentar seu ateliê". */}
            <div className="tecelas-reserve">
              <p className="tecelas-reserve__label">Seu código de reserva:</p>
              <p className="tecelas-reserve__code">{pin}</p>
              <p className="tecelas-reserve__hint">
                Anote seu código de reserva — ele ajuda suas tecelãs a
                sustentar seu ateliê se você perder seu Ponto Arakne.
                Guarde em lugar seguro, longe do seu aparelho.
              </p>
            </div>
            {/* Backup de papel: quando não há convidadora, a share 0 fica
                com a dona em papel. Disfarçado de "fio de reserva" —
                ela anota e usa na recuperação junto com o código acima. */}
            {result?.paperBackupShare && (
              <div className="tecelas-reserve tecelas-reserve--paper">
                <p className="tecelas-reserve__label">Seu fio de reserva:</p>
                <p className="tecelas-reserve__code tecelas-reserve__code--long">
                  {result.paperBackupShare}
                </p>
                <p className="tecelas-reserve__hint">
                  Anote também este fio de reserva — sem ele, só suas tecelãs
                  podem te ajudar. Guarde junto do código de reserva, em
                  lugar seguro e longe do seu aparelho.
                </p>
              </div>
            )}
            <button className="btn btn--primary" onClick={handleContinue}>
              Continuar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
