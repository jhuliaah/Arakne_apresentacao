/** DemoSetupPage — conecta este navegador a uma conta existente no backend.
 *
 *  Originalmente criada para configurar a Fundadora em um clique (demo do
 *  júri). Agora generalizada: aceita qualquer identificador + PIN, permitindo
 *  "conectar" este navegador a qualquer conta que já exista no backend (ex.:
 *  recuperar acesso a uma conta com saldo em outro aparelho).
 *
 *  Pré-requisito: a conta já deve existir no backend (criada via onboarding
 *  ou seed_demo.py).
 *
 *  Fluxo:
 *    1. Gera nsec/npub (nostr-tools) — nova identidade Nostr para este aparelho
 *    2. Criptografa nsec com padrão conhecido [0,1,2,3,4,5] (AES-GCM + PBKDF2)
 *    3. Faz login no backend (POST /login com identificador + PIN informados)
 *    4. Atualiza o npub da conta no backend (PATCH /usuarias/me/npub)
 *    5. Guarda tudo no localStorage (token, identificador, PIN, nsec
 *       criptografado, pattern hash, npub, recovery_distributed=1)
 *    6. Mostra tela de sucesso com identificador, PIN, convite e padrão
 *
 *  O padrão [0,1,2,3,4,5] são os 6 vértices do primeiro hexágono do
 *  HexPatternCanvas (cantos no sentido horário, começando do topo).
 *  A pessoa precisa desenhar essa sequência para entrar no app após reload.
 *
 *  Defaults FUNDADORA/1234 mantidos para a demo do júri (seed_demo.py).
 */

import { useState } from "react";
import Header from "../components/Header";
import { login, setToken, setIdentificador, setPin, markUnlockedThisSession, updateNpub } from "../api";
import { createNostrIdentity, decodeNsec } from "../lib/nostr-keys";
import { encryptNsec, hashPattern } from "../lib/pattern-crypto";

/** Padrão fixo da demo: 6 vértices do primeiro hexágono (horário, do topo).
 *  Em login mode o HexPatternCanvas não exige minLength (só register mode),
 *  então 6 pontos é suficiente para destravar. */
const DEMO_PATTERN: number[] = [0, 1, 2, 3, 4, 5];

/** Defaults da Fundadora (criadas por seed_demo.py) — preenchidos nos campos
 *  para a demo do júri funcionar com um clique, mas editáveis. */
const DEFAULT_IDENTIFICADOR = "FUNDADORA";
const DEFAULT_PIN = "1234";

interface DemoSetupPageProps {
  /** Chamado quando o setup termina e a pessoa clica em "Ir para o app". */
  onDone: () => void;
}

type SetupState =
  | { status: "idle" }
  | { status: "running"; step: string }
  | { status: "error"; message: string }
  | { status: "success"; npub: string; identificador: string; pin: string; convite: string | null };

