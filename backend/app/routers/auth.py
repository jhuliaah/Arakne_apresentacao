"""Router for auth endpoints — POST /login."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import create_session, verify_pin
from app.database import get_db
from app.models.usuaria import Usuaria
from app.schemas.auth import LoginRequest, TokenResponse

router = APIRouter(tags=["auth"])


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login com identificador + PIN",
    description="Autentica uma usuária pelo identificador aleatório e PIN, retornando um token de sessão.",
)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db),
):
    usuaria = (
        db.query(Usuaria)
        .filter(Usuaria.identificador == payload.identificador)
        .first()
    )
    if not usuaria or not verify_pin(payload.pin, usuaria.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identificador ou PIN incorreto",
            headers={"WWW-Authenticate": "Bearer"},
        )

    sessao = create_session(db, usuaria.id)
    return TokenResponse(
        token=sessao.token,
        identificador=usuaria.identificador,
    )
