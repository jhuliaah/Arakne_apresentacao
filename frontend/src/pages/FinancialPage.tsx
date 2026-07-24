 /** Tela do ateliê — painel da artesã depois de entrar com o código. */


import { useEffect, useState, useCallback, useRef } from "react";
import QRCode from "qrcode";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import {
  createEmprestimo,
  ensureToken,
  getEmprestimoIds,
  getMe,
  getIdentificador,
  getConvite,
  pagarEmprestimo,
  addEmprestimoId,
  getEmprestimo,
  listarPontosDeTroca,
  setDisponibilidadePonto,
  criarTroca,
  getMinhasTrocas,
  confirmarTroca,
  recusarTroca,
  getAvalistasRecuperacao,
  vincularMentorRecuperacao,
  criarCobrancaPix,
  getStatusPagamentoPix,
  satsParaCentavosBrl,
  SATS_TO_BRL,
  getSaldoCarteira,
} from "../api";
import type { ConviteResponse } from "../api";
import type { AvalistaRecuperacao } from "../api";
import type { CobrancaPix, Emprestimo, PontoDeTroca, SaldoCarteira, Troca, Usuaria } from "../types";
import { useDelayedFlag } from "../lib/useDelayedFlag";
import MeuCodigoQR from "../components/MeuCodigoQR";
import type { CarteiraModo } from "./CarteiraTransacaoPage";

interface FinancialPageProps {
  onBack: () => void;
  onVerExtrato: () => void;
  onAbrirScanner: () => void;
  prefilledPontoIdentificador?: string | null;
  onPrefillConsumed?: () => void;
  /** Abre a tela de transação da cesta de novelos (entregar/receber/devolver). */
  onAbrirCarteira: (modo: CarteiraModo) => void;
}

const TIER_LABELS: Record<number, string> = {
  0: "Iniciante",
  1: "Aprendiz",
  2: "Artesã",
  3: "Mestra",
};

const TIER_LIMITS: Record<number, number> = {
  0: 0,
  1: 5000,
  2: 15000,
  3: 40000,
};

/** Trunca um npub para exibição compacta (mesmo padrão do onboarding). */
function truncarNpub(npub: string): string {
  if (npub.length <= 14) return npub;
  return `${npub.slice(0, 8)}…${npub.slice(-3)}`;
}

/** Rótulo de uma tecelã de confiança: prefere o apelido, com fallback
 *  para npub truncado quando o apelido não existe. */
function rotuloTecela(tec: AvalistaRecuperacao): string {
  return tec.apelido?.trim() || truncarNpub(tec.npub_avaliadora);
}

/** Formatador de moeda BRL reutilizado no modal de devolução. */
const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Modos do modal de devolução. Controla qual tela está visível:
 *  - "input": escolha de valor + botões Lightning/Pix
 *  - "pix-loading": gerando cobrança Pix
 *  - "pix-awaiting": QR visível, polling de status ativo
 *  - "pix-confirmed": pagamento aprovado, fecha em 2s
 *  - "pix-error": falha/expirado, botão "Tentar novamente" */
type RepayMode = "input" | "pix-loading" | "pix-awaiting" | "pix-confirmed" | "pix-error";

/** QR de devolução via Pix. Reusa a lib `qrcode` (mesmo padrão do
 *  MeuCodigoQR). Prefere o `qr_code_base64` que vem do backend; se vier
 *  vazio (caso mock), gera o QR a partir da linha `qr_code` (copia-e-cola).
 *  Disfarce: o alt text fala em "código de devolução", não em Pix. */
function PixQR({ cobranca }: { cobranca: CobrancaPix }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cobranca.qr_code_base64) {
      const b64 = cobranca.qr_code_base64;
      // O backend (Mercado Pago) devolve data URL completo; em mock
      // pode vir só o base64 cru — cobrimos os dois.
      setDataUrl(b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);
      setError(null);
      return;
    }
    if (!cobranca.qr_code) {
      setError("Não foi possível gerar o código de devolução.");
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(cobranca.qr_code, {
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
        if (!cancelled) setError("Não foi possível gerar o código de devolução.");
      });
    return () => { cancelled = true; };
  }, [cobranca.qr_code_base64, cobranca.qr_code]);

  if (error) {
    return <p className="field__error">{error}</p>;
  }

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
        <img src={dataUrl} alt="Código de devolução" width={240} height={240} />
      </div>
    </div>
  );
}

