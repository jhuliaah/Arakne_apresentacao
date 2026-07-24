import Header from "../../components/Header";

interface SplashPageProps {
  onCreateAccount: () => void;
  onHaveAccount: () => void;
  /** Volta para o fluxo de recuperação de conta (Lane D conecta). */
  onRecuperar?: () => void;
}

export default function SplashPage({ onCreateAccount, onHaveAccount, onRecuperar }: SplashPageProps) {
  return (
    <div className="page">
      <Header />
      <main className="onboarding onboarding--centered">
        <div className="onboarding__glyph">🧶</div>
        <h1 className="onboarding__title">Arakne</h1>
        <p className="onboarding__tagline">
          padrões de crochê &amp; tricô,<br />feitos por mãos, para mãos.
        </p>
        <div className="onboarding__form">
          <button className="btn btn--primary" onClick={onCreateAccount}>
            Criar conta
          </button>
          <button className="btn btn--secondary" onClick={onHaveAccount}>
            Acessar conta
          </button>
        </div>
        {/* Link discreto para recuperação — disfarçado de "perdi meu
            projeto", para não quebrar a aparência crochê da tela inicial.
            Visualmente mais sutil que os botões primários. */}
        {onRecuperar && (
          <div className="onboarding__footer-link" style={{ marginTop: "1.25rem" }}>
            <button type="button" onClick={onRecuperar}>
              Perdi o acesso ao meu projeto
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