export default function DemoSetupPage({ onDone }: DemoSetupPageProps) {
  const [state, setState] = useState<SetupState>({ status: "idle" });
  const [identInput, setIdentInput] = useState(DEFAULT_IDENTIFICADOR);
  const [pinInput, setPinInput] = useState(DEFAULT_PIN);

  async function handleSetup() {
    const id = identInput.trim();
    const pinTrim = pinInput.trim();
    if (!id || !pinTrim) {
      setState({ status: "error", message: "Informe o identificador e o PIN da conta." });
      return;
    }
    try {
      // 1. Gera identidade Nostr (nsec + npub) — nova para este aparelho
      setState({ status: "running", step: "Gerando identidade Nostr..." });
      const identity = createNostrIdentity();
      const nsecBytes = decodeNsec(identity.nsec);

      // 2. Criptografa nsec com o padrão fixo da demo
      setState({ status: "running", step: "Criptografando nsec..." });
      const encryptedBlob = await encryptNsec(nsecBytes, DEMO_PATTERN);

      // 3. Hash do padrão (check rápido antes do PBKDF2 no login)
      setState({ status: "running", step: "Calculando hash do padrão..." });
      const patternHash = await hashPattern(DEMO_PATTERN);

      // 4. Login no backend (POST /login com identificador + PIN informados)
      setState({ status: "running", step: "Fazendo login..." });
      const loginResp = await login(id, pinTrim);
      if (!loginResp) {
        setState({
          status: "error",
          message: "Falha no login. Confira o identificador e o PIN. A conta existe no backend?",
        });
        return;
      }

      // 5. Atualiza o npub da conta no backend (PATCH /usuarias/me/npub)
      setState({ status: "running", step: "Atualizando npub no backend..." });
      const updated = await updateNpub(loginResp.token, identity.npub);
      if (!updated) {
        setState({
          status: "error",
          message: "Falha ao atualizar npub. Verifique se o backend está rodando.",
        });
        return;
      }

      // 6. Guarda tudo no localStorage
      setState({ status: "running", step: "Salvando credenciais..." });
      setToken(loginResp.token);
      setIdentificador(id);
      setPin(pinTrim);
      localStorage.setItem("arakne_nsec_encrypted", encryptedBlob);
      localStorage.setItem("arakne_pattern_hash", patternHash);
      localStorage.setItem("arakne_npub", identity.npub);
      localStorage.setItem("arakne_recovery_distributed", "1");
      // Marca a sessão como destravada para pular o PatternLogin no bootstrap
      markUnlockedThisSession();

      // 7. Limpa a URL para que reloads vão ao app, não a esta página
      window.history.replaceState({}, "", "/");

      setState({
        status: "success",
        npub: identity.npub,
        identificador: id,
        pin: pinTrim,
        convite: updated.codigo_indicacao ?? null,
      });
    } catch (err) {
      setState({
        status: "error",
        message: `Erro inesperado: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function handleGoToApp() {
    onDone();
  }

  // ── Tela de sucesso ──────────────────────────────────────────
  if (state.status === "success") {
    return (
      <div className="page">
        <Header />
        <main className="onboarding onboarding--centered">
          <div className="onboarding__glyph">🕸️</div>
          <h1 className="onboarding__title">Conta conectada!</h1>
          <p className="onboarding__tagline">
            Este aparelho está vinculado à conta abaixo. Anote os dados:
          </p>

          <div className="onboarding__form" style={{ textAlign: "left", gap: "0.75rem" }}>
            <div className="demo-setup__field">
              <strong>Identificador:</strong> {state.identificador}
            </div>
            <div className="demo-setup__field">
              <strong>PIN:</strong> {state.pin}
            </div>
            {state.convite && (
              <div className="demo-setup__field">
                <strong>Convite:</strong> {state.convite}
                <br />
                <span className="field__hint">
                  Link: /convite/{state.convite}
                </span>
              </div>
            )}
            <div className="demo-setup__field">
              <strong>Padrão (Ponto Arakne):</strong>
              <br />
              <span className="demo-setup__pattern">0 → 1 → 2 → 3 → 4 → 5</span>
              <br />
              <span className="field__hint">
                Desenhe os 6 vértices do primeiro hexágono no sentido
                horário, começando do topo. Necessário para entrar no app
                após recarregar a página.
              </span>
            </div>
            <div className="demo-setup__field">
              <strong>npub:</strong>
              <br />
              <code className="demo-setup__npub">{state.npub}</code>
            </div>
          </div>

          <div className="onboarding__form">
            <button className="btn btn--primary" onClick={handleGoToApp}>
              Ir para o app
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ── Tela de erro ─────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <div className="page">
        <Header />
        <main className="onboarding onboarding--centered">
          <div className="onboarding__glyph">⚠️</div>
          <h1 className="onboarding__title">Erro na configuração</h1>
          <p className="onboarding__tagline">{state.message}</p>
          <div className="onboarding__form">
            <button className="btn btn--primary" onClick={() => setState({ status: "idle" })}>
              Tentar de novo
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ── Tela inicial / em execução ───────────────────────────────
  return (
    <div className="page">
      <Header />
      <main className="onboarding onboarding--centered">
        <div className="onboarding__glyph">🧶</div>
        <h1 className="onboarding__title">Conectar conta</h1>
        <p className="onboarding__tagline">
          Conecta este aparelho a uma conta já existente no backend. Informe
          o identificador e o PIN da conta. Defaults da Fundadora
          (seed_demo.py) estão pré-preenchidos para a demo do júri.
        </p>

        <div className="onboarding__form">
          <div className="field">
            <label className="field__label" htmlFor="demo-identificador">
              Identificador
            </label>
            <input
              id="demo-identificador"
              className="field__input"
              type="text"
              value={identInput}
              onChange={(e) => setIdentInput(e.target.value)}
              placeholder="FUNDADORA"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={state.status === "running"}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="demo-pin">
              PIN
            </label>
            <input
              id="demo-pin"
              className="field__input"
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="1234"
              autoComplete="off"
              disabled={state.status === "running"}
            />
          </div>

          <button
            className="btn btn--primary"
            onClick={handleSetup}
            disabled={state.status === "running" || !identInput.trim() || !pinInput.trim()}
          >
            {state.status === "running" ? state.step : "Conectar a esta conta"}
          </button>
        </div>

        {state.status === "running" && (
          <p className="field__hint" style={{ textAlign: "center", marginTop: "0.75rem" }}>
            Aguarde — gerando chaves e conectando ao backend...
          </p>
        )}
      </main>
    </div>
  );
}
