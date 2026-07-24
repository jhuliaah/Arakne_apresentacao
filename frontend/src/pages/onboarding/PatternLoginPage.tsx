/** PatternLoginPage — login via desenho do Ponto Arakne.
 *
 *  Substitui o antigo PinLoginPage (PIN numérico). A usuária desenha seu
 *  padrão hexagonal; o nsec criptografado no localStorage é decriptado com
 *  a chave derivada do padrão (PBKDF2 + AES-GCM). Se bater, a sessão é
 *  destravada.
 *
 *  Após 8 tentativas erradas, mostra "Deseja agendar uma nova aula de
 *  crochê? Solicite uma aula de reforço a sua tecelã amiga" — o botão
 *  "Solicitar aula de reforço" encadeia para o fluxo de recuperação
 *  social (onForgotPattern → RecoverAccountPage → RecoveryHelpRequestPage).
 */

import { useState } from "react";
import Header from "../../components/Header";
import HexPatternCanvas from "../../components/HexPatternCanvas";
import { markUnlockedThisSession } from "../../api";
import { hasStoredIdentity, unlockWithPattern } from "../../lib/pattern-storage";
import { decodeNsec } from "../../lib/nostr-keys";

interface PatternLoginPageProps {
  /** Chamado quando o padrão destrava a identidade. Recebe o nsec
   *  (bytes, 32) e o padrão desenhado — o App usa esses dados para
   *  iniciar o listener de recuperação (Pendência 3: a usuária pode
   *  ser convidadora de outra dona e precisa receber/responder pedidos
   *  de recuperação enquanto a sessão estiver ativa). */
  onUnlocked: (nsec: Uint8Array, pattern: number[]) => void;
  onCreateAccount: () => void;
  /** "Esqueci meu Ponto Arakne" → vai para RecoverAccountPage. */
  onForgotPattern: () => void;
  /** Volta para a tela anterior (splash ou convite). Opcional: se não
   *  vier, o botão "Voltar" não aparece (a tela tem saídas alternativas
   *  via "Esqueci" e "Criar conta"). Evita dead-end quando a usuária
   *  chegou aqui por engano e quer voltar sem desenhar. */
  onBack?: () => void;
}

const MAX_ATTEMPTS = 8;

export default function PatternLoginPage({ onUnlocked, onCreateAccount, onForgotPattern, onBack }: PatternLoginPageProps) {
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(false);

  // Sem identidade armazenada neste aparelho — não há o que destravar.
  // (Bootstrap do App.tsx normalmente impede chegar aqui, mas o guard
  // protege contra navegação manual via "Já tenho conta" no splash.)
  // Oferece tanto criar conta nova quanto recuperar uma conta existente
  // (a usuária pode ter saído da conta neste aparelho e querer voltar
  // pelo fluxo de recuperação social).
  if (!hasStoredIdentity()) {
    return (
      <div className="page">
        <Header />
        <main className="onboarding onboarding--centered">
          <div className="onboarding__glyph">🧶</div>
          <h1 className="onboarding__title">Nenhuma conta neste aparelho</h1>
          <p className="onboarding__tagline">
            Para entrar, crie sua conta e desenhe seu Ponto Arakne — ou
            recupere uma conta que você já tem em outro aparelho.
          </p>
          <div className="onboarding__form">
            <button className="btn btn--primary" onClick={onCreateAccount}>
              Criar conta
            </button>
            <button className="btn btn--secondary" onClick={onForgotPattern}>
              Recuperar conta
            </button>
            {onBack && (
              <button
                className="btn btn--secondary"
                onClick={onBack}
                style={{ marginTop: "0.5rem" }}
              >
                ← Voltar
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  async function handlePatternSubmit(pattern: number[]) {
    setLoading(true);
    const identity = await unlockWithPattern(pattern);
    setLoading(false);

    if (identity) {
      markUnlockedThisSession();
      // NostrIdentity.nsec é bech32 (string) — decodifica para bytes
      // (32 bytes) para o listener de recuperação (NIP-59 usa bytes).
      const nsecBytes = decodeNsec(identity.nsec);
      onUnlocked(nsecBytes, pattern);
      return;
    }

    // Padrão errado: dispara animação de erro no canvas e conta a tentativa.
    const next = attempts + 1;
    setAttempts(next);
    setError(true);
    // Limpa o flag de erro após a animação (~600ms) para o canvas aceitar
    // um novo desenho. resetKey força o canvas a resetar o estado interno.
    window.setTimeout(() => {
      setError(false);
      setResetKey((k) => k + 1);
    }, 650);
  }

  function handleTryAgain() {
    setAttempts(0);
    setError(false);
    setResetKey((k) => k + 1);
  }

  // Atingiu o limite de tentativas — mensagem de ajuda com botão para
  // solicitar aula de reforço (encadeia para o fluxo de recuperação
  // social via onForgotPattern → RecoverAccountPage → ped ajuda a tecelã).
  if (attempts >= MAX_ATTEMPTS) {
    return (
      <div className="page">
        <Header />
        <main className="onboarding onboarding--centered">
          <div className="onboarding__glyph">🧶</div>
          <h1 className="onboarding__title">Deseja agendar uma nova aula de crochê</h1>
          <p className="onboarding__tagline">
            Solicite uma aula de reforço a sua tecelã amiga
          </p>
          <div className="onboarding__form">
            <button className="btn btn--primary" onClick={handleTryAgain}>
              Tentar de novo
            </button>
            <button className="btn btn--secondary" onClick={onForgotPattern}>
              Solicitar aula de reforço
            </button>
            {onBack && (
              <button
                className="btn btn--secondary"
                onClick={onBack}
                style={{ marginTop: "0.5rem" }}
              >
                ← Voltar
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Header />
      <main className="onboarding onboarding--centered">
        <div className="onboarding__glyph">🧶</div>
        <h1 className="onboarding__title">Continue essa trilha</h1>
        <p className="onboarding__tagline">Desenhe seu Ponto Arakne para entrar</p>

        <div style={{ width: "100%", maxWidth: "420px" }}>
          <HexPatternCanvas
            mode="login"
            onPatternSubmit={handlePatternSubmit}
            error={error}
            resetKey={resetKey}
          />

          {loading && (
            <div className="recover__status" style={{ paddingTop: "0.75rem" }}>
              <span className="spinner" style={{ width: "24px", height: "24px" }} />
              <p className="recover__status-text">Verificando seu ponto...</p>
            </div>
          )}

          {attempts > 0 && !loading && (
            <p className="field__hint" style={{ textAlign: "center", marginTop: "0.5rem" }}>
              Tentativa {attempts} de {MAX_ATTEMPTS}
            </p>
          )}

          <div className="onboarding__footer-link">
            <button type="button" onClick={onForgotPattern}>
              Esqueci meu Ponto Arakne
            </button>
          </div>

          {onBack && (
            <div className="onboarding__footer-link" style={{ marginTop: "0.75rem" }}>
              <button type="button" onClick={onBack}>
                ← Voltar
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
