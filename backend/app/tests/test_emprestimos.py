"""Testes de integração do fluxo de empréstimo via API.

Cobre o fluxo completo: criar usuária, dar aval, emprestar, pagar, subir tier.
Cada teste tem um nome descritivo da regra que valida.
"""

from app.models.usuaria import Usuaria
from app.services.lnbits import lnbits


# ── Helper ──────────────────────────────────────────────────

def _criar_usuaria(client, pin="1234"):
    """Cria uma usuária via API e retorna o JSON de resposta."""
    resp = client.post("/usuarias", json={"pin": pin})
    assert resp.status_code == 201
    return resp.json()


def _dar_aval(client, avalista_codigo, nova_ident):
    """Dá aval de uma usuária para outra via API.

    Uses avalista's codigo_indicacao (shareable) and nova's identificador.
    """
    resp = client.post("/avais", json={
        "avalista_codigo_indicacao": avalista_codigo,
        "nova_usuaria_identificador": nova_ident,
    })
    assert resp.status_code == 201
    return resp.json()


# ── Testes do fluxo completo ─────────────────────────────────

def test_fluxo_completo_criar_aval_emprestar_pagar_subir_tier(client, db_session):
    """Fluxo ponta-a-ponta: criar → aval → emprestar → pagar → tier sobe."""
    assert lnbits.is_mock  # garante mock mode

    # 1. Criar avalista
    avalista = _criar_usuaria(client, "1234")

    # 2. Criar nova usuária
    nova = _criar_usuaria(client, "5678")

    # 3. Dar aval: nova usuária recebe aval → tier 0→1
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])

    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == nova["identificador"]
    ).first()
    assert usuaria.tier == 1

    # 4. Pedir empréstimo (tier 1 = 5.000 sats)
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 201
    emprestimo = resp.json()
    assert emprestimo["status"] == "ativo"
    assert emprestimo["valor_sats"] == 5000
    assert emprestimo["invoice_bolt11"] is not None

    # 5. Saldo devedor foi setado
    db_session.refresh(usuaria)
    assert usuaria.saldo_devedor == 5000

    # 6. Pagar valor total
    resp = client.post(
        f"/emprestimos/{emprestimo['id']}/pagamento",
        json={"valor_sats": 5000},
    )
    assert resp.status_code == 200
    pagamento = resp.json()
    assert pagamento["quitado"] is True
    assert pagamento["saldo_devedor"] == 0
    assert pagamento["tier"] == 2  # tier subiu de 1 para 2

    # 7. Empréstimo marcado como quitado
    resp = client.get(f"/emprestimos/{emprestimo['id']}")
    assert resp.json()["status"] == "quitado"


def test_usuaria_sem_aval_nao_pode_pedir_emprestimo(client, db_session):
    """Regra: tier 0 sem aval → POST /emprestimos retorna 403."""
    nova = _criar_usuaria(client)

    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 403


def test_pagamento_parcial_nao_quita_nem_sobe_tier(client, db_session):
    """Regra: pagar parcialmente reduz saldo mas não sobe tier."""
    avalista = _criar_usuaria(client, "1234")
    nova = _criar_usuaria(client, "5678")
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])

    # Empréstimo de 5.000 sats
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    emprestimo = resp.json()

    # Pagar 2.000 (parcial)
    resp = client.post(
        f"/emprestimos/{emprestimo['id']}/pagamento",
        json={"valor_sats": 2000},
    )
    assert resp.status_code == 200
    pagamento = resp.json()
    assert pagamento["quitado"] is False
    assert pagamento["saldo_devedor"] == 3000
    assert pagamento["tier"] == 1  # tier não mudou

    # Pagar restante (3.000)
    resp = client.post(
        f"/emprestimos/{emprestimo['id']}/pagamento",
        json={"valor_sats": 3000},
    )
    assert resp.json()["quitado"] is True
    assert resp.json()["tier"] == 2  # agora subiu


