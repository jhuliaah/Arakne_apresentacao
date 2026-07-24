"""Testes de integração das trilhas de aprendizagem.

Cobre os 3 endpoints do router /trilhas:
- GET  /trilhas (listagem + filtros + ordenação)
- GET  /trilhas/{id} (detalhe com níveis e aulas, regra de desbloqueio)
- POST /trilhas/aulas/{id}/concluir (auth, idempotência, nivel/trilha completo)

Educacional apenas — sem efeito colateral financeiro.
"""

from app.models.aula import Aula
from app.models.material import Material
from app.models.progresso_aula import ProgressoAula
from app.models.trilha import Trilha
from app.models.usuaria import Usuaria


# ── Helpers ─────────────────────────────────────────────────


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
    """Cria uma trilha com 3 níveis e a quantidade de aulas por nível dada.
    Cada aula ganha 1 material. Retorna a Trilha.
    """
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

    aula_id_counter = 1
    for nivel, qtd in enumerate(niveis_aulas, start=1):
        for ordem in range(1, qtd + 1):
            aula = Aula(
                trilha_id=trilha.id,
                nivel=nivel,
                ordem=ordem,
                titulo=f"Aula N{nivel}O{ordem}",
                descricao="Descrição",
            )
            db_session.add(aula)
            db_session.flush()
            mat = Material(
                aula_id=aula.id,
                tipo="pdf",
                url="https://example.com/file.pdf",
                titulo="Material PDF",
                ordem=1,
                legenda="legenda",
            )
            db_session.add(mat)
            aula_id_counter += 1

    db_session.commit()
    return trilha


# ── GET /trilhas ─────────────────────────────────────────────


def test_listar_trilhas_ordenado_por_ordem(client, db_session):
    """Regra: GET /trilhas retorna lista ordenada por ordem."""
    db_session.add_all([
        Trilha(titulo="B", tecnica="Crochê", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=3),
        Trilha(titulo="A", tecnica="Crochê", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=1),
        Trilha(titulo="C", tecnica="Crochê", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=2),
    ])
    db_session.commit()

    resp = client.get("/trilhas")
    assert resp.status_code == 200
    data = resp.json()
    titulos = [t["titulo"] for t in data]
    assert titulos == ["A", "C", "B"]
    # campos esperados presentes
    for t in data:
        assert set(t.keys()) >= {
            "id", "titulo", "tecnica", "estilo", "descricao",
            "emoji", "cor", "ordem", "total_aulas", "aulas_concluidas",
        }
        assert t["aulas_concluidas"] == 0  # anônimo


