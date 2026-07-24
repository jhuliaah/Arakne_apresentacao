"""FastAPI application entry point for the Arakne backend."""

from sqlalchemy import inspect

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine
from app.models import (  # noqa: F401 — import so tables are registered
    Usuaria,
    Sessao,
    Padrao,
    ProgressoPadrao,
    Emprestimo,
    Aval,
    AvalistaRecuperacao,
    Troca,
    Trilha,
    Aula,
    Material,
    ProgressoAula,
    RecoveryShareBackup,
    PagamentoPix,
    CustodiaMultisig,
    ConversaoPool,
    TransacaoCarteira,
)
from app.routers import (
    avais,
    auth,
    carteira,
    custodia,
    emprestimos,
    health,
    pix,
    pontos_troca,
    trilhas,
    usuarias,
)


def _ensure_schema_up_to_date() -> None:
    """Dev/demo safety net: create_all() only creates *missing* tables, it
    never ALTERs an existing one. If a previous run left an arakne.db with an
    older schema (e.g. missing a column we later added), every insert on that
    table fails silently from the frontend's point of view ("não foi possível
    criar conta"). Since this is disposable demo data, we just detect drift
    and rebuild instead of leaving the app in a broken half-migrated state.
    """
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    if "usuarias" not in inspector.get_table_names():
        return

    existing_cols = {c["name"] for c in inspector.get_columns("usuarias")}
    expected_cols = {c.name for c in Usuaria.__table__.columns}
    if not expected_cols.issubset(existing_cols):
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)


_ensure_schema_up_to_date()

app = FastAPI(
    title="Arakne API",
    description="Backend API for Arakne — crochet learning + microcredit platform.",
    version="0.3.0",
)

# Dev/demo CORS: auth is Bearer-token based (no cookies), so there is no
# credential-leak risk in allowing any local origin — this avoids the app
# silently failing whenever the frontend is served from a different port
# than whatever was hardcoded here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(usuarias.router)
app.include_router(avais.router)
app.include_router(emprestimos.router)
app.include_router(pontos_troca.router)
app.include_router(trilhas.router)
app.include_router(pix.router)
app.include_router(carteira.router)
app.include_router(custodia.router)


@app.get("/")
def root():
    return {"app": "Arakne", "version": "0.3.0"}
