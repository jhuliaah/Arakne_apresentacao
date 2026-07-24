"""Emprestimo model — a microcredit loan (disguised as 'kit de material')."""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class Emprestimo(Base):
    __tablename__ = "emprestimos"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    valor_sats = Column(Integer, nullable=False)
    invoice_id = Column(String, nullable=True)
    status = Column(String, default="pendente", nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)
    quitado_em = Column(DateTime, nullable=True)

    usuaria = relationship("Usuaria", backref="emprestimos")

    def __repr__(self) -> str:
        return (
            f"<Emprestimo id={self.id} usuaria_id={self.usuaria_id} "
            f"valor={self.valor_sats} status='{self.status}'>"
        )
