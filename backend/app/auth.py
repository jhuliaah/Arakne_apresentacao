"""Authentication utilities — pseudonymous, PIN-based.

No real identity (name, email, CPF) is ever stored. Each user is identified
by a random `identificador` string and authenticates with a bcrypt-hashed PIN.
Session tokens are opaque random strings stored in the `sessoes` table.
"""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.sessao import Sessao
from app.models.usuaria import Usuaria


def _naive_utc(dt: datetime) -> datetime:
    """Normalize a datetime to a timezone-naive UTC value.

    SQLite stores datetimes without timezone info, so values read back from
    the DB are naive. Comparing them with timezone-aware datetimes raises
    TypeError. This helper strips tzinfo (converting to UTC first if aware)
    so comparisons are always safe.
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

TOKEN_EXPIRY_DAYS = 30
IDENTIFICADOR_LENGTH = 10
CODIGO_INDICACAO_LENGTH = 8


# ── PIN hashing ────────────────────────────────────────────

def hash_pin(pin: str) -> str:
    """Hash a PIN with bcrypt."""
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, pin_hash: str) -> bool:
    """Verify a PIN against a stored bcrypt hash."""
    return bcrypt.checkpw(pin.encode("utf-8"), pin_hash.encode("utf-8"))


# ── Random identifier / referral code generation ────────────

def generate_identificador() -> str:
    """Generate a random URL-safe identifier (no personal data)."""
    return secrets.token_urlsafe(IDENTIFICADOR_LENGTH)


def generate_codigo_indicacao() -> str:
    """Generate a random referral code."""
    return secrets.token_urlsafe(CODIGO_INDICACAO_LENGTH)


# ── Session management ───────────────────────────────────────

def create_session(db: Session, usuaria_id: int) -> Sessao:
    """Create a new session token in the database."""
    token = secrets.token_urlsafe(32)
    expira_em = _naive_utc(datetime.now(UTC)) + timedelta(days=TOKEN_EXPIRY_DAYS)
    sessao = Sessao(
        usuaria_id=usuaria_id,
        token=token,
        expira_em=expira_em,
    )
    db.add(sessao)
    db.commit()
    db.refresh(sessao)
    return sessao


async def get_current_usuaria(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuaria:
    """FastAPI dependency that resolves the authenticated Usuaria from a Bearer token."""
    sessao: Optional[Sessao] = (
        db.query(Sessao).filter(Sessao.token == token).first()
    )
    if not sessao:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if sessao.expira_em and _naive_utc(sessao.expira_em) < _naive_utc(datetime.now(UTC)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    usuaria = (
        db.query(Usuaria).filter(Usuaria.id == sessao.usuaria_id).first()
    )
    if not usuaria:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuária não encontrada",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return usuaria
