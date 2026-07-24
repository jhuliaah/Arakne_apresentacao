/** InviteDecisionPage — tela de convite (link /convite/{codigo}).
 *
 *  BUG 1 (link de convite quebrado): esta tela agora é alcançada mesmo
 *  quando já há uma identidade Nostr armazenada neste aparelho (o
 *  bootstrap do App.tsx prioriza `inviteCodigo` quando a sessão não está
 *  destravada). Assim a 2ª visita a `/convite/FUNDADORA_INVITE` (com a
 *  1ª conta já criada) ainda abre esta tela, oferecendo:
 *    - "Iniciar um novo projeto com este convite" → limpa a identidade
 *      atual (clearStoredIdentity) e segue para createAccount com o
 *      convite. Necessário para a demo (2 cadastros distintos com o
 *      mesmo link da Fundadora).
 *    - "Entrar na minha conta" → segue para patternLogin (re-login na
 *      conta existente neste aparelho).
 *    - "Aceitar convite" / "Criar conta sem vínculo" → fluxo original
 *      (quando não há identidade armazenada).
 *
 *  Disfarce: vocabulário crochê ("iniciar um novo projeto" = criar nova
 *  conta). Nenhuma palavra-chave de segurança/identidade aparece no copy.
 */

import Header from "../components/Header";
import { hasStoredIdentity, clearStoredIdentity } from "../lib/pattern-storage";

interface InviteDecisionPageProps {
  onAceitar: () => void;
  onRecusar: () => void;
  /** Entrar na conta existente neste aparelho (vai a patternLogin).
   *  Só oferecido quando há identidade armazenada. */
  onEntrarExistente?: () => void;
}

export default function InviteDecisionPage({ onAceitar, onRecusar, onEntrarExistente }: InviteDecisionPageProps) {
  const temIdentidade = hasStoredIdentity();

  /** Iniciar um novo projeto com este convite: limpa a identidade atual
   *  (nsec criptografado, hash do padrão, npub) e segue para criar conta
   *  com o convite. Necessário para a demo (2 cadastros com o mesmo link). */
  function handleIniciarNovoProjeto() {
    clearStoredIdentity();
    onAceitar();
  }

  return (
    <div className="page">
      <Header />
      <main className="onboarding onboarding--centered">
        <div className="onboarding__glyph">🪢</div>
        <h1 className="onboarding__title">Você foi convidada</h1>
        <p className="onboarding__tagline">
          Uma amiga quer te trazer para o grupo de tricô dela. Aceitar vincula
          sua conta nova a ela — isso libera seu primeiro nível.
        </p>
        <div className="onboarding__form">
          {/* Sem identidade armazenada: fluxo original (aceitar convite
              ou criar conta sem vínculo). */}
          {!temIdentidade && (
            <>
              <button className="btn btn--primary" onClick={onAceitar}>
                Aceitar convite
              </button>
              <button className="btn btn--secondary" onClick={onRecusar}>
                Criar conta sem vínculo
              </button>
            </>
          )}

          {/* Com identidade armazenada: oferece criar nova conta (limpa
              a atual) ou entrar na conta existente. O botão "Aceitar
              convite" também aparece, mas chama handleIniciarNovoProjeto
              (limpa a identidade antes de criar a nova). */}
          {temIdentidade && (
            <>
              <button className="btn btn--primary" onClick={handleIniciarNovoProjeto}>
                Iniciar um novo projeto com este convite
              </button>
              {onEntrarExistente && (
                <button className="btn btn--secondary" onClick={onEntrarExistente}>
                  Entrar na minha conta
                </button>
              )}
              <button className="btn btn--secondary" onClick={onRecusar}>
                Criar conta sem vínculo
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