def test_usuaria_com_saldo_devedor_nao_pode_emprestar_de_novo(client, db_session):
    """Regra: saldo devedor > 0 impede novo empréstimo."""
    avalista = _criar_usuaria(client, "1234")
    nova = _criar_usuaria(client, "5678")
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])

    # Primeiro empréstimo
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 201

    # Segundo empréstimo deve ser bloqueado (tem dívida)
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 403


def test_emprestimo_quitado_rejeita_novo_pagamento(client, db_session):
    """Regra: não aceitar pagamento de empréstimo já quitado."""
    avalista = _criar_usuaria(client, "1234")
    nova = _criar_usuaria(client, "5678")
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])

    resp = client.post(f"/emprestimos/{nova['identificador']}")
    emprestimo = resp.json()

    # Pagar totalmente
    client.post(
        f"/emprestimos/{emprestimo['id']}/pagamento",
        json={"valor_sats": 5000},
    )

    # Tentar pagar de novo → 400
    resp = client.post(
        f"/emprestimos/{emprestimo['id']}/pagamento",
        json={"valor_sats": 1000},
    )
    assert resp.status_code == 400


def test_tier_sobe_duas_vezes_apos_dois_emprestimos(client, db_session):
    """Regra: quitar tier 1 → tier 2, pegar e quitar tier 2 → tier 3."""
    avalista = _criar_usuaria(client, "1234")
    nova = _criar_usuaria(client, "5678")
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])

    # Empréstimo 1 (tier 1, 5.000 sats)
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    emp1 = resp.json()
    assert emp1["valor_sats"] == 5000

    resp = client.post(
        f"/emprestimos/{emp1['id']}/pagamento",
        json={"valor_sats": 5000},
    )
    assert resp.json()["tier"] == 2

    # Empréstimo 2 (tier 2, 15.000 sats)
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    emp2 = resp.json()
    assert emp2["valor_sats"] == 15000

    resp = client.post(
        f"/emprestimos/{emp2['id']}/pagamento",
        json={"valor_sats": 15000},
    )
    assert resp.json()["tier"] == 3  # chegou ao tier máximo


def test_cadastro_com_codigo_indicacao_cria_aval_e_libera_tier_1(client, db_session):
    """Regra: cadastrar com codigo_indicacao cria Aval automaticamente e sobe tier 0→1."""
    # 1. Criar avalista (tier 0 por padrão)
    avalista = _criar_usuaria(client, "1234")

    # 2. Criar nova usuária com o codigo_indicacao da avalista
    resp = client.post("/usuarias", json={
        "pin": "5678",
        "codigo_indicacao": avalista["codigo_indicacao"],
    })
    assert resp.status_code == 201
    nova = resp.json()

    # 3. Nova usuária nasce com tier 1 (aval recebido)
    assert nova["tier"] == 1
    assert nova["codigo_indicacao_usado"] == avalista["codigo_indicacao"]

    # 4. Já pode pedir empréstimo (tier 1 = 5.000 sats)
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 201


def test_get_convite_disponivel_apenas_para_tier_3(client, db_session):
    """Regra: GET /usuarias/me/convite só funciona para tier 3+."""
    # Criar usuária tier 0 e logar
    u = _criar_usuaria(client, "1234")
    resp = client.post("/login", json={
        "identificador": u["identificador"],
        "pin": "1234",
    })
    token = resp.json()["token"]

    # Tier 0 → 403
    resp = client.get("/usuarias/me/convite", headers={
        "Authorization": f"Bearer {token}",
    })
    assert resp.status_code == 403

    # Promover para tier 3 manualmente no banco
    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == u["identificador"]
    ).first()
    usuaria.tier = 3
    db_session.commit()

    # Tier 3 → 200 com codigo e link
    resp = client.get("/usuarias/me/convite", headers={
        "Authorization": f"Bearer {token}",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["codigo"] == u["codigo_indicacao"]
    assert data["link"] == f"/convite/{u['codigo_indicacao']}"
