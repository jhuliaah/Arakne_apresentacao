/** Main app — roteador simples por path + máquina de estados do onboarding.

  Routes:
    /                    → fluxo normal (splash num aparelho novo, desenho do
                           Ponto Arakne num aparelho que já tem conta)
    /convite/{codigo}    → mesmo fluxo, mas um aparelho novo vê uma tela de
                           aceitar/recusar o convite antes de criar a conta

  Onboarding (aparelho novo, sem identidade Nostr armazenada):
    splash → createAccount → recoverySetup → catalog
    (com convite:) inviteDecision → createAccount → recoverySetup → catalog

  A antiga BackupPage (que mostrava o mnemonic BIP-39) foi removida na
  Fase 5 — substituída pela RecoverySetupPage (Track 3C, Fase 3), que
  configura avalistas e distribui shares SSSS via NIP-59.

  Aparelho que já tem conta (identidade Nostr no localStorage):
    patternLogin (uma vez por aba) → catalog

  A camada financeira é revelada pela "aula 1 do nível 1" da trilha #9
  (Ponto Arakne): desenhar o padrão correto destrava a FinancialPage.
  Não há mais gesto de busca secreto na SearchBar.

  Fase 2 (integração Lane D): o fluxo de recuperação social ganhou três
  novas views:
    - recoveryHelpRequest: convidada sem PIN nem nsec pede ajuda a uma
      tecelã (disfarçado de "pedir aula de ponto"). Gera nsec efêmero e
      publica pedido NIP-59.
    - recoveryScanner: convidada escaneia o QR on-demand que a tecelã
      preparou (share 0 + ownerNpub).
    - recoveryCombine: convidada informa identificador + PIN para buscar
      a share 1 no backend; combina share 0 (QR) + share 1 (backend)
      via SSSS e reconstrói o nsec.
    - recoveryAdoptPattern: convidada desenha um NOVO Ponto Arakne para
      re-criptografar o nsec recuperado neste dispositivo.
    - recoveryQRGenerator: tecelã (logada) aceita um pedido do sino e
      gera o QR on-demand com a share 0 que tem em cache.

  O SSSS (Opção E, T=2 N=2) é MANTIDO — o QR on-demand é uma camada
  extra por cima, não substitui o fluxo NIP-59 existente.
*/


import { useEffect, useState } from "react";
import TrilhasPage from "./pages/TrilhasPage";
import TrilhaDetailPage from "./pages/TrilhaDetailPage";
import AulaPage from "./pages/AulaPage";
import DecoyPage from "./pages/DecoyPage";
import FinancialPage from "./pages/FinancialPage";
import ExtratoPage from "./pages/ExtratoPage";
import ComunidadePage from "./pages/ComunidadePage";
import MeusProjetosPage from "./pages/MeusProjetosPage";
import PerfilPage from "./pages/PerfilPage";
import ScannerQRPage from "./pages/ScannerQRPage";
import SemConexaoPage from "./pages/SemConexaoPage";
import InviteDecisionPage from "./pages/InviteDecisionPage";
import SplashPage from "./pages/onboarding/SplashPage";
import CreateAccountPage from "./pages/onboarding/CreateAccountPage";
import RecoverySetupPage from "./pages/onboarding/RecoverySetupPage";
import PatternLoginPage from "./pages/onboarding/PatternLoginPage";
import RecoverAccountPage from "./pages/onboarding/RecoverAccountPage";
import RecoveryHelpRequestPage from "./pages/onboarding/RecoveryHelpRequestPage";
import DemoSetupPage from "./pages/DemoSetupPage";
import CarteiraTransacaoPage, { type CarteiraModo } from "./pages/CarteiraTransacaoPage";
import RecoveryScanner from "./components/RecoveryScanner";
import RecoveryBell from "./components/RecoveryBell";
import RecoveryQRGenerator from "./components/RecoveryQRGenerator";
import HexPatternCanvas from "./components/HexPatternCanvas";
import Header from "./components/Header";
import type { NavTarget } from "./components/BottomNav";
import type { Aula } from "./types";
import {
  isUnlockedThisSession,
  markUnlockedThisSession,
  login,
  setToken,
  setPin as setStoredPin,
  setIdentificador as setStoredIdentificador,
  fetchRecoveryShare,
  getAvalistasRecuperacao,
  ensureToken,
} from "./api";
import {
  hasStoredIdentity,
  adoptRecoveredIdentity,
  resetFailedAttempts,
} from "./lib/pattern-storage";
import { useRecoveryListener } from "./hooks/useRecoveryListener";
import { tryCombineShares, type RecoveryResponse } from "./lib/recovery-request";
import { decryptWithPin } from "./lib/pattern-crypto";
import type { IncomingRecoveryRequest } from "./lib/recovery-respond";

