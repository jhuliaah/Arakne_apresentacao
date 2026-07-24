"""Pytest configuration — uses an in-memory SQLite database for tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (  # noqa: F401
    Usuaria,
    Sessao,
    Padrao,
    ProgressoPadrao,
    Emprestimo,
    Aval,
    AvalistaRecuperacao,
    TransacaoCarteira,
)


@pytest.fixture(autouse=True)
def mock_lnbits():
    """Ensure LNbits is in mock mode for all tests (no real Lightning node)."""
    from app.services.lnbits import lnbits

    lnbits._mock = True
    yield
    lnbits._mock = True


@pytest.fixture(autouse=True)
def mock_pix():
    """Ensure the Pix (Mercado Pago) client is in mock mode for all tests
    (no real PSP call), same pattern as mock_lnbits above."""
    from app.services.pix import pix

    pix._mock = True
    yield
    pix._mock = True


@pytest.fixture(autouse=True)
def mock_exchange():
    """Ensure the Binance client is in mock mode for all tests — envolve
    dinheiro real (compra + saque), então isso é ainda mais crítico que os
    outros mocks: nunca deve ser possível rodar a suite de testes e comprar
    Bitcoin de verdade sem querer."""
    from app.services.exchange import exchange

    exchange._mock = True
    yield
    exchange._mock = True


@pytest.fixture
def db_session():
    """Create a fresh in-memory database for each test."""
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=test_engine
    )
    Base.metadata.create_all(bind=test_engine)

    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client(db_session):
    """FastAPI TestClient with the test database injected."""
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
