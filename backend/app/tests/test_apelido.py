"""Testes das mudanças #7-backend (apelido) e #8-backend (PIN escolhido).

Cobre:
- PATCH /usuarias/me/apelido: sucesso, não-autenticado (401), vazio (422),
  > 80 chars (422), strip de whitespace.
- POST /usuarias: persiste apelido no cadastro; UsuariaResponse retorna apelido.
- Validação de PIN em POST /usuarias: 3 dígitos (422), 9 dígitos (422),
  com letras (422), 4 dígitos (201), 8 dígitos (201).
- GET /usuarias/by-identificador/{id}/avalistas-recuperacao retorna `apelido`
  da avalista quando ela tem apelido definido.
- GET /usuarias/by-identificador/{id}/npub NÃO expõe apelido (lookup minimalista).
"""

from app.models.avalista_recuperacao import AvalistaRecuperacao
from app.models.usuaria import Usuaria
from app.services.bech32 import npub_encode


# ── Helpers ──────────────────────────────────────────────────

def _criar_usuaria(client, pin="1234", npub=None, codigo_indicacao=None, apelido=None):
    """Cria uma usuária via API e retorna o JSON de resposta."""
    body = {"pin": pin}
    if npub is not None:
        body["npub"] = npub
    if codigo_indicacao is not None:
        body["codigo_indicacao"] = codigo_indicacao
    if apelido is not None:
        body["apelido"] = apelido
    resp = client.post("/usuarias", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _login(client, identificador, pin="1234"):
    resp = client.post("/login", json={
        "identificador": identificador,
        "pin": pin,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


# ── #7: PATCH /usuarias/me/apelido ────────────────────────────

def test_update_apelido_sucesso(client, db_session):
    """PATCH /usuarias/me/apelido atualiza e retorna a usuária com apelido."""
    u = _criar_usuaria(client)
    assert u["apelido"] is None

    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "Fundadora"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["apelido"] == "Fundadora"
    assert data["identificador"] == u["identificador"]

    # GET /usuarias/me confirma persistência
    resp_get = client.get(
        "/usuarias/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp_get.status_code == 200
    assert resp_get.json()["apelido"] == "Fundadora"


def test_update_apelido_sem_auth_401(client, db_session):
    """PATCH /usuarias/me/apelido sem token → 401."""
    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "Fundadora"},
    )
    assert resp.status_code == 401


def test_update_apelido_vazio_422(client, db_session):
    """Apelido vazio → 422 (min_length=1)."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_update_apelido_so_espacos_422(client, db_session):
    """Apelido só com whitespace → 422 após strip (validator rejeita vazio)."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "   "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_update_apelido_maior_que_80_422(client, db_session):
    """Apelido > 80 chars → 422 (max_length=80)."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "a" * 81},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_update_apelido_strip_whitespace(client, db_session):
    """Whitespace nas bordas é removido antes de persistir."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "  Tecelã  "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["apelido"] == "Tecelã"


def test_update_apelido_sobrescreve(client, db_session):
    """Um segundo PATCH sobrescreve o apelido anterior."""
    u = _criar_usuaria(client, apelido="Velho")
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/apelido",
        json={"apelido": "Novo"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["apelido"] == "Novo"


# ── #7: apelido no cadastro (POST /usuarias) ─────────────────

def test_cadastro_com_apelido_persiste(client, db_session):
    """POST /usuarias com apelido → persistido e retornado."""
    u = _criar_usuaria(client, apelido="Fundadora")
    assert u["apelido"] == "Fundadora"

    token = _login(client, u["identificador"])
    resp = client.get(
        "/usuarias/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.json()["apelido"] == "Fundadora"


def test_cadastro_sem_apelido_deixa_null(client, db_session):
    """POST /usuarias sem apelido → apelido null (retrocompatível)."""
    u = _criar_usuaria(client)
    assert u["apelido"] is None


# ── #7: apelido em avalistas-recuperacao público ──────────────

def test_avalistas_recuperacao_publico_retorna_apelido(client, db_session):
    """GET /usuarias/by-identificador/{id}/avalistas-recuperacao inclui
    o apelido da avalista quando ela tem apelido definido."""
    # 1. Convidadora com npub e apelido
    convidadora = _criar_usuaria(client, npub="c" * 64, apelido="Fundadora")
    usuaria_c = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == convidadora["identificador"])
        .first()
    )
    usuaria_c.tier = 3
    db_session.commit()

    # 2. Nova usuária com o codigo_indicacao da convidadora → cria 1 slot
    nova = _criar_usuaria(
        client,
        pin="5678",
        npub="d" * 64,
        codigo_indicacao=convidadora["codigo_indicacao"],
    )

    # 3. Endpoint público retorna o slot com apelido da convidadora
    resp = client.get(
        f"/usuarias/by-identificador/{nova['identificador']}/avalistas-recuperacao"
    )
    assert resp.status_code == 200
    avalistas = resp.json()["avalistas"]
    assert len(avalistas) == 1
    assert avalistas[0]["apelido"] == "Fundadora"
    # npub continua presente
    assert avalistas[0]["npub_avaliadora"] == npub_encode("c" * 64)


def test_avalistas_recuperacao_publico_sem_apelido_retorna_null(client, db_session):
    """Avalista sem apelido → campo `apelido` é null no slot."""
    convidadora = _criar_usuaria(client, npub="c" * 64)  # sem apelido
    usuaria_c = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == convidadora["identificador"])
        .first()
    )
    usuaria_c.tier = 3
    db_session.commit()

    nova = _criar_usuaria(
        client,
        pin="5678",
        codigo_indicacao=convidadora["codigo_indicacao"],
    )

    resp = client.get(
        f"/usuarias/by-identificador/{nova['identificador']}/avalistas-recuperacao"
    )
    assert resp.status_code == 200
    avalistas = resp.json()["avalistas"]
    assert len(avalistas) == 1
    assert avalistas[0]["apelido"] is None


