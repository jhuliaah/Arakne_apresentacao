"""ConversaoPool model — registro de cada conversão BRL→sats que credita o
fundo (pool) Lightning após um repagamento Pix confirmado.

Existe pra auditoria e reconciliação, não pra controle de fluxo: o
repagamento da usuária (PagamentoPix) já foi confirmado e a dívida dela já
foi abatida ANTES dessa conversão rodar — se a compra/saque na Binance
falhar (rede fora, saldo insuficiente, limite de saque, etc.), isso nunca
reverte o repagamento dela. Esta tabela é onde a gente rastreia se o
dinheiro de fato voltou pro fundo, pra reconciliar manualmente quando
`status` ficar em "falhou".
"""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class ConversaoPool(Base):
    __tablename__ = "conversoes_pool"

    id = Column(Integer, primary_key=True, index=True)
    pagamento_pix_id = Column(Integer, ForeignKey("pagamentos_pix.id"), nullable=False)

    valor_centavos_brl = Column(Integer, nullable=False)
    quantidade_btc = Column(Float, nullable=True)
    preco_medio_brl = Column(Float, nullable=True)
    binance_order_id = Column(String, nullable=True)
    binance_withdraw_id = Column(String, nullable=True)

    status = Column(String, default="pendente", nullable=False)  # pendente | concluida | falhou
    erro = Column(String, nullable=True)  # detalhe da falha, se status == "falhou"

    criado_em = Column(DateTime, server_default=func.now(), nullable=False)
    concluido_em = Column(DateTime, nullable=True)

    pagamento_pix = relationship("PagamentoPix", backref="conversao_pool")

    def __repr__(self) -> str:
        return (
            f"<ConversaoPool id={self.id} status='{self.status}' "
            f"quantidade_btc={self.quantidade_btc}>"
        )
