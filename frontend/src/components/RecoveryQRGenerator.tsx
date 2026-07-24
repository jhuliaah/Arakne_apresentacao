/** RecoveryQRGenerator — tecelã gera QR efêmero com a share 0 (Track 4D).
 *
 *  Tela que a tecelã vê após clicar "Aceitar aula" num pedido do sino
 *  (RecoveryBell). Fluxo:
 *
 *  1. Recebe o `IncomingRecoveryRequest` (npub da convidada + nsec
 *     efêmero dela para resposta).
 *  2. Desembrulha a share 0 que a tecelã tem em cache
 *     (`getShareForOwner(ownerNpub)` em `recovery-respond.ts`). Se não
 *     houver share em cache, mostra erro disfarçado ("Não tenho o fio
 *     dessa tecelã") — sem expor que é share criptográfica.
 *  3. Gera um QR on-demand contendo a share 0 + metadados mínimos
 *     (ownerNpub da convidada, timestamp). Renderizado em `<canvas>`
 *     (não `<img>`) com `user-select: none` e TTL curto (5 min) com
 *     countdown visual. Após expirar, a tecelã precisa gerar de novo.
 *  4. Após gerar o QR, publica um gift-wrap `type:"response"` endereçado
 *     ao nsec efêmero da convidada (reusa `publishRecoveryResponse`).
 *     O QR pode conter só a share 0 (a convidada pega share 1 do backend
 *     via PIN). Decisão de payload: share 0 em base64 + ownerNpub.
 *  5. Botão "Gerar novo QR" após expirar. Botão "Cancelar" volta.
 *
 *  Disfarce (§5.2 do mestre): a tela parece "preparar amostra de ponto
 *  para enviar à aluna". Sem jargão criptográfico visível. O countdown
 *  é "tempo para a aluna escanear a amostra".
 *
 *  Segurança (mestre §15):
 *  - QR renderizado em `<canvas>` (não `<img>`) — mais difícil de
 *    screenshot acidental, sem atributo `src` exposto no DOM.
 *  - `user-select: none` no container do QR.
 *  - TTL curto (5 min) com countdown visual. Após expirar, o canvas é
 *    limpo (clearRect) e a share não fica mais visível.
 *  - O payload do QR é mínimo: `{ v: 1, s: share0Base64, o: ownerNpub,
 *    t: timestamp }`. Share 0 SSSS é ~33 bytes em base64 = ~44 chars —
 *    cabe folgado num QR.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Header from "./Header";
import {
  getShareForOwner,
  publishRecoveryResponse,
  type IncomingRecoveryRequest,
} from "../lib/recovery-respond";

interface RecoveryQRGeneratorProps {
  /** Pedido recebido (vindo do sino — RecoveryBell). */
  request: IncomingRecoveryRequest;
  /** nsec da tecelã (para assinar o gift-wrap de resposta). Obrigatório
   *  para publicar a resposta NIP-59. Se null, o QR ainda é gerado mas
   *  a resposta automática não é publicada (modo só-QR). */
  avalistaNsec: Uint8Array | null;
  /** Volta para a tela anterior. */
  onBack: () => void;
}

/** Versão do payload do QR (para futuras migrações). */
const QR_PAYLOAD_VERSION = 1;
/** TTL do QR em milissegundos (5 minutos). */
const QR_TTL_MS = 5 * 60 * 1000;
/** Intervalo de atualização do countdown (ms). */
const COUNTDOWN_INTERVAL_MS = 1000;

/** Estado da tela. */
type Phase = "preparando" | "pronto" | "expirado" | "erro";

/** Monta o payload do QR como string JSON compacta.
 *  Formato: `{ v: 1, s: share0Base64, o: ownerNpub, t: timestampSeg }`. */
function montarPayloadQr(
  share0Base64: string,
  ownerNpub: string,
  timestampSeg: number,
): string {
  return JSON.stringify({
    v: QR_PAYLOAD_VERSION,
    s: share0Base64,
    o: ownerNpub,
    t: timestampSeg,
  });
}

