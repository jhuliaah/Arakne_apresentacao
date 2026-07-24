/** Comunidade — camada de disfarce.
 *
 *  Propositalmente 100% decorativa: nenhuma funcionalidade real vive aqui
 *  (nem convite, nem Ponto de Troca). Isso é deliberado — se alguém tiver
 *  contato com o aparelho e abrir essa aba, não deve encontrar nenhum
 *  traço de convite de aval, troca de sats, ou qualquer coisa financeira.
 *  As funcionalidades reais equivalentes vivem em FinancialPage (camada
 *  revelada, atrás do gesto de busca).
 */

import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import { grupos, posts } from "../data/community";

interface ComunidadePageProps {
  onNavigate: (target: NavTarget) => void;
}

export default function ComunidadePage({ onNavigate }: ComunidadePageProps) {
  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="catalog">
        <h2 className="catalog__title">Comunidade</h2>
        <p className="catalog__subtitle">grupos de tricô perto de você</p>

        <div className="community__groups">
          {grupos.map((g) => (
            <div className="community__group-card" key={g.id}>
              <div className="community__group-emoji">{g.emoji}</div>
              <div>
                <div className="community__group-name">{g.nome}</div>
                <div className="community__group-meta">{g.membros} membros</div>
              </div>
            </div>
          ))}
        </div>

        <h3 className="financial__history-title" style={{ marginTop: "1.75rem" }}>
          Atividade recente
        </h3>
        <div className="community__posts">
          {posts.map((p) => (
            <div className="community__post" key={p.id}>
              <div className="community__post-emoji">{p.emoji}</div>
              <div>
                <div className="community__post-text">{p.texto}</div>
                <div className="community__post-meta">{p.autora} · {p.tempo}</div>
              </div>
            </div>
          ))}
        </div>
      </main>
      <BottomNav active="comunidade" onNavigate={onNavigate} />
    </div>
  );
}
