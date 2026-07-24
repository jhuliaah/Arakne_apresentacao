/** Decoy catalog page — a generic crochet pattern gallery with ZERO financial traces.

  This page exists to mislead anyone snooping for hidden screens.
  It shows a different set of patterns, a different subtitle, and contains
  absolutely no reference to "materiais", "níveis", "kits", or anything
  that could hint at a financial layer.

  The search bar on this page only filters patterns — it does NOT respond
  to DECOY_SEARCH, so there's no way to accidentally stumble into the real
  financial screen from here. (The old SECRET_SEARCH gesture was removed;
  the financial layer is now revealed by the trilha #9 aula 1 nível 1.)
*/

import { useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import PatternCard from "../components/PatternCard";
import type { Pattern } from "../types";

// Completely different patterns — not the same set as the main catalog.
// No "Ponto Arakne", no "Especial" tier, nothing that links back.
const decoyPatterns: Pattern[] = [
  {
    id: 101,
    nome: "Ponto Voador",
    nivel: "Intermediário",
    cor: "#c8e8c8",
    emoji: "🕊️",
    descricao: "Laçadas cruzadas que criam um efeito de asas na peça final.",
  },
  {
    id: 102,
    nome: "Trança Simples",
    nivel: "Iniciante",
    cor: "#e8e0c8",
    emoji: "🪢",
    descricao: "Padrão entrelaçado clássico, perfeito para bordas de mantas.",
  },
  {
    id: 103,
    nome: "Ponto Pipoca",
    nivel: "Avançado",
    cor: "#e8c8e0",
    emoji: "🌼",
    descricao: "Múltiplas laçadas em um único ponto formam textura em relevo.",
  },
  {
    id: 104,
    nome: "Ponto Leque",
    nivel: "Intermediário",
    cor: "#c8d8e8",
    emoji: "🐚",
    descricao: "Vários pontos altos no mesmo espaço criam um leque aberto.",
  },
  {
    id: 105,
    nome: "Ponto Melado",
    nivel: "Iniciante",
    cor: "#f0e0c0",
    emoji: "🍯",
    descricao: "Textura densa e quente, ideal para peças de inverno.",
  },
  {
    id: 106,
    nome: "Renda Dupla",
    nivel: "Avançado",
    cor: "#d0e0f0",
    emoji: "❄️",
    descricao: "Trabalho delicado com fios finos, cria renda verdadeira.",
  },
];

interface DecoyPageProps {
  onBack: () => void;
}

export default function DecoyPage({ onBack }: DecoyPageProps) {
  const [query, setQuery] = useState("");
  const [filterApplied, setFilterApplied] = useState(false);

  const filtered = filterApplied && query
    ? decoyPatterns.filter((p) =>
        p.nome.toLowerCase().includes(query.toLowerCase()) ||
        p.nivel.toLowerCase().includes(query.toLowerCase())
      )
    : decoyPatterns;

  // Plain search — no secret gestures on this page.
  // Even if someone types "Ponto Arakne" here, it just shows "no results".
  const handleSearch = (q: string) => {
    setQuery(q);
    setFilterApplied(true);
  };

  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="catalog">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <div className="catalog__search">
          <input
            type="text"
            className="search__input"
            placeholder="Buscar padrão..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFilterApplied(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch(query);
              }
            }}
            aria-label="Buscar padrão de crochê"
          />
          <button
            className="search__btn"
            onClick={() => handleSearch(query)}
            aria-label="Buscar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>

        <h2 className="catalog__title">Galeria de Padrões</h2>
        <p className="catalog__subtitle">
          Coleção de pontos e técnicas para todos os níveis.
        </p>
        <div className="catalog__grid">
          {filtered.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="catalog__empty">Nenhum padrão encontrado.</p>
        )}

        <footer className="catalog__footer">
          <p className="catalog__footer-text">
            Vibed with <a href="https://shakespeare.diy" target="_blank" rel="noopener noreferrer">Shakespeare</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
