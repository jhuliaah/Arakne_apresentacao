/** Aula page — mostra PDF, passo a passo e vídeo da aula.

  Suporta três tipos de mídia por aula: PDF (link), imagem (passo a passo
  numerado) e vídeo (iframe embutido). O botão "Concluir Aula" marca o
  progresso — puramente educacional, sem efeito financeiro.

  EXCEÇÃO: a "aula 1 do nível 1" da trilha #9 (Ponto Arakne) é o portal
  disfarçado para a camada financeira. Em vez de conteúdo, mostra o
  HexPatternCanvas:
   - se já há identidade Nostr armazenada → mode="login" → destravar com
     o desenho → revela FinancialPage (transição arakne-reveal);
    - se não → mode="register" → cria identidade Nostr → vai à
      configuração de recuperação (RecoverySetupPage) e depois ao catálogo.

  As demais aulas da trilha #9 mostram conteúdo normal (placeholder do
  seed), como qualquer outra trilha.
*/

import { useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import HexPatternCanvas from "../components/HexPatternCanvas";
import { concluirAula, generatePin, criarConta, markUnlockedThisSession, iniciarAula } from "../api";
import {
  hasStoredIdentity,
  createAndStoreIdentity,
  unlockWithPattern,
  incrementFailedAttempts,
  resetFailedAttempts,
  isLockedOut,
  MAX_ATTEMPTS,
} from "../lib/pattern-storage";
import type { Aula } from "../types";

interface AulaPageProps {
  aula: Aula;
  onBack: () => void;
  onConcluida: () => void;
  onNavigate: (target: NavTarget) => void;
  /** Trilha #9 aula 1 nível 1 destravada → revela a camada financeira. */
  onRevealFinancial: () => void;
  /** Trilha #9 aula 1 nível 1 sem conta → cria identidade e vai à configuração de recuperação.
   *  Recebe o PIN gerado em criarConta (Opção E: usado para criptografar
   *  a share 1 antes de enviar ao backend). */
  onGoToRecoverySetup: (npub: string, nsec: string, pin: string) => void;
}

/** Detecta a "aula portal": aula 1 do nível 1 da trilha #9 (Ponto Arakne). */
function isPortalAula(aula: Aula): boolean {
  return aula.trilha_id === 9 && aula.nivel === 1 && aula.ordem === 1;
}

export default function AulaPage({
  aula,
  onBack,
  onConcluida,
  onNavigate,
  onRevealFinancial,
  onGoToRecoverySetup,
}: AulaPageProps) {
  const [concluida, setConcluida] = useState(aula.concluida);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Estado de "Começar aula" (BUG 3): se a aula ainda não foi iniciada
  // (ProgressoAula não existe), mostramos o botão "Começar aula" que
  // chama `iniciarAula`. Se já foi iniciada (mas não concluída), mostra
  // "Aula em andamento". Se concluída, nem mostra.
  const [iniciando, setIniciando] = useState(false);
  const [iniciada, setIniciada] = useState(aula.concluida);

  // Estado do portal (trilha #9 aula 1 nível 1).
  const [patternError, setPatternError] = useState(false);
  const [patternLoading, setPatternLoading] = useState(false);
  const [patternResetKey, setPatternResetKey] = useState(0);

  // ── Portal: trilha #9, aula 1, nível 1 ──────────────────────
  if (isPortalAula(aula)) {
    const hasIdentity = hasStoredIdentity();
    const mode = hasIdentity ? "login" : "register";
    // §5.2: se a dona errou o Ponto Arakne MAX_ATTEMPTS vezes (as pernas
    // da aranha), o Ponto trava — deixa de funcionar como credencial.
    // A UI disfarçada mostra um ponto genérico, sem indício de credencial.
    const lockedOut = hasIdentity && isLockedOut();

    async function handlePortalPattern(pattern: number[]) {
      setPatternLoading(true);
      if (hasIdentity) {
        // Login: destrava o nsec com o desenho.
        const identity = await unlockWithPattern(pattern);
        setPatternLoading(false);
        if (identity) {
          // Sucesso: zera o contador de tentativas falhas antes de revelar.
          resetFailedAttempts();
          markUnlockedThisSession();
          onRevealFinancial();
        } else {
          // Falha: incrementa o contador. Se atingiu o limite, o Ponto
          // trava — a UI passa a exibir o estado de lockout disfarçado.
          const attempts = incrementFailedAttempts();
          if (attempts >= MAX_ATTEMPTS) {
            setPatternError(false);
            setPatternResetKey((k) => k + 1);
            return;
          }
          setPatternError(true);
          window.setTimeout(() => {
            setPatternError(false);
            setPatternResetKey((k) => k + 1);
          }, 650);
        }
      } else {
        // Registro: cria identidade Nostr + conta backend, vai à recuperação.
        try {
          const id = await createAndStoreIdentity(pattern);
          // Conta backend com PIN aleatório interno. O PIN é passado à
          // RecoverySetupPage para criptografar a share 1 (Opção E) e
          // mostrado à dona como "código de reserva" para anotar.
          const pin = generatePin();
          await criarConta(pin);
          // Nova identidade começa com contador de tentativas zerado.
          resetFailedAttempts();
          setPatternLoading(false);
          onGoToRecoverySetup(id.npub, id.nsec, pin);
        } catch {
          setPatternLoading(false);
          setErro("Algo deu errado ao guardar seu desenho. Tente novamente.");
          setPatternResetKey((k) => k + 1);
        }
      }
    }

    // ── Estado de lockout (§5.2): ponto "indisponível", sem credencial ──
    // Disfarce mantida: parece um ponto de crochê genérico temporariamente
    // indisponível. Nenhuma linguagem de segurança/credencial/recuperação.
    if (lockedOut) {
      return (
        <div className="page">
          <Header />
          <main className="catalog">
            <button className="financial__back" onClick={onBack} aria-label="Voltar">
              ← Voltar
            </button>

            <div className="aula__header">
              <h2 className="aula__title">{aula.titulo}</h2>
              <p className="aula__desc">
                Este ponto requer prática adicional. Explore outras trilhas enquanto isso.
              </p>
            </div>

            {/* Ponto de crochê genérico — visual estático, não interativo.
                Parece um padrão normal, mas sem canvas de desenho. */}
            <div
              style={{
                width: "100%",
                maxWidth: "480px",
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1rem",
                padding: "1.5rem 0",
              }}
              aria-label="Ponto de crochê indisponível"
            >
              <div
                style={{
                  width: "220px",
                  height: "220px",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle at 50% 40%, #f5efe6 0%, #ece3d4 60%, #ddd1bd 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <span style={{ fontSize: "3rem", lineHeight: 1 }} aria-hidden="true">
                  🧶
                </span>
              </div>
              <p className="field__hint" style={{ textAlign: "center" }}>
                Este ponto está temporariamente indisponível. Tente outra aula.
              </p>
            </div>
          </main>
          <BottomNav active="catalog" onNavigate={onNavigate} />
        </div>
      );
    }

    return (
      <div className="page">
        <Header>
          <RecoveryBellHost />
        </Header>
        <main className="catalog">
          <button className="financial__back" onClick={onBack} aria-label="Voltar">
            ← Voltar
          </button>

          <div className="aula__header">
            <h2 className="aula__title">{aula.titulo}</h2>
            <p className="aula__desc">
              {hasIdentity
                ? "Desenhe seu Ponto Arakne para abrir esta aula."
                : "Desenhe seu Ponto Arakne para começar — ele é a chave do seu ateliê."}
            </p>
          </div>

          <div style={{ width: "100%", maxWidth: "480px", margin: "0 auto" }}>
            <HexPatternCanvas
              mode={mode}
              onPatternSubmit={hasIdentity ? handlePortalPattern : undefined}
              onPatternConfirmed={hasIdentity ? undefined : handlePortalPattern}
              error={patternError}
              resetKey={patternResetKey}
              minLength={8}
            />
            {patternLoading && (
              <p className="field__hint" style={{ textAlign: "center", marginTop: "0.75rem" }}>
                {hasIdentity ? "Verificando..." : "Guardando seu desenho..."}
              </p>
            )}
            {erro && <p className="field__error">{erro}</p>}
          </div>
        </main>
        <BottomNav active="catalog" onNavigate={onNavigate} />
      </div>
    );
  }

  // ── Aula normal (conteúdo educacional) ──────────────────────
  const pdfs = aula.materiais.filter((m) => m.tipo === "pdf");
  const imagens = aula.materiais
    .filter((m) => m.tipo === "imagem")
    .sort((a, b) => a.ordem - b.ordem);
  const videos = aula.materiais.filter((m) => m.tipo === "video");

  async function handleConcluir() {
    if (concluida) return;
    setSubmitting(true);
    setErro(null);
    const resp = await concluirAula(aula.id);
    setSubmitting(false);
    if (resp === null) {
      setErro("Não foi possível concluir aula. Verifique sua conexão ou faça login novamente.");
      return;
    }
    setConcluida(true);
    // Small delay so the user sees the confirmation before navigating back.
    setTimeout(() => onConcluida(), 800);
  }

  // "Começar aula" (BUG 3): cria ProgressoAula para esta aula. Se já
  // foi iniciada (idempotente), o backend retorna `iniciada_agora=false`
  // — não é erro. Após iniciar, marca `iniciada=true` para esconder o
  // botão e mostrar "Aula em andamento".
  async function handleIniciar() {
    if (iniciando || iniciada || concluida) return;
    setIniciando(true);
    setErro(null);
    const resp = await iniciarAula(aula.id);
    setIniciando(false);
    if (resp === null) {
      setErro("Não foi possível começar a aula. Tente novamente.");
      return;
    }
    setIniciada(true);
  }

  return (
    <div className="page">
      <Header />
      <main className="catalog">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <div className="aula__header">
          <h2 className="aula__title">{aula.titulo}</h2>
          <p className="aula__desc">{aula.descricao}</p>
        </div>

        {/* PDF — apostila/material de apoio */}
        {pdfs.length > 0 && (
          <section className="aula__section">
            <h3 className="aula__section-title">📄 Material de apoio</h3>
            <ul className="aula__pdf-list">
              {pdfs.map((m) => (
                <li key={m.id}>
                  <a
                    className="aula__pdf-link"
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="aula__pdf-icon" aria-hidden="true">📄</span>
                    <span className="aula__pdf-name">{m.titulo}</span>
                    <span className="aula__pdf-action">Abrir</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Imagens — passo a passo numerado */}
        {imagens.length > 0 && (
          <section className="aula__section">
            <h3 className="aula__section-title">🖼️ Passo a passo</h3>
            <ol className="aula__steps">
              {imagens.map((m, idx) => (
                <li key={m.id} className="aula__step">
                  <span className="aula__step-number">{idx + 1}</span>
                  <div className="aula__step-content">
                    <img
                      className="aula__step-img"
                      src={m.url}
                      alt={m.legenda || m.titulo}
                      loading="lazy"
                    />
                    <p className="aula__step-caption">{m.legenda || m.titulo}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Vídeo — vídeo-aula */}
        {videos.length > 0 && (
          <section className="aula__section">
            <h3 className="aula__section-title">🎬 Vídeo-aula</h3>
            {videos.map((m) => (
              <div key={m.id} className="aula__video">
                <div className="aula__video-frame">
                  <iframe
                    src={m.url}
                    title={m.titulo}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <p className="aula__video-title">{m.titulo}</p>
              </div>
            ))}
          </section>
        )}

        {/* Erro */}
        {erro && (
          <div className="financial__error">
            <p>{erro}</p>
          </div>
        )}

        {/* "Começar aula" (BUG 3): se a aula não foi iniciada nem
            concluída, mostra o botão para criar o ProgressoAula. Se já
            iniciada (mas não concluída), mostra "Aula em andamento". */}
        {!concluida && !iniciada && (
          <button
            className="btn btn--secondary aula__iniciar"
            onClick={handleIniciar}
            disabled={iniciando || submitting}
            style={{ marginBottom: "0.75rem" }}
          >
            {iniciando ? "Começando..." : "Começar aula"}
          </button>
        )}
        {!concluida && iniciada && (
          <p className="field__hint" style={{ marginBottom: "0.75rem" }}>
            ✓ Aula em andamento
          </p>
        )}

        {/* Concluir */}
        <button
          className="btn btn--primary aula__concluir"
          onClick={handleConcluir}
          disabled={concluida || submitting}
        >
          {concluida ? "✓ Aula concluída" : submitting ? "Salvando..." : "Concluir aula"}
        </button>
      </main>
      <BottomNav active="catalog" onNavigate={onNavigate} />
    </div>
  );
}
