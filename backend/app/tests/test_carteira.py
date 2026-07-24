"""Testes de integração do router /carteira (off-ramp sats → BRL via Pix).

Cobre:
- GET /carteira/cotacao — cotação mock
- GET /carteira/saldo — saldo mock + conversão BRL
- POST /carteira/depositar — gera QR Pix
- POST /carteira/pagar — mock, valida pais==BR
- POST /carteira/pagar sem pais=BR → 403
- POST /carteira/gerar-quitacao — gera cobrança vinculada a empréstimo

Roda inteiro em mock mode (LNbits, Pix, Binance), mesmo padrão de test_pix.py.
"""

from app.models.transacao_carteira import TransacaoCarteira
from app.models.usuaria import Usuaria
from app.services.exchange import exchange
from app.services.pix import pix


# ── Helpers (mesmo padrão de test_pix.py / test_emprestimos.py) ──

def _criar_usuaria(client, pin="1234", pais=None):
    body = {"pin": pin}
    if pais is not None:
        body["pais"] = pais
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


def _criar_usuaria_logada(client, pin="1234", pais=None):
    """Cria usuária, faz login, retorna (usuaria_json, token, auth_headers)."""
    u = _criar_usuaria(client, pin=pin, pais=pais)
    token = _login(client, u["identificador"], pin=pin)
    return u, token, {"Authorization": f"Bearer {token}"}


