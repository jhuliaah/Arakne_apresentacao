"""Aula model — a single lesson inside a Trilha, grouped by nivel."""

from sqlalchemy import Column, Integer, String, ForeignKey

from app.models.base import Base


class Aula(Base):
    __tablename__ = "aulas"

    id = Column(Integer, primary_key=True, index=True)
    trilha_id = Column(Integer, ForeignKey("trilhas.id"), nullable=False, index=True)
    nivel = Column(Integer, nullable=False, index=True)
    ordem = Column(Integer, nullable=False, default=0)
    titulo = Column(String, nullable=False)
    descricao = Column(String, nullable=False, default="")

    def __repr__(self) -> str:
        return f"<Aula id={self.id} trilha={self.trilha_id} nivel={self.nivel}>"
