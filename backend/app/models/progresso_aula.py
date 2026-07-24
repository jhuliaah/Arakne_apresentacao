"""ProgressoAula model — per-user progress state of an Aula.

Educational only: no side effects on Padrao/ProgressoPadrao/tier/saldo.
UNIQUE(usuaria_id, aula_id) ensures idempotent completion/início.

Ciclo de vida do registro:
- `inscrita_em`  → timestamp de quando a usuária se inscreveu/iniciou a aula
                   (None quando a linha foi criada retroativamente por
                   `concluir_aula` sem passar por `inscrever`/`iniciar`).
- `concluida`    → False enquanto em andamento, True após `concluir_aula`.
- `concluida_em` → timestamp de conclusão (None enquanto não concluída).

Uma linha com `concluida=False` significa "em andamento"; `inscrita_em` é
metadata opcional. `concluir_aula` continua criando a linha (se não existir)
e marcando `concluida=True` + `concluida_em=now`.
"""

from sqlalchemy import (
    Column,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)

from app.models.base import Base


class ProgressoAula(Base):
    __tablename__ = "progresso_aulas"
    __table_args__ = (
        UniqueConstraint("usuaria_id", "aula_id", name="uq_progresso_usuaria_aula"),
    )

    id = Column(Integer, primary_key=True, index=True)
    usuaria_id = Column(Integer, ForeignKey("usuarias.id"), nullable=False, index=True)
    aula_id = Column(Integer, ForeignKey("aulas.id"), nullable=False, index=True)
    concluida = Column(Boolean, default=False, nullable=False)
    concluida_em = Column(DateTime, nullable=True)
    # Timestamp de inscrição/início da aula (None em registros criados
    # retroativamente por `concluir_aula`). Não afeta o fluxo existente.
    inscrita_em = Column(DateTime, nullable=True, default=None)

    def __repr__(self) -> str:
        return (
            f"<ProgressoAula usuaria={self.usuaria_id} "
            f"aula={self.aula_id} concluida={self.concluida}>"
        )
