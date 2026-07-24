/** TypeScript interfaces for the Arakne frontend. */

export interface Usuaria {
  identificador: string;
  codigo_indicacao: string;
  codigo_indicacao_usado: string | null;
  tier: number;
  saldo_devedor: number;
  tier_congelado: boolean;
  padroes_completos: number;
  disponivel_como_ponto: boolean;
  trocas_como_ponto_concluidas: number;
  criado_em: string;
  // País (ISO alpha-2, ex: "BR"). Null enquanto a usuária não informou.
  // Usado pela carteira para liberar pagamentos Pix (só "BR" por enquanto).
  pais?: string | null;
}

export interface PontoDeTroca {
  identificador: string;
  trocas_como_ponto_concluidas: number;
}

export interface Troca {
  id: number;
  valor_sats: number;
  status: string;
  criado_em: string;
  confirmada_em: string | null;
  papel: "solicitante" | "ponto";
  contraparte_identificador: string;
}

export interface Emprestimo {
  id: number;
  usuaria_id: number;
  valor_sats: number;
  invoice_id: string | null;
  status: string;
  criado_em: string;
  quitado_em: string | null;
  invoice_bolt11?: string;
}

export interface PagamentoResponse {
  emprestimo_id: number;
  valor_pago: number;
  saldo_devedor: number;
  quitado: boolean;
  tier: number;
}

export interface LoginResponse {
  token: string;
  token_type: string;
  identificador: string;
}

export interface Pattern {
  id: number;
  nome: string;
  nivel: string;
  cor: string;
  emoji: string;
  descricao: string;
}

// ── Trilhas de conhecimento (camada de disfarce) ───────────
// Educacional apenas — sem acoplamento financeiro.

export interface Material {
  id: number;
  aula_id: number;
  tipo: "pdf" | "imagem" | "video";
  url: string;
  titulo: string;
  ordem: number;
  legenda: string | null;
  // Campos opcionais para atribuição e metadados (Passo 2 do plano de trilhas).
  licenca?: string | null;
  fonte?: string | null;
  duracao_seg?: number | null;
  thumbnail_url?: string | null;
}

export interface Aula {
  id: number;
  trilha_id: number;
  nivel: number;
  ordem: number;
  titulo: string;
  descricao: string;
  concluida: boolean;
  materiais: Material[];
}

export interface Nivel {
  nivel: number;
  label: string;
  desbloqueado: boolean;
  aulas: Aula[];
}

export interface Trilha {
  id: number;
  titulo: string;
  tecnica: string;
  estilo: string;
  descricao: string;
  emoji: string;
  cor: string;
  ordem: number;
  total_aulas: number;
  aulas_concluidas: number;
}

export interface TrilhaDetail extends Trilha {
  niveis: Nivel[];
}

export interface ConcluirAulaResponse {
  aula_id: number;
  concluida: boolean;
  nivel_completo: boolean;
  trilha_completa: boolean;
}

// ── Inscrição/início de trilhas e aulas (BUG 3) ─────────────
// Educacional apenas — sem acoplamento financeiro.

/** Resposta de `POST /trilhas/{trilha_id}/inscrever` — cria
 *  ProgressoAula(concluida=False) para cada aula sem registro prévio.
 *  Idempotente: inscrever de novo retorna `ja_inscritas = total_aulas`. */
export interface InscreverTrilhaResponse {
  trilha_id: number;
  aulas_inscritas: number;
  ja_inscritas: number;
  total_aulas: number;
}

/** Resposta de `POST /trilhas/aulas/{aula_id}/iniciar` — cria
 *  ProgressoAula para uma aula específica. Idempotente. */
export interface IniciarAulaResponse {
  aula_id: number;
  iniciada_agora: boolean;
  concluida: boolean;
}

// ── Pix (Mercado Pago) e custódia multisig ─────────────────
// Repagamento via dinheiro bancário (fora do app) e reserva fria.

// Cobrança Pix gerada pelo backend (POST /pix/emprestimos/{id}/cobranca).
// Na UI aparece como "concluir o padrão" — nunca como fatura.
export interface CobrancaPix {
  txid: string;
  mp_payment_id: string | null;
  status: string; // "pendente" | "aprovado" | "expirado"
  qr_code: string; // copia-e-cola (linha Pix)
  qr_code_base64: string; // imagem QR em base64 (pode ser vazia em mock)
  ticket_url: string;
  valor_sats: number;
  valor_centavos_brl: number;
}

// Status de um pagamento Pix (GET /pix/pagamentos/{txid}).
// Consulta só o DB local — não chama o Mercado Pago.
export interface StatusPagamentoPix {
  id: number;
  emprestimo_id: number;
  txid: string;
  status: string; // "pendente" | "aprovado" | "expirado"
  valor_sats: number;
  valor_centavos_brl: number;
  criado_em: string;
  confirmado_em: string | null;
}

// Custódia multisig (GET /custodia/reserva-fria) — união de dois schemas
// do backend (CustodiaMultisigResponse | CustodiaMultisigVazia).
export interface CustodiaReservaFria {
  configurado: boolean;
  // Presentes só se configurado=true:
  descriptor?: string;
  endereco?: string;
  quorum?: string; // ex: "2-de-3"
  total_signatarios?: number;
  network?: string; // "regtest" | "testnet" | "signet" | "mainnet"
  criado_em?: string;
  // Presente só se configurado=false:
  mensagem?: string;
}

// ── Cesta de novelos (carteira) ────────────────────────────
// Carteira interna de sats com conversão BRL via cotação do backend.
// Na UI aparece como "Cesta de novelos" (saldo em novelos) — o vocabulário
// sats/BTC fica em texto pequeno, como detalhe técnico, nunca em destaque.
// Os endpoints /carteira/* são protegidos por Bearer (ensureToken).

/** Cotação BTC↔BRL (GET /carteira/cotacao). */
export interface CotacaoCarteira {
  btc_brl: number;
  atualizado_em: string;
}

/** Saldo da carteira da usuária logada (GET /carteira/saldo). */
export interface SaldoCarteira {
  saldo_sats: number;
  saldo_brl: number;
  cotacao_btc_brl: number;
}

/** Uma transação da carteira (GET /carteira/transacoes).
 *  valor_sats > 0 = entrada (depósito/quitação), < 0 = saída (pagamento). */
export interface TransacaoCarteira {
  id: number;
  tipo: "deposito" | "pagamento" | "conversao" | "saque";
  valor_sats: number;
  valor_centavos_brl: number | null;
  cotacao_btc_brl: number | null;
  descricao: string | null;
  contraparte: string | null;
  status: "pendente" | "concluida" | "falhou";
  criado_em: string;
}

/** Resposta de POST /carteira/depositar — gera QR Pix para a usuária
 *  escanear e depositar BRL que vira sats na carteira interna. */
export interface DepositarCarteiraResponse {
  txid: string;
  qr_code: string;
  qr_code_base64: string;
  ticket_url: string;
  valor_centavos_brl: number;
  status: string;
}

/** Resposta de POST /carteira/pagar — envia Pix para a chave do
 *  comerciante, debitando sats da carteira interna (com conversão). */
export interface PagarCarteiraResponse {
  id: number;
  status: string;
  valor_centavos_brl: number;
  valor_sats: number;
}

/** Resposta de POST /carteira/gerar-quitacao — gera QR Pix para a
 *  usuária pagar (em BRL) o abatimento de um empréstimo (novelos). */
export interface GerarQuitacaoResponse {
  txid: string;
  qr_code: string;
  qr_code_base64: string;
  ticket_url: string;
  valor_sats: number;
  valor_centavos_brl: number;
  status: string;
}
