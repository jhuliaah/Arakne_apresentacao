"""AvalistaRecuperacao model — recovery contacts for Nostr-based social recovery.

Separate from the `Aval` model (which is for the financial risk engine and is
never shown in the UI). This table stores the M-of-N recovery avalistas for
each usuária: typically 3 slots (T=2, N=3), where some slots may be
"shadow" avalistas (auto-generated npub, nsec discarded) and one slot may be
the real convidadora.

The backend only stores the npub (public key). The frontend (standalone
Arakne app) is responsible for generating nsec/npub pairs and for implementing
NIP-17/59 + SSSS. The backend provides persistence and discovery only.
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Boolean,
    String,
    UniqueConstraint,
    func,
)

from app.models.base import Base


class AvalistaRecuperacao(Base):
    __tablename__ = "avalistas_recuperacao"

    __table_args__ = (
        UniqueConstraint("usuaria_id", "ordem", name="uq_avalista_recuperacao_slot"),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False, index=True)
    npub_avaliadora = Column(String, nullable=False)
    ordem = Column(Integer, nullable=False)  # slot 1, 2 or 3
    is_shadow = Column(Boolean, default=False, nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return (
            f"<AvalistaRecuperacao usuaria_id={self.usuaria_id} "
            f"ordem={self.ordem} shadow={self.is_shadow}>"
        )
