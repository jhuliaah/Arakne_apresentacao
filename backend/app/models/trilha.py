"""Trilha model — a learning track (educational, no financial coupling)."""

from sqlalchemy import Column, Integer, String

from app.models.base import Base


class Trilha(Base):
    __tablename__ = "trilhas"

    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, nullable=False)
    tecnica = Column(String, nullable=False)
    estilo = Column(String, nullable=False)
    descricao = Column(String, nullable=False, default="")
    emoji = Column(String, nullable=False, default="")
    cor = Column(String, nullable=False, default="")
    ordem = Column(Integer, nullable=False, default=0)

    def __repr__(self) -> str:
        return f"<Trilha id={self.id} titulo='{self.titulo}'>"
