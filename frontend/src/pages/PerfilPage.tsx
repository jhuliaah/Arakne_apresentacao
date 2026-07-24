import { useEffect, useState } from "react";
import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import BottomNav, { type NavTarget } from "../components/BottomNav";
import {
  ensureToken,
  getCustodiaReservaFria,
  getMe,
  getNickname,
  logout,
} from "../api";
import { clearStoredIdentity, softLogout } from "../lib/pattern-storage";
import { clearSharesCache } from "../lib/recovery-respond";
import { useDelayedFlag } from "../lib/useDelayedFlag";
import type { CustodiaReservaFria, Usuaria } from "../types";

interface PerfilPageProps {
  onNavigate: (target: NavTarget) => void;
  onLoggedOut: () => void;
  /** (Legado — Mudança #6 moveu o QR para FinancialPage.) A Lane D
   *  removerá esta prop ao limpar a view `meuQRCode` do App.tsx. Mantida
   *  como opcional para não quebrar o App.tsx atual. */
  onVerMeuCodigo?: () => void;
}

const NIVEL_LABELS: Record<number, string> = {
  0: "Iniciante",
  1: "Aprendiz",
  2: "Artesã",
  3: "Mestra",
};

// Formatador de data pt-BR para a reserva do ateliê central.
// Criado no escopo do módulo para não reinstanciar a cada render.
const formatadorDataReserva = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Traduz o quorum "M-de-N" do backend para uma frase amigável.
 *  Ex.: "2-de-3" → "2 de 3 assinaturas necessárias".
 *  Disfarce: "assinaturas necessárias" = quorum multisig. */
function formatarQuorum(quorum: string): string {
  const m = quorum.match(/^(\d+)-de-(\d+)$/i);
  if (m) return `${m[1]} de ${m[2]} assinaturas necessárias`;
  // Fallback: se o formato vier diferente, mostra o cru rotulado.
  return quorum;
}

/** Traduz o nome técnico da network para o vocabulário do ateliê.
 *  mainnet → rede principal; demais → rede de testes. */
function traduzirNetwork(network: string): string {
  switch (network.toLowerCase()) {
    case "mainnet":
      return "rede principal";
    case "regtest":
    case "testnet":
    case "signet":
      return "rede de testes";
    default:
      return network;
  }
}

