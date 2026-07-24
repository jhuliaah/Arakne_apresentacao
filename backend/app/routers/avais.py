"""Router for Aval endpoints — vouching between users.

The aval graph NEVER appears in the end-user interface.
This endpoint exists for the risk engine to function.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.aval import Aval
from app.models.usuaria import Usuaria
from app.schemas.aval import AvalCreate, AvalResponse
from app.services.risco import ao_receber_aval

router = APIRouter(prefix="/avais", tags=["avais"])


@router.post(
    "",
    response_model=AvalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Dar aval (uma usuária avalia outra)",
    description="Cria registro de Aval, define avalista_id na nova usuária, e sobe tier 0→1.",
)
def create_aval(payload: AvalCreate, db: Session = Depends(get_db)):
    avalista = (
        db.query(Usuaria)
        .filter(Usuaria.codigo_indicacao == payload.avalista_codigo_indicacao)
        .first()
    )
    if not avalista:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Avalista não encontrada",
        )

    nova = (
        db.query(Usuaria)
        .filter(Usuaria.identificador == payload.nova_usuaria_identificador)
        .first()
    )
    if not nova:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Usuária a ser avalizada não encontrada",
        )

    # Set the avalista on the new user
    nova.avalista_id = avalista.id

    # Create the Aval record
    aval = Aval(
        usuaria_que_avaliza_id=avalista.id,
        nova_usuaria_id=nova.id,
    )
    db.add(aval)

    # Bump tier 0 → 1 (received an aval)
    ao_receber_aval(nova)

    db.commit()
    db.refresh(aval)

    return AvalResponse(
        id=aval.id,
        usuaria_que_avaliza_id=aval.usuaria_que_avaliza_id,
        nova_usuaria_id=aval.nova_usuaria_id,
        criado_em=aval.criado_em,
    )
