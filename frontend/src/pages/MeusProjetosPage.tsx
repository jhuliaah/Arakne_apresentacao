/** MeusProjetosPage — "Meus Projetos": trilhas em andamento (BUG 3).
 *
 *  Substitui o placeholder `ComingSoonPage` na view `projetos` do
 *  App.tsx. Lista as trilhas onde a usuária logada tem ≥1 ProgressoAula
 *  (inscrita ou concluída) — via `GET /trilhas/me`.
 *
 *  Disfarce: linguagem crochê ("meus projetos", "trilhas em andamento",
 *  "continuar tecendo"). Cada trilha é um card com nome, descrição
 *  curta, barra de progresso (X/Y aulas) e botão "Continuar" que leva
 *  à TrilhaDetailPage. Estado vazio convida a explorar o catálogo.
 *
 *  Educacional apenas — sem acoplamento financeiro.
 */

import { useEffect, useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import { listarMinhasTrilhas } from "../api";
import type { Trilha } from "../types";
import { useDelayedFlag } from "../lib/useDelayedFlag";

interface MeusProjetosPageProps {
  onBack: () => void;
  /** Abre a TrilhaDetailPage de uma trilha inscrita. */
  onAbrirTrilha: (trilhaId: number) => void;
  /** Estado vazio: leva ao catálogo de trilhas para a usuária explorar. */
  onVerTrilhas: () => void;
  onNavigate: (target: NavTarget) => void;
}

export default function MeusProjetosPage({
  onBack,
  onAbrirTrilha,
  onVerTrilhas,
  onNavigate,
}: MeusProjetosPageProps) {
  const [trilhas, setTrilhas] = useState<Trilha[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const showSkeleton = useDelayedFlag(trilhas === null && !loadError);

  useEffect(() => {
    let cancelled = false;
    setTrilhas(null);
    setLoadError(false);
    listarMinhasTrilhas().then((data) => {
      if (cancelled) return;
      if (data === null) {
        setLoadError(true);
      } else {
        setTrilhas(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="catalog">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <h2 className="catalog__title">Meus projetos</h2>
        <p className="catalog__subtitle">
          Suas trilhas em andamento — continue tecendo de onde parou.
        </p>

        {loadError ? (
          <div className="catalog__empty">
            <p>Não conseguimos carregar seus projetos agora.</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Verifique sua conexão e tente novamente em instantes.
            </p>
          </div>
        ) : showSkeleton && trilhas === null ? (
          <div className="trilhas__grid">
            {[1, 2, 3].map((i) => (
              <div className="skeleton-card" key={i} aria-hidden="true">
                <div className="skeleton skeleton-card__visual" />
                <div className="skeleton-card__body">
                  <div className="skeleton skeleton--text" />
                  <div className="skeleton skeleton--text skeleton--short" />
                  <div className="skeleton skeleton--bar" />
                </div>
              </div>
            ))}
          </div>
        ) : trilhas === null ? null : trilhas.length === 0 ? (
          // Estado vazio: convida a explorar o catálogo.
          <div className="catalog__empty">
            <p>Você ainda não começou nenhuma trilha.</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
              Explore o catálogo para começar!
            </p>
            <button
              className="btn btn--primary"
              onClick={onVerTrilhas}
              style={{ marginTop: "0.75rem" }}
            >
              Ver trilhas
            </button>
          </div>
        ) : (
          <div className="trilhas__grid">
            {trilhas.map((trilha) => {
              const pct = trilha.total_aulas > 0
                ? Math.round((trilha.aulas_concluidas / trilha.total_aulas) * 100)
                : 0;
              const completa = trilha.aulas_concluidas === trilha.total_aulas && trilha.total_aulas > 0;
              return (
                <div
                  key={trilha.id}
                  className="trilha-card"
                  style={{ "--trilha-cor": trilha.cor } as React.CSSProperties}
                >
                  <div className="trilha-card__visual">
                    <span className="trilha-card__emoji">{trilha.emoji}</span>
                  </div>
                  <div className="trilha-card__body">
                    <h3 className="trilha-card__name">{trilha.titulo}</h3>
                    <div className="trilha-card__tags">
                      <span className="trilha-card__tag">{trilha.tecnica}</span>
                      <span className="trilha-card__tag trilha-card__tag--estilo">{trilha.estilo}</span>
                    </div>
                    <p className="trilha-card__desc">{trilha.descricao}</p>
                    <div className="trilha-card__progress">
                      <div className="trilha-card__progress-bar">
                        <div
                          className="trilha-card__progress-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="trilha-card__progress-text">
                        {trilha.aulas_concluidas}/{trilha.total_aulas} aulas
                      </span>
                    </div>
                    <button
                      className="btn btn--primary"
                      onClick={() => onAbrirTrilha(trilha.id)}
                      style={{ marginTop: "0.5rem", width: "100%" }}
                    >
                      {completa ? "Revisar" : "Continuar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav active="projetos" onNavigate={onNavigate} />
    </div>
  );
}
