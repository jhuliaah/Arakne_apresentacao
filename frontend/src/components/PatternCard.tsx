/** Pattern card — shows a crochet pattern in the catalog grid. */

import type { Pattern } from "../types";

interface PatternCardProps {
  pattern: Pattern;
}

export default function PatternCard({ pattern }: PatternCardProps) {
  return (
    <article className="pattern-card">
      <div className="pattern-card__visual" style={{ backgroundColor: pattern.cor }}>
        <span className="pattern-card__emoji">{pattern.emoji}</span>
      </div>
      <div className="pattern-card__body">
        <h3 className="pattern-card__name">{pattern.nome}</h3>
        <span className="pattern-card__nivel">{pattern.nivel}</span>
        <p className="pattern-card__desc">{pattern.descricao}</p>
      </div>
    </article>
  );
}
