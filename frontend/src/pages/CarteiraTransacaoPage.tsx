/** CarteiraTransacaoPage — tela de transação da cesta de novelos.
 *
 *  Três modos de operação, escolhidos pelo card "Cesta de novelos" no
 *  FinancialPage:
 *    - "pagar": envia Pix para um comerciante (chave + valor em BRL).
 *      O backend debita sats da carteira interna e faz a conversão.
 *    - "receber": gera QR Pix de depósito (a usuária recebe BRL que
 *      vira sats na carteira). Mostra QR + copia-e-cola + polling.
 *    - "quitar": gera QR Pix para abater (parte de) um empréstimo.
 *      O backend gera a cobrança; quando confirmada, o saldo devedor
 *      cai. Mesmo fluxo de QR + polling do "receber".
 *
 *  Disfarce crochê: a tela fala em "novelos", nunca em Bitcoin/sats
 *  em destaque. O valor em sats aparece em texto pequeno, como detalhe
 *  técnico ao lado do valor em BRL. Países são apresentados como
 *  "De onde você está criando hoje?".
 *
 *  Conexão com o backend (Lane A):
 *    - POST /carteira/pagar → envia Pix (modo "pagar")
 *    - POST /carteira/depositar → gera QR de depósito (modo "receber")
 *    - POST /carteira/gerar-quitacao → gera QR de quitação (modo "quitar")
 *    - GET /carteira/saldo → refresca saldo após transação
 *    - PATCH /usuarias/me/pais → salva país (passo 1)
 *    - GET /pix/pagamentos/{txid} → polling de status (reutilizado)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import {
  ensureToken,
  getMe,
  updatePais,
  depositarCarteira,
  pagarCarteira,
  gerarQuitacaoCarteira,
  verificarDepositoCarteira,
  getStatusPagamentoPix,
  SATS_TO_BRL,
} from "../api";
import type { DepositarCarteiraResponse, GerarQuitacaoResponse, Usuaria } from "../types";

export type CarteiraModo = "pagar" | "receber" | "quitar";

interface CarteiraTransacaoPageProps {
  modo: CarteiraModo;
  onBack: () => void;
  /** Chamado quando uma transação é concluída com sucesso — o
   *  FinancialPage refresca saldo/tier/empréstimos. */
  onTransacaoConcluida: () => void;
  /** Saldo devedor atual (modo "quitar") — para mostrar quanto falta. */
  saldoDevedor?: number;
  /** Empréstimo ativo (modo "quitar") — o backend precisa do ID. */
  emprestimoId?: number | null;
}

// ── Países suportados ───────────────────────────────────────
// Oriente Médio + América do Sul. Só "BR" habilita pagamentos Pix
// por enquanto; os demais mostram "em breve". O framing é neutro
// ("De onde você está criando hoje?") para não revelar o público-alvo.
const PAISES: { codigo: string; nome: string }[] = [
  { codigo: "BR", nome: "Brasil" },
  { codigo: "AR", nome: "Argentina" },
  { codigo: "UY", nome: "Uruguai" },
  { codigo: "CL", nome: "Chile" },
  { codigo: "CO", nome: "Colômbia" },
  { codigo: "PE", nome: "Peru" },
  { codigo: "VE", nome: "Venezuela" },
  { codigo: "BO", nome: "Bolívia" },
  { codigo: "PY", nome: "Paraguai" },
  { codigo: "LB", nome: "Líbano" },
  { codigo: "SY", nome: "Síria" },
  { codigo: "JO", nome: "Jordânia" },
  { codigo: "IQ", nome: "Iraque" },
  { codigo: "IR", nome: "Irã" },
  { codigo: "SA", nome: "Arábia Saudita" },
  { codigo: "AE", nome: "Emirados Árabes" },
  { codigo: "IL", nome: "Israel" },
  { codigo: "PS", nome: "Palestina" },
  { codigo: "YE", nome: "Iêmen" },
  { codigo: "EG", nome: "Egito" },
];

// ── Formatador BRL reutilizado ──────────────────────────────
const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type Etapa = "pais" | "input" | "preparando" | "resultado" | "erro";

/** QR de pagamento Pix (depósito ou quitação). Reusa a lib `qrcode`.
 *  Prefere `qr_code_base64` do backend; se vazio (mock), gera do
 *  `qr_code` string (copia-e-cola). Disfarce: alt = "código de fios". */
