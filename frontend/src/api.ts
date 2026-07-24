/** API client — all fetch calls to the Arakne backend go through here. */

import type { CobrancaPix, ConcluirAulaResponse, CotacaoCarteira, CustodiaReservaFria, DepositarCarteiraResponse, Emprestimo, GerarQuitacaoResponse, IniciarAulaResponse, InscreverTrilhaResponse, LoginResponse, PagarCarteiraResponse, PagamentoResponse, PontoDeTroca, SaldoCarteira, StatusPagamentoPix, TransacaoCarteira, Trilha, TrilhaDetail, Troca, Usuaria } from "./types";
import { getStoredNpub } from "./lib/pattern-storage";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

// Conversão demo sats → BRL (1 sat = R$0,0001; 10000 sats = R$1,00).
// Em produção, buscar cotação via API externa.
export const SATS_TO_BRL = 0.0001;

// Helper: converte sats para centavos de BRL (o backend espera centavos).
export function satsParaCentavosBrl(sats: number): number {
  return Math.round(sats * SATS_TO_BRL * 100);
}

// ── Storage helpers ──────────────────────────────────────────

const STORAGE_KEYS = {
  identificador: "arakne_identificador",
  pin: "arakne_pin",
  token: "arakne_token",
  emprestimos: "arakne_emprestimo_ids",
  pixTxids: "arakne_pix_txids",
  avalCodigos: "arakne_aval_codigos",
  onboardingDone: "arakne_onboarding_done",
  nickname: "arakne_nickname",
} as const;

const SESSION_UNLOCKED_KEY = "arakne_unlocked";

export function getNickname(): string | null {
  return localStorage.getItem(STORAGE_KEYS.nickname);
}

export function setNickname(nome: string): void {
  localStorage.setItem(STORAGE_KEYS.nickname, nome);
}

/** True se o PIN já foi confirmado nesta aba/sessão do navegador
 *  (sessionStorage é limpo ao fechar a aba — reabrir pede o PIN de novo). */
export function isUnlockedThisSession(): boolean {
  return sessionStorage.getItem(SESSION_UNLOCKED_KEY) === "1";
}

export function markUnlockedThisSession(): void {
  sessionStorage.setItem(SESSION_UNLOCKED_KEY, "1");
}

export function getIdentificador(): string | null {
  return localStorage.getItem(STORAGE_KEYS.identificador);
}

export function setIdentificador(id: string): void {
  localStorage.setItem(STORAGE_KEYS.identificador, id);
}

export function getPin(): string | null {
  return localStorage.getItem(STORAGE_KEYS.pin);
}

export function setPin(pin: string): void {
  localStorage.setItem(STORAGE_KEYS.pin, pin);
}

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.token);
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.token, token);
}

/** Limpa tudo do dispositivo — identificador, token, apelido, histórico
 *  local de fios/avais e a sessão desbloqueada. Não afeta a conta no
 *  backend; a usuária pode recuperar depois com a frase de segurança. */
export function logout(): void {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
}

export function getEmprestimoIds(): number[] {
  const raw = localStorage.getItem(STORAGE_KEYS.emprestimos);
  return raw ? JSON.parse(raw) as number[] : [];
}

export function addEmprestimoId(id: number): void {
  const ids = getEmprestimoIds();
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem(STORAGE_KEYS.emprestimos, JSON.stringify(ids));
  }
}

// ── Pix txids (rastreamento de repagamentos via Pix) ────────
// Mesmo padrão de arakne_emprestimo_ids: o backend não tem endpoint
// "listar pagamentos Pix por usuária", só GET /pix/pagamentos/{txid}.
// Rastreamos cada txid criado via criarCobrancaPix no localStorage e
// hidratamos a timeline do ExtratoPage com polling individual.

export function getPixTxids(): string[] {
  const raw = localStorage.getItem(STORAGE_KEYS.pixTxids);
  return raw ? JSON.parse(raw) as string[] : [];
}

