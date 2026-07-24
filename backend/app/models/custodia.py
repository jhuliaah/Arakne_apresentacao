"""CustodiaMultisig model — referência de leitura da reserva fria (seção 6
do doc mestre).

Isto é documentação estruturada, não um cofre: o backend nunca guarda chave
privada de steward aqui, e nenhuma rota deste app move fundos da reserva
fria. Só o descriptor público (quem são os signatários, quorum) e o
endereço, pra mostrar no pitch e pra rastrear rotação de chaves ao longo do
tempo — cada rotação vira uma nova linha, a anterior nunca é apagada.

Preenchido a partir da saída de scripts/gerar_multisig.py, manualmente ou
por um script de seed — não há endpoint de escrita, de propósito.
"""

from sqlalchemy import Boolean, Column, Integer, String, DateTime, func

from app.models.base import Base


class CustodiaMultisig(Base):
    __tablename__ = "custodia_multisig"

    id = Column(Integer, primary_key=True, index=True)
    descriptor = Column(String, nullable=False)  # ex.: wsh(sortedmulti(2,xpub.../0/*,...))
    endereco = Column(String, nullable=False)
    quorum = Column(String, nullable=False)  # ex.: "2-de-3"
    total_signatarios = Column(Integer, nullable=False)
    network = Column(String, nullable=False)  # regtest | testnet | signet | mainnet
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return (
            f"<CustodiaMultisig id={self.id} quorum='{self.quorum}' "
            f"network='{self.network}' ativo={self.ativo}>"
        )
