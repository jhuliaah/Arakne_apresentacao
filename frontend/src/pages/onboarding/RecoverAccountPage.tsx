/** RecoverAccountPage — recuperação de conta em novo dispositivo.
 *
 *  Track 4D da Fase 4 do plano de recuperação Nostr do Arakne (Opção E).
 *
 *  Cenário: a usuária perdeu o aparelho (ou esqueceu o Ponto Arakne),
 *  está num dispositivo novo, e sabe o `identificador` do seu ateliê +
 *  seu PIN (o "código de reserva" anotado na configuração). Esta tela
 *  orquestra o fluxo de recuperação social:
 *
 *    1. Ela informa o identificador do ateliê e seu PIN.
 *    2. `startRecoveryRequest(identificador, pin)` faz login no backend
 *       com o PIN, busca a share 1 (decripta com o PIN) e gift-wrap um
 *       pedido NIP-59 à convidadora (se houver), usando um nsec efêmero.
 *    3. `subscribeToRecoveryResponses(ephemeralNsec, ...)` escuta
 *       gift-wraps de resposta no npub efêmero. A convidadora que aprova
 *       devolve a share 0 SSSS.
 *    4. Quando 2 shares chegam (share 1 do backend + share 0 da
 *       convidadora), a usuária desenha um NOVO Ponto Arakne.
 *       `tryCombineShares` reconstrói o nsec original e valida o pubkey
 *       contra o npub da dona (buscado no backend).
 *    5. `adoptRecoveredIdentity(recoveredNsec, newPattern)` re-criptografa
 *       o nsec com o novo padrão e guarda no localStorage. A sessão é
 *       destravada e o App vai para o catálogo.
 *
 *  Fallback E′ (sem convidadora): se o backend não retornar convidadora
 *  (0 avalistas), a dona precisa colar o "código de reserva de papel"
 *  (share 0 em base64, anotada manualmente na configuração). A UI
 *  decodifica e combina com a share 1 do backend.
 *
 *  Disfarce: vocabulário de crochê/tecelagem alinhado ao copy deck.
 *  "Reatar fios" = recuperar conta. "Tecelãs" = avalistas. "Fios" =
 *  shares SSSS. "Ponto Arakne" = padrão de desbloqueio. "Código de
 *  reserva" = PIN (para o backend) ou share 0 em base64 (paper backup).
 *  Nenhuma palavra-chave de segurança/criptografia aparece no copy.
 *
 *  Modelo de ameaça: o nsec efêmero nunca sai do dispositivo. O nsec
 *  reconstruído é re-criptografado imediatamente com o novo padrão e
 *  nunca é persistido em plaintext. O npub da dona (público) é buscado
 *  no backend pelo identificador — não vaza informação nova.
 */

import { useEffect, useRef, useState } from "react";
import Header from "../../components/Header";
import HexPatternCanvas from "../../components/HexPatternCanvas";
import { markUnlockedThisSession, getNpubByIdentificador, updateNpub, setIdentificador as setStoredIdentificador, setPin as setStoredPin } from "../../api";
import {
  startRecoveryRequest,
  startRecoveryRequestWithNsec,
  subscribeToRecoveryResponses,
  tryCombineShares,
  type RecoveryRequestResult,
  type RecoveryResponse,
} from "../../lib/recovery-request";
import { adoptRecoveredIdentity, resetFailedAttempts } from "../../lib/pattern-storage";
import { base64ToBytes } from "../../lib/recovery-serialize";
import { createNostrIdentity, decodeNsec } from "../../lib/nostr-keys";

interface RecoverAccountPageProps {
  /** Chamado quando o nsec foi recuperado, guardado e a sessão destravada. */
  onRecovered: () => void;
  /** Volta para PatternLoginPage. */
  onBack: () => void;
  /** "Pedir aula de ponto" — disfarçado de pedido de ajuda a uma tecelã
   *  (Mudança #3). A Lane D conecta à view de pedido de ajuda (Lane C
   *  cria a UI). Opcional com default para não quebrar o build. */
  onPedirAulaPonto?: () => void;
}

