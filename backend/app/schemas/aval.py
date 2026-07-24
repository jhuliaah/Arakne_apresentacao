"""Pydantic schemas for the Aval (vouching) endpoints."""

from datetime import datetime

from pydantic import BaseModel


class AvalCreate(BaseModel):
    """Request body for POST /avais — one user vouches for another.

    The avalista is identified by their shareable codigo_indicacao (not
    their private identificador), since invite links use codigo_indicacao.
    """

    avalista_codigo_indicacao: str
    nova_usuaria_identificador: str


class AvalResponse(BaseModel):
    """Response — note: never exposes the aval graph to the end user."""

    id: int
    usuaria_que_avaliza_id: int
    nova_usuaria_id: int
    criado_em: datetime