export default function RecoveryQRGenerator({
  request,
  avalistaNsec,
  onBack,
}: RecoveryQRGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("preparando");
  const [errorMsg, setErrorMsg] = useState("");
  const [restanteMs, setRestanteMs] = useState(QR_TTL_MS);
  // Guarda o timestamp (ms) de geração para calcular o countdown.
  const geradoEmRef = useRef<number | null>(null);
  // Guarda se a resposta NIP-59 já foi publicada (evita duplicar).
  const respostaPublicadaRef = useRef(false);

  /** Gera (ou regenera) o QR no canvas e (re)inicia o countdown. */
  const gerarQr = useCallback(async () => {
    const share = getShareForOwner(request.ownerNpub);
    if (!share) {
      // Disfarce: "Não tenho o fio dessa tecelã" — sem expor share.
      setErrorMsg("Não tenho o fio dessa tecelã guardado aqui.");
      setPhase("erro");
      return;
    }

    // Codifica a share 0 em base64 para o payload do QR.
    let share0Base64: string;
    try {
      // share.share é Uint8Array — converter para base64.
      let bin = "";
      for (let i = 0; i < share.share.length; i++) {
        bin += String.fromCharCode(share.share[i]);
      }
      share0Base64 = btoa(bin);
    } catch (err) {
      console.error("[RecoveryQRGenerator] falha ao codificar share:", err);
      setErrorMsg("Não consegui preparar a amostra agora. Tente de novo.");
      setPhase("erro");
      return;
    }

    const timestampSeg = Math.floor(Date.now() / 1000);
    const payload = montarPayloadQr(share0Base64, request.ownerNpub, timestampSeg);

    const canvas = canvasRef.current;
    if (!canvas) {
      setErrorMsg("Não consegui preparar a amostra agora. Tente de novo.");
      setPhase("erro");
      return;
    }

    try {
      await QRCode.toCanvas(canvas, payload, {
        width: 260,
        margin: 1,
        color: { dark: "#12294F", light: "#F3ECDD" },
        errorCorrectionLevel: "M",
      });
    } catch (err) {
      console.error("[RecoveryQRGenerator] falha ao gerar QR:", err);
      setErrorMsg("Não consegui preparar a amostra agora. Tente de novo.");
      setPhase("erro");
      return;
    }

    geradoEmRef.current = Date.now();
    setRestanteMs(QR_TTL_MS);
    setPhase("pronto");

    // Publica o gift-wrap de resposta (uma vez por montagem). O QR
    // on-demand é a via principal, mas a resposta NIP-59 garante que
    // a convidada receba mesmo se não conseguir escanear (fallback).
    if (!respostaPublicadaRef.current && avalistaNsec) {
      respostaPublicadaRef.current = true;
      publishRecoveryResponse(
        avalistaNsec,
        share,
        request.initiatorNpub,
        "", // requestEventId desconhecido aqui — string vazia é ok.
      ).catch((err) => {
        console.warn(
          "[RecoveryQRGenerator] publishRecoveryResponse falhou (QR ainda válido):",
          err,
        );
      });
    }
  }, [request, avalistaNsec]);

  // Gera o QR no mount.
  useEffect(() => {
    gerarQr();
  }, [gerarQr]);

  // Countdown — limpa o canvas ao expirar.
  useEffect(() => {
    if (phase !== "pronto") return;
    const id = window.setInterval(() => {
      const geradoEm = geradoEmRef.current;
      if (geradoEm === null) return;
      const decorrido = Date.now() - geradoEm;
      const restante = Math.max(0, QR_TTL_MS - decorrido);
      setRestanteMs(restante);
      if (restante === 0) {
        // Limpa o canvas (segurança §15 — share não fica visível).
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        setPhase("expirado");
      }
    }, COUNTDOWN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  // Limpa o canvas no unmount (segurança §15).
  useEffect(() => {
    return () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, []);

  // Formata o countdown como "m:ss".
  const minutos = Math.floor(restanteMs / 60_000);
  const segundos = Math.floor((restanteMs % 60_000) / 1000);
  const countdownStr = `${minutos}:${segundos.toString().padStart(2, "0")}`;

  return (
    <div className="page theme-financial">
      <Header />
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <h2 className="financial__title">Preparar amostra de ponto</h2>
        <p className="financial__invite-text" style={{ margin: "0 20px 1rem" }}>
          Sua aluna pediu uma aula. Prepare a amostra do ponto para ela
          escanear — ela vai reatar os fios do próprio ateliê com a amostra.
        </p>

        {phase === "preparando" && (
          <div className="recover__status">
            <span className="spinner" />
            <p className="recover__status-text">Preparando a amostra...</p>
          </div>
        )}

        {phase === "pronto" && (
          <div style={{ margin: "0 20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                margin: "1rem 0",
              }}
            >
              <div
                style={{
                  background: "#F3ECDD",
                  padding: "16px",
                  borderRadius: "16px",
                  boxShadow: "var(--shadow-lg)",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={260}
                  height={260}
                  aria-label="Amostra do ponto para a aluna escanear"
                  style={{
                    display: "block",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    pointerEvents: "none",
                  }}
                />
              </div>
            </div>

            <p
              className="field__hint"
              style={{ textAlign: "center", marginTop: "0.5rem" }}
            >
              Mostre a amostra à aluna. Ela expira em{" "}
              <strong>{countdownStr}</strong>.
            </p>

            <button
              className="btn btn--secondary"
              onClick={onBack}
              style={{ marginTop: "1rem", width: "100%" }}
            >
              Concluir
            </button>
          </div>
        )}

        {phase === "expirado" && (
          <div style={{ margin: "0 20px" }} className="recover__status">
            <p className="recover__status-text">
              A amostra expirou. Gere uma nova para a aluna escanear.
            </p>
            <button
              className="btn btn--primary"
              onClick={() => {
                respostaPublicadaRef.current = false;
                gerarQr();
              }}
              style={{ marginTop: "0.75rem" }}
            >
              Gerar nova amostra
            </button>
            <button
              className="btn btn--secondary"
              onClick={onBack}
              style={{ marginTop: "0.5rem" }}
            >
              Cancelar
            </button>
          </div>
        )}

        {phase === "erro" && (
          <div style={{ margin: "0 20px" }}>
            <p className="field__error">{errorMsg}</p>
            <button
              className="btn btn--primary"
              onClick={() => {
                setErrorMsg("");
                gerarQr();
              }}
              style={{ marginTop: "0.75rem" }}
            >
              Tentar de novo
            </button>
            <button
              className="btn btn--secondary"
              onClick={onBack}
              style={{ marginTop: "0.5rem" }}
            >
              Voltar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
