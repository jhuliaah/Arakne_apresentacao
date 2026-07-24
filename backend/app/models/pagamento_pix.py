"""PagamentoPix model — uma cobrança Pix dinâmica gerada pra repagar um
empréstimo (disfarçada como "padrão concluído" na UI).

Um `txid` por transação é o mecanismo de atribuição (ver services/pix.py e
seção 8 do doc mestre) — nunca guardamos identidade real de quem pagou.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.models.base import Base


class PagamentoPix(Base):
    __tablename__ = "pagamentos_pix"

    id = Column(Integer, primary_key=True, index=True)
    emprestimo_id = Column(Integer, ForeignKey("emprestimos.id"), nullable=False)
    txid = Column(String, unique=True, index=True, nullable=False)
    mp_payment_id = Column(String, nullable=True, index=True)

    # Denominação dupla: o kit é devido em sats (ledger interno) mas cobrado
    # em BRL via Pix. Enquanto a seção 9 (denominação em moeda local) não
    # estiver implementada, quem chama a API resolve a conversão e manda os
    # dois valores já calculados.
    valor_sats = Column(Integer, nullable=False)
    valor_centavos_brl = Column(Integer, nullable=False)

    status = Column(String, default="pendente", nullable=False)  # pendente | aprovado | expirado
    qr_code = Column(String, nullable=True)  # copia-e-cola
    criado_em = Column(DateTime, server_default=func.now(), nullable=False)
    confirmado_em = Column(DateTime, nullable=True)

    emprestimo = relationship("Emprestimo", backref="pagamentos_pix")

    def __repr__(self) -> str:
        return (
            f"<PagamentoPix id={self.id} txid='{self.txid}' "
            f"status='{self.status}' valor_sats={self.valor_sats}>"
        )