export default function FinancialPage({
  onBack,
  onVerExtrato,
  onAbrirScanner,
  prefilledPontoIdentificador,
  onPrefillConsumed,
  onAbrirCarteira,
}: FinancialPageProps) {
  const [usuaria, setUsuaria] = useState<Usuaria | null>(null);
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedFlag(loading);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convite, setConvite] = useState<ConviteResponse | null>(null);
  const [copied, setCopied] = useState(false);
  // Estado separado para o botão "Copiar" do próprio código de convite
  // (seção Tecelã de confiança) — não compartilha com o `copied` do
  // convite de aprendiz nem com o copia-e-cola do Pix.
  const [codigoConviteCopied, setCodigoConviteCopied] = useState(false);

  // Fornecedoras de Linha (Ponto de Troca)
  const [pontos, setPontos] = useState<PontoDeTroca[]>([]);
  const [togglingPonto, setTogglingPonto] = useState(false);
  const [pontosError, setPontosError] = useState<string | null>(null);
  const [trocaAlvo, setTrocaAlvo] = useState<string | null>(null);
  const [valorTroca, setValorTroca] = useState("");
  const [trocaLoading, setTrocaLoading] = useState(false);
  const [trocaMsg, setTrocaMsg] = useState<string | null>(null);

  // Pedidos de troca recebidos no ateliê (quando a usuária é Fornecedora
  // de Linha e outra tecedora pede troca com ela). Apenas pendentes.
  const [trocasRecebidas, setTrocasRecebidas] = useState<Troca[]>([]);
  const [trocasRecebidasLoading, setTrocasRecebidasLoading] = useState(false);
  const [trocaActionLoading, setTrocaActionLoading] = useState<number | null>(null);
  const [trocaActionMsg, setTrocaActionMsg] = useState<string | null>(null);

  // Tecelã de confiança (avalista de recuperação vinculado depois)
  const [tecelas, setTecelas] = useState<AvalistaRecuperacao[]>([]);
  const [tecelasLoading, setTecelasLoading] = useState(true);
  const [tecelaCodigo, setTecelaCodigo] = useState("");
  const [tecelaSubmitting, setTecelaSubmitting] = useState(false);
  const [tecelaError, setTecelaError] = useState<string | null>(null);
  const [tecelaSuccess, setTecelaSuccess] = useState<string | null>(null);

  // Repayment modal state
  // `mode` controla qual tela do modal está visível:
  //  - "input": escolha de valor + botões Lightning/Pix
  //  - "pix-loading": gerando cobrança Pix
  //  - "pix-awaiting": QR visível, polling de status ativo
  //  - "pix-confirmed": pagamento aprovado, fecha em 2s
  //  - "pix-error": falha/expirado, botão "Tentar novamente"
  const [repayModal, setRepayModal] = useState<{
    open: boolean;
    emprestimo: Emprestimo | null;
    valor: string;
    processing: boolean;
    result: { quitado: boolean; tier: number; saldo_devedor: number } | null;
    mode: RepayMode;
    pixCobranca: CobrancaPix | null;
    pixError: string | null;
  }>({
    open: false,
    emprestimo: null,
    valor: "",
    processing: false,
    result: null,
    mode: "input",
    pixCobranca: null,
    pixError: null,
  });

  // Ref para o interval de polling Pix — limpo no unmount e ao fechar
  // o modal. NUNCA deixar polling rodando após desmontar.
  const pixPollingRef = useRef<number | null>(null);

  /** Para o polling de status Pix, se ativo. Idempotente. */
  const stopPixPolling = useCallback(() => {
    if (pixPollingRef.current !== null) {
      clearInterval(pixPollingRef.current);
      pixPollingRef.current = null;
    }
  }, []);

  // Cleanup de segurança: se o componente desmontar com polling ativo
  // (ex.: navegação para outra tela), limpa o interval.
  useEffect(() => {
    return () => stopPixPolling();
  }, [stopPixPolling]);

  // Confirmação de "Puxar novelos" (substitui a exibição da invoice)
  const [liberadoDisplay, setLiberadoDisplay] = useState<Emprestimo | null>(null);

  // ── Cesta de novelos (carteira) ───────────────────────────
  // Saldo da carteira interna (sats + BRL). Buscado no mount e
  // refrescado quando a usuária volta da tela de transação.
  const [saldoCarteira, setSaldoCarteira] = useState<SaldoCarteira | null>(null);

  // Tier upgrade animation
  const [tierUpgraded, setTierUpgraded] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = await ensureToken();
    if (!token) {
      setError("Não foi possível carregar seus dados. Tente novamente.");
      setLoading(false);
      return;
    }
    let me = await getMe(token);
    let activeToken = token;
    if (!me) {
      localStorage.removeItem("arakne_token");
      const retryToken = await ensureToken();
      if (!retryToken) {
        setError("Não foi possível carregar seus dados. Tente novamente.");
        setLoading(false);
        return;
      }
      me = await getMe(retryToken);
      activeToken = retryToken;
      if (!me) {
        setError("Não foi possível carregar seus dados. Tente novamente.");
        setLoading(false);
        return;
      }
    }
    setUsuaria(me);

    // Load emprestimos from stored IDs
    const ids = getEmprestimoIds();
    const results: Emprestimo[] = [];
    for (const id of ids) {
      const emp = await getEmprestimo(id);
      if (emp) results.push(emp);
    }
    results.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
    setEmprestimos(results);

    // Load convite if user is tier 3+
    if (me && me.tier >= 3) {
      const conviteData = await getConvite(activeToken);
      if (conviteData) setConvite(conviteData);
    } else {
      setConvite(null);
    }

    // Load available Pontos de Troca (Fornecedoras de Linha)
    const pontosData = await listarPontosDeTroca(activeToken);
    if (pontosData) setPontos(pontosData);

    // Se a usuária é Fornecedora de Linha, carrega os pedidos de troca
    // pendentes recebidos no ateliê dela (papel === "ponto").
    if (me?.disponivel_como_ponto) {
      setTrocasRecebidasLoading(true);
      const minhasTrocas = await getMinhasTrocas(activeToken);
      if (minhasTrocas) {
        const pendentes = minhasTrocas.filter(
          (t) => t.papel === "ponto" && t.status === "pendente"
        );
        setTrocasRecebidas(pendentes);
      }
      setTrocasRecebidasLoading(false);
    } else {
      setTrocasRecebidas([]);
    }

    // Load tecelãs de confiança já vinculadas (avalistas de recuperação)
    const tecelasData = await getAvalistasRecuperacao(activeToken);
    setTecelas(tecelasData ?? []);
    setTecelasLoading(false);

    // Load saldo da cesta de novelos (best-effort — o endpoint pode não
    // existir ainda se a Lane A ainda não terminou).
    const saldo = await getSaldoCarteira();
    if (saldo) setSaldoCarteira(saldo);

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Tecelã de confiança (avalista de recuperação) ────────────

  /** Recarrega apenas a lista de tecelãs vinculadas (usado após vincular
   *  com sucesso, sem precisar recarregar a página inteira). */
  const recarregarTecelas = useCallback(async () => {
    const token = await ensureToken();
    if (!token) return;
    const lista = await getAvalistasRecuperacao(token);
    setTecelas(lista ?? []);
  }, []);

  const handleVincularTecela = async () => {
    const codigo = tecelaCodigo.trim();
    if (!codigo) {
      setTecelaError("Digite o código de convite da tecelã que você quer convidar.");
      return;
    }
    setTecelaSubmitting(true);
    setTecelaError(null);
    setTecelaSuccess(null);
    try {
      await vincularMentorRecuperacao(codigo);
      setTecelaCodigo("");
      setTecelaSuccess("Tecelã convidada para o seu ateliê!");
      await recarregarTecelas();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Mensagem disfarçada: nunca vaza "recuperação", "chave", etc.
      if (/n[ãa]o encontr|inv[áa]lid|inexistente|n[ãa]o existe/i.test(msg)) {
        setTecelaError(
          "Não encontrei essa tecelã — confira o código de convite dela (não o identificador dela)."
        );
      } else if (/j[áa]|preenchido|slot|limite|m[áa]ximo/i.test(msg)) {
        setTecelaError("Seu ateliê já tem uma tecelã de confiança.");
      } else {
        setTecelaError("Não consegui convidar essa tecelã agora. Tente de novo.");
      }
    } finally {
      setTecelaSubmitting(false);
    }
  };

  useEffect(() => {
    if (prefilledPontoIdentificador) {
      setTrocaAlvo(prefilledPontoIdentificador);
      setTrocaMsg(null);
      onPrefillConsumed?.();
    }
  }, [prefilledPontoIdentificador, onPrefillConsumed]);

  const podeEmprestar = usuaria
    ? usuaria.tier >= 1 && !usuaria.tier_congelado && usuaria.saldo_devedor === 0
    : false;

  const limite = usuaria ? TIER_LIMITS[usuaria.tier] ?? 0 : 0;

  // ── Fornecedoras de Linha (Ponto de Troca) ───────────────────

  const handleToggleSouPonto = async () => {
    if (!usuaria) return;
    setTogglingPonto(true);
    setPontosError(null);
    const token = await ensureToken();
    if (!token) {
      setTogglingPonto(false);
      return;
    }
    const novoValor = !usuaria.disponivel_como_ponto;
    const resp = await setDisponibilidadePonto(token, novoValor);
    setTogglingPonto(false);
    if (!resp.ok) {
      setPontosError(
        "Ainda não dá pra se tornar uma Fornecedora de Linha — isso libera a partir do nível 1."
      );
      return;
    }
    setUsuaria({ ...usuaria, disponivel_como_ponto: resp.disponivel ?? novoValor });
  };

  const handlePedirTroca = async (pontoIdentificador: string) => {
    const valor = Number(valorTroca);
    if (!valor || valor <= 0) {
      setTrocaMsg("Digite um valor válido.");
      return;
    }
    setTrocaLoading(true);
    setTrocaMsg(null);
    const token = await ensureToken();
    if (!token) {
      setTrocaLoading(false);
      setTrocaMsg("Não foi possível confirmar agora. Tente de novo.");
      return;
    }
    const troca = await criarTroca(token, pontoIdentificador, valor);
    setTrocaLoading(false);
    if (!troca) {
      setTrocaMsg("Não conseguimos registrar essa troca. Tente de novo.");
      return;
    }
    if (troca.status === "pendente") {
      // Disfarce: "tecelã" em vez de "fornecedor/aprovação". A troca
      // fica aguardando a tecelã confirmar no ateliê dela.
      setTrocaMsg("Troca combinada! Aguarde a tecelã confirmar.");
      setValorTroca("");
      setTrocaAlvo(null);
      return;
    }
    if (troca.status === "confirmada") {
      setTrocaMsg(`Troca confirmada! ${valor.toLocaleString("pt-BR")} combinados.`);
      setValorTroca("");
      setTrocaAlvo(null);
      return;
    }
    // Outros status (recusada, falhou) — erro disfarçado.
    setTrocaMsg("Não conseguimos registrar essa troca. Tente de novo.");
  };

  /** Recarrega apenas a lista de pedidos de troca pendentes recebidos
   *  no ateliê (papel === "ponto"). Usado após confirmar/recusar. */
  const recarregarTrocasRecebidas = useCallback(async () => {
    const token = await ensureToken();
    if (!token) return;
    const minhas = await getMinhasTrocas(token);
    if (minhas) {
      setTrocasRecebidas(
        minhas.filter((t) => t.papel === "ponto" && t.status === "pendente")
      );
    }
  }, []);

  const handleConfirmarTroca = async (trocaId: number) => {
    setTrocaActionLoading(trocaId);
    setTrocaActionMsg(null);
    const token = await ensureToken();
    if (!token) {
      setTrocaActionLoading(null);
      setTrocaActionMsg("Não foi possível agora. Tente de novo.");
      return;
    }
    try {
      await confirmarTroca(token, trocaId);
      setTrocaActionMsg("Troca confirmada no seu ateliê.");
      await recarregarTrocasRecebidas();
      // Recarrega também os pontos para atualizar o contador de trocas
      // concluídas da usuária como Fornecedora de Linha.
      const pontosData = await listarPontosDeTroca(token);
      if (pontosData) setPontos(pontosData);
      // Atualiza o me para refletir trocas_como_ponto_concluidas.
      const me = await getMe(token);
      if (me) setUsuaria(me);
    } catch {
      setTrocaActionMsg("Não consegui confirmar essa troca. Tente de novo.");
    } finally {
      setTrocaActionLoading(null);
    }
  };

  const handleRecusarTroca = async (trocaId: number) => {
    setTrocaActionLoading(trocaId);
    setTrocaActionMsg(null);
    const token = await ensureToken();
    if (!token) {
      setTrocaActionLoading(null);
      setTrocaActionMsg("Não foi possível agora. Tente de novo.");
      return;
    }
    try {
      await recusarTroca(token, trocaId);
      setTrocaActionMsg("Troca recusada no seu ateliê.");
      await recarregarTrocasRecebidas();
    } catch {
      setTrocaActionMsg("Não consegui recusar essa troca. Tente de novo.");
    } finally {
      setTrocaActionLoading(null);
    }
  };

  const handleSolicitarKit = async () => {
    const ident = getIdentificador();
    if (!ident) return;
    setActionLoading(true);
    const emp = await createEmprestimo(ident);
    if (emp) {
      addEmprestimoId(emp.id);
      setEmprestimos((prev) => [emp, ...prev]);
      // Mostra só a confirmação amigável (sem exibir invoice/bolt11)
      setLiberadoDisplay(emp);
      await loadData();
    } else {
      setError("Não foi possível puxar novelos agora.");
    }
    setActionLoading(false);
  };

  // ── Repayment handlers ───────────────────────────────────────

  const openRepayModal = (emp: Emprestimo) => {
    setRepayModal({
      open: true,
      emprestimo: emp,
      valor: String(emp.valor_sats),
      processing: false,
      result: null,
      mode: "input",
      pixCobranca: null,
      pixError: null,
    });
  };

  const closeRepayModal = () => {
    stopPixPolling();
    setRepayModal({
      open: false,
      emprestimo: null,
      valor: "",
      processing: false,
      result: null,
      mode: "input",
      pixCobranca: null,
      pixError: null,
    });
  };

  const handleRepay = async () => {
    const emp = repayModal.emprestimo;
    if (!emp) return;
    const valor = parseInt(repayModal.valor, 10);
    if (!valor || valor <= 0) return;

    setRepayModal((prev) => ({ ...prev, processing: true }));
    const result = await pagarEmprestimo(emp.id, valor);

    if (result) {
      // Show result in modal
      setRepayModal((prev) => ({
        ...prev,
        processing: false,
        result: {
          quitado: result.quitado,
          tier: result.tier,
          saldo_devedor: result.saldo_devedor,
        },
      }));

      // If tier changed (quitado), trigger the upgrade animation
      if (result.quitado && usuaria && result.tier > usuaria.tier) {
        setTierUpgraded(result.tier);
        setTimeout(() => setTierUpgraded(null), 3000);
      }

      // Reload all data after a short delay so the user sees the result
      setTimeout(async () => {
        await loadData();
        closeRepayModal();
      }, 1800);
    } else {
      setRepayModal((prev) => ({ ...prev, processing: false }));
      setError(
        "Não conseguimos confirmar a devolução agora. Pode ser que tenha falhado, ou que ainda esteja em confirmação — confira o registro de padrões antes de tentar de novo, pra evitar duplicar a devolução."
      );
      closeRepayModal();
    }
  };

  // ── Repayment via Pix ─────────────────────────────────────────
  // Fluxo paralelo ao Lightning: gera cobrança Pix, mostra QR e faz
  // polling de status a cada 3s. Disfarce: "código de devolução".

  const handleRepayPix = async () => {
    const emp = repayModal.emprestimo;
    if (!emp) return;
    const valor = parseInt(repayModal.valor, 10);
    if (!valor || valor <= 0) return;

    // Garante que não há polling anterior rodando
    stopPixPolling();

    setRepayModal((prev) => ({
      ...prev,
      mode: "pix-loading",
      pixError: null,
      pixCobranca: null,
    }));

    const centavos = satsParaCentavosBrl(valor);
    const cobranca = await criarCobrancaPix(emp.id, valor, centavos);

    if (!cobranca) {
      setRepayModal((prev) => ({
        ...prev,
        mode: "pix-error",
        pixError: "Não conseguimos gerar o código de devolução agora. Tente de novo.",
      }));
      return;
    }

    setRepayModal((prev) => ({
      ...prev,
      mode: "pix-awaiting",
      pixCobranca: cobranca,
    }));

    // Inicia polling de status a cada 3s
    pixPollingRef.current = window.setInterval(async () => {
      const status = await getStatusPagamentoPix(cobranca.txid);
      if (!status) return; // erro de rede → mantém polling
      if (status.status === "aprovado") {
        stopPixPolling();
        setRepayModal((prev) => ({ ...prev, mode: "pix-confirmed" }));
        // Refresca saldo/tier e fecha o modal após 2s
        setTimeout(async () => {
          await loadData();
          closeRepayModal();
        }, 2000);
      } else if (status.status === "expirado") {
        stopPixPolling();
        setRepayModal((prev) => ({
          ...prev,
          mode: "pix-error",
          pixError: "O código de devolução expirou. Tente gerar um novo.",
        }));
      }
      // status === "pendente" → mantém polling
    }, 3000);
  };

  // ── Confirmação "Puxar novelos" ─────────────────────────────

  const closeLiberadoDisplay = () => {
    setLiberadoDisplay(null);
  };

  // ── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page theme-financial">
        <Header>
          <RecoveryBellHost />
        </Header>
        <main className="financial">
          <button className="financial__back" onClick={onBack} aria-label="Voltar">
            ← Voltar aos padrões
          </button>
          <h2 className="financial__title">Seu ateliê</h2>
          {showSkeleton && (
            <div className="trilhas__grid" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div className="skeleton skeleton-card__visual" />
                  <div className="skeleton-card__body">
                    <div className="skeleton skeleton--text" />
                    <div className="skeleton skeleton--text skeleton--short" />
                    <div className="skeleton skeleton--bar" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="page theme-financial">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="financial">
        <button className="financial__back" onClick={onBack} aria-label="Voltar">
          ← Voltar aos padrões
        </button>

        <div className="financial__brand">
          <img src="/logo-arakne-crest.png" alt="" className="financial__brand-mark" />
          <span className="financial__brand-name">ARAKNE</span>
          <span className="financial__brand-tagline">Tecemos possibilidades. Você cria sua história.</span>
        </div>

        <h2 className="financial__title">Seu ateliê</h2>

        {error && (
          <div className="financial__error">
            <p>{error}</p>
            <button onClick={() => { setError(null); loadData(); }}>Tentar de novo</button>
          </div>
        )}

        {/* Tier upgrade banner */}
        {tierUpgraded !== null && (
          <div className="financial__tier-upgrade">
            <span className="financial__tier-upgrade-emoji">🎉</span>
            <span>Nova técnica disponível: {TIER_LABELS[tierUpgraded] ?? tierUpgraded}. Você desbloqueou uma capacidade nova no seu ateliê.</span>
          </div>
        )}

        {/* Tier / Level card */}
        <div className={`financial__card financial__card--tier ${tierUpgraded !== null ? "financial__card--highlight" : ""}`}>
          <div className="financial__card-label">Nível Atual</div>
          <div className="financial__tier-display">
            <span className="financial__tier-number">{usuaria?.tier ?? 0}</span>
            <span className="financial__tier-name">
              {TIER_LABELS[usuaria?.tier ?? 0] ?? "—"}
            </span>
          </div>
          {podeEmprestar && (
            <div className="financial__tier-badge">Disponível</div>
          )}
          {usuaria?.tier_congelado && (
            <div className="financial__tier-badge financial__tier-badge--frozen">
              Pausado
            </div>
          )}
        </div>

        {usuaria?.tier_congelado && (
          <div className="financial__error" style={{ margin: "0 20px 1rem" }}>
            <strong>Padrão esperando você voltar.</strong> Uma parceira de fio
            sua ainda não terminou o padrão dela, e isso pausa o seu ateliê
            também — é assim que o sistema protege o grupo. Assim que o padrão
            dela voltar a andar, seu ateliê volta ao normal automaticamente.
            Você ainda pode usar tudo o que já tem disponível enquanto isso.
          </div>
        )}

        {/* Balance cards */}
        <div className="financial__row">
          <div className="financial__card">
            <div className="financial__card-label">Material disponível</div>
            <div className="financial__card-value">
              {limite.toLocaleString("pt-BR")} <span className="financial__card-unit">novelo(s)</span>
            </div>
          </div>
          <div className="financial__card">
            <div className="financial__card-label">Padrão em andamento</div>
            <div className="financial__card-value">
              {(usuaria?.saldo_devedor ?? 0).toLocaleString("pt-BR")} <span className="financial__card-unit">novelo(s)</span>
            </div>
          </div>
        </div>

        {/* Estoque capacity hint */}
        <p className="field__hint" style={{ margin: "0 20px 0.75rem" }}>
          Capacidade do seu estoque: até {limite.toLocaleString("pt-BR")} novelos.
        </p>

        {/* Action button */}
        {podeEmprestar && (
          <button
            className="financial__btn financial__btn--primary"
            onClick={handleSolicitarKit}
            disabled={actionLoading}
          >
            {actionLoading ? "Puxando..." : "Puxar novelos"}
          </button>
        )}

        {/* ── Cesta de novelos (carteira) ────────────────────────
            Card de saldo da carteira interna (sats + BRL). Disfarce:
            "Cesta de novelos" + "Seus novelos" + "Valor do novelo".
            Os botões falam em "Entregar novelos", "Receber novelos" e
            "Devolver novelos" (vocabulário já existente). A unidade
            interna (sats) e a cotação de BTC não aparecem mais na tela
            — o disfarce vale para a interface inteira, sem exceção,
            mesmo em texto pequeno. */}
        <div className="financial__invite carteira-card">
          <h3 className="financial__history-title">Cesta de novelos</h3>
          <div className="carteira-card__saldo">
            <div className="carteira-card__linha">
              <span className="carteira-card__label">Seus novelos</span>
              <span className="carteira-card__valor">
                {saldoCarteira
                  ? brlFormatter.format(saldoCarteira.saldo_brl)
                  : brlFormatter.format(0)}
              </span>
            </div>
            <p className="carteira-card__sats">
              {saldoCarteira
                ? saldoCarteira.saldo_sats.toLocaleString("pt-BR")
                : 0}{" "}
              novelo(s)
            </p>
          </div>
          {saldoCarteira && saldoCarteira.cotacao_btc_brl > 0 && (
            <p className="carteira-card__cotacao">
              Valor do novelo: {brlFormatter.format(saldoCarteira.cotacao_btc_brl)}
            </p>
          )}
          <div className="carteira-card__botoes">
            <button
              className="financial__btn financial__btn--small"
              onClick={() => onAbrirCarteira("pagar")}
            >
              Entregar novelos
            </button>
            <button
              className="financial__btn financial__btn--small"
              onClick={() => onAbrirCarteira("receber")}
            >
              Receber novelos
            </button>
            {(usuaria?.saldo_devedor ?? 0) > 0 && (
              <button
                className="financial__btn financial__btn--small financial__btn--secondary"
                onClick={() => onAbrirCarteira("quitar")}
              >
                Devolver novelos
              </button>
            )}
          </div>
        </div>

        {/* History */}
        <div className="financial__history">
          <h3 className="financial__history-title">Padrões recentes</h3>
          <button
            className="financial__btn financial__btn--small"
            style={{ marginBottom: "0.75rem" }}
            onClick={onVerExtrato}
          >
            Ver registro de padrões
          </button>
          {emprestimos.length === 0 ? (
            <p className="financial__empty">Nenhum padrão puxado ainda.</p>
          ) : (
            <ul className="financial__list">
              {emprestimos.map((emp) => (
                <li key={emp.id} className="financial__list-item">
                  <div className="financial__list-info">
                    <span className="financial__list-name">Padrão #{emp.id}</span>
                    <span className="financial__list-date">
                      {new Date(emp.criado_em).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <div className="financial__list-right">
                    <span className="financial__list-amount">
                      {emp.valor_sats.toLocaleString("pt-BR")} novelo(s)
                    </span>
                    {emp.status === "ativo" ? (
                      <button
                        className="financial__btn financial__btn--small"
                        onClick={() => openRepayModal(emp)}
                        disabled={actionLoading}
                      >
                        Devolver novelos
                      </button>
                    ) : (
                      <span className="financial__list-badge">Padrão concluído! 🧵</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Invite link — only for tier 3+ */}
        {convite && (
          <div className="financial__invite">
            <h3 className="financial__history-title">Convidar Aprendiz</h3>
            <p className="financial__invite-text">
              Compartilhe este link para convidar uma nova aprendiz:
            </p>
            <div className="financial__invite-link">
              <input
                type="text"
                readOnly
                value={window.location.origin + convite.link}
                className="financial__invite-input"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                className="financial__btn financial__btn--small"
                onClick={() => {
                  const fullLink = window.location.origin + convite.link;
                  navigator.clipboard.writeText(fullLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        )}

        {/* Pedidos de troca no ateliê — só visível para Fornecedoras de
            Linha. Disfarce crochê: "pedidos de troca no ateliê", "tecelã",
            sem "fornecedor/aprovação/transação financeira". */}
        {usuaria?.disponivel_como_ponto && (
          <div className="financial__invite">
            <h3 className="financial__history-title">Pedidos de troca no ateliê</h3>
            <p className="financial__invite-text">
              Tecedoras que pediram troca de fio com você.
            </p>

            {trocaActionMsg && <p className="field__hint">{trocaActionMsg}</p>}

            {trocasRecebidasLoading ? (
              <p className="field__hint">Procurando pedidos no seu ateliê…</p>
            ) : trocasRecebidas.length === 0 ? (
              <p className="field__hint">Nenhum pedido de troca no momento.</p>
            ) : (
              <ul className="financial__list">
                {trocasRecebidas.map((t) => (
                  <li key={t.id} className="financial__list-item">
                    <div className="financial__list-info">
                      <span className="financial__list-name">
                        {t.contraparte_identificador.slice(0, 8)}…
                      </span>
                      <span className="financial__list-date">
                        {new Date(t.criado_em).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <div className="financial__list-right">
                      <span className="financial__list-amount">
                        {t.valor_sats.toLocaleString("pt-BR")} novelo(s)
                      </span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          className="financial__btn financial__btn--small"
                          onClick={() => handleConfirmarTroca(t.id)}
                          disabled={trocaActionLoading !== null}
                        >
                          {trocaActionLoading === t.id ? "..." : "Confirmar"}
                        </button>
                        <button
                          className="financial__btn financial__btn--small financial__btn--secondary"
                          onClick={() => handleRecusarTroca(t.id)}
                          disabled={trocaActionLoading !== null}
                        >
                          Recusar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Fornecedoras de Linha (Ponto de Troca) — nível 1+ */}
        <div className="financial__invite">
          <h3 className="financial__history-title">Fornecedoras de Linha</h3>
          <p className="financial__invite-text">
            Tecedoras de confiança que trocam fio por material direto com você.
          </p>

          <button
            className="financial__btn financial__btn--small"
            style={{ marginBottom: "0.75rem" }}
            onClick={onAbrirScanner}
          >
            📷 Escanear código de uma tecedora
          </button>

          {pontosError && <p className="field__error">{pontosError}</p>}

          {usuaria && (
            <label className="checkbox-row" style={{ margin: "0.75rem 0" }}>
              <input
                type="checkbox"
                checked={usuaria.disponivel_como_ponto}
                disabled={togglingPonto}
                onChange={handleToggleSouPonto}
              />
              <span>
                Quero me tornar uma Fornecedora de Linha (aparecer para outras
                tecedoras trocarem fio com você).
              </span>
            </label>
          )}

          {/* Contador de trocas concluídas no ateliê (disfarçado de
              "trocas concluídas no seu ateliê"). Veio da bancada do
              PerfilPage — vive aqui, na camada financeira. */}
          {usuaria?.disponivel_como_ponto && (
            <p className="field__hint" style={{ marginBottom: "0.75rem" }}>
              {usuaria.trocas_como_ponto_concluidas} trocas concluídas no seu ateliê.
            </p>
          )}

          {pontos.length === 0 ? (
            <p className="field__hint">Nenhuma Fornecedora de Linha por perto ainda.</p>
          ) : (
            <ul className="financial__list">
              {pontos.map((p) => (
                <li key={p.identificador} className="financial__list-item">
                  <div className="financial__list-info">
                    <span className="financial__list-name">{p.identificador.slice(0, 8)}…</span>
                    <span className="financial__list-date">
                      {p.trocas_como_ponto_concluidas} trocas concluídas
                    </span>
                  </div>
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => {
                      setTrocaAlvo(trocaAlvo === p.identificador ? null : p.identificador);
                      setTrocaMsg(null);
                    }}
                  >
                    {trocaAlvo === p.identificador ? "Fechar" : "Pedir troca"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {trocaAlvo && (
            <div className="consent-note" style={{ marginTop: "0.75rem" }}>
              <div className="field" style={{ marginBottom: "0.5rem" }}>
                <label className="field__label" htmlFor="valorTroca">Quanto quer trocar?</label>
                <input
                  id="valorTroca"
                  className="field__input"
                  inputMode="numeric"
                  placeholder="Ex.: 2000"
                  value={valorTroca}
                  onChange={(e) => setValorTroca(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              {trocaMsg && <p className="field__hint">{trocaMsg}</p>}
              <button
                className="btn btn--primary"
                onClick={() => handlePedirTroca(trocaAlvo)}
                disabled={trocaLoading}
              >
                {trocaLoading ? "Combinando..." : "Confirmar troca"}
              </button>
            </div>
          )}
        </div>

        {/* Tecelã de confiança — disfarçado como "ateliê". Permite
            vincular uma tecelã de confiança (avalista de recuperação)
            depois do cadastro, via codigo_indicacao dela. Se a usuária
            já tem tecelã vinculada, mostra a lista e bloqueia novas
            vinculações (o backend rejeita slot preenchido). */}
        <div className="financial__invite">
          <h3 className="financial__history-title">Tecelã de confiança</h3>

          {tecelasLoading ? (
            <p className="field__hint">Procurando tecelãs do seu ateliê…</p>
          ) : tecelas.length > 0 ? (
            <>
              <p className="financial__invite-text">
                Sua tecelã de confiança está pronta para ajudar quando precisar.
              </p>
              <ul className="financial__list">
                {tecelas.map((t) => (
                  <li key={t.id} className="financial__list-item">
                    <div className="financial__list-info">
                      <span className="financial__list-name">{rotuloTecela(t)}</span>
                      <span className="financial__list-date">Tecelã do ateliê</span>
                    </div>
                    <span className="financial__list-badge">🧶</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="financial__invite-text">
                Convide uma tecelã experiente para fazer parte do seu ateliê —
                ela poderá te dar uma mão quando um padrão travar.
              </p>
              <div className="field" style={{ marginBottom: "0.5rem" }}>
                <label className="field__label" htmlFor="tecelaCodigo">
                  Código de convite da tecelã
                </label>
                <input
                  id="tecelaCodigo"
                  className="field__input"
                  type="text"
                  placeholder="Cole aqui o código de convite da tecelã"
                  value={tecelaCodigo}
                  onChange={(e) => setTecelaCodigo(e.target.value)}
                  disabled={tecelaSubmitting}
                />
                <p className="field__hint">
                  Peça à tecelã o código de convite dela (ela encontra em
                  "Meu código de convite" no ateliê dela). Não cole o
                  identificador dela — são códigos diferentes.
                </p>
              </div>
              {tecelaError && <p className="field__error">{tecelaError}</p>}
              {tecelaSuccess && <p className="field__hint">{tecelaSuccess}</p>}
              <button
                className="financial__btn financial__btn--small"
                onClick={handleVincularTecela}
                disabled={tecelaSubmitting || !tecelaCodigo.trim()}
              >
                {tecelaSubmitting ? "Convidando…" : "Convidar tecelã para o ateliê"}
              </button>

              {/* Meu código de convite — para a usuária poder copiar e
                  passar à outra tecedora que vai vinculá-la como tecelã
                  de confiança. O codigo_indicacao vem direto do /me
                  (qualquer tier), não depende do getConvite (tier 3+). */}
              {usuaria?.codigo_indicacao && (
                <div className="consent-note" style={{ marginTop: "0.75rem" }}>
                  <p className="field__label" style={{ marginBottom: "0.4rem" }}>
                    Seu código de convite
                  </p>
                  <p className="field__hint" style={{ marginBottom: "0.5rem" }}>
                    Compartilhe este código com a tecedora que vai te
                    convidar para o ateliê dela.
                  </p>
                  <div className="financial__invite-link">
                    <input
                      type="text"
                      readOnly
                      value={usuaria.codigo_indicacao}
                      className="financial__invite-input"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      aria-label="Seu código de convite"
                    />
                    <button
                      className="financial__btn financial__btn--small"
                      onClick={() => {
                        navigator.clipboard.writeText(usuaria.codigo_indicacao);
                        setCodigoConviteCopied(true);
                        setTimeout(() => setCodigoConviteCopied(false), 2000);
                      }}
                    >
                      {codigoConviteCopied ? "Copiado!" : "Copiar"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Meu código de Ponto de Troca (Mudança #6) — QR do
            identificador da usuária, para outra tecedora escanear em
            vez de digitar à mão. Saiu do PerfilPage (camada crochê) e
            passou a viver aqui, na camada financeira — o QR de
            Fornecedora de Linha não pertence à bancada crochê. */}
        <div className="financial__invite">
          <h3 className="financial__history-title">Meu código de Ponto de Troca</h3>
          <p className="financial__invite-text">
            Mostre este código para outra tecedora escanear, em vez de
            digitar seu identificador na mão.
          </p>
          <MeuCodigoQR compact />
        </div>

        {/* Pattern progress */}
        <div className="financial__progress">
          <div className="financial__progress-row">
            <span>Padrões concluídos</span>
            <span className="financial__progress-value">{usuaria?.padroes_completos ?? 0}</span>
          </div>
        </div>
      </main>

      {/* ── Repayment modal ─────────────────────────────────── */}
      {repayModal.open && repayModal.emprestimo && (
        <div className="modal-overlay" onClick={closeRepayModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {repayModal.result ? (
              // ── Lightning result view (fluxo existente) ──
              <div className="repay-result">
                <div className="repay-result__icon">
                  {repayModal.result.quitado ? "🎉" : "✅"}
                </div>
                <h3 className="repay-result__title">
                  {repayModal.result.quitado ? "Padrão concluído! 🧵" : "Devolução registrada!"}
                </h3>
                <p className="repay-result__text">
                  {repayModal.result.quitado
                    ? "Você terminou essa peça. Um novo nível de técnica foi desbloqueado."
                    : `Faltam ${repayModal.result.saldo_devedor.toLocaleString("pt-BR")} novelo(s) pra terminar esse padrão.`}
                </p>
              </div>
            ) : repayModal.mode === "pix-loading" ? (
              // ── Pix loading: gerando cobrança ──
              <>
                <h3 className="modal__title">Devolver via Pix</h3>
                <p className="modal__text">Gerando código de devolução…</p>
                <div
                  className="skeleton skeleton-card__visual"
                  style={{ width: 240, height: 240, margin: "0 auto" }}
                  aria-hidden="true"
                />
              </>
            ) : repayModal.mode === "pix-awaiting" && repayModal.pixCobranca ? (
              // ── Pix awaiting: QR visível + polling ativo ──
              <>
                <h3 className="modal__title">Devolver via Pix</h3>
                <p className="modal__text">
                  Escaneie o código de devolução para concluir.
                </p>

                <PixQR cobranca={repayModal.pixCobranca} />

                <p
                  className="modal__hint"
                  style={{ textAlign: "center", marginTop: "0.75rem", fontWeight: 600 }}
                >
                  {brlFormatter.format(repayModal.pixCobranca.valor_centavos_brl / 100)}
                </p>

                <p className="modal__hint" style={{ textAlign: "center" }}>
                  Aguardando pagamento…
                </p>

                {/* Copia-e-cola opcional — disfarçado como "código de
                    devolução". Nunca mostramos txid/mp_payment_id crus. */}
                <div className="financial__invite-link" style={{ marginTop: "0.75rem" }}>
                  <input
                    type="text"
                    readOnly
                    value={repayModal.pixCobranca.qr_code}
                    className="financial__invite-input"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    aria-label="Código de devolução para copiar"
                  />
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => {
                      navigator.clipboard.writeText(repayModal.pixCobranca!.qr_code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>

                <div className="modal__actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    className="financial__btn financial__btn--secondary"
                    onClick={closeRepayModal}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : repayModal.mode === "pix-confirmed" ? (
              // ── Pix confirmed: fecha automaticamente em 2s ──
              <div className="repay-result">
                <div className="repay-result__icon">✅</div>
                <h3 className="repay-result__title">Registro atualizado!</h3>
                <p className="repay-result__text">
                  Novelos devolvidos. Seu ateliê já está atualizado.
                </p>
              </div>
            ) : repayModal.mode === "pix-error" ? (
              // ── Pix error: mensagem + "Tentar novamente" ──
              <div className="repay-result">
                <div className="repay-result__icon">⚠️</div>
                <h3 className="repay-result__title">Não foi possível concluir</h3>
                <p className="repay-result__text">
                  {repayModal.pixError ?? "Algo deu errado. Tente de novo."}
                </p>
                <div className="modal__actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    className="financial__btn financial__btn--secondary"
                    onClick={closeRepayModal}
                  >
                    Cancelar
                  </button>
                  <button
                    className="financial__btn financial__btn--primary financial__btn--small"
                    onClick={() =>
                      setRepayModal((prev) => ({
                        ...prev,
                        mode: "input",
                        pixError: null,
                        pixCobranca: null,
                      }))
                    }
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : (
              // ── Input view (default, mode === "input") ──
              <>
                <h3 className="modal__title">Devolver novelos</h3>
                <p className="modal__text">
                  Quanto você quer devolver hoje?
                </p>

                {usuaria && usuaria.saldo_devedor > 0 && (
                  <p className="modal__hint">
                    Padrão em andamento: {usuaria.saldo_devedor.toLocaleString("pt-BR")} novelo(s)
                  </p>
                )}

                <label className="modal__label" htmlFor="repay-valor">
                  Quanto você quer devolver?
                </label>
                <input
                  id="repay-valor"
                  type="number"
                  className="modal__input"
                  value={repayModal.valor}
                  onChange={(e) => setRepayModal((prev) => ({ ...prev, valor: e.target.value }))}
                  min={1}
                  max={repayModal.emprestimo.valor_sats}
                  placeholder="Quantos novelos"
                  autoFocus
                />

                {/* Conversão sats → BRL ao vivo, para a usuária saber
                    quanto está devolvendo em dinheiro bancário via Pix. */}
                {repayModal.valor && parseInt(repayModal.valor, 10) > 0 && (
                  <p className="modal__hint">
                    {parseInt(repayModal.valor, 10).toLocaleString("pt-BR")} novelo(s) ≈{" "}
                    {brlFormatter.format(parseInt(repayModal.valor, 10) * SATS_TO_BRL)}
                  </p>
                )}

                <div className="modal__quick-buttons">
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => {
                      const half = Math.floor(repayModal.emprestimo!.valor_sats / 2);
                      setRepayModal((prev) => ({ ...prev, valor: String(half) }));
                    }}
                  >
                    Metade
                  </button>
                  <button
                    className="financial__btn financial__btn--small"
                    onClick={() => setRepayModal((prev) => ({
                      ...prev,
                      valor: String(prev.emprestimo!.valor_sats),
                    }))}
                  >
                    Tudo
                  </button>
                </div>

                <div className="modal__actions">
                  <button
                    className="financial__btn financial__btn--secondary"
                    onClick={closeRepayModal}
                    disabled={repayModal.processing}
                  >
                    Cancelar
                  </button>
                  <button
                    className="financial__btn financial__btn--primary financial__btn--small"
                    onClick={handleRepay}
                    disabled={repayModal.processing || !repayModal.valor || parseInt(repayModal.valor, 10) <= 0}
                  >
                    {repayModal.processing ? "Processando..." : "Devolver novelos"}
                  </button>
                </div>

                {/* Pix — ação secundária, abaixo do fluxo Lightning
                    principal. Disfarce: "Pagar com Pix" em texto normal,
                    sem gritar. Mesmas classes CSS do resto do modal. */}
                <button
                  className="financial__btn financial__btn--small financial__btn--secondary"
                  style={{ width: "100%", marginTop: "0.5rem" }}
                  onClick={handleRepayPix}
                  disabled={repayModal.processing || !repayModal.valor || parseInt(repayModal.valor, 10) <= 0}
                >
                  Pagar com Pix
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Confirmação "Puxar novelos" ────────────────────── */}
      {liberadoDisplay && (
        <div className="modal-overlay" onClick={closeLiberadoDisplay}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Padrão liberado!</h3>
            <p className="modal__text">
              Seus novelos já estão no seu estoque. Boa costura.
            </p>
            <div className="modal__actions">
              <button
                className="financial__btn financial__btn--primary financial__btn--small"
                onClick={closeLiberadoDisplay}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
