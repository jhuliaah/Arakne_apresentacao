"""Router for Trilhas de conhecimento — learning tracks (educational only).

No financial side effects: this router never touches Padrao, ProgressoPadrao,
tier, or saldo_devedor. It only manages per-user lesson progress state in
the `progresso_aulas` table.

Endpoints (public for reads, Bearer for write):
- GET  /trilhas                            → list (optional filters: tecnica, estilo)
- GET  /trilhas/me                         → trilhas em que a usuária tem progresso
- GET  /trilhas/{trilha_id}                → detail with niveis[] and aulas[]
- POST /trilhas/{trilha_id}/inscrever      → inscrever em todas as aulas da trilha
- POST /trilhas/aulas/{aula_id}/iniciar    → iniciar uma aula específica
- POST /trilhas/aulas/{aula_id}/concluir   → mark lesson complete (idempotent)
"""

from datetime import UTC, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth import _naive_utc, get_current_usuaria
from app.database import get_db
from app.models.aula import Aula
from app.models.material import Material
from app.models.progresso_aula import ProgressoAula
from app.models.sessao import Sessao
from app.models.trilha import Trilha
from app.models.usuaria import Usuaria
from app.schemas.trilha import (
    AulaOut,
    ConcluirAulaResponse,
    IniciarAulaResponse,
    InscreverTrilhaResponse,
    MaterialOut,
    NivelOut,
    TrilhaDetailOut,
    TrilhaOut,
)

router = APIRouter(prefix="/trilhas", tags=["trilhas"])

# A *non-auto-erroring* bearer scheme so the GET endpoints can accept an
# optional token without FastAPI returning 401 when it's missing.
_optional_oauth2 = OAuth2PasswordBearer(tokenUrl="/login", auto_error=False)


async def _optional_current_usuaria(
    token: Optional[str] = Depends(_optional_oauth2),
    db: Session = Depends(get_db),
) -> Optional[Usuaria]:
    """Resolve the authenticated Usuaria if a valid Bearer token is present,
    otherwise return None. Used by the public GET endpoints so logged-in users
    see their progress while anonymous users see a virgin state.
    """
    if not token:
        return None
    sessao = db.query(Sessao).filter(Sessao.token == token).first()
    if not sessao:
        return None
    if sessao.expira_em and _naive_utc(sessao.expira_em) < _naive_utc(datetime.now(UTC)):
        return None
    return db.query(Usuaria).filter(Usuaria.id == sessao.usuaria_id).first()


# ── Helpers ─────────────────────────────────────────────────

_NIVEL_LABELS = {1: "Iniciante", 2: "Intermediário", 3: "Avançado"}


def _aulas_concluidas_ids(db: Session, usuaria_id: Optional[int]) -> set[int]:
    """Return the set of aula IDs the given usuária has completed.
    Empty when usuaria_id is None (anonymous).
    """
    if usuaria_id is None:
        return set()
    rows = (
        db.query(ProgressoAula.aula_id)
        .filter(ProgressoAula.usuaria_id == usuaria_id)
        .filter(ProgressoAula.concluida.is_(True))
        .all()
    )
    return {r[0] for r in rows}


def _build_trilha_out(
    trilha: Trilha,
    db: Session,
    concluidas: set[int],
) -> TrilhaOut:
    total_aulas = db.query(Aula).filter(Aula.trilha_id == trilha.id).count()
    aula_ids = {
        a[0]
        for a in db.query(Aula.id).filter(Aula.trilha_id == trilha.id).all()
    }
    aulas_concluidas = len(aula_ids & concluidas)
    return TrilhaOut(
        id=trilha.id,
        titulo=trilha.titulo,
        tecnica=trilha.tecnica,
        estilo=trilha.estilo,
        descricao=trilha.descricao,
        emoji=trilha.emoji,
        cor=trilha.cor,
        ordem=trilha.ordem,
        total_aulas=total_aulas,
        aulas_concluidas=aulas_concluidas,
    )


