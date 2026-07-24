"""ProgressoPadrao model — tracks which patterns a user has completed."""

from sqlalchemy import Column, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class ProgressoPadrao(Base):
    __tablename__ = "progresso_padrao"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    padrao_id = Column(Integer, ForeignKey("padroes.id"), nullable=False)
    completo_em = Column(DateTime, server_default=func.now(), nullable=False)

    usuaria = relationship("Usuaria", backref="progressos")
    padrao = relationship("Padrao", backref="progressos")

    def __repr__(self) -> str:
        return (
            f"<ProgressoPadrao usuaria_id={self.usuaria_id} "
            f"padrao_id={self.padrao_id} completo_em={self.completo_em}>"
        )
