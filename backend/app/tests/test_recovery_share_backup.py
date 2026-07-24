"""Testes do endpoint de backup do share SSSS criptografado com PIN (Option E).

Estratégia Option E (T=2, N=2):
  - Share 0: convidadora via Nostr (frontend).
  - Share 1: criptografado com PIN pelo frontend, guardado aqui como blob opaco.

Cobre:
- POST /usuarias/me/recovery-share (auth) — cria (201) e faz upsert (200)
- GET /usuarias/me/recovery-share (auth) — busca ou 404
- Sem auth → 401 em ambos
- Cadastro sem convidadora → 0 slots de AvalistaRecuperacao
- Cadastro com convidadora com npub → 1 slot (ordem=1, is_shadow=False)
"""

from app.models.avalista_recuperacao import AvalistaRecuperacao
from app.models.usuaria import Usuaria


# ── Helpers ──────────────────────────────────────────────────

def _criar_usuaria(client, pin="1234", npub=None, codigo_indicacao=None):
    """Cria uma usuária via API e retorna o JSON de resposta."""
    body = {"pin": pin}
    if npub is not None:
        body["npub"] = npub
    if codigo_indicacao is not None:
        body["codigo_indicacao"] = codigo_indicacao
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


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ── Testes do endpoint de backup do share ────────────────────

def test_armazenar_e_buscar_share(client, db_session):
    """POST cria (201) e GET retorna o blob armazenado."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])
    usuaria_db = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == u["identificador"])
        .first()
    )

    blob = "YmxvYi1kZS1leGVtcGxvLWRlLXNoYXJlLTE="  # base64 arbitrário
    resp = client.post(
        "/usuarias/me/recovery-share",
        json={"share_blob": blob},
        headers=_auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["usuaria_id"] == usuaria_db.id
    assert data["share_blob"] == blob
    assert "criado_em" in data

    # GET devolve o mesmo blob
    resp_get = client.get(
        "/usuarias/me/recovery-share",
        headers=_auth_headers(token),
    )
    assert resp_get.status_code == 200
    assert resp_get.json()["share_blob"] == blob


def test_upsert_substitui_share(client, db_session):
    """POST duas vezes → o segundo blob substitui o primeiro (200 na 2ª)."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    blob_a = "YmxvYi1B"
    resp_a = client.post(
        "/usuarias/me/recovery-share",
        json={"share_blob": blob_a},
        headers=_auth_headers(token),
    )
    assert resp_a.status_code == 201

    blob_b = "YmxvYi1C"
    resp_b = client.post(
        "/usuarias/me/recovery-share",
        json={"share_blob": blob_b},
        headers=_auth_headers(token),
    )
    assert resp_b.status_code == 200, resp_b.text
    assert resp_b.json()["share_blob"] == blob_b

    # GET retorna o blob mais recente (B)
    resp_get = client.get(
        "/usuarias/me/recovery-share",
        headers=_auth_headers(token),
    )
    assert resp_get.json()["share_blob"] == blob_b


def test_buscar_share_sem_auth_401(client, db_session):
    """GET sem token → 401."""
    resp = client.get("/usuarias/me/recovery-share")
    assert resp.status_code == 401


def test_armazenar_sem_auth_401(client, db_session):
    """POST sem token → 401."""
    resp = client.post(
        "/usuarias/me/recovery-share",
        json={"share_blob": "YWJj"},
    )
    assert resp.status_code == 401


def test_buscar_share_inexistente_404(client, db_session):
    """Usuária autenticada sem share armazenado → 404."""
    u = _criar_usuaria(client)
    token = _login(client, u["identificador"])

    resp = client.get(
        "/usuarias/me/recovery-share",
        headers=_auth_headers(token),
    )
    assert resp.status_code == 404


# ── Testes da nova estratégia de slots (Option E) ────────────

def test_create_usuaria_sem_convidadora_nao_cria_slots(client, db_session):
    """Cadastro sem codigo_indicacao → 0 slots de AvalistaRecuperacao."""
    u = _criar_usuaria(client)
    usuaria_db = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == u["identificador"])
        .first()
    )

    slots = (
        db_session.query(AvalistaRecuperacao)
        .filter(AvalistaRecuperacao.usuaria_id == usuaria_db.id)
        .all()
    )
    assert len(slots) == 0


def test_create_usuaria_com_convidadora_cria_1_slot(client, db_session):
    """Convidadora com npub → exatamente 1 slot (ordem=1, is_shadow=False)."""
    # 1. Convidadora com npub
    convidadora = _criar_usuaria(client, npub="a" * 64)
    convidadora_db = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == convidadora["identificador"])
        .first()
    )
    convidadora_db.tier = 3
    db_session.commit()

    # 2. Nova usuária indicada pela convidadora
    nova = _criar_usuaria(
        client,
        pin="5678",
        codigo_indicacao=convidadora["codigo_indicacao"],
    )
    nova_db = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == nova["identificador"])
        .first()
    )

    slots = (
        db_session.query(AvalistaRecuperacao)
        .filter(AvalistaRecuperacao.usuaria_id == nova_db.id)
        .order_by(AvalistaRecuperacao.ordem)
        .all()
    )
    assert len(slots) == 1
    assert slots[0].ordem == 1
    assert slots[0].is_shadow is False
    # npub armazenado é o da convidadora (hex "a"*64)
    assert slots[0].npub_avaliadora == "a" * 64
