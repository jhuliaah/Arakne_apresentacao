"""Testes de integração do fluxo de troca (Ponto de Troca) via API.

Cobre o fluxo de aprovação explícita: criar troca fica pendente, apenas a
fornecedora (Ponto de Troca) pode confirmar/recusar, e a solicitante não
pode confirmar a própria troca.
"""

from app.models.usuaria import Usuaria


# ── Helpers ──────────────────────────────────────────────────

def _criar_usuaria(client, pin="1234"):
    """Cria uma usuária via API e retorna o JSON de resposta."""
    resp = client.post("/usuarias", json={"pin": pin})
    assert resp.status_code == 201
    return resp.json()


def _login(client, identificador, pin):
    """Faz login e retorna o token de sessão."""
    resp = client.post("/login", json={
        "identificador": identificador,
        "pin": pin,
    })
    assert resp.status_code == 200
    return resp.json()["token"]


def _promover_e_ativar_ponto(db_session, identificador):
    """Promove a usuária para tier 1 e ativa como Ponto de Troca."""
    u = db_session.query(Usuaria).filter(
        Usuaria.identificador == identificador
    ).first()
    u.tier = 1
    u.disponivel_como_ponto = True
    db_session.commit()
    return u


def _criar_troca(client, token, ponto_identificador, valor_sats=1000):
    """Cria uma troca como solicitante autenticada."""
    resp = client.post("/trocas", json={
        "ponto_identificador": ponto_identificador,
        "valor_sats": valor_sats,
    }, headers={"Authorization": f"Bearer {token}"})
    return resp


# ── Testes ────────────────────────────────────────────────────

def test_criar_troca_fica_pendente(client, db_session):
    """Regra: ao solicitar uma troca, ela nasce 'pendente' e NÃO é confirmada
    automaticamente — a fornecedora precisa aprovar depois."""
    solicitante = _criar_usuaria(client, "1111")
    ponto = _criar_usuaria(client, "2222")
    _promover_e_ativar_ponto(db_session, ponto["identificador"])

    token_sol = _login(client, solicitante["identificador"], "1111")
    resp = _criar_troca(client, token_sol, ponto["identificador"])
    assert resp.status_code == 201
    troca = resp.json()
    assert troca["status"] == "pendente"
    assert troca["confirmada_em"] is None
    assert troca["papel"] == "solicitante"


def test_confirmar_troca_como_ponto(client, db_session):
    """Regra: a fornecedora (Ponto de Troca) confirma → status vira
    'confirmada', confirmada_em é setada e o contador de trocas concluídas
    do ponto é incrementado."""
    solicitante = _criar_usuaria(client, "1111")
    ponto = _criar_usuaria(client, "2222")
    ponto_obj = _promover_e_ativar_ponto(db_session, ponto["identificador"])
    trocas_antes = ponto_obj.trocas_como_ponto_concluidas

    token_sol = _login(client, solicitante["identificador"], "1111")
    token_ponto = _login(client, ponto["identificador"], "2222")

    resp = _criar_troca(client, token_sol, ponto["identificador"])
    troca_id = resp.json()["id"]

    # Ponto confirma
    resp = client.post(
        f"/trocas/{troca_id}/confirmar",
        headers={"Authorization": f"Bearer {token_ponto}"},
    )
    assert resp.status_code == 200
    confirmada = resp.json()
    assert confirmada["status"] == "confirmada"
    assert confirmada["confirmada_em"] is not None
    assert confirmada["papel"] == "ponto"

    # Contador do ponto incrementado
    db_session.refresh(ponto_obj)
    assert ponto_obj.trocas_como_ponto_concluidas == trocas_antes + 1


def test_confirmar_troca_solicitante_nao_pode(client, db_session):
    """Regra: a solicitante NÃO pode confirmar a própria troca — apenas a
    fornecedora (Ponto de Troca) pode. Deve retornar 403."""
    solicitante = _criar_usuaria(client, "1111")
    ponto = _criar_usuaria(client, "2222")
    _promover_e_ativar_ponto(db_session, ponto["identificador"])

    token_sol = _login(client, solicitante["identificador"], "1111")
    resp = _criar_troca(client, token_sol, ponto["identificador"])
    troca_id = resp.json()["id"]

    # Solicitante tenta confirmar → 403
    resp = client.post(
        f"/trocas/{troca_id}/confirmar",
        headers={"Authorization": f"Bearer {token_sol}"},
    )
    assert resp.status_code == 403


def test_recusar_troca(client, db_session):
    """Regra: a fornecedora pode recusar → status vira 'recusada' e o
    contador de trocas concluídas NÃO é incrementado."""
    solicitante = _criar_usuaria(client, "1111")
    ponto = _criar_usuaria(client, "2222")
    ponto_obj = _promover_e_ativar_ponto(db_session, ponto["identificador"])
    trocas_antes = ponto_obj.trocas_como_ponto_concluidas

    token_sol = _login(client, solicitante["identificador"], "1111")
    token_ponto = _login(client, ponto["identificador"], "2222")

    resp = _criar_troca(client, token_sol, ponto["identificador"])
    troca_id = resp.json()["id"]

    resp = client.post(
        f"/trocas/{troca_id}/recusar",
        headers={"Authorization": f"Bearer {token_ponto}"},
    )
    assert resp.status_code == 200
    recusada = resp.json()
    assert recusada["status"] == "recusada"
    assert recusada["confirmada_em"] is None

    # Contador não mudou
    db_session.refresh(ponto_obj)
    assert ponto_obj.trocas_como_ponto_concluidas == trocas_antes


def test_minhas_trocas_lista_pendentes(client, db_session):
    """Regra: GET /trocas/minhas retorna trocas pendentes também (Bug 8) —
    após a troca ficar pendente, ela aparece no extrato de ambas as partes."""
    solicitante = _criar_usuaria(client, "1111")
    ponto = _criar_usuaria(client, "2222")
    _promover_e_ativar_ponto(db_session, ponto["identificador"])

    token_sol = _login(client, solicitante["identificador"], "1111")
    token_ponto = _login(client, ponto["identificador"], "2222")

    _criar_troca(client, token_sol, ponto["identificador"])

    # Solicitante vê a troca
    resp = client.get(
        "/trocas/minhas",
        headers={"Authorization": f"Bearer {token_sol}"},
    )
    assert resp.status_code == 200
    trocas_sol = resp.json()
    assert len(trocas_sol) == 1
    assert trocas_sol[0]["status"] == "pendente"
    assert trocas_sol[0]["papel"] == "solicitante"

    # Ponto também vê a troca
    resp = client.get(
        "/trocas/minhas",
        headers={"Authorization": f"Bearer {token_ponto}"},
    )
    assert resp.status_code == 200
    trocas_ponto = resp.json()
    assert len(trocas_ponto) == 1
    assert trocas_ponto[0]["status"] == "pendente"
    assert trocas_ponto[0]["papel"] == "ponto"