type View =
  | "loading"
  | "splash"
  | "inviteDecision"
  | "createAccount"
  | "recoverySetup"
  | "patternLogin"
  | "recoverAccount"
  | "recoveryHelpRequest"
  | "recoveryScanner"
  | "recoveryCombine"
  | "recoveryAdoptPattern"
  | "recoveryQRGenerator"
  | "demoSetup"
  | "catalog"
  | "trilhaDetail"
  | "aula"
  | "comunidade"
  | "projetos"
  | "perfil"
  | "financial"
  | "extrato"
  | "scannerQR"
  | "carteiraTransacao"
  | "decoy";

const NAV_TO_VIEW: Record<NavTarget, View> = {
  catalog: "catalog",
  comunidade: "comunidade",
  projetos: "projetos",
  perfil: "perfil",
};

/** Views que o botão "voltar" do navegador manda para o catálogo. */
const BACK_TO_CATALOG_VIEWS: View[] = [
  "financial",
  "extrato",
  "scannerQR",
  "carteiraTransacao",
  "decoy",
  "comunidade",
  "projetos",
  "perfil",
  "trilhaDetail",
  "aula",
];

function getInviteCodigo(): string | null {
  const match = window.location.pathname.match(/^\/convite\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** True se a URL atual é /demo-setup (página de setup da demo do júri). */
function isDemoSetupPath(): boolean {
  return window.location.pathname === "/demo-setup";
}

export default function App() {
  // Bootstrap síncrono: se a URL é /demo-setup, já nascemos no demoSetup —
  // evita piscar a tela de onboarding (ou cair em patternLogin quando há
  // identidade armazenada) antes do useEffect corrigir.
  const [view, setView] = useState<View>(() =>
    isDemoSetupPath() ? "demoSetup" : "loading"
  );
  const [inviteCodigo] = useState<string | null>(getInviteCodigo());
  // Whether the person explicitly accepted the invite on the decision
  // screen — if false, CreateAccountPage gets no invite code at all.
  const [usarConvite, setUsarConvite] = useState(false);
  // Transient — only held in memory between "Criar conta" e a próxima
  // tela do onboarding. O npub (chave pública bech32) é o identificador
  // de backup; nunca é persistido. O nsec (chave privada bech32) só
  // existe em memória entre CreateAccountPage e RecoverySetupPage — ele
  // é necessário para assinar os seals NIP-59 das shares endereçadas
  // aos avalistas. NUNCA vai ao backend, NUNCA é persistido em plaintext.
  const [pendingNpub, setPendingNpub] = useState<string | null>(null);
  const [pendingNsec, setPendingNsec] = useState<string | null>(null);
  // PIN gerado em criarConta (CreateAccountPage/AulaPage) — passado à
  // RecoverySetupPage para criptografar a share 1 antes de enviar ao
  // backend (Opção E). A dona anota esse PIN como "código de reserva".
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  // Identidade destravada em memória após o PatternLogin. Guardamos o
  // nsec (bytes) e o padrão para iniciar o listener de recuperação
  // (Pendência 3: a usuária pode ser convidadora de outra dona e precisa
  // receber shards e responder pedidos enquanto a sessão estiver
  // ativa). Limpos no logout.
  const [unlockedNsec, setUnlockedNsec] = useState<Uint8Array | null>(null);
  const [unlockedPattern, setUnlockedPattern] = useState<number[] | null>(null);
  // Set when ScannerQRPage successfully reads a code — consumed once by
  // FinancialPage to pre-fill the troca form, then cleared.
  const [scannedIdentificador, setScannedIdentificador] = useState<string | null>(null);
  // Modo da tela de transação da cesta de novelos (entregar/receber/devolver).
  // Definido pelo FinancialPage antes de navegar para carteiraTransacao.
  const [carteiraModo, setCarteiraModo] = useState<CarteiraModo>("receber");
  // Trilha/aula navigation state for the learning trails.
  const [selectedTrilhaId, setSelectedTrilhaId] = useState<number | null>(null);
  const [selectedAula, setSelectedAula] = useState<Aula | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  // ── Estado do fluxo de recuperação social (Fase 2) ──────────
  // Convidada pede ajuda → RecoveryHelpRequestPage gera nsec efêmero
  // → RecoveryScanner escaneia QR da tecelã (share 0 + ownerNpub) →
  // RecoveryCombine pede identificador + PIN, busca share 1 no backend,
  // combina via SSSS → RecoveryAdoptPattern desenha novo Ponto Arakne
  // e adota o nsec recuperado.
  // share 0 + ownerNpub escaneados do QR da tecelã.
  const [recoveryShare0, setRecoveryShare0] = useState<Uint8Array | null>(null);
  const [recoveryOwnerNpub, setRecoveryOwnerNpub] = useState<string | null>(null);
  // nsec reconstruído após combine (guardado para o adopt pattern).
  const [recoveredNsec, setRecoveredNsec] = useState<Uint8Array | null>(null);
  // Pedido aceito pelo sino (RecoveryBell) → RecoveryQRGenerator.
  const [recoveryActiveRequest, setRecoveryActiveRequest] = useState<IncomingRecoveryRequest | null>(null);
  // Mapa npub → apelido para o RecoveryBell (populado sob demanda).
  const [apelidosMap, setApelidosMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Listener de recuperação (Pendência 3) ─────────────────
  // Roda em background enquanto a sessão está destravada. A usuária
  // pode ser convidadora de outra dona — o listener recebe shards
  // (distribuídas no onboarding da dona) e responde a pedidos de
  // recuperação automaticamente, usando o cache populado em
  // `loadSharesIntoCache` (dentro do hook). Os pedidos recebidos são
  // expostos para o sino (RecoveryBell) no Header.
  const recoveryListener = useRecoveryListener(
    unlockedNsec !== null,
    unlockedNsec,
    unlockedPattern,
  );

  // ── Popula mapa de apelidos para o sino (best-effort) ──────
  // Busca os avalistas de recuperação da usuária logada e constrói
  // um mapa npub → apelido. O RecoveryBell usa esse mapa para mostrar
  // o apelido das convidadas que pedem ajuda (em vez de npub truncado).
  // Se falhar (backend sem o campo apelido ainda), o sino faz fallback.
  useEffect(() => {
    if (!recoveryListener.isUnlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureToken();
        if (!token) return;
        const lista = await getAvalistasRecuperacao(token);
        if (cancelled || !lista) return;
        const mapa: Record<string, string> = {};
        for (const a of lista) {
          if (a.apelido) {
            mapa[a.npub_avaliadora] = a.apelido;
          }
        }
        if (!cancelled) setApelidosMap(mapa);
      } catch (err) {
        console.warn("[App] falha ao buscar apelidos para o sino:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recoveryListener.isUnlocked]);

  // ── Bootstrap: decide which screen to land on ──────────────
  // A identidade Nostr (nsec criptografado no localStorage) é a fonte de
  // verdade. Se existe, pede o desenho; senão, vai ao onboarding.
  // Exceção: /demo-setup sempre mostra a DemoSetupPage, independente de
  // identidade armazenada (a pessoa da demo pode rodar o setup várias vezes).
  //
  // BUG 1 (link de convite): se há `inviteCodigo` na URL, priorizamos a
  // `inviteDecision` — mesmo que já exista uma identidade armazenada neste
  // aparelho. Assim a 2ª visita a `/convite/FUNDADORA_INVITE` (com a 1ª
  // conta já criada) ainda abre a tela de convite, que oferece o botão
  // "Iniciar um novo projeto com este convite" (limpa a identidade atual
  // e segue para createAccount). Heurística:
  //   - inviteCodigo + sessão destravada → catalog (re-login normal)
  //   - inviteCodigo + sessão NÃO destravada → inviteDecision (permite
  //     criar nova conta ou entrar na conta existente)
  //   - sem inviteCodigo + identidade → patternLogin/catalog (fluxo normal)
  //   - sem inviteCodigo + sem identidade → splash
  useEffect(() => {
    if (isDemoSetupPath()) {
      setView("demoSetup");
      return;
    }
    if (inviteCodigo) {
      // Link de convite presente na URL. Se a sessão já está destravada
      // (re-login normal), vai direto ao catálogo. Caso contrário, mostra
      // a tela de convite — que oferece criar nova conta (limpando a
      // identidade atual) ou entrar na conta existente.
      setView(isUnlockedThisSession() ? "catalog" : "inviteDecision");
      return;
    }
    if (hasStoredIdentity()) {
      setView(isUnlockedThisSession() ? "catalog" : "patternLogin");
    } else {
      setView("splash");
    }
  }, [inviteCodigo]);

  // Handle browser back button — only meaningful once inside the app
  // (revealed screens return to the catalog; onboarding steps manage
  // their own back buttons instead).
  useEffect(() => {
    const handler = () => {
      setView((current) =>
        BACK_TO_CATALOG_VIEWS.includes(current) ? "catalog" : current
      );
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // ── Helper: slot do sino para o Header ──────────────────────
  // O Header com sino só aparece quando a usuária está logada E
  // destravada (isUnlocked). Fora disso, Header sem children.
  const bellSlot = recoveryListener.isUnlocked && recoveryListener.requests.length > 0 ? (
    <RecoveryBell
      requests={recoveryListener.requests}
      onHelp={(req) => {
        setRecoveryActiveRequest(req);
        setView("recoveryQRGenerator");
      }}
      apelidos={apelidosMap}
    />
  ) : undefined;

  if (view === "loading") {
    return null;
  }

  if (view === "demoSetup") {
    return (
      <DemoSetupPage
        onDone={() => setView("catalog")}
      />
    );
  }

  if (!isOnline) {
    return <SemConexaoPage />;
  }

  if (view === "splash") {
    return (
      <SplashPage
        onCreateAccount={() => setView("createAccount")}
        onHaveAccount={() => setView("patternLogin")}
        onRecuperar={() => setView("recoverAccount")}
      />
    );
  }

  if (view === "inviteDecision") {
    return (
      <InviteDecisionPage
        onAceitar={() => {
          setUsarConvite(true);
          setView("createAccount");
        }}
        onRecusar={() => {
          setUsarConvite(false);
          setView("createAccount");
        }}
        onEntrarExistente={() => setView("patternLogin")}
      />
    );
  }

  if (view === "createAccount") {
    return (
      <CreateAccountPage
        inviteCodigo={usarConvite ? inviteCodigo : null}
        onBack={() => setView(inviteCodigo ? "inviteDecision" : "splash")}
        onCreated={(npub, nsec, pin) => {
          setPendingNpub(npub);
          setPendingNsec(nsec);
          setPendingPin(pin);
          setView("recoverySetup");
        }}
      />
    );
  }

  if (view === "recoverySetup" && pendingNpub && pendingNsec && pendingPin) {
    return (
      <RecoverySetupPage
        npub={pendingNpub}
        nsec={pendingNsec}
        pin={pendingPin}
        onBack={() => setView("createAccount")}
        onDone={() => {
          setPendingNpub(null);
          setPendingNsec(null);
          setPendingPin(null);
          setView("catalog");
        }}
      />
    );
  }

  if (view === "patternLogin") {
    return (
      <PatternLoginPage
        onUnlocked={(nsec, pattern) => {
          setUnlockedNsec(nsec);
          setUnlockedPattern(pattern);
          setView("catalog");
        }}
        onCreateAccount={() => setView("createAccount")}
        onForgotPattern={() => setView("recoverAccount")}
        // Volta para a tela de origem: convite (se a usuária veio de um
        // link /convite/...) ou splash (caso contrário). Evita dead-end
        // quando a usuária chegou aqui por engano e quer voltar sem
        // desenhar o Ponto Arakne.
        onBack={() => setView(inviteCodigo ? "inviteDecision" : "splash")}
      />
    );
  }

  if (view === "recoverAccount") {
    return (
      <RecoverAccountPage
        onRecovered={() => setView("catalog")}
        onBack={() => setView("patternLogin")}
        onPedirAulaPonto={() => setView("recoveryHelpRequest")}
      />
    );
  }

  // ── Fluxo de recuperação social (Fase 2) ────────────────────

  if (view === "recoveryHelpRequest") {
    return (
      <RecoveryHelpRequestPage
        onAwaitScanner={(_ephemeralNsec) => {
          // O nsec efêmero é gerado pelo RecoveryHelpRequestPage para
          // publicar o pedido NIP-59. No fluxo atual (QR on-demand),
          // não precisamos dele no App.tsx — o RecoveryScanner só
          // escaneia o QR da tecelã. Mantemos o callback para futura
          // extensão (ex.: desembrulhar respostas NIP-59 pelo nsec
          // efêmero, se o QR falhar).
          setView("recoveryScanner");
        }}
        onBack={() => setView("recoverAccount")}
        // BUG 4: quando a conta não tem tecelãs de confiança vinculadas,
        // a tela de erro oferece "Ir ao meu ateliê" → FinancialPage,
        // onde a usuária pode vincular uma tecelã (seção "Tecelã de
        // confiança"). Antes, só havia "Tentar de novo" / "Voltar",
        // deixando a convidada sem caminho acionável.
        onGoToAtelie={() => setView("financial")}
      />
    );
  }

  if (view === "recoveryScanner") {
    return (
      <RecoveryScanner
        onScanned={({ share0, ownerNpub }) => {
          // Guarda a share 0 + ownerNpub escaneados e vai para a tela
          // de combine (pedir identificador + PIN, buscar share 1 no
          // backend, combinar via SSSS).
          setRecoveryShare0(share0);
          setRecoveryOwnerNpub(ownerNpub);
          setView("recoveryCombine");
        }}
        onBack={() => setView("splash")}
      />
    );
  }

  if (view === "recoveryCombine") {
    return (
      <RecoveryCombineView
        share0={recoveryShare0}
        ownerNpub={recoveryOwnerNpub}
        onSuccess={(nsec) => {
          setRecoveredNsec(nsec);
          setView("recoveryAdoptPattern");
        }}
        onCancel={() => setView("splash")}
      />
    );
  }

  if (view === "recoveryAdoptPattern") {
    return (
      <div className="page">
        <Header>{bellSlot}</Header>
        <main className="onboarding">
          <h1 className="onboarding__title">Aula: Ponto Renascido</h1>
          <p className="onboarding__tagline">
            Suas tecelãs reataram os fios. Agora aprenda um ponto novo para
            guardar seu ateliê — desenhe a coreografia abaixo.
          </p>
          <div style={{ width: "100%", maxWidth: "420px" }}>
            <HexPatternCanvas
              mode="register"
              onPatternConfirmed={async (newPattern) => {
                if (!recoveredNsec) return;
                try {
                  await adoptRecoveredIdentity(recoveredNsec, newPattern);
                  resetFailedAttempts();
                  markUnlockedThisSession();
                  // Limpa o estado transitório do fluxo de recuperação.
                  setRecoveredNsec(null);
                  setRecoveryShare0(null);
                  setRecoveryOwnerNpub(null);
                  setView("catalog");
                } catch (err) {
                  console.error("[App] adoptRecoveredIdentity falhou:", err);
                  setView("recoverAccount");
                }
              }}
              minLength={8}
            />
          </div>
        </main>
      </div>
    );
  }

  if (view === "recoveryQRGenerator" && recoveryActiveRequest) {
    return (
      <RecoveryQRGenerator
        request={recoveryActiveRequest}
        avalistaNsec={unlockedNsec}
        onBack={() => {
          // Descarta o pedido atendido e volta ao catálogo.
          if (recoveryActiveRequest) {
            recoveryListener.clearRequest(recoveryActiveRequest.initiatorNpub);
          }
          setRecoveryActiveRequest(null);
          setView("catalog");
        }}
      />
    );
  }

  if (view === "financial") {
    return (
      <FinancialPage
        onBack={() => setView("catalog")}
        onVerExtrato={() => setView("extrato")}
        onAbrirScanner={() => setView("scannerQR")}
        prefilledPontoIdentificador={scannedIdentificador}
        onPrefillConsumed={() => setScannedIdentificador(null)}
        onAbrirCarteira={(modo) => {
          setCarteiraModo(modo);
          setView("carteiraTransacao");
        }}
      />
    );
  }

  if (view === "carteiraTransacao") {
    return (
      <CarteiraTransacaoPage
        modo={carteiraModo}
        onBack={() => setView("financial")}
        onTransacaoConcluida={() => {
          // Apenas volta ao financial — o FinancialPage refresca o
          // saldo/tier no seu próprio loadData quando re-monta.
        }}
      />
    );
  }

  if (view === "extrato") {
    return <ExtratoPage onBack={() => setView("financial")} />;
  }

  if (view === "scannerQR") {
    return (
      <ScannerQRPage
        onBack={() => setView("financial")}
        onScanned={(identificador) => {
          setScannedIdentificador(identificador);
          setView("financial");
        }}
      />
    );
  }

  if (view === "decoy") {
    return <DecoyPage onBack={() => setView("catalog")} />;
  }

  if (view === "comunidade") {
    return <ComunidadePage onNavigate={(t) => setView(NAV_TO_VIEW[t])} />;
  }

  if (view === "projetos") {
    return (
      <MeusProjetosPage
        onBack={() => setView("catalog")}
        onAbrirTrilha={(id) => {
          setSelectedTrilhaId(id);
          setView("trilhaDetail");
        }}
        onVerTrilhas={() => setView("catalog")}
        onNavigate={(t) => setView(NAV_TO_VIEW[t])}
      />
    );
  }

  if (view === "perfil") {
    return (
      <PerfilPage
        onNavigate={(t) => setView(NAV_TO_VIEW[t])}
        onLoggedOut={() => {
          // "Sair" NÃO apaga a identidade (Mudança #5a): só desloga a
          // sessão (token do backend, nsec destravado em memória, cache
          // de shares em memória). A identidade Nostr persistida
          // (nsec criptografado, hash do padrão, npub) PERMANECE no
          // localStorage — a usuária volta a entrar desenhando o Ponto
          // Arakne. O PerfilPage já chama softLogout() + clearSharesCache()
          // + logout() internamente. O "Apagar conta" real (que chama
          // clearStoredIdentity) é um botão separado no PerfilPage e
          // também cai aqui — o onLoggedOut é o mesmo para ambos.
          setUnlockedNsec(null);
          setUnlockedPattern(null);
          setView("splash");
        }}
      />
    );
  }

  if (view === "trilhaDetail" && selectedTrilhaId !== null) {
    return (
      <TrilhaDetailPage
        trilhaId={selectedTrilhaId}
        onBack={() => setView("catalog")}
        onOpenAula={(aula) => {
          setSelectedAula(aula);
          setView("aula");
        }}
        onNavigate={(t) => setView(NAV_TO_VIEW[t])}
      />
    );
  }

  if (view === "aula" && selectedAula) {
    return (
      <AulaPage
        aula={selectedAula}
        onBack={() => setView("trilhaDetail")}
        onConcluida={() => setView("trilhaDetail")}
        onNavigate={(t) => setView(NAV_TO_VIEW[t])}
        onRevealFinancial={() => setView("financial")}
        onGoToRecoverySetup={(npub, nsec, pin) => {
          setPendingNpub(npub);
          setPendingNsec(nsec);
          setPendingPin(pin);
          setView("recoverySetup");
        }}
      />
    );
  }

  return (
    <TrilhasPage
      onRevealDecoy={() => setView("decoy")}
      onNavigate={(t) => setView(NAV_TO_VIEW[t])}
      onOpenTrilha={(id) => {
        setSelectedTrilhaId(id);
        setView("trilhaDetail");
      }}
      inviteCodigo={inviteCodigo}
    />
  );
}

// ── RecoveryCombineView (sub-componente inline) ───────────────
// Tela intermediária do fluxo de recuperação social: a convidada já
// escaneou a share 0 do QR da tecelã. Agora precisa informar
// identificador + PIN para buscar a share 1 no backend, combinar via
// SSSS e reconstruir o nsec. Implementada inline no App.tsx para não
// criar um arquivo novo (a Lane D pode refatorar para uma página
// própria depois, se quiser).
interface RecoveryCombineViewProps {
  share0: Uint8Array | null;
  ownerNpub: string | null;
  onSuccess: (nsec: Uint8Array) => void;
  onCancel: () => void;
}

function RecoveryCombineView({ share0, ownerNpub, onSuccess, onCancel }: RecoveryCombineViewProps) {
  const [identificador, setIdentificador] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCombine() {
    const id = identificador.trim();
    const pinTrim = pin.trim();
    if (!id || !pinTrim || !share0 || !ownerNpub) {
      setError("Informe o identificador e o código de reserva.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Login no backend com (identificador, pin) para obter token.
      const loginResp = await login(id, pinTrim);
      if (!loginResp) {
        setError("Código de reserva incorreto. Confira o identificador e o PIN.");
        setLoading(false);
        return;
      }
      setToken(loginResp.token);
      setStoredIdentificador(id);
      // P1 (auditoria item 9): setPin + token direto — mesmo fix do BUG 3
      // aplicado em recovery-request.ts. Sem setPin, ensureToken não consegue
      // re-logar se getMe falhar (race/latência) e quebra re-login futuro.
      setStoredPin(pinTrim);

      // 2. Busca a share 1 criptografada no backend (token direto evita
      //    round-trip getMe do ensureToken — ponto de falha do BUG 3).
      const blob = await fetchRecoveryShare(loginResp.token);
      if (!blob) {
        setError("Não encontramos seu fio no ateliê central. Confira o identificador.");
        setLoading(false);
        return;
      }

      // 3. Decripta a share 1 com o PIN.
      const share1 = await decryptWithPin(blob, pinTrim);
      if (!share1) {
        setError("Código de reserva incorreto para o fio do ateliê central.");
        setLoading(false);
        return;
      }

      // 4. Combina share 0 (QR) + share 1 (backend) via SSSS e valida
      //    o pubkey contra o ownerNpub escaneado do QR.
      const response: RecoveryResponse = {
        avalistaNpub: "qr-scanned",
        share: share0,
        vaultId: "",
      };
      const nsec = await tryCombineShares(share1, [response], ownerNpub);
      if (!nsec) {
        setError("Não conseguimos reatar seus fios. Confira se o PIN e o identificador estão corretos.");
        setLoading(false);
        return;
      }

      onSuccess(nsec);
    } catch (err) {
      console.error("[RecoveryCombineView] combine falhou:", err);
      setError("Não conseguimos reatar seus fios agora. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Header />
      <main className="onboarding">
        <button className="onboarding__back" onClick={onCancel}>
          ← Voltar
        </button>
        <h1 className="onboarding__title">Reatar seus fios</h1>
        <p className="onboarding__tagline">
          Sua tecelã compartilhou a amostra. Agora precisamos do seu
          identificador e do seu código de reserva para buscar o outro fio
          no ateliê central.
        </p>

        <div className="onboarding__form">
          <div className="field">
            <label className="field__label" htmlFor="rc-identificador">
              Identificador do seu ateliê
            </label>
            <input
              id="rc-identificador"
              className="field__input"
              type="text"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder="abc123_XyZ"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="rc-pin">
              Código de reserva (PIN)
            </label>
            <input
              id="rc-pin"
              className="field__input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4 dígitos"
              autoComplete="off"
              disabled={loading}
            />
          </div>

          {error && <p className="field__error">{error}</p>}

          <button
            className="btn btn--primary"
            onClick={handleCombine}
            disabled={loading || !identificador.trim() || !pin.trim()}
          >
            {loading ? "Reatando..." : "Reatar fios"}
          </button>
          <button
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={loading}
            style={{ marginTop: "0.5rem" }}
          >
            Cancelar
          </button>
        </div>
      </main>
    </div>
  );
}
