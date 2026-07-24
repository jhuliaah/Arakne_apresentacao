"""Pydantic schemas for the /carteira endpoints (off-ramp sats → BRL)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Cotação ─────────────────────────────────────────────────

class CotacaoResponse(BaseModel):
    """Cotação atual BTC/BRL — base pra toda conversão sats↔BRL."""

    btc_brl: float = Field(..., description="Preço de 1 BTC em BRL")
    atualizado_em: datetime = Field(..., description="Momento da consulta")


# ── Saldo ───────────────────────────────────────────────────

class SaldoResponse(BaseModel):
    """Saldo da carteira da usuária em sats e em BRL (convertido pela
    cotação atual)."""

    saldo_sats: int = Field(..., description="Saldo em sats na wallet LNbits")
    saldo_brl: float = Field(..., description="Saldo convertido pra BRL pela cotação atual")
    cotacao_btc_brl: float = Field(..., description="Cotação usada pra a conversão")


# ── Transações ──────────────────────────────────────────────

class TransacaoCarteiraResponse(BaseModel):
    """Uma linha do extrato da carteira."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    txid: Optional[str] = None
    tipo: str = Field(..., description="deposito | pagamento | conversao | saque")
    valor_sats: int = Field(..., description="Positivo pra entrada, negativo pra saída")
    valor_centavos_brl: Optional[int] = None
    cotacao_btc_brl: Optional[float] = None
    descricao: Optional[str] = None
    contraparte: Optional[str] = None
    status: str
    criado_em: datetime


# ── Depósito (gera cobrança Pix pra usuária pagar) ──────────

class DepositarRequest(BaseModel):
    """Body de POST /carteira/depositar — quanto a usuária quer depositar
    (via Pix) na própria carteira."""

    valor_centavos_brl: int = Field(
        ..., gt=0, description="Valor do depósito em centavos de BRL"
    )


class DepositarResponse(BaseModel):
    """Cobrança Pix gerada pra a usuária pagar — quando o webhook confirma,
    o saldo da carteira é creditado."""

    txid: str
    qr_code: str
    qr_code_base64: str
    ticket_url: str
    valor_centavos_brl: int
    status: str = "pendente"


# ── Pagamento (off-ramp carteira → comerciante via Pix) ─────

class PagarRequest(BaseModel):
    """Body de POST /carteira/pagar — envia Pix pra uma chave qualquer."""

    chave_pix: str = Field(
        ..., min_length=1, max_length=77, description="Chave Pix do comerciante"
    )
    valor_centavos_brl: int = Field(
        ..., gt=0, description="Valor do pagamento em centavos de BRL"
    )
    descricao: Optional[str] = Field(
        None, max_length=140, description="Descrição disfarçada (opcional)"
    )


class PagarResponse(BaseModel):
    """Confirmação do pagamento enviado."""

    id: int = Field(..., description="Id da TransacaoCarteira criada")
    status: str
    valor_centavos_brl: int
    valor_sats: int = Field(..., description="Sats debitados da carteira (negativo)")


# ── Quitação de empréstimo (atalho no router /carteira) ─────

class GerarQuitacaoRequest(BaseModel):
    """Body de POST /carteira/gerar-quitacao — gera cobrança Pix pra
    quitar (parte de) um empréstimo.

    Só pede `emprestimo_id` e `valor_sats` — o `valor_centavos_brl` da
    cobrança é calculado pela cotação atual (diferente do endpoint
    /pix/emprestimos/{id}/cobranca, que pede os dois valores). Isso faz
    sentido aqui porque a carteira já tem o conceito de cotação viva
    (GET /carteira/cotacao); o endpoint /pix é mais antigo e ainda
    segue o padrão "quem chama resolve a conversão".
    """

    emprestimo_id: int = Field(..., gt=0)
    valor_sats: int = Field(..., gt=0, description="Quanto abate do saldo devedor")


class GerarQuitacaoResponse(BaseModel):
    """Cobrança Pix gerada pra quitação — mesma estrutura do endpoint
    /pix/emprestimos/{id}/cobranca, mas exposta no /carteira pra o frontend
    ter tudo num lugar só."""

    txid: str
    qr_code: str
    qr_code_base64: str
    ticket_url: str
    valor_sats: int
    valor_centavos_brl: int
    status: str = "pendente"


# ── Verificação de depósito (polling sem webhook) ──────────

class VerificarDepositoResponse(BaseModel):
    """Resultado da verificação de status de uma transação de carteira
    consultando o Mercado Pago diretamente. Permite ao frontend confirmar
    depósitos via polling, sem depender do webhook (que pode falhar se o
    túnel cloudflared estiver fora do ar)."""

    txid: str
    status: str = Field(..., description="Status atual: pendente | concluida | falhou")
    status_mp: str | None = Field(
        None, description="Status retornado pelo Mercado Pago (approved, pending, etc.)"
    )