def _depositar_confirmado(client, headers, valor_centavos_brl):
    """Deposita e confirma via webhook (fluxo real) — devolve o valor_sats
    creditado. Usado por qualquer teste que precise de saldo real na
    carteira, já que o saldo agora vem do ledger (TransacaoCarteira com
    status='concluida'), não de um mock fixo — ver _saldo_sats_da_usuaria."""
    resp = client.post(
        "/carteira/depositar",
        json={"valor_centavos_brl": valor_centavos_brl},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    txid = resp.json()["txid"]

    mp_payment_id = next(k for k, v in pix._mock_txids.items() if v == txid)
    webhook_resp = client.post(
        "/pix/webhook", json={"type": "payment", "data": {"id": mp_payment_id}}
    )
    assert webhook_resp.status_code == 200

    transacoes = client.get("/carteira/transacoes", headers=headers).json()
    creditada = next(t for t in transacoes if t["txid"] == txid)
    assert creditada["status"] == "concluida"
    return creditada["valor_sats"]


def _dar_aval(client, avalista_codigo, nova_ident):
    resp = client.post("/avais", json={
        "avalista_codigo_indicacao": avalista_codigo,
        "nova_usuaria_identificador": nova_ident,
    })
    assert resp.status_code == 201
    return resp.json()


def _criar_emprestimo_tier1(client):
    """Cria avalista + usuária + aval + empréstimo de 5.000 sats. Retorna
    (usuaria_json, emprestimo_json)."""
    avalista = _criar_usuaria(client, "1234")
    nova = _criar_usuaria(client, "5678")
    _dar_aval(client, avalista["codigo_indicacao"], nova["identificador"])
    resp = client.post(f"/emprestimos/{nova['identificador']}")
    assert resp.status_code == 201
    return nova, resp.json()


# ── Testes ────────────────────────────────────────────────

def test_get_cotacao_retorna_preco_btc_brl(client, db_session):
    assert exchange.is_mock
    _, _, headers = _criar_usuaria_logada(client)

    resp = client.get("/carteira/cotacao", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["btc_brl"] > 0
    assert data["atualizado_em"] is not None


def test_get_cotacao_sem_token_retorna_401(client, db_session):
    resp = client.get("/carteira/cotacao")
    assert resp.status_code == 401


def test_get_saldo_retorna_sats_e_brl_convertido(client, db_session):
    """Saldo vem do ledger (TransacaoCarteira concluída) — não de um valor
    mock fixo. Sem nenhum depósito confirmado, começa em zero; depois de
    um depósito confirmado via webhook, reflete o valor real creditado."""
    _, _, headers = _criar_usuaria_logada(client, pais="BR")

    resp = client.get("/carteira/saldo", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["saldo_sats"] == 0

    valor_sats_creditado = _depositar_confirmado(client, headers, 15000)

    resp = client.get("/carteira/saldo", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["saldo_sats"] == valor_sats_creditado
    assert data["cotacao_btc_brl"] > 0
    esperado_brl = valor_sats_creditado / 100_000_000 * data["cotacao_btc_brl"]
    assert abs(data["saldo_brl"] - round(esperado_brl, 2)) < 0.01


def test_post_depositar_gera_qr_pix(client, db_session):
    assert pix.is_mock
    _, _, headers = _criar_usuaria_logada(client)

    resp = client.post(
        "/carteira/depositar",
        json={"valor_centavos_brl": 15000},  # R$ 150,00
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["txid"].startswith("arakne-cart-")
    assert data["qr_code"]
    assert data["valor_centavos_brl"] == 15000
    assert data["status"] == "pendente"

    # TransacaoCarteira tipo=deposito registrada como pendente.
    transacoes = client.get("/carteira/transacoes", headers=headers).json()
    assert len(transacoes) == 1
    assert transacoes[0]["tipo"] == "deposito"
    assert transacoes[0]["valor_sats"] > 0  # entrada: positivo
    assert transacoes[0]["status"] == "pendente"


def test_post_depositar_sem_token_retorna_401(client, db_session):
    resp = client.post(
        "/carteira/depositar",
        json={"valor_centavos_brl": 15000},
    )
    assert resp.status_code == 401


def test_webhook_confirma_deposito_de_carteira_via_txid(client, db_session):
    """O webhook do /pix precisa saber confirmar um depósito de carteira
    mesmo sem PagamentoPix (essa tabela é só pra repagamento de
    empréstimo) — casa pelo txid (external_reference) em vez de
    mp_payment_id, e credita a TransacaoCarteira correspondente."""
    assert pix.is_mock
    _, _, headers = _criar_usuaria_logada(client)

    resp = client.post(
        "/carteira/depositar",
        json={"valor_centavos_brl": 15000},
        headers=headers,
    )
    txid = resp.json()["txid"]
    assert txid.startswith("arakne-cart-")

    # DepositarResponse não expõe mp_payment_id (só txid) — pega do mapa
    # interno do mock, que agora lembra qual mp_payment_id corresponde a
    # qual txid (mesmo comportamento que o Mercado Pago real teria).
    mp_payment_id = next(k for k, v in pix._mock_txids.items() if v == txid)

    webhook_resp = client.post(
        "/pix/webhook",
        json={"type": "payment", "data": {"id": mp_payment_id}},
    )
    assert webhook_resp.status_code == 200

    transacoes = client.get("/carteira/transacoes", headers=headers).json()
    assert len(transacoes) == 1
    assert transacoes[0]["txid"] == txid
    assert transacoes[0]["status"] == "concluida"


def test_post_pagar_aprova_em_mock_e_debita_sats(client, db_session):
    assert pix.is_mock
    assert exchange.is_mock
    _, _, headers = _criar_usuaria_logada(client, pais="BR")

    # Precisa de saldo real (confirmado) antes de conseguir pagar — não
    # existe mais saldo fake de demo.
    _depositar_confirmado(client, headers, 50000)  # R$ 500,00

    resp = client.post(
        "/carteira/pagar",
        json={
            "chave_pix": "12345678901",  # CPF fake
            "valor_centavos_brl": 5000,  # R$ 50,00
            "descricao": "material adquirido",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "concluida"
    assert data["valor_centavos_brl"] == 5000
    assert data["valor_sats"] < 0  # saída: negativo

    # TransacaoCarteira tipo=pagamento registrada como concluída, além do
    # depósito que já estava lá.
    transacoes = client.get("/carteira/transacoes", headers=headers).json()
    assert len(transacoes) == 2
    pagamento = next(t for t in transacoes if t["tipo"] == "pagamento")
    assert pagamento["valor_sats"] < 0
    assert pagamento["contraparte"] == "12345678901"
    assert pagamento["status"] == "concluida"
    assert pagamento["descricao"] == "material adquirido"


def test_post_pagar_sem_pais_br_retorna_403(client, db_session):
    """Usuária sem pais informado (null) não pode pagar via Pix."""
    _, _, headers = _criar_usuaria_logada(client, pais=None)

    resp = client.post(
        "/carteira/pagar",
        json={
            "chave_pix": "12345678901",
            "valor_centavos_brl": 5000,
        },
        headers=headers,
    )
    assert resp.status_code == 403
    assert "Brasil" in resp.json()["detail"]


def test_post_pagar_com_pais_nao_br_retorna_403(client, db_session):
    """Usuária de outro país não pode pagar via Pix (rail brasileiro)."""
    _, _, headers = _criar_usuaria_logada(client, pais="US")

    resp = client.post(
        "/carteira/pagar",
        json={
            "chave_pix": "12345678901",
            "valor_centavos_brl": 5000,
        },
        headers=headers,
    )
    assert resp.status_code == 403


def test_post_pagar_saldo_insuficiente_retorna_400(client, db_session):
    """Tentar pagar valor maior que o saldo mock (50.000 sats) → 400."""
    _, _, headers = _criar_usuaria_logada(client, pais="BR")

    # R$ 1.000.000,00 = valor bem acima do saldo mock de 50.000 sats
    # (50.000 sats a ~R$ 350.000/BTC = ~R$ 175).
    resp = client.post(
        "/carteira/pagar",
        json={
            "chave_pix": "12345678901",
            "valor_centavos_brl": 1_000_000_00,  # R$ 1.000.000,00
        },
        headers=headers,
    )
    assert resp.status_code == 400
    assert "Saldo insuficiente" in resp.json()["detail"]


def test_post_gerar_quitacao_gera_cobranca_vinculada(client, db_session):
    assert pix.is_mock
    nova, emprestimo = _criar_emprestimo_tier1(client)
    token = _login(client, nova["identificador"], pin="5678")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(
        "/carteira/gerar-quitacao",
        json={
            "emprestimo_id": emprestimo["id"],
            "valor_sats": 5000,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["txid"].startswith("arakne-cart-")
    assert data["qr_code"]
    assert data["valor_sats"] == 5000
    # valor_centavos_brl é calculado pela cotação, não enviado no body.
    assert data["valor_centavos_brl"] > 0
    assert data["status"] == "pendente"


def test_post_gerar_quitacao_emprestimo_alheio_retorna_404(client, db_session):
    """Não vaza existência de empréstimo de outra usuária — 404 genérico."""
    # Empréstimo de outra usuária
    _, emprestimo_outro = _criar_emprestimo_tier1(client)
    # Usuária logada diferente
    _, _, headers = _criar_usuaria_logada(client, pin="9999", pais="BR")

    resp = client.post(
        "/carteira/gerar-quitacao",
        json={
            "emprestimo_id": emprestimo_outro["id"],
            "valor_sats": 1000,
        },
        headers=headers,
    )
    assert resp.status_code == 404


def test_post_gerar_quitacao_emprestimo_inexistente_retorna_404(client, db_session):
    _, _, headers = _criar_usuaria_logada(client, pais="BR")

    resp = client.post(
        "/carteira/gerar-quitacao",
        json={
            "emprestimo_id": 99999,
            "valor_sats": 1000,
        },
        headers=headers,
    )
    assert resp.status_code == 404


def test_post_gerar_quitacao_valor_maior_que_saldo_devedor_retorna_400(client, db_session):
    nova, emprestimo = _criar_emprestimo_tier1(client)
    token = _login(client, nova["identificador"], pin="5678")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(
        "/carteira/gerar-quitacao",
        json={
            "emprestimo_id": emprestimo["id"],
            "valor_sats": 999_999,  # maior que saldo devedor (5.000)
        },
        headers=headers,
    )
    assert resp.status_code == 400


def test_get_transacoes_lista_ordem_desc(client, db_session):
    """Transações aparecem da mais recente pra mais antiga."""
    _, _, headers = _criar_usuaria_logada(client, pais="BR")

    # Cria duas transações: um depósito confirmado e um pagamento.
    _depositar_confirmado(client, headers, 10000)
    client.post(
        "/carteira/pagar",
        json={
            "chave_pix": "12345678901",
            "valor_centavos_brl": 1000,
        },
        headers=headers,
    )

    resp = client.get("/carteira/transacoes", headers=headers)
    assert resp.status_code == 200
    transacoes = resp.json()
    assert len(transacoes) == 2
    # Mais recente primeiro (pagamento foi feito depois do depósito).
    assert transacoes[0]["tipo"] == "pagamento"
    assert transacoes[1]["tipo"] == "deposito"


def test_cadastro_com_pais_br_persiste_e_retorna_no_response(client, db_session):
    """POST /usuarias com pais=BR persiste e retorna no UsuariaResponse."""
    resp = client.post("/usuarias", json={"pin": "1234", "pais": "BR"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["pais"] == "BR"

    # Confirma no banco.
    usuaria = (
        db_session.query(Usuaria)
        .filter(Usuaria.identificador == data["identificador"])
        .first()
    )
    assert usuaria.pais == "BR"


def test_cadastro_sem_pais_retorna_null_no_response(client, db_session):
    """POST /usuarias sem pais → pais=None no response."""
    resp = client.post("/usuarias", json={"pin": "1234"})
    assert resp.status_code == 201
    assert resp.json()["pais"] is None
