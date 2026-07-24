"""Testes dos endpoints de inscrição/início de trilhas.

Cobre:
- POST /trilhas/{id}/inscrever  → sucesso (201), 404, 401, idempotência
- GET  /trilhas/me              → só trilhas com progresso, vazio se nenhuma
- POST /trilhas/aulas/{id}/iniciar → sucesso (201), idempotente, 404, 401
- Interação com POST /trilhas/aulas/{id}/concluir (continua funcionando)

Educacional apenas — sem efeito colateral financeiro.
"""

from app.models.aula import Aula
from app.models.progresso_aula import ProgressoAula
from app.models.trilha import Trilha
from app.models.usuaria import Usuaria


# ── Helpers (espelham test_trilhas.py) ──────────────────────


def _criar_usuaria(client, pin="1234"):
    resp = client.post("/usuarias", json={"pin": pin})
    assert resp.status_code == 201
    return resp.json()


def _login(client, identificador, pin="1234"):
    resp = client.post(
        "/login",
        json={"identificador": identificador, "pin": pin},
    )
    assert resp.status_code == 200
    return resp.json()["token"]


def _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2)):
    """Cria uma trilha com 3 níveis e a quantidade de aulas por nível dada."""
    trilha = Trilha(
        titulo="Trilha Crochê Básico",
        tecnica="Crochê",
        estilo="Moderno",
        descricao="Aprenda crochê do zero",
        emoji="🧶",
        cor="#ff0000",
        ordem=1,
    )
    db_session.add(trilha)
    db_session.flush()

    for nivel, qtd in enumerate(niveis_aulas, start=1):
        for ordem in range(1, qtd + 1):
            db_session.add(Aula(
                trilha_id=trilha.id,
                nivel=nivel,
                ordem=ordem,
                titulo=f"Aula N{nivel}O{ordem}",
                descricao="Descrição",
            ))
    db_session.commit()
    return trilha


# ── POST /trilhas/{id}/inscrever ────────────────────────────


def test_inscrever_trilha_sem_token_401(client, db_session):
    """Regra: POST sem Bearer → 401."""
    trilha = _popular_trilha_completa(db_session)
    resp = client.post(f"/trilhas/{trilha.id}/inscrever")
    assert resp.status_code == 401


def test_inscrever_trilha_inexistente_404(client, db_session):
    """Regra: trilha inexistente → 404 mesmo com token válido."""
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    resp = client.post(
        "/trilhas/9999/inscrever",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_inscrever_trilha_sucesso_201(client, db_session):
    """Regra: inscrever cria ProgressoAula para todas as aulas, retorna 201."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")

    resp = client.post(
        f"/trilhas/{trilha.id}/inscrever",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["trilha_id"] == trilha.id
    assert data["total_aulas"] == 6
    assert data["aulas_inscritas"] == 6
    assert data["ja_inscritas"] == 0

    # 6 linhas criadas, todas concluida=False, inscrita_em preenchido
    progressos = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
    ).all()
    assert len(progressos) == 6
    for p in progressos:
        assert p.concluida is False
        assert p.concluida_em is None
        assert p.inscrita_em is not None


def test_inscrever_trilha_idempotente(client, db_session):
    """Regra: chamar 2x não duplica — 2ª chamada conta tudo em ja_inscritas."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(1, 1, 1))
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = client.post(f"/trilhas/{trilha.id}/inscrever", headers=headers)
    assert r1.status_code == 201
    assert r1.json()["aulas_inscritas"] == 3
    assert r1.json()["ja_inscritas"] == 0

    r2 = client.post(f"/trilhas/{trilha.id}/inscrever", headers=headers)
    assert r2.status_code == 201
    assert r2.json()["aulas_inscritas"] == 0
    assert r2.json()["ja_inscritas"] == 3
    assert r2.json()["total_aulas"] == 3

    # Ainda 3 linhas no banco
    count = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
    ).count()
    assert count == 3


def test_inscrever_trilha_nao_afeta_financeiro(client, db_session):
    """Regra: inscrever não toca em tier/saldo_devedor/padroes_completos."""
    trilha = _popular_trilha_completa(db_session)
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    tier_antes = usuaria.tier
    saldo_antes = usuaria.saldo_devedor
    padroes_antes = usuaria.padroes_completos
    token = _login(client, u["identificador"], "1234")

    client.post(
        f"/trilhas/{trilha.id}/inscrever",
        headers={"Authorization": f"Bearer {token}"},
    )
    db_session.refresh(usuaria)
    assert usuaria.tier == tier_antes
    assert usuaria.saldo_devedor == saldo_antes
    assert usuaria.padroes_completos == padroes_antes


# ── GET /trilhas/me ─────────────────────────────────────────


def test_minhas_trilhas_sem_token_401(client, db_session):
    """Regra: GET /trilhas/me requer Bearer → 401 sem token."""
    resp = client.get("/trilhas/me")
    assert resp.status_code == 401


