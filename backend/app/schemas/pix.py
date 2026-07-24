"""Pydantic schemas for the Pix (Mercado Pago) endpoints."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CobrancaPixRequest(BaseModel):
    """Request body for POST /pix/emprestimos/{emprestimo_id}/cobranca.

    Os dois valores vêm de quem chama porque a denominação em moeda local
    (seção 9 do doc mestre) ainda não existe — não há cotação automática
    aqui. `valor_sats` é o quanto abate de `saldo_devedor`; `valor_centavos_brl`
    é o quanto a cobrança Pix vai pedir pra ela pagar.
    """

    valor_sats: int = Field(..., gt=0, description="Quanto abate do saldo devedor, em sats")
    valor_centavos_brl: int = Field(..., gt=0, description="Valor da cobrança Pix, em centavos de BRL")


class CobrancaPixResponse(BaseModel):
    """Response com o QR/copia-e-cola pra ela pagar."""

    txid: str
    mp_payment_id: Optional[str]
    status: str
    qr_code: str
    qr_code_base64: str
    ticket_url: str
    valor_sats: int
    valor_centavos_brl: int


class PagamentoPixResponse(BaseModel):
    """Status de uma cobrança Pix já criada."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    emprestimo_id: int
    txid: str
    status: str
    valor_sats: int
    valor_centavos_brl: int
    criado_em: datetime
    confirmado_em: Optional[datetime]


class WebhookPixResponse(BaseModel):
    """Resposta mínima pro Mercado Pago — só confirma recebimento (200 OK).

    Nunca deve vazar detalhe de negócio no corpo: o endpoint de webhook é
    público (o Mercado Pago não manda Bearer token da nossa sessão).
    """

    ok: bool = True
