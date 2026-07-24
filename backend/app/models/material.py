"""Material model — a single attached resource inside an Aula."""

from sqlalchemy import Column, Integer, String, ForeignKey

from app.models.base import Base


class Material(Base):
    __tablename__ = "materiais"

    id = Column(Integer, primary_key=True, index=True)
    aula_id = Column(Integer, ForeignKey("aulas.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False)  # "pdf" | "imagem" | "video"
    url = Column(String, nullable=False)
    titulo = Column(String, nullable=False, default="")
    ordem = Column(Integer, nullable=False, default=0)
    legenda = Column(String, nullable=True)

    # Campos opcionais para atribuição e metadados (Passo 2 do plano de trilhas).
    # Nullable para não quebrar materiais existentes no seed.
    licenca = Column(String, nullable=True)        # ex.: "CC-BY-SA 4.0", "CC0", "YouTube embed", "Proprietário Arakne"
    fonte = Column(String, nullable=True)          # autor/canal original (para atribuição CC-BY)
    duracao_seg = Column(Integer, nullable=True)   # duração em segundos (para vídeos)
    thumbnail_url = Column(String, nullable=True)  # URL da thumbnail (para vídeos, ex.: i.ytimg.com)

    def __repr__(self) -> str:
        return f"<Material id={self.id} aula={self.aula_id} tipo='{self.tipo}'>"
