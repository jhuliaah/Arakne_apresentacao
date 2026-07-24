/** Catalog page — the main screen showing crochet patterns. */

import { useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import PatternCard from "../components/PatternCard";
import SearchBar from "../components/SearchBar";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import { patterns } from "../data/patterns";

interface CatalogPageProps {
  onRevealDecoy?: () => void;
  onNavigate: (target: NavTarget) => void;
  inviteCodigo?: string | null;
}

export default function CatalogPage({ onRevealDecoy, onNavigate, inviteCodigo }: CatalogPageProps) {
  const [query, setQuery] = useState("");
  const [filterApplied, setFilterApplied] = useState(false);

  const filtered = filterApplied && query
    ? patterns.filter((p) =>
        p.nome.toLowerCase().includes(query.toLowerCase()) ||
        p.nivel.toLowerCase().includes(query.toLowerCase())
      )
    : patterns;

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
            <p>Bem-vinda! Explore os padrões disponíveis.</p>
          </div>
        )}

        <h2 className="catalog__title">Padrões de Crochê</h2>
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
      <BottomNav active="catalog" onNavigate={onNavigate} />
    </div>
  );
}
