"""Testes de integração dos endpoints de recuperação Nostr (Track 1A, Fase 1 / Track 3B, Fase 3).

Cobre:
- POST /usuarias com npub → persiste npub
- GET /usuarias/me retorna npub
- POST /usuarias sem npub → npub é null
- POST /usuarias com npub duplicado → 400
- Cadastro sem convidadora → 0 slots de avalistas (estratégia Option E)
- Cadastro com convidadora com npub → 1 slot (ordem=1, is_shadow=False)
- Cadastro com convidadora sem npub → 0 slots (sem shadow fallback)
- GET /usuarias/me/avalistas-recuperacao (auth) retorna slots em bech32 npub1...
- GET /usuarias/by-identificador/{id}/npub (sem auth) retorna npub em bech32
- GET /usuarias/by-identificador/{id}/avalistas-recuperacao (sem auth) retorna lista
- Conversão hex → bech32 npub1... (NIP-19) na serialização
"""

from app.models.avalista_recuperacao import AvalistaRecuperacao
from app.models.usuaria import Usuaria
from app.services.bech32 import npub_encode


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


# ── Testes de npub no cadastro ────────────────────────────────

def test_cadastro_com_npub_persiste_npub(client, db_session):
    """POST /usuarias com npub → npub é persistido e retornado."""
    npub = "a" * 64
    u = _criar_usuaria(client, npub=npub)
    assert u["npub"] == npub

    # GET /usuarias/me também retorna o npub
    token = _login(client, u["identificador"])
    resp = client.get("/usuarias/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["npub"] == npub


def test_cadastro_sem_npub_deixa_npub_null(client, db_session):
    """POST /usuarias sem npub → npub é null (retrocompatível)."""
    u = _criar_usuaria(client)
    assert u["npub"] is None


def test_cadastro_com_npub_duplicado_rejeita(client, db_session):
    """POST /usuarias com npub já cadastrado → 400."""
    npub = "b" * 64
    _criar_usuaria(client, npub=npub)
    resp = client.post("/usuarias", json={"pin": "5678", "npub": npub})
    assert resp.status_code == 400
    assert "npub" in resp.json()["detail"].lower()


# ── Testes de avalistas de recuperação no cadastro ───────────

def test_cadastro_sem_convidadora_nao_cria_slots(client, db_session):
    """Cadastro sem convidadora → 0 slots (estratégia Option E, T=2 N=2).

    Sem convidadora, não há npub para enviar o share 0 via Nostr — a dona
    usa paper backup (frontend). O share 1 vai ao backend via
    /usuarias/me/recovery-share. Nenhum slot de npub é criado aqui.
    """
    u = _criar_usuaria(client)

    token = _login(client, u["identificador"])
    resp = client.get(
        "/usuarias/me/avalistas-recuperacao",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["avalistas"] == []


def test_cadastro_com_convidadora_com_npub_cria_1_slot(client, db_session):
    """Convidadora com npub → 1 slot (ordem=1, is_shadow=False)."""
    # 1. Convidadora com npub
    convidadora = _criar_usuaria(client, npub="c" * 64)
    usuaria_c = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == convidadora["identificador"])
        .first()
    )
    usuaria_c.tier = 3
    db_session.commit()

    # 2. Nova usuária com o codigo_indicacao da convidadora
    nova = _criar_usuaria(
        client,
        pin="5678",
        npub="d" * 64,
        codigo_indicacao=convidadora["codigo_indicacao"],
    )

    # 3. Exatamente 1 slot, ordem=1, is_shadow=False, npub da convidadora
    token = _login(client, nova["identificador"], pin="5678")
    resp = client.get(
        "/usuarias/me/avalistas-recuperacao",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    avalistas = resp.json()["avalistas"]
    assert len(avalistas) == 1
    slot1 = avalistas[0]
    assert slot1["ordem"] == 1
    assert slot1["is_shadow"] is False
    # npub retornado em bech32 — deve corresponder ao hex "c"*64 armazenado
    assert slot1["npub_avaliadora"] == npub_encode("c" * 64)
    assert slot1["npub_avaliadora"].startswith("npub1")


def test_cadastro_com_convidadora_sem_npub_nao_cria_slots(client, db_session):
    """Convidadora sem npub → 0 slots (sem shadow fallback, Option E)."""
    convidadora = _criar_usuaria(client)  # sem npub
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

    token = _login(client, nova["identificador"], pin="5678")
    resp = client.get(
        "/usuarias/me/avalistas-recuperacao",
        headers={"Authorization": f"Bearer {token}"},
    )
    avalistas = resp.json()["avalistas"]
    assert avalistas == []


# ── Testes de descoberta pública (sem auth) ──────────────────

def test_get_npub_by_identificador_sem_auth(client, db_session):
    """GET /usuarias/by-identificador/{id}/npub (sem auth) retorna npub em bech32."""
    npub_hex = "e" * 64
    u = _criar_usuaria(client, npub=npub_hex)

    resp = client.get(f"/usuarias/by-identificador/{u['identificador']}/npub")
    assert resp.status_code == 200
    data = resp.json()
    assert data["identificador"] == u["identificador"]
    # npub retornado em bech32 npub1... (convertido do hex armazenado)
    assert data["npub"] == npub_encode(npub_hex)
    assert data["npub"].startswith("npub1")


def test_get_npub_by_identificador_npub_ja_bech32_passthrough(client, db_session):
    """Se o npub foi cadastrado já em bech32, o endpoint retorna-o inalterado."""
    npub_hex = "1" * 64
    npub_bech32 = npub_encode(npub_hex)
    u = _criar_usuaria(client, npub=npub_bech32)

    resp = client.get(f"/usuarias/by-identificador/{u['identificador']}/npub")
    assert resp.status_code == 200
    assert resp.json()["npub"] == npub_bech32


def test_get_npub_by_identificador_sem_npub_retorna_null(client, db_session):
    """Usuária sem npub → endpoint público retorna npub=null."""
    u = _criar_usuaria(client)
    resp = client.get(f"/usuarias/by-identificador/{u['identificador']}/npub")
    assert resp.status_code == 200
    assert resp.json()["npub"] is None


def test_get_npub_by_identificador_inexistente_404(client, db_session):
    """Identificador inexistente → 404."""
    resp = client.get("/usuarias/by-identificador/nao_existe/npub")
    assert resp.status_code == 404


def test_get_avalistas_recuperacao_by_identificador_sem_auth(client, db_session):
    """GET /usuarias/by-identificador/{id}/avalistas-recuperacao (sem auth).

    Sem convidadora → 0 slots (estratégia Option E).
    """
    u = _criar_usuaria(client, npub="f" * 64)
    resp = client.get(
        f"/usuarias/by-identificador/{u['identificador']}/avalistas-recuperacao"
    )
    assert resp.status_code == 200
    avalistas = resp.json()["avalistas"]
    assert avalistas == []


def test_get_avalistas_recuperacao_by_identificador_inexistente_404(client, db_session):
    resp = client.get(
        "/usuarias/by-identificador/nao_existe/avalistas-recuperacao"
    )
    assert resp.status_code == 404


# ── Teste de auth no endpoint /me/avalistas-recuperacao ──────

def test_get_my_avalistas_recuperacao_sem_auth_401(client, db_session):
    """GET /usuarias/me/avalistas-recuperacao sem token → 401."""
    resp = client.get("/usuarias/me/avalistas-recuperacao")
    assert resp.status_code == 401


# ── Testes do módulo bech32 (Track 3B) ────────────────────────

def test_bech32_npub_encode_formato():
    """npub_encode produz string npub1... de 63 chars para 32 bytes."""
    npub = npub_encode("ab" * 32)
    assert npub.startswith("npub1")
    assert len(npub) == 63


def test_bech32_npub_encode_passthrough():
    """npub_encode retorna bech32 inalterado se já for npub1..."""
    npub = npub_encode("cd" * 32)
    assert npub_encode(npub) == npub


def test_bech32_npub_encode_rejeita_tamanho_errado():
    """npub_encode rejeita pubkey que não tem 32 bytes."""
    import pytest
    with pytest.raises(ValueError):
        npub_encode("ab" * 31)  # 31 bytes
    with pytest.raises(ValueError):
        npub_encode("ab" * 33)  # 33 bytes


def test_bech32_npub_encode_round_trip_com_referencia():
    """Verifica contra a lib de referência `bech32` (se instalada)."""
    try:
        import bech32 as ref
    except ImportError:
        import pytest
        pytest.skip("lib de referência bech32 não instalada")
    hex_key = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaefa2cd0d"
    expected = ref.bech32_encode("npub", ref.convertbits(bytes.fromhex(hex_key), 8, 5))
    assert npub_encode(hex_key) == expected


# ── Testes do PATCH /usuarias/me/npub ─────────────────────────

def test_update_npub(client, db_session):
    """PATCH /usuarias/me/npub atualiza o npub da usuária logada."""
    u = _criar_usuaria(client)  # sem npub
    assert u["npub"] is None

    token = _login(client, u["identificador"])

    # PATCH com novo npub
    novo_npub = "a" * 64
    resp = client.patch(
        "/usuarias/me/npub",
        json={"npub": novo_npub},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["npub"] == novo_npub

    # GET /usuarias/me confirma
    resp_get = client.get(
        "/usuarias/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp_get.status_code == 200
    assert resp_get.json()["npub"] == novo_npub


def test_update_npub_sem_auth_401(client, db_session):
    """PATCH /usuarias/me/npub sem token → 401."""
    resp = client.patch(
        "/usuarias/me/npub",
        json={"npub": "a" * 64},
    )
    assert resp.status_code == 401


def test_update_npub_duplicado_rejeita(client, db_session):
    """PATCH com npub já usado por outra usuária → 400."""
    # Usuária 1 já tem npub
    _criar_usuaria(client, npub="b" * 64)

    # Usuária 2 sem npub
    u2 = _criar_usuaria(client, pin="5678")
    token = _login(client, u2["identificador"], pin="5678")

    # Tenta setar o mesmo npub da usuária 1
    resp = client.patch(
        "/usuarias/me/npub",
        json={"npub": "b" * 64},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "npub" in resp.json()["detail"].lower()


def test_update_npub_idempotente(client, db_session):
    """PATCH com o mesmo npub que já está armazenado → 200 (idempotente)."""
    npub = "c" * 64
    u = _criar_usuaria(client, npub=npub)
    token = _login(client, u["identificador"])

    resp = client.patch(
        "/usuarias/me/npub",
        json={"npub": npub},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["npub"] == npub
