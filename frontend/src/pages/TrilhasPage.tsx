/** Trilhas page — home da camada de aprendizado do ateliê. */


import { useEffect, useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import SearchBar from "../components/SearchBar";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import { listarTrilhas } from "../api";
import type { Trilha } from "../types";
import { useDelayedFlag } from "../lib/useDelayedFlag";

const TECNICAS = ["Todas", "Costura", "Crochê", "Bordado", "Tricô", "Patchwork"];
const ESTILOS = ["Todos", "Tradicional", "Regional", "Industrial", "Para Venda", "Especial"];

interface TrilhasPageProps {
  onRevealDecoy?: () => void;
  onNavigate: (target: NavTarget) => void;
  onOpenTrilha: (id: number) => void;
  inviteCodigo?: string | null;
}

export default function TrilhasPage({
  onRevealDecoy,
  onNavigate,
  onOpenTrilha,
  inviteCodigo,
}: TrilhasPageProps) {
  const [trilhas, setTrilhas] = useState<Trilha[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tecnica, setTecnica] = useState("Todas");
  const [estilo, setEstilo] = useState("Todos");
  const [query, setQuery] = useState("");
  const [filterApplied, setFilterApplied] = useState(false);
  const showSkeleton = useDelayedFlag(trilhas === null && !loadError);

  useEffect(() => {
    const t = tecnica === "Todas" ? undefined : tecnica;
    const e = estilo === "Todos" ? undefined : estilo;
    setTrilhas(null);
    setLoadError(false);
    listarTrilhas(t, e).then((data) => {
      if (data === null) {
        setLoadError(true);
      } else {
        setTrilhas(data);
      }
    });
  }, [tecnica, estilo]);

  const filtered = (() => {
    if (!trilhas) return null;
    if (!filterApplied || !query) return trilhas;
    const q = query.toLowerCase();
    return trilhas.filter(
      (t) =>
        t.titulo.toLowerCase().includes(q) ||
        t.tecnica.toLowerCase().includes(q) ||
        t.estilo.toLowerCase().includes(q)
    );
  })();

  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="catalog">
        <div className="catalog__search">
          <SearchBar
            onSearch={(q) => { setQuery(q); setFilterApplied(true); }}
            onRevealDecoy={onRevealDecoy}
          />
        </div>

        {inviteCodigo && (
          <div className="catalog__welcome">
            <p>Bem-vinda! Explore as trilhas disponíveis.</p>
          </div>
        )}

        <h2 className="catalog__title">Suas trilhas</h2>
        <p className="catalog__subtitle">
          Escolha o que quer aprender hoje
        </p>

        <div className="filter-chips" role="tablist" aria-label="Filtrar por técnica">
          {TECNICAS.map((t) => (
            <button
              key={t}
              className={`filter-chip ${tecnica === t ? "filter-chip--active" : ""}`}
              onClick={() => setTecnica(t)}
              role="tab"
              aria-selected={tecnica === t}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="filter-chips" role="tablist" aria-label="Filtrar por estilo">
          {ESTILOS.map((e) => (
            <button
              key={e}
              className={`filter-chip ${estilo === e ? "filter-chip--active" : ""}`}
              onClick={() => setEstilo(e)}
              role="tab"
              aria-selected={estilo === e}
            >
              {e}
            </button>
          ))}
        </div>

        {loadError ? (
          <div className="catalog__empty">
            <p>Não conseguimos carregar as trilhas agora.</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Verifique sua conexão e tente novamente em instantes.
            </p>
          </div>
        ) : showSkeleton && filtered === null ? (
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
        ) : filtered === null ? null : filtered.length === 0 ? (
          <p className="catalog__empty">Nenhuma trilha encontrada.</p>
        ) : (
          <div className="trilhas__grid">
            {filtered.map((trilha) => (
              <button
                key={trilha.id}
                className="trilha-card"
                onClick={() => onOpenTrilha(trilha.id)}
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
                        style={{
                          width: trilha.total_aulas > 0
                            ? `${(trilha.aulas_concluidas / trilha.total_aulas) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="trilha-card__progress-text">
                      {trilha.aulas_concluidas}/{trilha.total_aulas} aulas
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <footer className="catalog__footer">
          <p className="catalog__footer-text">
            Vibed with <a href="https://shakespeare.diy" target="_blank" rel="noopener noreferrer">Shakespeare</a>
          </p>
        </footer>
      </main>
      <BottomNav active="catalog" onNavigate={onNavigate} />
    </div>
  );
}
