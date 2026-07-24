"""Usuaria model — the core user entity of Arakne.

No real identity fields (name, CPF, email) are stored. Each user is identified
by a random `identificador` string and authenticates with a hashed PIN.
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class Usuaria(Base):
    __tablename__ = "usuarias"

    id = Column(Integer, primary_key=True, index=True)
    identificador = Column(String, unique=True, index=True, nullable=False)
    pin_hash = Column(String, nullable=False)
    lnbits_wallet_key = Column(String, nullable=True)  # admin key for LNbits wallet
    codigo_indicacao = Column(String, unique=True, index=True, nullable=False)
    codigo_indicacao_usado = Column(String, nullable=True)
    tier = Column(Integer, default=0, nullable=False)
    saldo_devedor = Column(Integer, default=0, nullable=False)  # in sats
    tier_congelado = Column(Boolean, default=False, nullable=False)
    avalista_id = Column(Integer, ForeignKey("usuarias.id"), nullable=True)
    npub = Column(String, unique=True, index=True, nullable=True)
    apelido = Column(String, nullable=True)  # apelido público (max ~80 chars)
    pais = Column(String(2), nullable=True)  # ISO 3166-1 alpha-2 (ex: "BR"). Null = não informado.
    padroes_completos = Column(Integer, default=0, nullable=False)
    disponivel_como_ponto = Column(Boolean, default=False, nullable=False)
    trocas_como_ponto_concluidas = Column(Integer, default=0, nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    avalista = relationship(
        "Usuaria",
        remote_side=[id],
        backref="avalizados",
        foreign_keys=[avalista_id],
    )
    sessoes = relationship("Sessao", back_populates="usuaria", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Usuaria id={self.id} tier={self.tier} congelado={self.tier_congelado}>"