def test_npub_publico_nao_expoe_apelido(client, db_session):
    """GET /usuarias/by-identificador/{id}/npub NÃO inclui apelido
    (lookup público minimalista — só identificador + npub)."""
    u = _criar_usuaria(client, npub="e" * 64, apelido="Fundadora")

    resp = client.get(f"/usuarias/by-identificador/{u['identificador']}/npub")
    assert resp.status_code == 200
    data = resp.json()
    assert "apelido" not in data
    assert set(data.keys()) == {"identificador", "npub"}


# ── #8: validação de PIN em POST /usuarias ────────────────────

def test_pin_3_digitos_422(client, db_session):
    """PIN com 3 dígitos → 422 (min_length=4)."""
    resp = client.post("/usuarias", json={"pin": "123"})
    assert resp.status_code == 422


def test_pin_9_digitos_422(client, db_session):
    """PIN com 9 dígitos → 422 (max_length=8)."""
    resp = client.post("/usuarias", json={"pin": "123456789"})
    assert resp.status_code == 422


def test_pin_com_letras_422(client, db_session):
    r"""PIN com letras → 422 (pattern ^\d{4,8}$)."""
    resp = client.post("/usuarias", json={"pin": "12ab5678"})
    assert resp.status_code == 422


def test_pin_valido_4_digitos_201(client, db_session):
    """PIN válido de 4 dígitos → 201."""
    resp = client.post("/usuarias", json={"pin": "1234"})
    assert resp.status_code == 201
    assert resp.json()["identificador"]


def test_pin_valido_8_digitos_201(client, db_session):
    """PIN válido de 8 dígitos → 201."""
    resp = client.post("/usuarias", json={"pin": "12345678"})
    assert resp.status_code == 201
    assert resp.json()["identificador"]


def test_pin_valido_6_digitos_201(client, db_session):
    """PIN válido de 6 dígitos (meio do range) → 201."""
    resp = client.post("/usuarias", json={"pin": "123456"})
    assert resp.status_code == 201
    assert resp.json()["identificador"]
