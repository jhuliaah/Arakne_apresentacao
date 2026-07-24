"""Troca model — 'Ponto de Troca': redemption of sats for material via a
trusted peer acting as a liquidity node ("Fornecedora de Linha").

Real Lightning payment between two usuárias' own wallets — no new PSP
integration needed, reuses the same LNbits pattern already used for
empréstimos (create invoice on receiver's wallet, pay from sender's wallet).
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class Troca(Base):
    __tablename__ = "trocas"

    id = Column(Integer, primary_key=True, index=True)
    solicitante_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    ponto_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)
    valor_sats = Column(Integer, nullable=False)
    invoice_id = Column(String, nullable=True)
    status = Column(String, default="pendente", nullable=False)  # pendente | confirmada | recusada | falhou
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)
    confirmada_em = Column(DateTime, nullable=True)

    solicitante = relationship(
        "Usuaria", foreign_keys=[solicitante_id], backref="trocas_solicitadas"
    )
    ponto = relationship(
        "Usuaria", foreign_keys=[ponto_id], backref="trocas_recebidas"
    )

    def __repr__(self) -> str:
        return (
            f"<Troca id={self.id} solicitante_id={self.solicitante_id} "
            f"ponto_id={self.ponto_id} valor={self.valor_sats} status='{self.status}'>"
        )
