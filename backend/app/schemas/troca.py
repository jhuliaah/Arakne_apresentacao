"""Pydantic schemas for the 'Ponto de Troca' (liquidity node) feature."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DisponibilidadeRequest(BaseModel):
    """Body for toggling whether the current usuária offers herself as a Ponto de Troca."""

    disponivel: bool


class PontoDeTrocaResponse(BaseModel):
    """A liquidity node as shown to someone looking for one — no wallet key, no id."""

    model_config = ConfigDict(from_attributes=True)

    identificador: str
    trocas_como_ponto_concluidas: int


class TrocaCreateRequest(BaseModel):
    """Body for POST /trocas — request a redemption from a chosen Ponto de Troca."""

    ponto_identificador: str
    valor_sats: int = Field(..., gt=0, le=200_000)


class TrocaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    valor_sats: int
    status: str
    criado_em: datetime
    confirmada_em: Optional[datetime]
    papel: str  # "solicitante" | "ponto" — from the current user's point of view
    contraparte_identificador: str