export default function PerfilPage({ onNavigate, onLoggedOut }: PerfilPageProps) {
  const [usuaria, setUsuaria] = useState<Usuaria | null>(null);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedFlag(loading);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  // Confirmação dupla para "Apagar conta deste dispositivo" (Mudança #5a).
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);

  const nickname = getNickname();

  useEffect(() => {
    (async () => {
      const token = await ensureToken();
      if (!token) {
        setError("Não foi possível carregar sua bancada agora.");
        setLoading(false);
        return;
      }
      const me = await getMe(token);
      if (!me) {
        setError("Não foi possível carregar sua bancada agora.");
        setLoading(false);
        return;
      }
      setUsuaria(me);
      setLoading(false);
    })();
  }, []);

  // Reserva do ateliê central (custódia multisig, disfarçada) —
  // endpoint público, não exige token. Buscada em paralelo com os
  // dados da usuária. Se falhar ou retornar null, a seção simplesmente
  // some (não é crítica para a bancada).
  const [custodia, setCustodia] = useState<CustodiaReservaFria | null>(null);
  const [custodiaLoading, setCustodiaLoading] = useState(true);
  const showCustodiaSkeleton = useDelayedFlag(custodiaLoading);

  useEffect(() => {
    (async () => {
      const data = await getCustodiaReservaFria();
      setCustodia(data);
      setCustodiaLoading(false);
    })();
  }, []);

  const handleSair = () => {
    // "Sair" NÃO apaga a identidade (Mudança #5a): só desloga a sessão
    // (token do backend, nsec destravado em memória, cache de shares em
    // memória, flag de sessão desbloqueada, contador de tentativas
    // falhas). A identidade Nostr persistida (nsec criptografado, hash
    // do padrão, npub) PERMANECE no localStorage — a usuária volta a
    // entrar desenhando o Ponto Arakne. O "apagar conta" real é uma
    // ação separada (handleApagar) com confirmação dupla.
    softLogout();
    clearSharesCache();
    logout();
    onLoggedOut();
  };

  const handleApagar = () => {
    // "Apagar conta deste dispositivo" (Mudança #5a) — ação real de
    // remoção: limpa a identidade Nostr persistida (nsec criptografado,
    // hash do padrão, npub) E os dados de sessão do backend. Também
    // limpa o cache em memória das shares recebidas como avalista.
    // Disfarçado de "Desfazer todos os pontos" para preservar o
    // vocabulário crochê. Confirmação dupla via `confirmandoApagar`.
    clearStoredIdentity();
    clearSharesCache();
    logout();
    onLoggedOut();
  };

  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="catalog">
        <h2 className="catalog__title">Bancada de Trabalho</h2>
        <p className="catalog__subtitle">{nickname ? `Olá, ${nickname}` : "Sua bancada"}</p>

        {/* Sair da conta — sempre visível no topo, independente do backend.
            "Sair" NÃO apaga a identidade (Mudança #5a): a usuária volta a
            entrar desenhando o Ponto Arakne. */}
        {!confirmandoSaida ? (
          <button
            className="btn btn--secondary"
            onClick={() => setConfirmandoSaida(true)}
            style={{ marginBottom: "1.5rem" }}
          >
            Sair da conta
          </button>
        ) : (
          <div className="consent-note" style={{ marginBottom: "1.5rem" }}>
            <p style={{ marginBottom: "0.75rem" }}>
              Você pode voltar a entrar desenhando seu Ponto Arakne neste
              aparelho, ou usando suas palavras do ateliê num aparelho novo.
              Seus pontos ficam guardados. Sair agora?
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn--secondary" onClick={() => setConfirmandoSaida(false)}>
                Cancelar
              </button>
              <button className="btn btn--primary" onClick={handleSair}>
                Sair mesmo assim
              </button>
            </div>
          </div>
        )}

        {loading && showSkeleton && (
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
        {error && <p className="field__error">{error}</p>}

        {usuaria && (
          <>
            <div className="community__group-card" style={{ marginBottom: "0.875rem" }}>
              <div className="community__group-emoji">🧵</div>
              <div>
                <div className="community__group-name">
                  Nível {NIVEL_LABELS[usuaria.tier] ?? usuaria.tier}
                </div>
                <div className="community__group-meta">
                  {usuaria.padroes_completos} padrões concluídos
                </div>
              </div>
            </div>

            {usuaria.tier_congelado && (
              <div className="consent-note" style={{ marginBottom: "0.875rem" }}>
                Padrão esperando você voltar — uma parceira de fio sua ainda
                não terminou o padrão dela.
              </div>
            )}
          </>
        )}

        {/* Reserva do ateliê central — disfarçada de "reserva do
            ateliê". Na verdade é a custódia multisig do fundo coletivo
            (dados públicos: endereço, quorum, rede). Card informativo,
            sutil — não compete com o card de nível. Se a busca falhar
            ou retornar null, a seção some silenciosamente (não é
            crítica para a bancada). Endpoint público, sem token. */}
        {custodiaLoading && showCustodiaSkeleton && (
          <div
            className="skeleton-card"
            aria-hidden="true"
            style={{ padding: "0.875rem 1rem", marginBottom: "0.875rem" }}
          >
            <div className="skeleton skeleton--text" style={{ marginBottom: "0.5rem" }} />
            <div
              className="skeleton skeleton--text skeleton--short"
              style={{ marginBottom: "0.625rem" }}
            />
            <div className="skeleton skeleton--bar" style={{ marginBottom: "0.5rem" }} />
            <div className="skeleton skeleton--bar" />
          </div>
        )}
        {!custodiaLoading && custodia && (
          custodia.configurado ? (
            <div className="perfil__reserva">
              <div className="perfil__reserva-header">
                <div className="perfil__reserva-title">
                  <span className="perfil__reserva-icon" aria-hidden="true">🔐</span>
                  Reserva do ateliê central
                </div>
                <div className="perfil__reserva-subtitle">
                  Transparência do fundo coletivo
                </div>
              </div>
              <dl className="perfil__reserva-list">
                {custodia.endereco && (
                  <div className="perfil__reserva-row">
                    <dt className="perfil__reserva-label">Endereço</dt>
                    <dd className="perfil__reserva-value perfil__reserva-value--mono">
                      {custodia.endereco}
                    </dd>
                  </div>
                )}
                {custodia.quorum && (
                  <div className="perfil__reserva-row">
                    <dt className="perfil__reserva-label">Assinaturas</dt>
                    <dd className="perfil__reserva-value">
                      {formatarQuorum(custodia.quorum)}
                    </dd>
                  </div>
                )}
                {custodia.network && (
                  <div className="perfil__reserva-row">
                    <dt className="perfil__reserva-label">Rede</dt>
                    <dd className="perfil__reserva-value">
                      {traduzirNetwork(custodia.network)}
                    </dd>
                  </div>
                )}
                {custodia.criado_em && (
                  <div className="perfil__reserva-row">
                    <dt className="perfil__reserva-label">Desde</dt>
                    <dd className="perfil__reserva-value">
                      {formatadorDataReserva.format(new Date(custodia.criado_em))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          ) : (
            <div className="consent-note" style={{ marginBottom: "0.875rem" }}>
              A reserva do ateliê central ainda não foi configurada.
            </div>
          )
        )}

        {/* "Apagar conta deste dispositivo" (Mudança #5a) — disfarçado de
            "Desfazer todos os pontos". Ação real de remoção da identidade
            Nostr persistida (nsec criptografado, hash do padrão, npub).
            Confirmação dupla para evitar perda acidental. Visualmente
            sutil (link/secondary) para não quebrar o disfarce crochê. */}
        {!confirmandoApagar ? (
          <div className="onboarding__footer-link" style={{ marginTop: "1.5rem" }}>
            <button
              type="button"
              onClick={() => setConfirmandoApagar(true)}
              style={{ color: "var(--text-muted, #888)", fontSize: "0.85rem" }}
            >
              Desfazer todos os pontos
            </button>
          </div>
        ) : (
          <div className="consent-note" style={{ marginTop: "1.5rem" }}>
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>Isso apaga seu ateliê deste aparelho.</strong> Você
              perde o Ponto Arakne guardado aqui e só volta a entrar com
              suas palavras do ateliê (recuperação social) num aparelho
              novo. Seus pontos no ateliê central não são apagados.
            </p>
            <p style={{ marginBottom: "0.75rem" }}>
              Tem certeza mesmo? Essa ação não tem volta.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn--secondary" onClick={() => setConfirmandoApagar(false)}>
                Cancelar
              </button>
              <button className="btn btn--primary" onClick={handleApagar}>
                Desfazer mesmo assim
              </button>
            </div>
          </div>
        )}
      </main>
      <BottomNav active="perfil" onNavigate={onNavigate} />
    </div>
  );
}
