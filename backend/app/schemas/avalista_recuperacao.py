"""Pydantic schemas for the AvalistaRecuperacao entity.

These are used by the Nostr-based social recovery flow (Track 1A, Fase 1).
The backend only persists and exposes the npub of each recovery avalista;
the actual NIP-17/59 + SSSS logic lives in the frontend.

The backend stores pubkeys as 64-char hex (placeholder shadows are generated
with ``secrets.token_hex(32)``; the convidadora's npub is stored in whatever
format the frontend sent). On output, ``npub_avaliadora`` is normalized to
bech32 ``npub1...`` (NIP-19) so the frontend can pass it directly to
``wrapToRecipient`` without any conversion. See ``app/services/bech32.py``.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.bech32 import to_npub


class VincularMentorIn(BaseModel):
    """Corpo da requisição de POST /usuarias/me/avalistas-recuperacao.

    Permite que uma usuária vincule sua convidadora/tecelã de confiança como
    avalista de recuperação DEPOIS do cadastro (caso tenha se registrado sem
    convite, ou a convidadora não tivesse npub na época). O vínculo é feito
    via codigo_indicacao da mentora — mesma chave usada no onboarding.
    """

    codigo_indicacao: str = Field(
        ...,
        min_length=1,
        description="Código de convite da tecelã de confiança (convidadora) "
        "que será vinculada como avalista de recuperação.",
    )


class AvalistaRecuperacaoOut(BaseModel):
    """One recovery avalista slot for a usuária.

    ``npub_avaliadora`` is always returned as bech32 ``npub1...`` regardless
    of whether the stored value is hex or already bech32.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    usuaria_id: int
    npub_avaliadora: str
    apelido: Optional[str] = None
    ordem: int
    is_shadow: bool
    criado_em: datetime

    @field_validator("npub_avaliadora", mode="before")
    @classmethod
    def _normalize_npub(cls, v):
        """Convert stored hex pubkey to bech32 npub1... on output."""
        return to_npub(v)


class AvalistasRecuperacaoListResponse(BaseModel):
    """List of recovery avalistas for a usuária (M-of-N, typically N=3)."""

    avalistas: List[AvalistaRecuperacaoOut]


class NpubPublicoResponse(BaseModel):
    """Public npub of a usuária, lookup by identificador.

    npub is intentionally public — any device can discover it to send NIP-17
    recovery requests. No auth required. The npub is normalized to bech32
    ``npub1...`` on output.
    """

    identificador: str
    npub: Optional[str]

    @field_validator("npub", mode="before")
    @classmethod
    def _normalize_npub(cls, v):
        """Convert stored hex pubkey to bech32 npub1... on output."""
        return to_npub(v)
