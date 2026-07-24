"""Pydantic schemas for the Usuaria entity."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UsuariaCreate(BaseModel):
    """Request body for POST /usuarias — only a PIN, no real identity."""

    pin: str = Field(
        ...,
        min_length=4,
        max_length=8,
        pattern=r"^\d{4,8}$",
        description="PIN escolhido pela usuária — 4 a 8 dígitos numéricos.",
    )
    codigo_indicacao: Optional[str] = Field(
        None,
        description="Código de indicação de outra usuária (opcional)",
    )
    npub: Optional[str] = Field(
        None,
        description="Chave pública Nostr (npub) da usuária — usada para "
        "recuperação social via Nostr. O frontend gera o par nsec/npub; "
        "o backend apenas recebe e guarda o npub.",
    )
    apelido: Optional[str] = Field(
        None,
        max_length=80,
        description="Apelido público da usuária (opcional, max 80 chars). "
        "Exibido em telas de vinculação de tecelãs em vez do npub truncado.",
    )
    pais: Optional[str] = Field(
        None,
        min_length=2,
        max_length=2,
        pattern=r"^[A-Z]{2}$",
        description="Código de país ISO 3166-1 alpha-2 (ex: \"BR\"). "
        "Opcional — usado para liberar/bloquear pagamentos Pix (off-ramp), "
        "que só faz sentido no Brasil.",
    )


class UsuariaResponse(BaseModel):
    """Response model — never exposes pin_hash, avalista_id, or internal id."""

    model_config = ConfigDict(from_attributes=True)

    identificador: str
    codigo_indicacao: str
    codigo_indicacao_usado: Optional[str]
    tier: int
    saldo_devedor: int
    tier_congelado: bool
    padroes_completos: int
    disponivel_como_ponto: bool
    trocas_como_ponto_concluidas: int
    criado_em: datetime
    npub: Optional[str] = None
    apelido: Optional[str] = None
    pais: Optional[str] = None


class NpubUpdate(BaseModel):
    """Request body for PATCH /usuarias/me/npub — atualiza o npub da usuária."""

    npub: str = Field(
        ...,
        min_length=10,
        description="Chave pública Nostr (npub1... ou hex de 64 chars) da "
        "usuária. Usado pela página de setup da demo para definir o npub "
        "da Fundadora após a geração do par nsec/npub no frontend.",
    )


class ApelidoUpdate(BaseModel):
    """Request body for PATCH /usuarias/me/apelido — atualiza o apelido."""

    apelido: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Novo apelido público da usuária (1 a 80 chars). "
        "Whitespace nas bordas é removido.",
    )

    @field_validator("apelido")
    @classmethod
    def _strip_apelido(cls, v: str) -> str:
        """Remove whitespace das bordas; rejeita string vazia após o strip."""
        v = v.strip()
        if not v:
            raise ValueError("apelido não pode ser vazio")
        return v


class PaisUpdate(BaseModel):
    """Request body for PATCH /usuarias/me/pais — atualiza o país.

    Usado pra liberar pagamentos Pix na carteira (routers/carteira.py),
    que só fazem sentido pra quem está no Brasil.
    """

    pais: str = Field(
        ...,
        min_length=2,
        max_length=2,
        pattern=r"^[A-Z]{2}$",
        description='Código de país ISO 3166-1 alpha-2 (ex: "BR").',
    )


class ConviteResponse(BaseModel):
    """Response for GET /usuarias/me/convite — invite link data."""

    codigo: str
    link: str
