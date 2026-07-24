/** RecoveryScanner — convidada escaneia o QR da share 0 (Track 4D).
 *
 *  Tela que a convidada vê no fluxo de recuperação, após pedir ajuda
 *  (RecoveryHelpRequestPage). Fica "bloqueada só com scanner" até
 *  escanear o QR que a tecelã preparou.
 *
 *  Fluxo:
 *  1. Abre a câmera e escaneia o QR (reusa `jsqr` — já no package.json).
 *  2. Segurança (mestre §15): `captureAttribute="false"` no vídeo,
 *     `user-select: none`, `pointerEvents` controlados. O scanner NÃO
 *     salva o frame na galeria (canvas oculto, limpo a cada tick).
 *  3. Ao escanear, parseia o payload `{ v, s, o, t }` (share 0 base64 +
 *     ownerNpub). Valida o formato.
 *  4. Chama `onScanned({ share0, ownerNpub })` que a Lane D conecta ao
 *     resto do fluxo (combina com share 1 do backend via PIN →
 *     reconstrói nsec via `tryCombineShares`).
 *  5. Estado "aguardando scanner" com mensagem disfarçada ("Aponte
 *     para o padrão que a tecelã preparou"). Sem jargão.
 *  6. Botão "Cancelar" volta.
 *
 *  Disfarce (§5.2): vocabulário de "amostra de ponto" / "padrão que a
 *  tecelã preparou". Nenhuma palavra-chave de segurança/criptografia.
 */

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import Header from "./Header";

interface RecoveryScannerProps {
  /** Chamado quando o QR é escaneado e validado. A Lane D conecta ao
   *  fluxo de combinação de shares (share 0 do QR + share 1 do backend). */
  onScanned: (payload: { share0: Uint8Array; ownerNpub: string }) => void;
  /** Volta para a tela anterior. */
  onBack: () => void;
}

/** Versão esperada do payload do QR (deve casar com RecoveryQRGenerator). */
const QR_PAYLOAD_VERSION = 1;

/** Valida e parseia o payload do QR. Retorna null se inválido. */
function parsearPayloadQr(
  raw: string,
): { share0: Uint8Array; ownerNpub: string } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as {
    v?: unknown;
    s?: unknown;
    o?: unknown;
    t?: unknown;
  };
  if (o.v !== QR_PAYLOAD_VERSION) return null;
  if (typeof o.s !== "string" || typeof o.o !== "string") return null;
  // Valida ownerNpub começa com "npub1".
  if (!o.o.startsWith("npub1")) return null;

  // Decodifica share 0 de base64 → bytes.
  let share0: Uint8Array;
  try {
    const bin = atob(o.s);
    share0 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      share0[i] = bin.charCodeAt(i);
    }
  } catch {
    return null;
  }
  // Share SSSS do nsec é ~33 bytes (1 byte índice + 32 bytes payload).
  // Aceitamos entre 16 e 128 bytes por margem (futuros esquemas).
  if (share0.length < 16 || share0.length > 128) return null;

  return { share0, ownerNpub: o.o };
}

export default function RecoveryScanner({ onScanned, onBack }: RecoveryScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const jaEscaneouRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
        tick();
      } catch {
        setError(
          "Não conseguimos acessar a câmera. Verifique a permissão do navegador."
        );
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        // Limpa o canvas imediatamente (segurança §15 — não deixa o
        // frame com o QR visível na memória do canvas oculto).
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const parsed = parsearPayloadQr(code.data.trim());
        if (parsed && !jaEscaneouRef.current) {
          jaEscaneouRef.current = true;
          stopCamera();
          onScanned(parsed);
          return;
        }
      }

      // Limpa o canvas a cada tick (não acumula frames).
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafRef.current = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  return (
    <div className="page theme-financial">
      <Header />
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <h2 className="financial__title">Escanear amostra</h2>
        <p className="financial__invite-text" style={{ margin: "0 20px 1rem" }}>
          Aponte para o padrão que a tecelã preparou para você.
        </p>

        {error ? (
          <div className="financial__invite" style={{ margin: "0 20px" }}>
            <p className="field__error">{error}</p>
            <button
              className="btn btn--secondary"
              onClick={onBack}
              style={{ marginTop: "0.75rem" }}
            >
              Voltar
            </button>
          </div>
        ) : (
          <div style={{ margin: "0 20px" }}>
            <div
              style={{
                position: "relative",
                borderRadius: "16px",
                overflow: "hidden",
                border: "2px dashed var(--color-primary)",
                aspectRatio: "3 / 4",
                background: "#000",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                // Segurança §15: não expõe atributo de captura, impede
                // seleção de texto/frame no mobile.
                // @ts-expect-error captureAttribute não é padrão TS DOM,
                // mas é suportado em alguns browsers para impedir captura.
                captureAttribute="false"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  pointerEvents: "none",
                }}
              />
            </div>
            <p
              className="field__hint"
              style={{ textAlign: "center", marginTop: "0.75rem" }}
            >
              {ready
                ? "Aponte para o padrão que a tecelã preparou."
                : "Ligando a câmera..."}
            </p>
            <button
              className="btn btn--secondary"
              onClick={onBack}
              style={{ marginTop: "0.75rem", width: "100%" }}
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Canvas oculto — usado só para decodificar frames. */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </main>
    </div>
  );
}