def _build_aula_out(
    aula: Aula,
    db: Session,
    concluidas: set[int],
) -> AulaOut:
    materiais = (
        db.query(Material)
        .filter(Material.aula_id == aula.id)
        .order_by(Material.ordem, Material.id)
        .all()
    )
    return AulaOut(
        id=aula.id,
        trilha_id=aula.trilha_id,
        nivel=aula.nivel,
        ordem=aula.ordem,
        titulo=aula.titulo,
        descricao=aula.descricao,
        concluida=aula.id in concluidas,
        materiais=[MaterialOut.model_validate(m) for m in materiais],
    )


def _build_niveis(
    trilha: Trilha,
    db: Session,
    concluidas: set[int],
) -> List[NivelOut]:
    """Build the 3-level structure with the unlock rule:
    nivel 1 always unlocked; nivel N (N>1) unlocked only if ALL aulas of
    nivel N-1 are concluded.
    """
    aulas = (
        db.query(Aula)
        .filter(Aula.trilha_id == trilha.id)
        .order_by(Aula.nivel, Aula.ordem, Aula.id)
        .all()
    )
    # group by nivel
    by_nivel: dict[int, List[Aula]] = {}
    for a in aulas:
        by_nivel.setdefault(a.nivel, []).append(a)

    niveis: List[NivelOut] = []
    niveis_sorted = sorted(by_nivel.keys())
    for idx, nivel_num in enumerate(niveis_sorted):
        if idx == 0:
            desbloqueado = True
        else:
            prev_nivel = niveis_sorted[idx - 1]
            prev_aulas = by_nivel[prev_nivel]
            desbloqueado = all(a.id in concluidas for a in prev_aulas)

        niveis.append(
            NivelOut(
                nivel=nivel_num,
                label=_NIVEL_LABELS.get(nivel_num, f"Nível {nivel_num}"),
                desbloqueado=desbloqueado,
                aulas=[_build_aula_out(a, db, concluidas) for a in by_nivel[nivel_num]],
            )
        )
    return niveis


# ── Endpoints ───────────────────────────────────────────────


@router.get(
    "",
    response_model=List[TrilhaOut],
    summary="Listar trilhas de aprendizagem",
    description=(
        "Lista todas as trilhas ordenadas por `ordem`. Filtros opcionais "
        "`tecnica` e `estilo` (case-insensitive, match exato). "
        "Público; se um Bearer token válido for enviado, `aulas_concluidas` "
        "reflete o progresso da usuária logada."
    ),
)
def listar_trilhas(
    tecnica: Optional[str] = Query(None, description="Filtro por técnica (case-insensitive)"),
    estilo: Optional[str] = Query(None, description="Filtro por estilo (case-insensitive)"),
    db: Session = Depends(get_db),
    usuaria: Optional[Usuaria] = Depends(_optional_current_usuaria),
):
    query = db.query(Trilha)
    if tecnica is not None:
        query = query.filter(Trilha.tecnica.ilike(tecnica))
    if estilo is not None:
        query = query.filter(Trilha.estilo.ilike(estilo))
    trilhas = query.order_by(Trilha.ordem, Trilha.id).all()

    concluidas = _aulas_concluidas_ids(db, usuaria.id if usuaria else None)
    return [_build_trilha_out(t, db, concluidas) for t in trilhas]


@router.get(
    "/me",
    response_model=List[TrilhaOut],
    summary="Minhas trilhas (em andamento/concluídas)",
    description=(
        "Retorna apenas as trilhas em que a usuária autenticada tem pelo "
        "menos um `ProgressoAula` (inscrita ou concluída). Requer Bearer. "
        "Ordenado por `ordem`. `aulas_concluidas` reflete o progresso real."
    ),
)
def listar_minhas_trilhas(
    db: Session = Depends(get_db),
    usuaria: Usuaria = Depends(get_current_usuaria),
):
    # IDs de trilhas onde a usuária tem ao menos 1 ProgressoAula.
    trilha_ids = {
        r[0]
        for r in db.query(Aula.trilha_id)
        .join(ProgressoAula, ProgressoAula.aula_id == Aula.id)
        .filter(ProgressoAula.usuaria_id == usuaria.id)
        .distinct()
        .all()
    }
    if not trilha_ids:
        return []

    trilhas = (
        db.query(Trilha)
        .filter(Trilha.id.in_(trilha_ids))
        .order_by(Trilha.ordem, Trilha.id)
        .all()
    )
    concluidas = _aulas_concluidas_ids(db, usuaria.id)
    return [_build_trilha_out(t, db, concluidas) for t in trilhas]


