"""Pydantic schemas para o backup do share SSSS criptografado com PIN.

Estratégia "Option E" (T=2, N=2): o frontend deriva uma chave AES-GCM a
partir do PIN da usuária, criptografa o share 1 e envia o blob opaco em
base64 para o backend persistir. O backend nunca vê o PIN nem o plaintext.

O modelo ORM chama a coluna ``encrypted_share_blob``; o schema expõe o
campo como ``share_blob`` (alias) para manter a API estável e simples.
"""

from datetime import datetime

from pydantic import AliasPath, BaseModel, ConfigDict, Field


class RecoveryShareBackupIn(BaseModel):
    """Payload de entrada: blob opaco em base64 produzido pelo frontend."""

    share_blob: str


class RecoveryShareBackupOut(BaseModel):
    """Resposta: o blob armazenado + metadados."""

    model_config = ConfigDict(from_attributes=True)

    usuaria_id: int
    share_blob: str = Field(validation_alias=AliasPath("encrypted_share_blob"))
    criado_em: datetime