export function addPixTxid(txid: string): void {
  const txids = getPixTxids();
  if (!txids.includes(txid)) {
    txids.push(txid);
    localStorage.setItem(STORAGE_KEYS.pixTxids, JSON.stringify(txids));
  }
}

export function isAvalCreated(codigo: string): boolean {
  const raw = localStorage.getItem(STORAGE_KEYS.avalCodigos);
  const codigos: string[] = raw ? JSON.parse(raw) : [];
  return codigos.includes(codigo);
}

export function markAvalCreated(codigo: string): void {
  const raw = localStorage.getItem(STORAGE_KEYS.avalCodigos);
  const codigos: string[] = raw ? JSON.parse(raw) : [];
  if (!codigos.includes(codigo)) {
    codigos.push(codigo);
    localStorage.setItem(STORAGE_KEYS.avalCodigos, JSON.stringify(codigos));
  }
}

// ── Random PIN generator ────────────────────────────────────

export function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// ── API calls ───────────────────────────────────────────────

export async function createUsuaria(
  pin: string,
  codigoIndicacao?: string,
  npub?: string,
  apelido?: string,
): Promise<Usuaria | null> {
  try {
    const body: Record<string, string> = { pin };
    if (codigoIndicacao) body.codigo_indicacao = codigoIndicacao;
    if (npub) body.npub = npub;
    if (apelido) body.apelido = apelido;
    const resp = await fetch(`${API_BASE}/usuarias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function createAval(avalistaCodigoIndicacao: string, novaIdentificador: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/avais`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avalista_codigo_indicacao: avalistaCodigoIndicacao,
        nova_usuaria_identificador: novaIdentificador,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function login(identificador: string, pin: string): Promise<LoginResponse | null> {
  try {
    const resp = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identificador, pin }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function getMe(token: string): Promise<Usuaria | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Atualiza o npub da usuária logada via PATCH /usuarias/me/npub.
 *  Usado pela página de setup da demo para definir o npub da Fundadora
 *  após a geração do par nsec/npub no frontend. */
export async function updateNpub(token: string, npub: string): Promise<Usuaria | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me/npub`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ npub }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Atualiza o apelido da usuária logada via PATCH /usuarias/me/apelido
 *  (Mudança #7-frontend). A Lane A adiciona o endpoint no backend.
 *  Retorna a usuária atualizada, ou null em falha. */
export async function updateApelido(token: string, apelido: string): Promise<Usuaria | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me/apelido`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ apelido }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Atualiza o país da usuária logada via PATCH /usuarias/me/pais.
 *  `pais` é ISO alpha-2 (ex: "BR"). Usado pela carteira para liberar
 *  pagamentos Pix (só "BR" por enquanto). Retorna a usuária atualizada,
 *  ou null em falha (ex.: endpoint ainda não existe no backend). */
export async function updatePais(token: string, pais: string): Promise<Usuaria | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me/pais`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pais }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function createEmprestimo(identificador: string): Promise<Emprestimo | null> {
  try {
    const resp = await fetch(`${API_BASE}/emprestimos/${identificador}`, {
      method: "POST",
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function pagarEmprestimo(id: number, valorSats: number): Promise<PagamentoResponse | null> {
  try {
    const resp = await fetch(`${API_BASE}/emprestimos/${id}/pagamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valor_sats: valorSats }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function getEmprestimo(id: number): Promise<Emprestimo | null> {
  try {
    const resp = await fetch(`${API_BASE}/emprestimos/${id}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Convite (invite link) ──────────────────────────────────

export interface ConviteResponse {
  codigo: string;
  link: string;
}

export async function getConvite(token: string): Promise<ConviteResponse | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me/convite`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Ponto de Troca ("Fornecedora de Linha") ──────────────────

export async function listarPontosDeTroca(token: string): Promise<PontoDeTroca[] | null> {
  try {
    const resp = await fetch(`${API_BASE}/pontos-de-troca`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Retorna null em erro de rede, ou {ok, disponivel?} — ok=false quando o
 *  backend recusou (ex.: tier insuficiente para se tornar um Ponto de Troca). */
export async function setDisponibilidadePonto(
  token: string,
  disponivel: boolean
): Promise<{ ok: boolean; disponivel?: boolean }> {
  try {
    const resp = await fetch(`${API_BASE}/pontos-de-troca/disponibilidade`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ disponivel }),
    });
    if (!resp.ok) return { ok: false };
    const data = await resp.json();
    return { ok: true, disponivel: data.disponivel };
  } catch {
    return { ok: false };
  }
}

export async function criarTroca(
  token: string,
  pontoIdentificador: string,
  valorSats: number
): Promise<Troca | null> {
  try {
    const resp = await fetch(`${API_BASE}/trocas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ponto_identificador: pontoIdentificador,
        valor_sats: valorSats,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function getMinhasTrocas(token: string): Promise<Troca[] | null> {
  try {
    const resp = await fetch(`${API_BASE}/trocas/minhas`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Tecelã confirma um pedido de troca recebido no ateliê dela.
 *  Endpoint: POST /trocas/{id}/confirmar (Bearer required).
 *  Lança Error com mensagem pronta para a UI em caso de falha. */
export async function confirmarTroca(token: string, trocaId: number): Promise<Troca> {
  const res = await fetch(`${API_BASE}/trocas/${trocaId}/confirmar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status} ao confirmar troca`);
  }
  return res.json();
}

/** Tecelã recusa um pedido de troca recebido no ateliê dela.
 *  Endpoint: POST /trocas/{id}/recusar (Bearer required).
 *  Lança Error com mensagem pronta para a UI em caso de falha. */
export async function recusarTroca(token: string, trocaId: number): Promise<Troca> {
  const res = await fetch(`${API_BASE}/trocas/${trocaId}/recusar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status} ao recusar troca`);
  }
  return res.json();
}

// ── Avalistas de recuperação (social backup via Nostr) ───────

/** Avalista de recuperação retornado pelo backend: cada uma das 3
 *  tecelãs de confiança que guardam um shard do nsec da dona. O campo
 *  `is_shadow` marca as tecelãs-sombra (placeholder com npub gerado
 *  automaticamente quando a dona não indicou ninguém).
 *
 *  `apelido` (Mudança #7-frontend) — apelido da tecelã, retornado pelo
 *  backend (Lane A) quando disponível. Pode ser null/ausente se a
 *  tecelã ainda não definiu apelido; a UI faz fallback para npub
 *  truncado. */
export interface AvalistaRecuperacao {
  id: number;
  usuaria_id: number;
  npub_avaliadora: string;
  ordem: number;
  is_shadow: boolean;
  criado_em: string;
  apelido?: string | null;
}

/** Busca os 3 avalistas de recuperação da usuária logada.
 *  Retorna null em erro de rede ou se o endpoint não existir ainda
 *  (Track 3B cuida do backend — o frontend já está pronto para
 *  consumir). */
export async function getAvalistasRecuperacao(
  token: string
): Promise<AvalistaRecuperacao[] | null> {
  try {
    const resp = await fetch(`${API_BASE}/usuarias/me/avalistas-recuperacao`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { avalistas: AvalistaRecuperacao[] };
    return data.avalistas;
  } catch {
    return null;
  }
}

/** Vincula uma tecelã de confiança (avalista de recuperação) usando o
 *  codigo_indicacao dela — fluxo "vincular depois" para usuárias que
 *  se cadastraram sem convite ou cuja convidadora não tinha npub na época.
 *  Endpoint: POST /usuarias/me/avalistas-recuperacao.
 *  Lança Error com mensagem pronta para a UI em caso de falha. */
export async function vincularMentorRecuperacao(
  codigoIndicacao: string
): Promise<void> {
  const token = await ensureToken();
  if (!token) {
    throw new Error("Não foi possível vincular a tecelã agora. Tente de novo.");
  }
  const res = await fetch(`${API_BASE}/usuarias/me/avalistas-recuperacao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ codigo_indicacao: codigoIndicacao }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status} ao vincular tecelã`);
  }
}

// ── Recuperação em novo dispositivo (sem auth, por identificador) ──

/** Armazena a share 1 (criptografada com PIN) no backend.
 *  Endpoint: POST /usuarias/me/recovery-share (auth required).
 *  Opção E: T=2 N=2 — o backend guarda 1 share, a convidadora guarda a outra.
 *  @returns true se o backend aceitou (201/200), false caso contrário. */
export async function uploadRecoveryShare(shareBlob: string): Promise<boolean> {
  try {
    const token = await ensureToken();
    if (!token) return false;
    const resp = await fetch(`${API_BASE}/usuarias/me/recovery-share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ share_blob: shareBlob }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Busca a share 1 (criptografada com PIN) do backend.
 *  Endpoint: GET /usuarias/me/recovery-share (auth required).
 *  Retorna o blob base64, ou null se não houver share armazenada (404) ou falhar.
 *
 *  `token` opcional: se o caller já fez login e tem o token em mãos
 *  (ex.: fluxo de recuperação em novo dispositivo), passe direto para
 *  evitar o round-trip `getMe` do `ensureToken` — esse round-trip pode
 *  falhar por race condition/latência e quebrar a recuperação mesmo com
 *  PIN correto (BUG 3). Se omitido, cai em `ensureToken` (comportamento
 *  histórico — usado por callers que já têm sessão estabelecida). */
export async function fetchRecoveryShare(token?: string): Promise<string | null> {
  try {
    const t = token ?? (await ensureToken());
    if (!t) return null;
    const resp = await fetch(`${API_BASE}/usuarias/me/recovery-share`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = (await resp.json()) as { share_blob: string };
    return data.share_blob;
  } catch {
    return null;
  }
}

/** Busca o npub público de uma usuária pelo identificador (sem auth).
 *
 *  Usado por um novo dispositivo que sabe apenas o identificador da conta
 *  para descobrir o npub da dona e iniciar a recuperação social (Track 4A).
 *  O npub é público por design (chave pública Nostr) — não requer token.
 *
 *  Endpoint: GET /usuarias/by-identificador/{id}/npub
 *  Resposta: { identificador: string, npub: string | null }
 *
 *  @param identificador - identificador opaco da conta da dona
 *  @returns npub bech32 (npub1...), ou null se não encontrado/erro de rede */
export async function getNpubByIdentificador(
  identificador: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${API_BASE}/usuarias/by-identificador/${encodeURIComponent(identificador)}/npub`,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { identificador: string; npub: string | null };
    return data.npub;
  } catch {
    return null;
  }
}

/** Busca os avalistas de recuperação de uma usuária pelo identificador (sem auth).
 *
 *  Usado por um novo dispositivo para descobrir para quais npubs enviar os
 *  pedidos NIP-59 de recuperação de shares SSSS (Track 4A). Não requer token
 *  — npub é público.
 *
 *  Endpoint: GET /usuarias/by-identificador/{id}/avalistas-recuperacao
 *  Resposta: { avalistas: AvalistaRecuperacao[] }
 *
 *  @param identificador - identificador opaco da conta da dona
 *  @returns array de avalistas (com npub_avaliadora em bech32), ou null se
 *    não encontrado/erro de rede */
export async function getAvalistasByIdentificador(
  identificador: string,
): Promise<AvalistaRecuperacao[] | null> {
  try {
    const resp = await fetch(
      `${API_BASE}/usuarias/by-identificador/${encodeURIComponent(identificador)}/avalistas-recuperacao`,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { avalistas: AvalistaRecuperacao[] };
    return data.avalistas;
  } catch {
    return null;
  }
}

// ── Composite helpers ───────────────────────────────────────

/** Ensure a token exists — login if needed. Returns token or null. */
export async function ensureToken(): Promise<string | null> {
  const existing = getToken();
  if (existing) {
    // Verify the token still works
    const me = await getMe(existing);
    if (me) return existing;
    // Token expired — clear and re-login
    localStorage.removeItem(STORAGE_KEYS.token);
  }

  const ident = getIdentificador();
  const pin = getPin();
  if (!ident || !pin) return null;

  const loginResp = await login(ident, pin);
  if (!loginResp) return null;

  setToken(loginResp.token);
  return loginResp.token;
}

/**
 * Fluxo de recuperação: recebe {identificador, pin} já decodificados da
 * frase de segurança, confirma com o backend via /login e, se válido,
 * adota essa conta neste dispositivo (útil tanto para "esqueci meu PIN"
 * quanto para restaurar a conta em um aparelho novo).
 */
export async function recuperarConta(
  identificador: string,
  pin: string
): Promise<boolean> {
  const resp = await login(identificador, pin);
  if (!resp) return false;
  setIdentificador(identificador);
  setToken(resp.token);
  localStorage.setItem(STORAGE_KEYS.onboardingDone, "1");
  return true;
}

/**
 * Cria a conta real (identificador + PIN aleatório interno, nunca mostrado
 * à usuária) e garante que ela nasça com um aval válido (tier 0 → 1):
 *  - se veio de um link de convite, quem convidou é a avalista;
 *  - caso contrário, criamos uma "avalista sombra" só para liberar o
 *    primeiro nível — invisível para a usuária, não aparece em lugar nenhum.
 *
 * Já faz login e guarda token + PIN internamente, para que o ensureToken
 * das telas financeiras funcione sem depender de um passo de "backup"
 * que faça login (o novo onboarding não tem esse passo).
 */
export async function criarConta(
  pin: string,
  inviteCodigo?: string | null,
  npub?: string,
  apelido?: string,
): Promise<Usuaria | null> {
  // Se o caller não passou npub explicitamente, tenta ler do localStorage
  // (a identidade Nostr já deve ter sido criada por createAndStoreIdentity).
  const npubFinal = npub ?? getStoredNpub() ?? undefined;
  const usuaria = await createUsuaria(pin, inviteCodigo ?? undefined, npubFinal, apelido);
  if (!usuaria) return null;

  setIdentificador(usuaria.identificador);
  setPin(pin);

  // Login imediato para obter token (mantém ensureToken funcionando).
  const loginResp = await login(usuaria.identificador, pin);
  if (loginResp) setToken(loginResp.token);

  // Se o backend não aceitou `apelido` no POST (schema antigo), tenta
  // novamente via PATCH /usuarias/me/apelido (best-effort — não falha
  // a criação da conta se o endpoint ainda não existir).
  if (apelido && loginResp) {
    await updateApelido(loginResp.token, apelido);
  }

  if (inviteCodigo) {
    markAvalCreated(inviteCodigo);
  } else if (!isAvalCreated("self")) {
    const shadowPin = generatePin();
    const shadow = await createUsuaria(shadowPin);
    if (shadow) {
      const ok = await createAval(shadow.codigo_indicacao, usuaria.identificador);
      if (ok) markAvalCreated("self");
    }
  }

  localStorage.setItem(STORAGE_KEYS.onboardingDone, "1");
  return usuaria;
}

// ── Trilhas de conhecimento (camada de disfarce) ──────────
// Educacional apenas — sem acoplamento financeiro.

export async function listarTrilhas(tecnica?: string, estilo?: string): Promise<Trilha[] | null> {
  try {
    const params = new URLSearchParams();
    if (tecnica) params.set("tecnica", tecnica);
    if (estilo) params.set("estilo", estilo);
    const qs = params.toString();
    // Envia o token (se houver) para que o backend retorne o progresso
    // da usuária logada — sem token, `aulas_concluidas` vem sempre 0.
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${API_BASE}/trilhas${qs ? "?" + qs : ""}`, { headers });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function getTrilha(id: number): Promise<TrilhaDetail | null> {
  try {
    // Envia o token (se houver) para que o backend retorne o progresso
    // da usuária logada (aulas concluídas + níveis desbloqueados). Sem
    // token, o backend trata como anônima e tudo aparece como não
    // concluído/trancado — o progresso salvo via `concluirAula` ficaria
    // invisível ao voltar para a TrilhaDetailPage.
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${API_BASE}/trilhas/${id}`, { headers });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function concluirAula(aulaId: number): Promise<ConcluirAulaResponse | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/trilhas/aulas/${aulaId}/concluir`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Inscreve a usuária logada em todas as aulas de uma trilha (BUG 3).
 *  Cria ProgressoAula(concluida=False) para cada aula sem registro prévio.
 *  Idempotente — inscrever de novo não duplica nem erro.
 *  Endpoint: POST /trilhas/{trilhaId}/inscrever (Bearer required). */
export async function inscreverTrilha(
  trilhaId: number,
): Promise<InscreverTrilhaResponse | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/trilhas/${trilhaId}/inscrever`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Lista as trilhas onde a usuária logada tem ≥1 ProgressoAula (inscrita
 *  ou concluída). Mesmo schema `TrilhaOut` do `GET /trilhas`.
 *  Endpoint: GET /trilhas/me (Bearer required). */
export async function listarMinhasTrilhas(): Promise<Trilha[] | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/trilhas/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Inicia uma aula específica (cria ProgressoAula para ela). Idempotente.
 *  Endpoint: POST /trilhas/aulas/{aulaId}/iniciar (Bearer required). */
export async function iniciarAula(
  aulaId: number,
): Promise<IniciarAulaResponse | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/trilhas/aulas/${aulaId}/iniciar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Pix (Mercado Pago) e custódia multisig ──────────────────
// Repagamento via dinheiro bancário (fora do app) e reserva fria.
// Os endpoints Pix/custódia são públicos (não exigem Bearer), mas
// passamos o token se houver — não custa, e o backend pode mudar.

/** Gera cobrança Pix para repagar (parte de) um empréstimo.
 *  Na UI aparece como "concluir o padrão" — nunca como fatura.
 *  Endpoint: POST /pix/emprestimos/{id}/cobranca.
 *  Após criar com sucesso, rastreia o txid no localStorage para
 *  alimentar a timeline do ExtratoPage (polling individual). */
export async function criarCobrancaPix(
  emprestimoId: number,
  valorSats: number,
  valorCentavosBrl: number
): Promise<CobrancaPix | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = localStorage.getItem("arakne_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(`${API_BASE}/pix/emprestimos/${emprestimoId}/cobranca`, {
      method: "POST",
      headers,
      body: JSON.stringify({ valor_sats: valorSats, valor_centavos_brl: valorCentavosBrl }),
    });
    if (!resp.ok) return null;
    const cobranca = await resp.json();
    // Rastreia o txid para a timeline do ExtratoPage.
    if (cobranca?.txid) addPixTxid(cobranca.txid);
    return cobranca;
  } catch {
    return null;
  }
}

/** Consulta status de uma cobrança Pix pelo txid (read-only no DB;
 *  não consulta o Mercado Pago). Útil como fallback de polling se o
 *  webhook não estiver configurado.
 *  Endpoint: GET /pix/pagamentos/{txid}. */
export async function getStatusPagamentoPix(txid: string): Promise<StatusPagamentoPix | null> {
  try {
    const resp = await fetch(`${API_BASE}/pix/pagamentos/${txid}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Busca o status de todos os txids Pix rastreados no localStorage
 *  (criados via criarCobrancaPix). Faz as chamadas em paralelo com
 *  Promise.all e ignora nulls (txid expirado/inválido/erro de rede).
 *  Usado pelo ExtratoPage para incluir repagamentos via Pix na timeline. */
export async function getTodosStatusPix(): Promise<StatusPagamentoPix[]> {
  const txids = getPixTxids();
  if (txids.length === 0) return [];
  const resultados = await Promise.all(
    txids.map((txid) => getStatusPagamentoPix(txid))
  );
  return resultados.filter((s): s is StatusPagamentoPix => s !== null);
}

/** Dados públicos da custódia multisig ativa (reserva fria).
 *  Nunca inclui chave privada — só descriptor/endereço para auditoria.
 *  Endpoint: GET /custodia/reserva-fria. */
export async function getCustodiaReservaFria(): Promise<CustodiaReservaFria | null> {
  try {
    const resp = await fetch(`${API_BASE}/custodia/reserva-fria`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Cesta de novelos (carteira) ────────────────────────────
// Carteira interna de sats com conversão BRL. Os endpoints /carteira/*
// exigem Bearer (ensureToken). Na UI aparece como "Cesta de novelos" — o
// vocabulário sats/BTC fica em texto pequeno, nunca em destaque.

/** Cotação BTC↔BRL (GET /carteira/cotacao). Público, sem Bearer. */
export async function getCotacaoCarteira(): Promise<CotacaoCarteira | null> {
  try {
    const resp = await fetch(`${API_BASE}/carteira/cotacao`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Saldo da carteira da usuária logada (GET /carteira/saldo). */
export async function getSaldoCarteira(): Promise<SaldoCarteira | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/carteira/saldo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Histórico de transações da carteira (GET /carteira/transacoes). */
export async function getTransacoesCarteira(): Promise<TransacaoCarteira[] | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/carteira/transacoes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Gera QR Pix para a usuária depositar BRL que vira sats na carteira
 *  interna (POST /carteira/depositar). */
export async function depositarCarteira(
  valorCentavosBrl: number
): Promise<DepositarCarteiraResponse | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/carteira/depositar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ valor_centavos_brl: valorCentavosBrl }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Envia Pix para a chave do comerciante, debitando sats da carteira
 *  interna (POST /carteira/pagar). Lança Error em 403 (país não
 *  suportado) para o frontend tratar com mensagem específica. */
export async function pagarCarteira(
  chavePix: string,
  valorCentavosBrl: number,
  descricao?: string
): Promise<PagarCarteiraResponse> {
  const token = await ensureToken();
  if (!token) {
    throw new Error("Não foi possível confirmar agora. Tente de novo.");
  }
  const res = await fetch(`${API_BASE}/carteira/pagar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chave_pix: chavePix,
      valor_centavos_brl: valorCentavosBrl,
      descricao: descricao ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status} ao pagar`);
  }
  return res.json();
}

/** Gera QR Pix para abater (quitar) parte de um empréstimo em BRL
 *  (POST /carteira/gerar-quitacao). O backend converte sats→BRL e
 *  gera a cobrança Pix; quando o pagamento é confirmado, o saldo
 *  devedor do empréstimo é reduzido. */
export async function gerarQuitacaoCarteira(
  emprestimoId: number,
  valorSats: number
): Promise<GerarQuitacaoResponse | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(`${API_BASE}/carteira/gerar-quitacao`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        emprestimo_id: emprestimoId,
        valor_sats: valorSats,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Verifica o status de um depósito consultando o Mercado Pago diretamente
 *  (POST /carteira/transacoes/{txid}/verificar). Polling ativo — não depende
 *  do webhook do Mercado Pago, que pode falhar se o túnel cloudflared estiver
 *  fora do ar. Atualiza o status no backend se o pagamento foi confirmado.
 *  Retorna {txid, status, status_mp} ou null em erro de rede. */
export async function verificarDepositoCarteira(
  txid: string
): Promise<{ txid: string; status: string; status_mp: string | null } | null> {
  try {
    const token = await ensureToken();
    if (!token) return null;
    const resp = await fetch(
      `${API_BASE}/carteira/transacoes/${encodeURIComponent(txid)}/verificar`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