@router.get(
    "/{trilha_id}",
    response_model=TrilhaDetailOut,
    summary="Detalhes de uma trilha",
    description=(
        "Retorna a trilha com seus 3 níveis e respectivas aulas. "
        "`desbloqueado` do nível: nível 1 sempre true; nível N>1 só true se "
        "TODAS as aulas do nível N-1 estiverem concluídas. `concluida` da "
        "aula: false se deslogada; vem de ProgressoAula se logada."
    ),
)
def get_trilha(
    trilha_id: int,
    db: Session = Depends(get_db),
    usuaria: Optional[Usuaria] = Depends(_optional_current_usuaria),
):
    trilha = db.query(Trilha).filter(Trilha.id == trilha_id).first()
    if not trilha:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trilha não encontrada")

    concluidas = _aulas_concluidas_ids(db, usuaria.id if usuaria else None)
    base = _build_trilha_out(trilha, db, concluidas)
    niveis = _build_niveis(trilha, db, concluidas)
    return TrilhaDetailOut(
        **base.model_dump(),
        niveis=niveis,
    )


@router.post(
    "/aulas/{aula_id}/concluir",
    response_model=ConcluirAulaResponse,
    summary="Concluir uma aula",
    description=(
        "Marca a aula como concluída para a usuária logada. Idempotente: se "
        "já concluída, retorna 200 sem recriar registro. Retorna "
        "`nivel_completo` (todas as aulas daquele nível concluídas) e "
        "`trilha_completa` (todas as aulas da trilha concluídas). Sem efeito "
        "colateral financeiro."
    ),
)
def concluir_aula(
    aula_id: int,
    db: Session = Depends(get_db),
    usuaria: Usuaria = Depends(get_current_usuaria),
):
    aula = db.query(Aula).filter(Aula.id == aula_id).first()
    if not aula:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada")

    progresso = (
        db.query(ProgressoAula)
        .filter(
            ProgressoAula.usuaria_id == usuaria.id,
            ProgressoAula.aula_id == aula_id,
        )
        .first()
    )
    if progresso:
        # Idempotent: ensure flag is set, do not duplicate, do not error.
        if not progresso.concluida:
            progresso.concluida = True
            progresso.concluida_em = _naive_utc(datetime.now(UTC))
            db.commit()
    else:
        progresso = ProgressoAula(
            usuaria_id=usuaria.id,
            aula_id=aula_id,
            concluida=True,
            concluida_em=_naive_utc(datetime.now(UTC)),
        )
        db.add(progresso)
        db.commit()

    # Compute nivel_completo: all aulas of this aula's nivel concluded
    aulas_nivel = (
        db.query(Aula)
        .filter(Aula.trilha_id == aula.trilha_id, Aula.nivel == aula.nivel)
        .all()
    )
    aulas_nivel_ids = {a.id for a in aulas_nivel}
    concluidas_nivel = {
        r[0]
        for r in db.query(ProgressoAula.aula_id)
        .filter(
            ProgressoAula.usuaria_id == usuaria.id,
            ProgressoAula.aula_id.in_(aulas_nivel_ids),
            ProgressoAula.concluida.is_(True),
        )
        .all()
    }
    nivel_completo = aulas_nivel_ids.issubset(concluidas_nivel)

    # Compute trilha_completa: all aulas of the trilha concluded
    aulas_trilha = {
        a[0]
        for a in db.query(Aula.id)
        .filter(Aula.trilha_id == aula.trilha_id)
        .all()
    }
    concluidas_trilha = {
        r[0]
        for r in db.query(ProgressoAula.aula_id)
        .filter(
            ProgressoAula.usuaria_id == usuaria.id,
            ProgressoAula.aula_id.in_(aulas_trilha),
            ProgressoAula.concluida.is_(True),
        )
        .all()
    }
    trilha_completa = aulas_trilha.issubset(concluidas_trilha)

    return ConcluirAulaResponse(
        aula_id=aula_id,
        concluida=True,
        nivel_completo=nivel_completo,
        trilha_completa=trilha_completa,
    )


