"""Padrao model — crochet/texile patterns for the learning trail."""

from sqlalchemy import Column, Integer, String

from app.models.base import Base


class Padrao(Base):
    __tablename__ = "padroes"

    id = Column(Integer, primary_key=True, index=True)
    nivel = Column(Integer, nullable=False)
    nome_publico = Column(String, nullable=False)
    sats_desbloqueados = Column(Integer, default=0, nullable=False)

    def __repr__(self) -> str:
        return f"<Padrao id={self.id} nivel={self.nivel} nome='{self.nome_publico}'>"
