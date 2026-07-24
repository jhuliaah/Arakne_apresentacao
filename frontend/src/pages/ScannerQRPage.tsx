import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";

interface ScannerQRPageProps {
  onBack: () => void;
  onScanned: (identificador: string) => void;
}

export default function ScannerQRPage({ onBack, onScanned }: ScannerQRPageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
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
          "Não conseguimos acessar a câmera. Verifique a permissão do navegador, ou digite o código manualmente."
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

      const ctx = canvas.getContext("2d");
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
        stopCamera();
        onScanned(code.data.trim());
        return;
      }

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
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <h2 className="financial__title">Escanear Código</h2>

        {error ? (
          <div className="financial__invite" style={{ margin: "0 20px" }}>
            <p className="field__error">{error}</p>
            <button className="btn btn--secondary" onClick={onBack} style={{ marginTop: "0.75rem" }}>
              Digitar manualmente
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
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
            <p className="field__hint" style={{ textAlign: "center", marginTop: "0.75rem" }}>
              {ready ? "Aponte a câmera para o código." : "Ligando a câmera..."}
            </p>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </main>
    </div>
  );
}
