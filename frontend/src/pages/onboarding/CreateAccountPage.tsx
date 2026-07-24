/** CreateAccountPage — onboarding: nome + consentimento + PIN de acesso + Ponto Arakne.
 *
 *  Substitui o antigo PIN numérico pela identidade Nostr: a usuária desenha
 *  um padrão hexagonal (Ponto Arakne) que vira a senha de destravamento.
 *  O nsec é criptografado com AES-GCM-256 + PBKDF2 do padrão e guardado
 *  no localStorage. O npub (chave pública bech32) é o identificador de
 *  backup — anotado em QR/papel — usado na próxima tela (RecoverySetupPage).
 *
 *  Mudança #8-frontend: a usuária ESCOLHE um PIN numérico de acesso (4-8
 *  dígitos), em vez de o PIN ser gerado aleatoriamente. Esse PIN é o
 *  "código de reserva" usado para decriptar a share 1 do backend na
 *  recuperação social (Opção E). O Ponto Arakne continua sendo desenhado
 *  no HexPatternCanvas (mode="register"). O disfarce é preservado: a UI
 *  chama o PIN de "código de acesso ao projeto", sem mencionar
 *  "recuperação".
 */

import { useState } from "react";
import Header from "../../components/Header";
import HexPatternCanvas from "../../components/HexPatternCanvas";
import { criarConta, setNickname } from "../../api";
import { createAndStoreIdentity } from "../../lib/pattern-storage";
import type { NostrIdentity } from "../../lib/nostr-keys";

interface CreateAccountPageProps {
  inviteCodigo?: string | null;
  onBack: () => void;
  /** Chamado quando o padrão foi confirmado e a identidade Nostr criada.
   *  Recebe npub (chave pública bech32 — mostrada na próxima tela),
   *  nsec (chave privada bech32 — passada adiante para distribuir os
   *  shards SSSS aos avalistas) e o PIN escolhido (usado para
   *  criptografar a share 1 antes de enviar ao backend — Opção E). O
   *  nsec NÃO é persistido em plaintext; ele só existe em memória entre
   *  esta tela e a RecoverySetupPage. */
  onCreated: (npub: string, nsec: string, pin: string) => void;
}

/** Tamanho mínimo/máximo do PIN de acesso (Mudança #8). */
const PIN_MIN = 4;
const PIN_MAX = 8;