/** Estados da máquina de recuperação. */
type Phase =
  | "input" // Estado 1: input do identificador + PIN
  | "searching" // Estado 2: procurando tecelãs (loading)
  | "waiting" // Estado 3: aguardando respostas
  | "newPattern" // Estado 4: desenhar novo Ponto Arakne
  | "error"; // Estado 5: erro

/** Threshold SSSS (M=2 de N=2 — Opção E). */
const THRESHOLD = 2;
/** Timeout máximo de espera por respostas (ms). */
const RESPONSE_TIMEOUT_MS = 60_000;

export default function RecoverAccountPage({
  onRecovered,
  onBack,
  onPedirAulaPonto,
}: RecoverAccountPageProps) {
  const [phase, setPhase] = useState<Phase>("input");
  // Caminho escolhido no estado input (Mudança #3): "pin" (fluxo atual,
  // busca share 1 no backend) ou "nsec" (a dona tem o nsec anotado).
  const [path, setPath] = useState<"pin" | "nsec">("pin");
  const [identificador, setIdentificador] = useState("");
  const [pin, setPin] = useState("");
  const [nsecInput, setNsecInput] = useState("");
  const [nsecError, setNsecError] = useState<string | null>(null);
  const [paperBackup, setPaperBackup] = useState("");
  const [responses, setResponses] = useState<RecoveryResponse[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [combining, setCombining] = useState(false);
  // Indica se a share 1 do backend foi recuperada com sucesso.
  const [backendShareOk, setBackendShareOk] = useState(false);
  // Indica se há convidadora (1 avalista) ou não (0 — paper backup).
  const [hasConvidadora, setHasConvidadora] = useState(true);
  // Caminho nsec: se a dona colou um nsec válido, guardamos os bytes
  // para adotar direto (sem combine) no estado newPattern.
  const nsecDirectRef = useRef<Uint8Array | null>(null);

  // Guarda o resultado do pedido (nsec efêmero + npub esperado da dona +
  // share 1 do backend) entre os estados. Refs porque não precisam
  // re-renderizar.
  const requestResultRef = useRef<RecoveryRequestResult | null>(null);
  const expectedOwnerNpubRef = useRef<string | null>(null);
  const backendShareRef = useRef<Uint8Array | null>(null);

  // Cleanup do subscribe e do timeout — guardados em refs para chamar
  // no unmount ou ao cancelar.
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<number | null>(null);

  // ── Cleanup no unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // ── Estado 2: dispara o pedido ao backend + relays ─────────
  // Ramifica por `path` (Mudança #3): "pin" (fluxo SSSS original,
  // busca share 1 no backend) ou "nsec" (a dona tem o nsec anotado,
  // só precisa desembrulhar a share 0 da convidadora via NIP-59).
  async function handleSearch() {
    if (path === "nsec") {
      await handleSearchNsec();
      return;
    }
    const id = identificador.trim();
    const pinTrim = pin.trim();
    if (!id) {
      setErrorMsg("Informe o identificador do seu ateliê.");
      setPhase("error");
      return;
    }
    if (!pinTrim) {
      setErrorMsg("Informe seu código de reserva (PIN).");
      setPhase("error");
      return;
    }

    setPhase("searching");
    setErrorMsg("");

    try {
      const result = await startRecoveryRequest(id, pinTrim);
      requestResultRef.current = result;
      backendShareRef.current = result.backendShare;
      setBackendShareOk(result.backendShare !== null);

      // O npub esperado da dona é buscado no backend (endpoint público,
      // sem auth). startRecoveryRequest já valida isso internamente e
      // lança se não encontra, mas não retorna o npub — precisamos dele
      // para o subscribe (validação) e para o combine final. Re-buscamos
      // aqui: chamada idempotente e barata.
      const ownerNpub = await getNpubByIdentificador(id);
      if (!ownerNpub) {
        setErrorMsg("Não encontramos seu ateliê. Confira o identificador.");
        setPhase("error");
        return;
      }
      expectedOwnerNpubRef.current = ownerNpub;

      // Decide se há convidadora: se published > 0, o pedido NIP-59 foi
      // entregue a alguém. Se published === 0, não há convidadora — a
      // dona precisa usar o paper backup (fallback E′).
      setHasConvidadora(result.published > 0);

      // P2 (auditoria item 9): se o login falhou (PIN incorreto), mostra
      // feedback imediato em vez de esperar 60s de timeout. Mesmo que
      // published > 0 (convidadora recebeu o pedido), sem backendShare a
      // recuperação nunca atinge threshold T=2.
      if (result.loginFailed) {
        setErrorMsg(
          "Código de reserva incorreto. Confira o identificador e o PIN.",
        );
        setPhase("error");
        return;
      }

      // Se não há convidadora e a share 1 do backend veio, vamos direto
      // ao estado de espera pelo paper backup (sem subscribe NIP-59).
      if (result.published === 0) {
        if (result.backendShare) {
          // Sem convidadora — dona precisa colar o código de papel.
          setResponses([]);
          setPhase("waiting");
          // Sem subscribe nem timeout: a dona vai colar o paper backup.
          return;
        }
        // Fallback de recuperação simples: o login succeeded (PIN correto),
        // mas não há shares SSSS nem avalistas configurados. Em vez de
        // bloquear, geramos uma nova identidade Nostr e vinculamos à conta
        // do backend — o saldo/tier/empréstimos estão no backend, não no
        // nsec. A dona desenha um novo Ponto Arakne e o app adota a nova
        // identidade. SSSS pode ser configurado depois pelo FinancialPage.
        if (!result.loginFailed) {
          try {
            const identity = createNostrIdentity();
            const nsecBytes = decodeNsec(identity.nsec);
            // updateNpub usa o token do localStorage (setado por
            // startRecoveryRequest via setToken). Se falhar, ainda assim
            // adotamos a identidade — o npub será atualizado na próxima
            // chamada autenticada.
            await updateNpub(localStorage.getItem("arakne_token") || "", identity.npub);
            // Guarda as credenciais no localStorage para ensureToken
            // funcionar nas telas financeiras.
            setStoredIdentificador(id);
            setStoredPin(pinTrim);
            localStorage.setItem("arakne_npub", identity.npub);
            // Marca como não distribuído para o FinancialPage poder
            // configurar SSSS depois.
            localStorage.removeItem("arakne_recovery_distributed");
            nsecDirectRef.current = nsecBytes;
            setResponses([]);
            setPhase("newPattern");
            return;
          } catch (err) {
            console.error("[RecoverAccountPage] fallback de recuperação simples falhou:", err);
          }
        }
        // Nem backend nem convidadora — não dá para recuperar.
        setErrorMsg(
          "Não conseguimos reatar seus fios agora. Confira o identificador e o código de reserva.",
        );
        setPhase("error");
        return;
      }

      // Publicou em ≥1 relay — vai para o estado de espera.
      setResponses([]);
      setPhase("waiting");
      startWaitingForResponses();
    } catch (err) {
      console.error("[RecoverAccountPage] startRecoveryRequest falhou:", err);
      setErrorMsg(
        "Não conseguimos reatar seus fios agora. Confira o identificador e o código de reserva.",
      );
      setPhase("error");
    }
  }

  // ── Estado 2 (caminho nsec): a dona tem o nsec anotado ──────
  // Neste caminho (Mudança #3), a dona cola/escaneia o nsec. Decodifica,
  // deriva npub, busca avalistas no backend (se souber o identificador)
  // e envia o pedido NIP-59 à convidadora. Como a dona JÁ TEM o nsec,
  // ela não precisa combinar shares — pode adotar o nsec direto. Mas
  // mantemos o fluxo SSSS para o caso de a dona querer validar com a
  // convidadora (opcional). O caminho mais comum é: tem nsec → adota
  // direto após desenhar o novo Ponto Arakne.
  async function handleSearchNsec() {
    const nsecTrim = nsecInput.trim();
    if (!nsecTrim) {
      setNsecError("Cole sua chave secreta (nsec1...).");
      return;
    }

    // Valida o nsec imediatamente (feedback rápido antes de ir ao backend).
    let nsecBytes: Uint8Array;
    try {
      nsecBytes = decodeNsec(nsecTrim);
    } catch (err) {
      setNsecError(
        `Chave secreta inválida. Precisa começar com "nsec1". ${(err as Error).message}`,
      );
      return;
    }
    if (nsecBytes.length !== 32) {
      setNsecError("Chave secreta com tamanho errado.");
      return;
    }
    setNsecError(null);

    setPhase("searching");
    setErrorMsg("");

    // Guarda o nsec direto para adoção sem combine (a dona já tem a
    // chave — não precisa das shares SSSS).
    nsecDirectRef.current = nsecBytes;

    try {
      const id = identificador.trim() || null;
      const result = await startRecoveryRequestWithNsec(nsecTrim, id);
      requestResultRef.current = result;
      expectedOwnerNpubRef.current = result.ownerNpub;
      backendShareRef.current = null;
      setBackendShareOk(false);
      setHasConvidadora(result.published > 0);

      // Se a dona tem o nsec, ela não precisa esperar respostas — pode
      // ir direto ao novo Ponto Arakne. Mas se há convidadora, ainda
      // inscrevemos para o caso de ela querer validar (opcional). O
      // fluxo principal aqui é: tem nsec → desenha novo padrão → adota.
      // Vamos direto ao newPattern (mais simples e útil).
      setResponses([]);
      setPhase("newPattern");
    } catch (err) {
      console.error("[RecoverAccountPage] startRecoveryRequestWithNsec falhou:", err);
      setErrorMsg(
        "Não conseguimos reatar seus fios com essa chave. Confira sua chave secreta.",
      );
      setPhase("error");
    }
  }

  // ── Estado 3: inscreve para receber respostas + timeout ────
  function startWaitingForResponses() {
    const result = requestResultRef.current;
    const ownerNpub = expectedOwnerNpubRef.current;
    if (!result || !ownerNpub) return;

    const cleanup = subscribeToRecoveryResponses(
      result.ephemeralNsec,
      (response) => {
        setResponses((prev) => {
          // Evita duplicatas (mesma convidadora respondendo 2x).
          if (prev.some((r) => r.avalistaNpub === response.avalistaNpub)) {
            return prev;
          }
          const next = [...prev, response];
          // Quando atingir o threshold (considerando a share do backend),
          // vai para o estado 4.
          const totalShares =
            (backendShareRef.current ? 1 : 0) + next.length;
          if (totalShares >= THRESHOLD) {
            // Para de escutar — já temos o suficiente.
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }
            if (timeoutRef.current !== null) {
              window.clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setPhase("newPattern");
          }
          return next;
        });
      },
      ownerNpub,
    );
    unsubscribeRef.current = cleanup;

    // Timeout: se não receber respostas a tempo, mostra mensagem clara.
    timeoutRef.current = window.setTimeout(() => {
      setResponses((prev) => {
        const totalShares = (backendShareRef.current ? 1 : 0) + prev.length;
        if (totalShares < THRESHOLD) {
          setErrorMsg(
            "Aguardando suas tecelãs responderem... Tente novamente mais tarde, ou use seu código de reserva de papel.",
          );
          setPhase("error");
        }
        return prev;
      });
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      timeoutRef.current = null;
    }, RESPONSE_TIMEOUT_MS);
  }

  function handleCancelWaiting() {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setResponses([]);
    setPhase("input");
  }

  // ── Fallback E′: dona cola o paper backup (share 0 em base64) ──
  function handleUsePaperBackup() {
    const trimmed = paperBackup.trim();
    if (!trimmed) {
      setErrorMsg("Cole o código de reserva de papel que você anotou.");
      setPhase("error");
      return;
    }
    let paperShare: Uint8Array;
    try {
      paperShare = base64ToBytes(trimmed);
    } catch (err) {
      console.error("[RecoverAccountPage] paper backup base64 inválido:", err);
      setErrorMsg("O código de reserva de papel parece inválido. Confira.");
      setPhase("error");
      return;
    }
    // Encapsula como uma "resposta" da convidadora (paper) e avança.
    const paperResponse: RecoveryResponse = {
      avalistaNpub: "paper-backup",
      share: paperShare,
      vaultId: "",
    };
    setResponses([paperResponse]);
    const totalShares = (backendShareRef.current ? 1 : 0) + 1;
    if (totalShares >= THRESHOLD) {
      setPhase("newPattern");
    } else {
      setErrorMsg("Ainda faltam fios. Confira seu código de reserva de papel.");
      setPhase("error");
    }
  }

  // ── Estado 4: combina shares + adota identidade ────────────
  async function handlePatternConfirmed(newPattern: number[]) {
    setCombining(true);
    try {
      let recoveredNsec: Uint8Array | null = null;

      // Caminho nsec (Mudança #3): a dona colou o nsec — adota direto,
      // sem combinar shares. O nsec já foi validado em handleSearchNsec.
      if (nsecDirectRef.current) {
        recoveredNsec = nsecDirectRef.current;
      } else {
        // Caminho PIN (fluxo SSSS original): combina share 1 do backend
        // + share 0 da convidadora (ou paper backup).
        const ownerNpub = expectedOwnerNpubRef.current;
        if (!ownerNpub) {
          setErrorMsg(
            "Não conseguimos reatar seus fios agora. Tente novamente ou peça ajuda a outra tecelã.",
          );
          setPhase("error");
          setCombining(false);
          return;
        }
        recoveredNsec = await tryCombineShares(
          backendShareRef.current,
          responses,
          ownerNpub,
        );
      }

      if (!recoveredNsec) {
        setErrorMsg(
          "Não conseguimos reatar seus fios agora. Tente novamente ou peça ajuda a outra tecelã.",
        );
        setPhase("error");
        return;
      }

      // Re-criptografa o nsec recuperado com o novo padrão e guarda.
      await adoptRecoveredIdentity(recoveredNsec, newPattern);

      // Recuperação bem-sucedida: zera o contador de tentativas falhas
      // do Ponto Arakne (§5.2) — a dona começa um novo ciclo com o novo
      // padrão, sem lockout residual.
      resetFailedAttempts();

      markUnlockedThisSession();
      onRecovered();
    } catch (err) {
      console.error("[RecoverAccountPage] combine/adopt falhou:", err);
      setErrorMsg(
        "Não conseguimos reatar seus fios agora. Tente novamente ou peça ajuda a outra tecelã.",
      );
      setPhase("error");
    } finally {
      setCombining(false);
    }
  }

  function handleTryAgain() {
    // Volta ao estado 1, preservando o identificador digitado (conveniência).
    setResponses([]);
    setErrorMsg("");
    setNsecError(null);
    requestResultRef.current = null;
    expectedOwnerNpubRef.current = null;
    backendShareRef.current = null;
    nsecDirectRef.current = null;
    setBackendShareOk(false);
    setHasConvidadora(true);
    setPhase("input");
  }

  // Conta quantos fios já chegaram (para o contador da tela de espera).
  const fiosRecebidos = (backendShareOk ? 1 : 0) + responses.length;

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="page">
      <Header />
      <main className="onboarding">
        <button className="onboarding__back" onClick={onBack}>
          ← Voltar
        </button>

        {/* Estado 1 — Input: dois caminhos (PIN ou nsec) + pedir ajuda */}
        {phase === "input" && (
          <>
            <h1 className="onboarding__title">Reatar seus fios</h1>
            <p className="onboarding__tagline">
              Se você perdeu seu Ponto Arakne, suas tecelãs podem te ajudar a
              reatar os fios do seu ateliê.
            </p>

            {/* Seletor de caminho (Mudança #3): "Tenho meu PIN" ou
                "Tenho minha chave secreta". Disfarçado de abas de
                "como você quer reatar seus fios". */}
            <div className="onboarding__form">
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button
                  type="button"
                  className={path === "pin" ? "btn btn--primary" : "btn btn--secondary"}
                  onClick={() => setPath("pin")}
                  style={{ flex: 1 }}
                >
                  Tenho meu PIN
                </button>
                <button
                  type="button"
                  className={path === "nsec" ? "btn btn--primary" : "btn btn--secondary"}
                  onClick={() => setPath("nsec")}
                  style={{ flex: 1 }}
                >
                  Tenho minha chave
                </button>
              </div>

              {/* Caminho 1: PIN (fluxo SSSS original) */}
              {path === "pin" && (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor="identificador">
                      Identificador do seu ateliê
                    </label>
                    <input
                      id="identificador"
                      className="field__input"
                      type="text"
                      value={identificador}
                      onChange={(e) => setIdentificador(e.target.value)}
                      placeholder="abc123_XyZ"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={combining}
                    />
                    <p className="field__hint">
                      É o código que você anotou ao criar sua conta.
                    </p>
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="pin">
                      Código de reserva (PIN)
                    </label>
                    <input
                      id="pin"
                      className="field__input"
                      type="password"
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="4 dígitos"
                      autoComplete="off"
                      disabled={combining}
                    />
                    <p className="field__hint">
                      É o código de reserva que você anotou ao configurar suas
                      tecelãs.
                    </p>
                  </div>

                  <button
                    className="btn btn--primary"
                    onClick={handleSearch}
                    disabled={!identificador.trim() || !pin.trim()}
                  >
                    Procurar tecelãs
                  </button>
                </>
              )}

              {/* Caminho 2: nsec (a dona tem a chave secreta anotada) */}
              {path === "nsec" && (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor="nsecInput">
                      Sua chave secreta
                    </label>
                    <textarea
                      id="nsecInput"
                      className="field__input"
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      placeholder="nsec1..."
                      rows={3}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={combining}
                    />
                    <p className="field__hint">
                      É a chave longa que você anotou em papel ao criar sua
                      conta. Começa com "nsec1".
                    </p>
                    {nsecError && <p className="field__error">{nsecError}</p>}
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="identificadorNsec">
                      Identificador do seu ateliê (opcional)
                    </label>
                    <input
                      id="identificadorNsec"
                      className="field__input"
                      type="text"
                      value={identificador}
                      onChange={(e) => setIdentificador(e.target.value)}
                      placeholder="abc123_XyZ"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={combining}
                    />
                    <p className="field__hint">
                      Se você souber, ajuda suas tecelãs a te encontrar mais
                      rápido. Se não lembrar, pode deixar em branco.
                    </p>
                  </div>

                  <button
                    className="btn btn--primary"
                    onClick={handleSearch}
                    disabled={!nsecInput.trim()}
                  >
                    Reatar com minha chave
                  </button>
                </>
              )}

              {/* Se a usuária não tem nem PIN nem nsec → pedir ajuda a
                  uma tecelã (disfarçado de "pedir aula de ponto").
                  A Lane C cria a UI do pedido; a Lane D conecta o
                  callback. Texto crochê: "Não consigo acessar meu
                  projeto — quero pedir uma aula de ponto a uma tecelã". */}
              <div className="onboarding__footer-link" style={{ marginTop: "1.25rem" }}>
                <button
                  type="button"
                  onClick={onPedirAulaPonto}
                  style={{ color: "var(--text-muted, #888)", fontSize: "0.9rem" }}
                >
                  Não consigo acessar meu projeto — quero pedir uma aula de
                  ponto a uma tecelã
                </button>
              </div>
            </div>
          </>
        )}

        {/* Estado 2 — Procurando tecelãs (loading) */}
        {phase === "searching" && (
          <div className="recover__status">
            <span className="spinner" />
            <p className="recover__status-text">Procurando suas tecelãs...</p>
          </div>
        )}

        {/* Estado 3 — Aguardando respostas */}
        {phase === "waiting" && (
          <div className="recover__status">
            <span className="spinner" />
            <p className="recover__status-text">
              {hasConvidadora
                ? "Aguardando suas tecelãs responderem..."
                : "Aguardando seu código de reserva de papel."}
            </p>
            <p className="recover__counter">
              {Math.min(fiosRecebidos, THRESHOLD)} de {THRESHOLD} fios recebidos
            </p>
            {backendShareOk && (
              <p className="field__hint">
                1 fio recuperado do ateliê central.
              </p>
            )}

            {/* Fallback E′: sem convidadora — dona cola o paper backup. */}
            {!hasConvidadora && (
              <div className="onboarding__form" style={{ marginTop: "1rem" }}>
                <div className="field">
                  <label className="field__label" htmlFor="paperBackup">
                    Código de reserva de papel
                  </label>
                  <textarea
                    id="paperBackup"
                    className="field__input"
                    value={paperBackup}
                    onChange={(e) => setPaperBackup(e.target.value)}
                    placeholder="Cole o código que você anotou em papel"
                    rows={3}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="field__hint">
                    É o código longo que você anotou em papel ao configurar
                    suas tecelãs.
                  </p>
                </div>
                <button
                  className="btn btn--primary"
                  onClick={handleUsePaperBackup}
                  disabled={!paperBackup.trim()}
                >
                  Usar código de reserva
                </button>
              </div>
            )}

            {hasConvidadora && (
              <button
                className="btn btn--secondary"
                onClick={handleCancelWaiting}
              >
                Cancelar
              </button>
            )}
          </div>
        )}

        {/* Estado 4 — Aula disfarçada de novo ponto (§5.2: "uma aula de um
            ponto novo" cuja coreografia É a definição do novo Ponto Arakne) */}
        {phase === "newPattern" && (
          <>
            <h1 className="onboarding__title">Aula: Ponto Renascido</h1>
            <p className="onboarding__tagline">
              Sua tecelã reatou os fios. Agora aprenda um ponto novo para
              guardar seu ateliê — desenhe a coreografia abaixo.
            </p>

            <div style={{ width: "100%", maxWidth: "420px" }}>
              <HexPatternCanvas
                mode="register"
                onPatternConfirmed={handlePatternConfirmed}
              />

              {combining && (
                <p
                  className="field__hint"
                  style={{ textAlign: "center", marginTop: "0.75rem" }}
                >
                  Reatando seus fios...
                </p>
              )}
            </div>
          </>
        )}

        {/* Estado 5 — Erro */}
        {phase === "error" && (
          <>
            <h1 className="onboarding__title">Não foi dessa vez</h1>
            <p className="onboarding__tagline">
              {errorMsg ||
                "Não conseguimos reatar seus fios agora. Tente novamente ou peça ajuda a outra tecelã."}
            </p>

            <div className="onboarding__form">
              <button className="btn btn--primary" onClick={handleTryAgain}>
                Tentar de novo
              </button>
              <button className="btn btn--secondary" onClick={onBack}>
                Voltar
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