# ── Inscrição / início ──────────────────────────────────────


@router.post(
    "/{trilha_id}/inscrever",
    response_model=InscreverTrilhaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Inscrever em uma trilha",
    description=(
        "Cria um `ProgressoAula` com `concluida=False` + `inscrita_em=now` "
        "para cada aula da trilha em que a usuária ainda não tem registro. "
        "Idempotente: chamar de novo não duplica — apenas conta em "
        "`ja_inscritas`. Requer Bearer. Sem efeito colateral financeiro."
    ),
)
def inscrever_trilha(
    trilha_id: int,
    db: Session = Depends(get_db),
    usuaria: Usuaria = Depends(get_current_usuaria),
):
    trilha = db.query(Trilha).filter(Trilha.id == trilha_id).first()
    if not trilha:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trilha não encontrada")

    aulas = (
        db.query(Aula)
        .filter(Aula.trilha_id == trilha_id)
        .order_by(Aula.nivel, Aula.ordem, Aula.id)
        .all()
    )
    total_aulas = len(aulas)

    # IDs de aulas que já têm ProgressoAula para esta usuária nesta trilha.
    aulas_com_progresso = {
        r[0]
        for r in db.query(ProgressoAula.aula_id)
        .join(Aula, Aula.id == ProgressoAula.aula_id)
        .filter(
            ProgressoAula.usuaria_id == usuaria.id,
            Aula.trilha_id == trilha_id,
        )
        .all()
    }

    agora = _naive_utc(datetime.now(UTC))
    novas = 0
    for aula in aulas:
        if aula.id in aulas_com_progresso:
            continue
        db.add(ProgressoAula(
            usuaria_id=usuaria.id,
            aula_id=aula.id,
            concluida=False,
            inscrita_em=agora,
        ))
        novas += 1

    if novas:
        db.commit()

    return InscreverTrilhaResponse(
        trilha_id=trilha_id,
        aulas_inscritas=novas,
        ja_inscritas=total_aulas - novas,
        total_aulas=total_aulas,
    )


@router.post(
    "/aulas/{aula_id}/iniciar",
    response_model=IniciarAulaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Iniciar uma aula específica",
    description=(
        "Cria um `ProgressoAula` com `concluida=False` + `inscrita_em=now` "
        "para a aula, se ainda não existir. Idempotente: se já existe, "
        "retorna 201 com `iniciada_agora=false` (não duplica, não altera "
        "estado de conclusão). Útil para 'começar aula' sem inscrever na "
        "trilha toda. Requer Bearer. Sem efeito colateral financeiro."
    ),
)
def iniciar_aula(
    aula_id: int,
    db: Session = Depends(get_db),
    usuaria: Usuaria = Depends(get_current_usuaria),
):
    aula = db.query(Aula).filter(Aula.id == aula_id).first()
    if not aula:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada")

    progresso = (
        db.query(ProgressoAula)
        .filter(
            ProgressoAula.usuaria_id == usuaria.id,
            ProgressoAula.aula_id == aula_id,
        )
        .first()
    )
    if progresso:
        # Idempotente: não duplica, não sobrescreve concluida nem inscrita_em.
        return IniciarAulaResponse(
            aula_id=aula_id,
            iniciada_agora=False,
            concluida=bool(progresso.concluida),
        )

    db.add(ProgressoAula(
        usuaria_id=usuaria.id,
        aula_id=aula_id,
        concluida=False,
        inscrita_em=_naive_utc(datetime.now(UTC)),
    ))
    db.commit()

    return IniciarAulaResponse(
        aula_id=aula_id,
        iniciada_agora=True,
        concluida=False,
    )
