"""Testes do motor de risco — cobrem todas as regras de elegibilidade.

Cada teste tem um nome que descreve a regra que valida.
"""

import secrets

from app.models.usuaria import Usuaria
from app.services.risco import (
    ao_atrasar,
    ao_quitar,
    limite_por_tier,
    pode_avalizar,
    pode_emprestar,
)


# ── Helper ──────────────────────────────────────────────────

def _criar_usuaria(db, *, tier=0, **kwargs):
    """Cria e persiste uma Usuaria no banco de teste."""
    defaults = dict(
        identificador=secrets.token_urlsafe(10),
        pin_hash="$2b$12$fakehash",
        codigo_indicacao=secrets.token_urlsafe(8),
    )
    defaults.update(kwargs)
    u = Usuaria(tier=tier, **defaults)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ── Teste 1: Usuária nova sem aval não pode pegar tier 1 ──────

def test_usuaria_sem_aval_nao_pode_emprestar(db_session):
    """Regra: tier 0 sem aval recebido → não pode pegar empréstimo."""
    usuaria = _criar_usuaria(db_session, tier=0)

    assert pode_emprestar(usuaria) is False


# ── Teste 2: Aval recebido libera tier 1 sem padrões ─────────

def test_usuaria_com_aval_pode_emprestar_com_zero_padroes(db_session):
    """Regra: tier 1 liberado com 1 aval, mesmo com zero padrões completados."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(
        db_session, tier=1, avalista_id=avalista.id, padroes_completos=0
    )

    assert pode_emprestar(usuaria) is True


# ── Teste 3: Ao quitar, tier sobe e novo limite reflete ───────

def test_ao_quitar_tier_sobe_e_novo_limite_reflete_proximo_tier(db_session):
    """Regra: ao quitar tier 1, sobe para tier 2 com limite 15.000 sats."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(
        db_session, tier=1, avalista_id=avalista.id, saldo_devedor=5_000
    )

    ao_quitar(usuaria)
    db_session.commit()

    assert usuaria.tier == 2
    assert limite_por_tier(usuaria.tier) == 15_000
    assert usuaria.saldo_devedor == 0


# ── Teste 4: Atraso >14 dias congela usuária E avalista ──────

def test_atraso_maior_que_14_dias_congela_usuaria_e_avalista(db_session):
    """Regra: atraso >14 dias congela quem pegou o empréstimo E quem avalizou."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(db_session, tier=1, avalista_id=avalista.id)

    ao_atrasar(usuaria, dias_atraso=15)
    db_session.commit()

    assert usuaria.tier_congelado is True
    assert avalista.tier_congelado is True


# ── Teste 5: Avalista congelada bloqueia mesmo em dia ────────

def test_usuaria_com_avalista_congelada_nao_pode_emprestar_mesmo_em_dia(db_session):
    """Regra: avalista congelada bloqueia nova usuária, mesmo sem débito próprio."""
    avalista = _criar_usuaria(db_session, tier=3, tier_congelado=True)
    usuaria = _criar_usuaria(
        db_session,
        tier=1,
        avalista_id=avalista.id,
        tier_congelado=False,
        saldo_devedor=0,
    )

    assert pode_emprestar(usuaria) is False


# ── Edge cases ────────────────────────────────────────────────

def test_atraso_ate_14_dias_nao_congela(db_session):
    """Regra: atraso de exatamente 14 dias NÃO congela (limite exclusivo)."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(db_session, tier=1, avalista_id=avalista.id)

    ao_atrasar(usuaria, dias_atraso=14)
    db_session.commit()

    assert usuaria.tier_congelado is False
    assert avalista.tier_congelado is False


def test_ao_quitar_descongela_usuaria_e_avalista(db_session):
    """Regra: quitar regulariza — descongela usuária e avalista."""
    avalista = _criar_usuaria(db_session, tier=3, tier_congelado=True)
    usuaria = _criar_usuaria(
        db_session,
        tier=1,
        avalista_id=avalista.id,
        tier_congelado=True,
        saldo_devedor=5_000,
    )

    ao_quitar(usuaria)
    db_session.commit()

    assert usuaria.tier_congelado is False
    assert avalista.tier_congelado is False


def test_ao_quitar_tier_3_permanece_tier_3(db_session):
    """Regra: tier 3 é o máximo — quitar não sobe além de 3."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(
        db_session, tier=3, avalista_id=avalista.id, saldo_devedor=40_000
    )

    ao_quitar(usuaria)
    db_session.commit()

    assert usuaria.tier == 3
    assert limite_por_tier(usuaria.tier) == 40_000


def test_usuaria_com_saldo_devedor_nao_pode_emprestar(db_session):
    """Regra: não pode pegar novo empréstimo enquanto deve o anterior."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(
        db_session, tier=1, avalista_id=avalista.id, saldo_devedor=5_000
    )

    assert pode_emprestar(usuaria) is False


def test_usuaria_congelada_nao_pode_emprestar(db_session):
    """Regra: tier_congelado bloqueia novo empréstimo."""
    avalista = _criar_usuaria(db_session, tier=3)
    usuaria = _criar_usuaria(
        db_session, tier=1, avalista_id=avalista.id, tier_congelado=True
    )

    assert pode_emprestar(usuaria) is False


def test_pode_avalizar_exige_tier_3(db_session):
    """Regra: apenas tier 3+ pode gerar links de indicação."""
    u0 = _criar_usuaria(db_session, tier=0)
    u1 = _criar_usuaria(db_session, tier=1)
    u2 = _criar_usuaria(db_session, tier=2)
    u3 = _criar_usuaria(db_session, tier=3)

    assert pode_avalizar(u0) is False
    assert pode_avalizar(u1) is False
    assert pode_avalizar(u2) is False
    assert pode_avalizar(u3) is True
