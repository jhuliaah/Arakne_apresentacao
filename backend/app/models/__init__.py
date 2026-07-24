"""Import all models so SQLAlchemy registers them on the Base metadata."""

from app.models.base import Base  # noqa: F401
from app.models.usuaria import Usuaria  # noqa: F401
from app.models.sessao import Sessao  # noqa: F401
from app.models.padrao import Padrao  # noqa: F401
from app.models.progresso import ProgressoPadrao  # noqa: F401
from app.models.emprestimo import Emprestimo  # noqa: F401
from app.models.aval import Aval  # noqa: F401
from app.models.avalista_recuperacao import AvalistaRecuperacao  # noqa: F401
from app.models.troca import Troca  # noqa: F401
from app.models.trilha import Trilha  # noqa: F401
from app.models.aula import Aula  # noqa: F401
from app.models.material import Material  # noqa: F401
from app.models.progresso_aula import ProgressoAula  # noqa: F401
from app.models.recovery_share_backup import RecoveryShareBackup  # noqa: F401
from app.models.pagamento_pix import PagamentoPix  # noqa: F401
from app.models.custodia import CustodiaMultisig  # noqa: F401
from app.models.conversao_pool import ConversaoPool  # noqa: F401
from app.models.transacao_carteira import TransacaoCarteira  # noqa: F401

__all__ = [
    "Base",
    "Usuaria",
    "Sessao",
    "Padrao",
    "ProgressoPadrao",
    "Emprestimo",
    "Aval",
    "AvalistaRecuperacao",
    "Troca",
    "Trilha",
    "Aula",
    "Material",
    "ProgressoAula",
    "RecoveryShareBackup",
    "PagamentoPix",
    "CustodiaMultisig",
    "ConversaoPool",
    "TransacaoCarteira",
]
