"""Sessao model — opaque session tokens for pseudonymous auth."""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class Sessao(Base):
    __tablename__ = "sessoes"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    token = Column(String, unique=True, index=True, nullable=False)
    criada_em = Column(DateTime, server_default=func.now(), nullable=False)
    expira_em = Column(DateTime, nullable=True)  # null = never expires

    usuaria = relationship("Usuaria", back_populates="sessoes")

    def __repr__(self) -> str:
        return f"<Sessao usuaria_id={self.usuaria_id} criada_em={self.criada_em}>"
