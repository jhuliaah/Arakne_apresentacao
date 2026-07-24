"""Pydantic schemas for the Emprestimo (microcredit loan) endpoints."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class EmprestimoResponse(BaseModel):
    """Standard response for any emprestimo endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuaria_id: int
    valor_sats: int
    invoice_id: Optional[str]
    status: str
    criado_em: datetime
    quitado_em: Optional[datetime]


class EmprestimoCreateResponse(EmprestimoResponse):
    """Response for POST /emprestimos — includes the bolt11 invoice."""

    invoice_bolt11: Optional[str] = None


class EmprestimoCreateRequest(BaseModel):
    """Body opcional para POST /emprestimos — valor solicitado em sats.

    Se omitido, solicita o limite disponível inteiro
    (`limite_por_tier(tier) - saldo_devedor`).
    """

    valor_sats: Optional[int] = Field(
        None, gt=0, description="Valor a solicitar em sats (default: limite disponível)"
    )


class PagamentoRequest(BaseModel):
    """Request body for POST /emprestimos/{id}/pagamento."""

    valor_sats: int = Field(..., gt=0, description="Valor a pagar em sats")


class PagamentoResponse(BaseModel):
    """Response for a payment — shows updated balance and tier."""

    emprestimo_id: int
    valor_pago: int
    saldo_devedor: int
    quitado: bool
    tier: int