function CodigoQR({ qrCodeBase64, qrCode }: { qrCodeBase64: string; qrCode: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (qrCodeBase64) {
      const b64 = qrCodeBase64;
      setDataUrl(b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);
      setError(null);
      return;
    }
    if (!qrCode) {
      setError("Não foi possível gerar o código de fios.");
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrCode, {
      width: 240,
      margin: 1,
      color: { dark: "#12294F", light: "#F3ECDD" },
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível gerar o código de fios.");
      });
    return () => {
      cancelled = true;
    };
  }, [qrCodeBase64, qrCode]);

  if (error) return <p className="field__error">{error}</p>;
  if (!dataUrl) {
    return (
      <div
        className="skeleton skeleton-card__visual"
        style={{ width: 240, height: 240, margin: "0 auto" }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          display: "inline-block",
          background: "#F3ECDD",
          padding: "12px",
          borderRadius: "14px",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <img src={dataUrl} alt="Código de fios" width={240} height={240} />
      </div>
    </div>
  );
}

/** Leitor de QR inline (câmera traseira) — reutiliza jsqr como o
 *  ScannerQRPage. Lê QR que contém código Pix copia-e-cola ou chave
 *  Pix. Preenche o campo `chavePix` automaticamente. */
function LeitorQRInline({
  onLido,
  onFechar,
}: {
  onLido: (valor: string) => void;
  onFechar: () => void;
}) {
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
          "Não conseguimos acessar a câmera. Verifique a permissão do navegador, ou digite a chave manualmente."
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
        stop();
        onLido(code.data.trim());
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function stop() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="consent-note" style={{ marginTop: "0.5rem" }}>
      {error ? (
        <p className="field__error">{error}</p>
      ) : (
        <>
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
          <p className="field__hint" style={{ textAlign: "center", marginTop: "0.5rem" }}>
            {ready ? "Aponte para o código Pix de quem vai receber." : "Ligando a câmera..."}
          </p>
        </>
      )}
      <button
        className="financial__btn financial__btn--small financial__btn--secondary"
        style={{ width: "100%", marginTop: "0.5rem" }}
        onClick={onFechar}
      >
        Fechar leitor
      </button>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

export default function CarteiraTransacaoPage({
  modo,
  onBack,
  onTransacaoConcluida,
  saldoDevedor = 0,
  emprestimoId = null,
}: CarteiraTransacaoPageProps) {
  const [usuaria, setUsuaria] = useState<Usuaria | null>(null);
  const [etapa, setEtapa] = useState<Etapa>("input");
  const [erro, setErro] = useState<string | null>(null);

  // Campos de input
  const [valorBrl, setValorBrl] = useState(""); // BRL digitado (ex: "10.50")
  const [valorSats, setValorSats] = useState(""); // sats (modo quitar)
  const [chavePix, setChavePix] = useState("");
  const [descricao, setDescricao] = useState("");
  const [mostrarLeitor, setMostrarLeitor] = useState(false);

  // Resultado (QR de depósito/quitação ou confirmação de pagamento)
  const [depositoQr, setDepositoQr] = useState<DepositarCarteiraResponse | null>(null);
  const [quitacaoQr, setQuitacaoQr] = useState<GerarQuitacaoResponse | null>(null);
  const [pagamentoOk, setPagamentoOk] = useState(false);

  // Polling de status (modos receber/quitar)
  const pollingRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Cleanup no unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Carrega a usuária (para saber o país) no mount
  useEffect(() => {
    (async () => {
      const token = await ensureToken();
      if (!token) return;
      const me = await getMe(token);
      if (me) setUsuaria(me);
    })();
  }, []);

  // Se a usuária não tem país, começa na etapa "pais"
  useEffect(() => {
    if (usuaria && !usuaria.pais) {
      setEtapa("pais");
    }
  }, [usuaria]);

  /** Converte string "10.50" → centavos (1050). Aceita vírgula ou ponto. */
  function parseBrlParaCentavos(s: string): number {
    const limpo = s.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(limpo);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }

  /** Salva o país via PATCH e avança. */
  async function salvarPais(pais: string) {
    const token = await ensureToken();
    if (!token) {
      setErro("Não foi possível salvar agora. Tente de novo.");
      return;
    }
    const atualizada = await updatePais(token, pais);
    if (atualizada) {
      setUsuaria(atualizada);
    } else {
      // Endpoint pode não existir ainda — salva só no estado local
      // para não bloquear o fluxo. O backend (Lane A) cuidará depois.
      setUsuaria((prev) => (prev ? { ...prev, pais } : prev));
    }
    setEtapa("input");
  }

  // ── Submeter transação ──────────────────────────────────
  async function submeter() {
    setErro(null);
    setEtapa("preparando");

    try {
      if (modo === "pagar") {
        const centavos = parseBrlParaCentavos(valorBrl);
        if (centavos <= 0) {
          setErro("Digite um valor válido.");
          setEtapa("input");
          return;
        }
        if (!chavePix.trim()) {
          setErro("Digite a chave Pix de quem vai receber.");
          setEtapa("input");
          return;
        }
        await pagarCarteira(chavePix.trim(), centavos, descricao.trim() || undefined);
        setPagamentoOk(true);
        setEtapa("resultado");
        onTransacaoConcluida();
        return;
      }

      if (modo === "receber") {
        const centavos = parseBrlParaCentavos(valorBrl);
        if (centavos <= 0) {
          setErro("Digite um valor válido.");
          setEtapa("input");
          return;
        }
        const resp = await depositarCarteira(centavos);
        if (!resp) {
          setErro("Não conseguimos gerar o código de fios agora. Tente de novo.");
          setEtapa("erro");
          return;
        }
        setDepositoQr(resp);
        setEtapa("resultado");
        iniciarPolling(resp.txid);
        return;
      }

      // modo === "quitar"
      const sats = parseInt(valorSats, 10);
      if (sats <= 0) {
        setErro("Digite quantos novelos quer abater.");
        setEtapa("input");
        return;
      }
      if (!emprestimoId) {
        setErro("Nenhum padrão ativo encontrado para abater.");
        setEtapa("erro");
        return;
      }
      const resp = await gerarQuitacaoCarteira(emprestimoId, sats);
      if (!resp) {
        setErro("Não conseguimos gerar o código de fios agora. Tente de novo.");
        setEtapa("erro");
        return;
      }
      setQuitacaoQr(resp);
      setEtapa("resultado");
      iniciarPolling(resp.txid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // 403 = país não suportado
      if (/pa[íi]s|n[ãa]o suport|brasil/i.test(msg)) {
        setErro("Entrega de novelos só disponível no Brasil.");
      } else {
        setErro(msg || "Algo deu errado. Tente de novo.");
      }
      setEtapa("erro");
    }
  }

  /** Inicia polling de status a cada 3s (modos receber/quitar).
   *
   *  "quitar" (repagar empréstimo) usa /pix/pagamentos/{txid} — cria um
   *  PagamentoPix de verdade, o mesmo fluxo já testado ponta-a-ponta.
   *
   *  "receber" (depósito na carteira) chama POST /carteira/transacoes/{txid}
   *  /verificar — consulta o Mercado Pago diretamente e atualiza o status
   *  da TransacaoCarteira se o pagamento foi confirmado. Não depende do
   *  webhook, que pode falhar se o túnel cloudflared estiver fora do ar. */
  function iniciarPolling(txid: string) {
    stopPolling();
    pollingRef.current = window.setInterval(async () => {
      if (modo === "receber") {
        const verificacao = await verificarDepositoCarteira(txid);
        if (!verificacao) return; // erro de rede → mantém polling
        if (verificacao.status === "concluida") {
          stopPolling();
          onTransacaoConcluida();
          setTimeout(() => onBack(), 2000);
        } else if (verificacao.status === "falhou") {
          stopPolling();
          setErro("O código de fios falhou. Tente gerar um novo.");
          setEtapa("erro");
        }
        return;
      }

      const status = await getStatusPagamentoPix(txid);
      if (!status) return; // erro de rede → mantém polling
      if (status.status === "aprovado") {
        stopPolling();
        onTransacaoConcluida();
        // Fecha a tela após 2s
        setTimeout(() => onBack(), 2000);
      } else if (status.status === "expirado") {
        stopPolling();
        setErro("O código de fios expirou. Tente gerar um novo.");
        setEtapa("erro");
      }
    }, 3000);
  }

  function tentarDeNovo() {
    setErro(null);
    setDepositoQr(null);
    setQuitacaoQr(null);
    setPagamentoOk(false);
    setEtapa("input");
  }

  // ── Valores derivados ────────────────────────────────────
  const centavos = parseBrlParaCentavos(valorBrl);
  const satsQuitar = parseInt(valorSats, 10) || 0;
  const tituloModo =
    modo === "pagar" ? "Entregar novelos" : modo === "receber" ? "Receber novelos" : "Devolver novelos";

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="page theme-financial">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar ao ateliê
        </button>

        <h2 className="financial__title">{tituloModo}</h2>

        {/* ── Passo 1: Seleção de país ── */}
        {etapa === "pais" && (
          <div className="financial__invite">
            <h3 className="financial__history-title">De onde você está criando hoje?</h3>
            <p className="financial__invite-text">
              Isso nos ajuda a oferecer as opções de entrega certas
              para o seu fio.
            </p>
            <div className="field" style={{ marginBottom: "0.75rem" }}>
              <label className="field__label" htmlFor="pais-select">
                País
              </label>
              <select
                id="pais-select"
                className="field__input"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) salvarPais(e.target.value);
                }}
              >
                <option value="" disabled>
                  Selecione…
                </option>
                {PAISES.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
            <p className="field__hint">
              Você pode mudar isso depois no seu ateliê.
            </p>
          </div>
        )}

        {/* ── País selecionado mas não-Brasil (pagar) ── */}
        {etapa === "input" && modo === "pagar" && usuaria?.pais && usuaria.pais !== "BR" && (
          <div className="financial__invite">
            <h3 className="financial__history-title">{tituloModo}</h3>
            <p className="financial__invite-text">
              Entrega de novelos em breve nesta região. Por enquanto, a
              entrega de novelos está disponível apenas no Brasil.
            </p>
            <button
              className="financial__btn financial__btn--small financial__btn--secondary"
              onClick={() => setEtapa("pais")}
            >
              Mudar país
            </button>
          </div>
        )}

        {/* ── Passo 2: Input ── */}
        {etapa === "input" && (modo !== "pagar" || !usuaria?.pais || usuaria.pais === "BR") && (
          <div className="financial__invite">
            <h3 className="financial__history-title">{tituloModo}</h3>

            {modo === "quitar" && saldoDevedor > 0 && (
              <p className="modal__hint">
                Padrão em andamento: {saldoDevedor.toLocaleString("pt-BR")} novelo(s)
              </p>
            )}

            {/* Valor em BRL (modos pagar/receber) */}
            {(modo === "pagar" || modo === "receber") && (
              <div className="field" style={{ marginBottom: "0.75rem" }}>
                <label className="field__label" htmlFor="valor-brl">
                  {modo === "pagar" ? "Quanto quer entregar?" : "Quanto quer receber?"}
                </label>
                <input
                  id="valor-brl"
                  className="field__input"
                  inputMode="decimal"
                  placeholder="Ex.: 10,50"
                  value={valorBrl}
                  onChange={(e) => setValorBrl(e.target.value)}
                />
                {centavos > 0 && (
                  <p className="field__hint">
                    {brlFormatter.format(centavos / 100)} ≈{" "}
                    {Math.round(centavos / 100 / SATS_TO_BRL).toLocaleString("pt-BR")} novelo(s)
                  </p>
                )}
              </div>
            )}

            {/* Valor em sats (modo quitar) */}
            {modo === "quitar" && (
              <div className="field" style={{ marginBottom: "0.75rem" }}>
                <label className="field__label" htmlFor="valor-sats">
                  Quantos novelos quer abater?
                </label>
                <input
                  id="valor-sats"
                  className="field__input"
                  inputMode="numeric"
                  placeholder="Ex.: 1000"
                  value={valorSats}
                  onChange={(e) => setValorSats(e.target.value.replace(/\D/g, ""))}
                />
                {satsQuitar > 0 && (
                  <p className="field__hint">
                    {satsQuitar.toLocaleString("pt-BR")} novelo(s) ≈{" "}
                    {brlFormatter.format(satsQuitar * SATS_TO_BRL)}
                  </p>
                )}
              </div>
            )}

            {/* Chave Pix + descrição (modo pagar) */}
            {modo === "pagar" && (
              <>
                <div className="field" style={{ marginBottom: "0.75rem" }}>
                  <label className="field__label" htmlFor="chave-pix">
                    Chave Pix de quem vai receber
                  </label>
                  <input
                    id="chave-pix"
                    className="field__input"
                    type="text"
                    placeholder="CPF, e-mail, telefone ou código copia-e-cola"
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                  />
                </div>
                <button
                  className="financial__btn financial__btn--small"
                  style={{ marginBottom: "0.75rem" }}
                  onClick={() => setMostrarLeitor((v) => !v)}
                >
                  {mostrarLeitor ? "Fechar leitor" : "📷 Escanear QR"}
                </button>
                {mostrarLeitor && (
                  <LeitorQRInline
                    onLido={(valor) => {
                      setChavePix(valor);
                      setMostrarLeitor(false);
                    }}
                    onFechar={() => setMostrarLeitor(false)}
                  />
                )}
                <div className="field" style={{ marginBottom: "0.75rem" }}>
                  <label className="field__label" htmlFor="descricao">
                    Descrição (opcional)
                  </label>
                  <input
                    id="descricao"
                    className="field__input"
                    type="text"
                    placeholder="Ex.: Compra de fios"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                </div>
              </>
            )}

            {erro && <p className="field__error">{erro}</p>}

            <button
              className="financial__btn financial__btn--primary financial__btn--small"
              onClick={submeter}
            >
              {modo === "pagar"
                ? "Entregar novelos"
                : modo === "receber"
                ? "Gerar código de fios"
                : "Gerar código de devolução"}
            </button>
          </div>
        )}

        {/* ── Passo 3: Preparando ── */}
        {etapa === "preparando" && (
          <div className="financial__invite">
            <div className="loading" style={{ padding: "2rem 0" }}>
              <div className="spinner" />
              <p>Enrolando seus novelos...</p>
            </div>
          </div>
        )}

        {/* ── Passo 4: Resultado ── */}
        {etapa === "resultado" && (
          <div className="financial__invite">
            {/* Pagamento (modo pagar) — confirmação imediata */}
            {modo === "pagar" && pagamentoOk && (
              <>
                <div className="repay-result">
                  <div className="repay-result__icon">✅</div>
                  <h3 className="repay-result__title">Novelos entregues!</h3>
                  <p className="repay-result__text">
                    Seu ateliê já está atualizado.
                  </p>
                </div>
                <button
                  className="financial__btn financial__btn--primary financial__btn--small"
                  onClick={onBack}
                >
                  Voltar ao ateliê
                </button>
              </>
            )}

            {/* Depósito (modo receber) — QR + polling */}
            {modo === "receber" && depositoQr && (
              <>
                <h3 className="financial__history-title">Receber novelos</h3>
                <p className="modal__text">Escaneie o código para concluir o recebimento.</p>
                <CodigoQR
                  qrCodeBase64={depositoQr.qr_code_base64}
                  qrCode={depositoQr.qr_code}
                />
                <p
                  className="modal__hint"
                  style={{ textAlign: "center", marginTop: "0.75rem", fontWeight: 600 }}
                >
                  {brlFormatter.format(depositoQr.valor_centavos_brl / 100)}
                </p>
                <p className="modal__hint" style={{ textAlign: "center" }}>
                  Aguardando seus novelos...
                </p>
                <div className="financial__invite-link" style={{ marginTop: "0.75rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={depositoQr.qr_code}
                    className="financial__invite-input"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="Código de fios para copiar"
                  />
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => {
                      navigator.clipboard.writeText(depositoQr.qr_code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
                <button
                  className="financial__btn financial__btn--secondary financial__btn--small"
                  style={{ width: "100%", marginTop: "0.75rem" }}
                  onClick={onBack}
                >
                  Cancelar
                </button>
              </>
            )}

            {/* Quitação (modo quitar) — QR + polling */}
            {modo === "quitar" && quitacaoQr && (
              <>
                <h3 className="financial__history-title">Devolver novelos</h3>
                <p className="modal__text">Escaneie o código de devolução para concluir.</p>
                <CodigoQR
                  qrCodeBase64={quitacaoQr.qr_code_base64}
                  qrCode={quitacaoQr.qr_code}
                />
                <p
                  className="modal__hint"
                  style={{ textAlign: "center", marginTop: "0.75rem", fontWeight: 600 }}
                >
                  {brlFormatter.format(quitacaoQr.valor_centavos_brl / 100)}
                </p>
                <p className="modal__hint" style={{ textAlign: "center" }}>
                  Aguardando seus novelos...
                </p>
                <div className="financial__invite-link" style={{ marginTop: "0.75rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={quitacaoQr.qr_code}
                    className="financial__invite-input"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="Código de devolução para copiar"
                  />
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => {
                      navigator.clipboard.writeText(quitacaoQr.qr_code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
                <button
                  className="financial__btn financial__btn--secondary financial__btn--small"
                  style={{ width: "100%", marginTop: "0.75rem" }}
                  onClick={onBack}
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Erro ── */}
        {etapa === "erro" && (
          <div className="financial__invite">
            <div className="repay-result">
              <div className="repay-result__icon">⚠️</div>
              <h3 className="repay-result__title">Não foi possível concluir</h3>
              <p className="repay-result__text">
                {erro ?? "Algo deu errado. Tente de novo."}
              </p>
            </div>
            <div className="modal__actions">
              <button
                className="financial__btn financial__btn--secondary financial__btn--small"
                onClick={onBack}
              >
                Voltar
              </button>
              <button
                className="financial__btn financial__btn--primary financial__btn--small"
                onClick={tentarDeNovo}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
