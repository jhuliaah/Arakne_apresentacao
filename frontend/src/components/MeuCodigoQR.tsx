/** MeuCodigoQR — QR do identificador da usuária (Ponto de Troca).
 *
 *  Mudança #6: o QR de "Meu código" (identificador) saiu do PerfilPage
 *  (camada crochê/disfarce) e passou a ser uma seção da camada
 *  financeira (FinancialPage). Reusa a lógica original de
 *  `MeuQRCodePage` — gera um QR do `getIdentificador()` para outra
 *  tecedora escanear em vez de digitar à mão.
 *
 *  Disfarce preservado: o QR só aparece dentro da camada financeira
 *  ("Ponto de Troca"), nunca na bancada crochê.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getIdentificador } from "../api";

interface MeuCodigoQRProps {
  /** Compacta o visual quando embutido numa seção (sem padding extra). */
  compact?: boolean;
}

export default function MeuCodigoQR({ compact = false }: MeuCodigoQRProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identificador = getIdentificador();

  useEffect(() => {
    if (!identificador) {
      setError("Não foi possível gerar seu código agora.");
      return;
    }
    QRCode.toDataURL(identificador, {
      width: 220,
      margin: 1,
      color: { dark: "#12294F", light: "#F3ECDD" },
    })
      .then(setDataUrl)
      .catch(() => setError("Não foi possível gerar seu código agora."));
  }, [identificador]);

  if (error) {
    return <p className="field__error">{error}</p>;
  }

  return (
    <div style={{ textAlign: "center" }}>
      {dataUrl && (
        <div
          style={{
            display: "inline-block",
            background: "#F3ECDD",
            padding: "12px",
            borderRadius: "14px",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <img src={dataUrl} alt="Seu código Arakne" width={220} height={220} />
        </div>
      )}
      {identificador && (
        <p
          className="field__hint"
          style={{
            marginTop: compact ? "0.5rem" : "0.75rem",
            wordBreak: "break-all",
          }}
        >
          {identificador}
        </p>
      )}
    </div>
  );
}
