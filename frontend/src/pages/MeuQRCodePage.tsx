import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import { getIdentificador } from "../api";

interface MeuQRCodePageProps {
  onBack: () => void;
}

export default function MeuQRCodePage({ onBack }: MeuQRCodePageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identificador = getIdentificador();

  useEffect(() => {
    if (!identificador) {
      setError("Não foi possível gerar seu código agora.");
      return;
    }
    QRCode.toDataURL(identificador, {
      width: 260,
      margin: 1,
      color: { dark: "#12294F", light: "#F3ECDD" },
    })
      .then(setDataUrl)
      .catch(() => setError("Não foi possível gerar seu código agora."));
  }, [identificador]);

  return (
    <div className="page theme-financial">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar
        </button>

        <h2 className="financial__title">Meu Código</h2>
        <p className="financial__invite-text" style={{ margin: "0 20px 1rem" }}>
          Mostre este código para outra tecedora escanear, em vez de digitar
          seu identificador na mão.
        </p>

        {error && <p className="field__error" style={{ margin: "0 20px" }}>{error}</p>}

        {dataUrl && (
          <div style={{ display: "flex", justifyContent: "center", margin: "1rem 0" }}>
            <div
              style={{
                background: "#F3ECDD",
                padding: "16px",
                borderRadius: "16px",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <img src={dataUrl} alt="Seu código Arakne" width={260} height={260} />
            </div>
          </div>
        )}

        {identificador && (
          <p
            className="field__hint"
            style={{ textAlign: "center", margin: "0 20px", wordBreak: "break-all" }}
          >
            {identificador}
          </p>
        )}
      </main>
    </div>
  );
}
