"""RecoveryShareBackup model — backup do share SSSS criptografado com PIN.

Estratégia "Option E" (T=2, N=2) para recuperação social Nostr:
  - Share 0: enviado à convidadora via Nostr gift-wrap (frontend).
  - Share 1: criptografado pelo frontend com uma chave derivada do PIN da
    usuária (AES-GCM) e armazenado aqui como um blob opaco em base64.

O backend NUNCA vê o PIN, nunca descriptografa o blob e nunca participa da
criptografia Nostr. Como T=2, o backend sozinho não consegue reconstruir o
nsec — precisa do share da convidadora (via Nostr) + deste share (destravado
pelo PIN). Uma única linha por usuária (unique em usuaria_id).
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)

from app.models.base import Base


class RecoveryShareBackup(Base):
    __tablename__ = "recovery_share_backup"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(
        Integer,
        ForeignKey("usuarias.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Blob opaco em base64 produzido pelo frontend (AES-GCM com chave derivada
    # do PIN). O backend não interpreta nem descriptografa este conteúdo.
    encrypted_share_blob = Column(Text, nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<RecoveryShareBackup usuaria_id={self.usuaria_id}>"
