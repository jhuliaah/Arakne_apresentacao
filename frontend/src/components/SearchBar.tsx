/** Search bar — filtra padrões e técnicas da trilha.

  Busca normal apenas. O antigo gesto secreto "Ponto Arakne" foi removido
  (a camada financeira agora é revelada pela aula 1 do nível 1 da trilha
  #9). O gesto "Galeria de Padrões" (decoy) permanece.
*/


import { useState } from "react";
import { DECOY_SEARCH } from "../data/patterns";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onRevealDecoy?: () => void;
}

export default function SearchBar({ onSearch, onRevealDecoy }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (onRevealDecoy && q === DECOY_SEARCH.toLowerCase()) {
      onRevealDecoy();
      return;
    }
    onSearch(query);
  };

  return (
    <form className="search" onSubmit={handleSubmit}>
      <input
        type="text"
        className="search__input"
        placeholder="Buscar um padrão ou técnica..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar padrão de crochê"
      />
      <button type="submit" className="search__btn" aria-label="Buscar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </form>
  );
}
