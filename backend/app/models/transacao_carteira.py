"""TransacaoCarteira model — histórico de movimentações da carteira interna
da usuária (off-ramp sats → BRL via Pix).

Diferente de `PagamentoPix` (que é uma cobrança Pix *recebida* da usuária
pra repagar empréstimo), `TransacaoCarteira` é o ledger da carteira dela:
cada linha é uma entrada (depósito) ou saída (pagamento a comerciante,
conversão, saque). O `valor_sats` tem sinal — positivo pra entrada,
negativo pra saída — pra poder somar e obter o saldo num único reduce.

Disfarce: `descricao` carrega o texto que aparece no extrato disfarçado
(ex.: "material adquirido" em vez de "pagamento Pix enviado"). A camada
de disfarce é responsabilidade do frontend; aqui só guardamos o texto.
"""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class TransacaoCarteira(Base):
    __tablename__ = "transacoes_carteira"

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False)

    # Liga essa linha à cobrança Pix que a originou (quando aplicável, ex.:
    # depósito) — é isso que o webhook do Pix usa pra achar e confirmar
    # essa transação quando não existe um PagamentoPix correspondente
    # (PagamentoPix é só pra repagamento de empréstimo, ver docstring do
    # módulo). Nulo pra transações sem cobrança Pix própria (ex.: conversão
    # interna, saque).
    txid = Column(String, nullable=True, index=True)

    # "deposito" | "pagamento" | "conversao" | "saque"
    tipo = Column(String, nullable=False)
    # Positivo para entrada, negativo para saída — facilita sum(saldo).
    valor_sats = Column(Integer, nullable=False)
    # BRL envolvido (se aplicável) — em centavos, sem sinal.
    valor_centavos_brl = Column(Integer, nullable=True)
    # Cotação BTC/BRL no momento da transação (pra auditoria).
    cotacao_btc_brl = Column(Float, nullable=True)
    # Descrição disfarçada (ex.: "material adquirido").
    descricao = Column(String, nullable=True)
    # Contraparte: chave Pix do comerciante (em pagamento), ou null.
    contraparte = Column(String, nullable=True)
    # "pendente" | "concluida" | "falhou"
    status = Column(String, default="concluida", nullable=False)
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)

    usuaria = relationship("Usuaria", backref="transacoes_carteira")

    def __repr__(self) -> str:
        return (
            f"<TransacaoCarteira id={self.id} tipo='{self.tipo}' "
            f"valor_sats={self.valor_sats} status='{self.status}'>"
        )