export default function CreateAccountPage({ inviteCodigo, onBack, onCreated }: CreateAccountPageProps) {
  const [nome, setNome] = useState("");
  const [consent, setConsent] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PIN de acesso escolhido pela usuária (Mudança #8). Disfarçado de
  // "código de acesso ao projeto" — não menciona recuperação.
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [pinConfirmTouched, setPinConfirmTouched] = useState(false);

  // Validações do PIN (só disparam depois do primeiro toque/campo sujo).
  const pinLengthOk = pin.length >= PIN_MIN && pin.length <= PIN_MAX;
  const pinConfirmMatches = pin === pinConfirm && pinLengthOk;
  const pinValid = pinLengthOk && pinConfirmMatches;
  const showPinError = pinTouched && !pinLengthOk;
  const showPinConfirmError = pinConfirmTouched && pin !== pinConfirm;

  // Só libera o canvas de Ponto Arakne quando o PIN está válido e o
  // consentimento está marcado. Isso evita a usuária desenhar o padrão
  // antes de ter um PIN válido (que é necessário para criar a conta).
  const podeDesenhar = pinValid && consent;

  async function handlePatternConfirmed(pattern: number[]) {
    setError(null);
    setLoading(true);
    try {
      // 1. Cria identidade Nostr: gera nsec direto (32 bytes), deriva npub,
      //    criptografa nsec com o padrão e guarda no localStorage.
      const identity: NostrIdentity = await createAndStoreIdentity(pattern);

      // 2. Cria conta no backend com o PIN escolhido pela usuária
      //    (Mudança #8 — antes era generatePin()). O PIN é o "código de
      //    reserva" que a usuária vai anotar e usar na recuperação social.
      const apelido = nome.trim() || undefined;
      const usuaria = await criarConta(pin, inviteCodigo, undefined, apelido);
      if (!usuaria) {
        // criarConta retorna null em erro de rede ou resposta inválida
        // do backend. Distinguimos de um erro inesperado (catch) para
        // dar mensagem amigável de conectividade.
        setError(
          "Não foi possível conectar ao ateliê central. Verifique sua internet e tente de novo."
        );
        setLoading(false);
        return;
      }

      if (apelido) setNickname(apelido);
      onCreated(identity.npub, identity.nsec, pin);
    } catch (err) {
      console.error("[CreateAccountPage] falha ao criar conta:", err);
      // Erro inesperado (ex.: falha ao criptografar o nsec localmente).
      // Mensagem genérica em vocabulário crochê, sem expor detalhes técnicos.
      setError("Algo deu errado ao guardar seu desenho. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Header />
      <main className="onboarding">
        <button className="onboarding__back" onClick={onBack}>← Voltar</button>
        <h1 className="onboarding__title">Criar conta</h1>
        <p className="onboarding__tagline">Leva menos de um minuto.</p>

        <div className="onboarding__form">
          <div className="field">
            <label className="field__label" htmlFor="nome">Nome ou apelido (opcional)</label>
            <input
              id="nome"
              className="field__input"
              placeholder="Como quer ser chamada?"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
            />
          </div>

          {/* PIN de acesso (Mudança #8) — disfarçado de "código de
              acesso ao projeto". A usuária escolhe 4-8 dígitos numéricos
              e confirma. Esse PIN é o "código de reserva" usado na
              recuperação social (Opção E), mas a UI não menciona
              "recuperação" para preservar o disfarce. */}
          <div className="field">
            <label className="field__label" htmlFor="pin">
              Código de acesso ao projeto
            </label>
            <input
              id="pin"
              className="field__input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                // Só aceita dígitos, até 8 caracteres.
                const v = e.target.value.replace(/\D/g, "").slice(0, PIN_MAX);
                setPin(v);
              }}
              onBlur={() => setPinTouched(true)}
              placeholder={`${PIN_MIN} a ${PIN_MAX} dígitos`}
              autoComplete="off"
              maxLength={PIN_MAX}
            />
            <p className="field__hint">
              Anote este código — ele abre seu projeto se você perder seu
              Ponto Arakne. Só números, entre {PIN_MIN} e {PIN_MAX} dígitos.
            </p>
            {showPinError && (
              <p className="field__error">
                O código precisa ter entre {PIN_MIN} e {PIN_MAX} dígitos.
              </p>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pinConfirm">
              Confirme seu código de acesso
            </label>
            <input
              id="pinConfirm"
              className="field__input"
              type="password"
              inputMode="numeric"
              value={pinConfirm}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, PIN_MAX);
                setPinConfirm(v);
              }}
              onBlur={() => setPinConfirmTouched(true)}
              placeholder="Digite o mesmo código"
              autoComplete="off"
              maxLength={PIN_MAX}
            />
            {showPinConfirmError && (
              <p className="field__error">Os códigos não batem.</p>
            )}
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Concordo com as regras da nossa comunidade de tricô. Não pedimos
              e-mail nem telefone.
            </span>
          </label>

          {error && <p className="field__error">{error}</p>}

          <div className="onboarding__pattern-intro">
            <p className="onboarding__tagline" style={{ marginBottom: "0.5rem" }}>
              Desenhe seu <strong>Ponto Arakne</strong> — ele é a chave do seu
              ateliê. Conecte pelo menos 8 pontos e repita para confirmar.
            </p>
          </div>

          {podeDesenhar ? (
            <HexPatternCanvas
              mode="register"
              onPatternConfirmed={handlePatternConfirmed}
              minLength={8}
            />
          ) : (
            <p className="field__hint" style={{ textAlign: "center" }}>
              {consent
                ? "Preencha e confirme seu código de acesso para desenhar o Ponto Arakne."
                : "Marque o consentimento para continuar."}
            </p>
          )}

          {loading && (
            <div className="recover__status" style={{ paddingTop: "0.75rem" }}>
              <span className="spinner" style={{ width: "24px", height: "24px" }} />
              <p className="recover__status-text">Guardando seu desenho...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