def test_minhas_trilhas_vazio_quando_sem_progresso(client, db_session):
    """Regra: sem nenhum ProgressoAula → lista vazia."""
    _popular_trilha_completa(db_session)
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")

    resp = client.get("/trilhas/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_minhas_trilhas_retorna_so_trilhas_com_progresso(client, db_session):
    """Regra: só trilhas em que a usuária tem ProgressoAula aparecem."""
    t1 = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    t2 = Trilha(
        titulo="Outra Trilha", tecnica="Tecelagem", estilo="Tradicional",
        descricao="", emoji="", cor="", ordem=2,
    )
    db_session.add(t2)
    db_session.commit()

    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")

    # Inscrever só em t1
    resp = client.post(
        f"/trilhas/{t1.id}/inscrever",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201

    resp = client.get("/trilhas/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == t1.id
    assert data[0]["total_aulas"] == 6
    assert data[0]["aulas_concluidas"] == 0  # inscrita mas nenhuma concluída


def test_minhas_trilhas_reflete_conclusao(client, db_session):
    """Regra: aulas_concluidas em /trilhas/me reflete progresso real."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    # Inscrever e concluir 1 aula
    client.post(f"/trilhas/{trilha.id}/inscrever", headers=headers)
    primeira_aula = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id, Aula.nivel == 1
    ).order_by(Aula.ordem).first()
    client.post(f"/trilhas/aulas/{primeira_aula.id}/concluir", headers=headers)

    resp = client.get("/trilhas/me", headers=headers)
    data = resp.json()
    assert len(data) == 1
    assert data[0]["aulas_concluidas"] == 1
    assert data[0]["total_aulas"] == 6


# ── POST /trilhas/aulas/{id}/iniciar ────────────────────────


def test_iniciar_aula_sem_token_401(client, db_session):
    """Regra: POST sem Bearer → 401."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    resp = client.post(f"/trilhas/aulas/{aula.id}/iniciar")
    assert resp.status_code == 401


def test_iniciar_aula_inexistente_404(client, db_session):
    """Regra: aula inexistente → 404 mesmo com token."""
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    resp = client.post(
        "/trilhas/aulas/9999/iniciar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_iniciar_aula_sucesso_201(client, db_session):
    """Regra: iniciar cria ProgressoAula concluida=False + inscrita_em."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")

    resp = client.post(
        f"/trilhas/aulas/{aula.id}/iniciar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["aula_id"] == aula.id
    assert data["iniciada_agora"] is True
    assert data["concluida"] is False

    progresso = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
        ProgressoAula.aula_id == aula.id,
    ).one()
    assert progresso.concluida is False
    assert progresso.concluida_em is None
    assert progresso.inscrita_em is not None


def test_iniciar_aula_idempotente(client, db_session):
    """Regra: chamar 2x não duplica, 2ª retorna iniciada_agora=False."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = client.post(f"/trilhas/aulas/{aula.id}/iniciar", headers=headers)
    assert r1.status_code == 201
    assert r1.json()["iniciada_agora"] is True

    r2 = client.post(f"/trilhas/aulas/{aula.id}/iniciar", headers=headers)
    assert r2.status_code == 201
    assert r2.json()["iniciada_agora"] is False
    assert r2.json()["concluida"] is False

    count = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
        ProgressoAula.aula_id == aula.id,
    ).count()
    assert count == 1


# ── Interação com concluir_aula ─────────────────────────────


def test_inscrever_depois_concluir_funciona(client, db_session):
    """Regra: após inscrever, concluir_aula marca concluida=True na mesma linha."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(1, 1, 1))
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    # Inscrever nas 3 aulas
    client.post(f"/trilhas/{trilha.id}/inscrever", headers=headers)
    aulas = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id
    ).order_by(Aula.nivel, Aula.ordem).all()

    # Concluir todas
    for a in aulas:
        r = client.post(f"/trilhas/aulas/{a.id}/concluir", headers=headers)
        assert r.status_code == 200
        assert r.json()["concluida"] is True

    # Última conclusão fecha a trilha
    last = client.post(f"/trilhas/aulas/{aulas[-1].id}/concluir", headers=headers)
    assert last.json()["trilha_completa"] is True

    # Ainda 3 linhas (não duplicou), todas concluídas
    progressos = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
    ).all()
    assert len(progressos) == 3
    for p in progressos:
        assert p.concluida is True
        assert p.concluida_em is not None
        assert p.inscrita_em is not None  # veio do inscrever


def test_iniciar_depois_concluir_funciona(client, db_session):
    """Regra: após iniciar, concluir_aula marca concluida=True na mesma linha."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    client.post(f"/trilhas/aulas/{aula.id}/iniciar", headers=headers)
    r = client.post(f"/trilhas/aulas/{aula.id}/concluir", headers=headers)
    assert r.status_code == 200
    assert r.json()["concluida"] is True

    # 1 linha, concluída, inscrita_em preservado
    progresso = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
        ProgressoAula.aula_id == aula.id,
    ).one()
    assert progresso.concluida is True
    assert progresso.concluida_em is not None
    assert progresso.inscrita_em is not None


def test_concluir_sem_inscricao_cria_linha_sem_inscrita_em(client, db_session):
    """Regra: concluir_aula sem inscrever antes cria linha com inscrita_em=None."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")

    client.post(
        f"/trilhas/aulas/{aula.id}/concluir",
        headers={"Authorization": f"Bearer {token}"},
    )

    progresso = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
        ProgressoAula.aula_id == aula.id,
    ).one()
    assert progresso.concluida is True
    assert progresso.inscrita_em is None  # criado por concluir, sem inscrever