def test_listar_trilhas_filtro_tecnica_case_insensitive(client, db_session):
    """Regra: ?tecnica= filtra por match exato case-insensitive."""
    db_session.add_all([
        Trilha(titulo="T1", tecnica="Crochê", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=1),
        Trilha(titulo="T2", tecnica="Tecelagem", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=2),
    ])
    db_session.commit()

    resp = client.get("/trilhas", params={"tecnica": "crochê"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["titulo"] == "T1"


def test_listar_trilhas_filtro_estilo(client, db_session):
    """Regra: ?estilo= filtra por estilo."""
    db_session.add_all([
        Trilha(titulo="T1", tecnica="Crochê", estilo="Moderno", descricao="",
               emoji="", cor="", ordem=1),
        Trilha(titulo="T2", tecnica="Crochê", estilo="Tradicional", descricao="",
               emoji="", cor="", ordem=2),
    ])
    db_session.commit()

    resp = client.get("/trilhas", params={"estilo": "Tradicional"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["titulo"] == "T2"


def test_listar_trilhas_logada_conta_progresso(client, db_session):
    """Regra: logada, aulas_concluidas reflete progresso da usuária."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()

    # Concluir 1 aula do nível 1 diretamente no banco
    primeira_aula = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id, Aula.nivel == 1
    ).order_by(Aula.ordem).first()
    db_session.add(ProgressoAula(
        usuaria_id=usuaria.id,
        aula_id=primeira_aula.id,
        concluida=True,
    ))
    db_session.commit()

    resp = client.get("/trilhas", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["total_aulas"] == 6
    assert data[0]["aulas_concluidas"] == 1


# ── GET /trilhas/{id} ───────────────────────────────────────


def test_get_trilha_retorna_niveis_e_aulas(client, db_session):
    """Regra: GET /trilhas/{id} retorna trilha + niveis[] + aulas[]."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))

    resp = client.get(f"/trilhas/{trilha.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == trilha.id
    assert data["titulo"] == "Trilha Crochê Básico"
    assert len(data["niveis"]) == 3
    for idx, nivel in enumerate(data["niveis"]):
        assert nivel["nivel"] == idx + 1
        assert len(nivel["aulas"]) == 2
        for aula in nivel["aulas"]:
            assert "concluida" in aula
            assert aula["concluida"] is False  # anônimo
            assert len(aula["materiais"]) == 1
            assert aula["materiais"][0]["tipo"] == "pdf"


def test_get_trilha_nivel2_bloqueado_sem_concluir_nivel1(client, db_session):
    """Regra: nível 2 desbloqueado=false quando nível 1 não concluído."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))

    resp = client.get(f"/trilhas/{trilha.id}")
    data = resp.json()
    assert data["niveis"][0]["desbloqueado"] is True
    assert data["niveis"][1]["desbloqueado"] is False
    assert data["niveis"][2]["desbloqueado"] is False


def test_get_trilha_nivel2_desbloqueado_apos_concluir_nivel1(client, db_session):
    """Regra: nível 2 desbloqueado=true quando TODAS aulas do nível 1 concluídas."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()

    aulas_n1 = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id, Aula.nivel == 1
    ).all()
    for a in aulas_n1:
        db_session.add(ProgressoAula(
            usuaria_id=usuaria.id, aula_id=a.id, concluida=True,
        ))
    db_session.commit()

    resp = client.get(f"/trilhas/{trilha.id}", headers={
        "Authorization": f"Bearer {token}",
    })
    data = resp.json()
    assert data["niveis"][0]["desbloqueado"] is True
    assert data["niveis"][1]["desbloqueado"] is True
    assert data["niveis"][2]["desbloqueado"] is False
    # aulas do nível 1 marcadas concluídas
    for aula in data["niveis"][0]["aulas"]:
        assert aula["concluida"] is True


def test_get_trilha_inexistente_404(client, db_session):
    """Regra: trilha inexistente retorna 404."""
    resp = client.get("/trilhas/9999")
    assert resp.status_code == 404


# ── POST /trilhas/aulas/{id}/concluir ───────────────────────


def test_concluir_aula_sem_token_401(client, db_session):
    """Regra: POST sem Bearer → 401."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()

    resp = client.post(f"/trilhas/aulas/{aula.id}/concluir")
    assert resp.status_code == 401


def test_concluir_aula_com_token_200(client, db_session):
    """Regra: POST com token válido → 200, concluida=true."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")

    resp = client.post(
        f"/trilhas/aulas/{aula.id}/concluir",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["aula_id"] == aula.id
    assert data["concluida"] is True
    assert data["nivel_completo"] is False  # só 1 de 2 aulas do nível 1
    assert data["trilha_completa"] is False


def test_concluir_aula_idempotente(client, db_session):
    """Regra: chamar 2x não duplica registro, retorna 200."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = client.post(f"/trilhas/aulas/{aula.id}/concluir", headers=headers)
    r2 = client.post(f"/trilhas/aulas/{aula.id}/concluir", headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()

    # Apenas 1 registro no banco
    count = db_session.query(ProgressoAula).filter(
        ProgressoAula.usuaria_id == usuaria.id,
        ProgressoAula.aula_id == aula.id,
    ).count()
    assert count == 1


def test_concluir_aula_nivel_completo(client, db_session):
    """Regra: nivel_completo=true após concluir todas aulas do nível."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(2, 2, 2))
    aulas_n1 = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id, Aula.nivel == 1
    ).order_by(Aula.ordem).all()
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = client.post(f"/trilhas/aulas/{aulas_n1[0].id}/concluir", headers=headers)
    assert r1.json()["nivel_completo"] is False
    r2 = client.post(f"/trilhas/aulas/{aulas_n1[1].id}/concluir", headers=headers)
    assert r2.json()["nivel_completo"] is True
    assert r2.json()["trilha_completa"] is False


def test_concluir_aula_trilha_completa(client, db_session):
    """Regra: trilha_completa=true após concluir todas aulas da trilha."""
    trilha = _popular_trilha_completa(db_session, niveis_aulas=(1, 1, 1))
    aulas = db_session.query(Aula).filter(
        Aula.trilha_id == trilha.id
    ).order_by(Aula.nivel, Aula.ordem).all()
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    headers = {"Authorization": f"Bearer {token}"}

    for i, a in enumerate(aulas):
        r = client.post(f"/trilhas/aulas/{a.id}/concluir", headers=headers)
        assert r.status_code == 200
        if i < len(aulas) - 1:
            assert r.json()["trilha_completa"] is False
        else:
            assert r.json()["trilha_completa"] is True
            assert r.json()["nivel_completo"] is True


def test_concluir_aula_inexistente_404(client, db_session):
    """Regra: aula inexistente retorna 404 mesmo com token válido."""
    u = _criar_usuaria(client, "1234")
    token = _login(client, u["identificador"], "1234")
    resp = client.post(
        "/trilhas/aulas/9999/concluir",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_concluir_aula_nao_afeta_financeiro(client, db_session):
    """Regra: concluir aula não toca em tier/saldo_devedor/padroes_completos."""
    trilha = _popular_trilha_completa(db_session)
    aula = db_session.query(Aula).filter(Aula.trilha_id == trilha.id).first()
    u = _criar_usuaria(client, "1234")
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    tier_antes = usuaria.tier
    saldo_antes = usuaria.saldo_devedor
    padroes_antes = usuaria.padroes_completos
    token = _login(client, u["identificador"], "1234")

    client.post(
        f"/trilhas/aulas/{aula.id}/concluir",
        headers={"Authorization": f"Bearer {token}"},
    )
    db_session.refresh(usuaria)
    assert usuaria.tier == tier_antes
    assert usuaria.saldo_devedor == saldo_antes
    assert usuaria.padroes_completos == padroes_antes
