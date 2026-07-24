"""Aval model — vouching relationships between users (never shown in UI)."""

from sqlalchemy import Column, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class Aval(Base):
    __tablename__ = "avais"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_que_avaliza_id = Column(
        Integer, ForeignKey("usuarias.id"), nullable=False
    )
    nova_usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    avalista = relationship(
        "Usuaria", foreign_keys=[usuaria_que_avaliza_id], backref="avais_dados"
    )
    avalizada = relationship(
        "Usuaria", foreign_keys=[nova_usuaria_id], backref="avais_recebidos"
    )

    def __repr__(self) -> str:
        return (
            f"<Aval avalista_id={self.usuaria_que_avaliza_id} "
            f"nova_id={self.nova_usuaria_id} criado_em={self.criado_em}>"
        )
