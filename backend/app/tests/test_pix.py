"""Testes de integração do fluxo Pix — cobrança dinâmica + webhook.

Roda inteiro em mock mode (sem MP_ACCESS_TOKEN configurado), espelhando o
padrão de test_emprestimos.py: cria usuária/aval/empréstimo pela API, gera
uma cobrança Pix, simula a notificação de webhook do Mercado Pago e valida
os mesmos efeitos que o fluxo Lightning já teria (abate saldo, sobe tier).
"""

from app.models.conversao_pool import ConversaoPool
from app.models.usuaria import Usuaria
from app.services.pix import pix


# ── Helpers (mesmo padrão de test_emprestimos.py) ───────────

def _criar_usuaria(client, pin="1234"):
    resp = client.post("/usuarias", json={"pin": pin})
    assert resp.status_code == 201
    return resp.json()


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


def _webhook_payload(mp_payment_id: str) -> dict:
    return {"type": "payment", "data": {"id": mp_payment_id}}


# ── Testes ────────────────────────────────────────────────

def test_criar_cobranca_pix_gera_txid_e_qr(client, db_session):
    assert pix.is_mock  # garante mock mode

    _, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 5000, "valor_centavos_brl": 15000},
    )
    assert resp.status_code == 201
    cobranca = resp.json()
    assert cobranca["txid"].startswith(f"arakne-{emprestimo['id']}-")
    assert cobranca["qr_code"]
    assert cobranca["valor_sats"] == 5000
    assert cobranca["valor_centavos_brl"] == 15000
    assert cobranca["status"] == "pending"


def test_cobranca_recusa_valor_sats_maior_que_saldo_devedor(client, db_session):
    _, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 999_999, "valor_centavos_brl": 100},
    )
    assert resp.status_code == 400


def test_webhook_confirma_pagamento_total_abate_saldo_e_sobe_tier(client, db_session):
    """Fluxo completo: cobrança → webhook aprovado → saldo zera → tier sobe.

    Mesmo gatilho (ao_quitar) que o fluxo Lightning usa em
    test_emprestimos.py — só a origem do evento muda."""
    nova, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 5000, "valor_centavos_brl": 15000},
    )
    cobranca = resp.json()

    resp = client.post("/pix/webhook", json=_webhook_payload(cobranca["mp_payment_id"]))
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == nova["identificador"]
    ).first()
    db_session.refresh(usuaria)
    assert usuaria.saldo_devedor == 0
    assert usuaria.tier == 2  # subiu de 1 para 2, igual ao fluxo Lightning

    status_resp = client.get(f"/pix/pagamentos/{cobranca['txid']}")
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "aprovado"
    assert status_resp.json()["confirmado_em"] is not None

    emp_resp = client.get(f"/emprestimos/{emprestimo['id']}")
    assert emp_resp.json()["status"] == "quitado"


def test_webhook_pagamento_parcial_nao_quita_nem_sobe_tier(client, db_session):
    nova, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 2000, "valor_centavos_brl": 6000},
    )
    cobranca = resp.json()
    client.post("/pix/webhook", json=_webhook_payload(cobranca["mp_payment_id"]))

    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == nova["identificador"]
    ).first()
    db_session.refresh(usuaria)
    assert usuaria.saldo_devedor == 3000
    assert usuaria.tier == 1  # não mudou


def test_webhook_e_idempotente(client, db_session):
    """Reenviar a mesma notificação não abate o saldo duas vezes."""
    nova, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 2000, "valor_centavos_brl": 6000},
    )
    cobranca = resp.json()

    client.post("/pix/webhook", json=_webhook_payload(cobranca["mp_payment_id"]))
    client.post("/pix/webhook", json=_webhook_payload(cobranca["mp_payment_id"]))  # reenvio

    usuaria = db_session.query(Usuaria).filter(
        Usuaria.identificador == nova["identificador"]
    ).first()
    db_session.refresh(usuaria)
    assert usuaria.saldo_devedor == 3000  # não abateu duas vezes


def test_webhook_ignora_notificacao_de_outro_tipo(client, db_session):
    """Notificações que não são de pagamento (ex.: merchant_order) são
    ignoradas sem erro e sem efeito."""
    resp = client.post("/pix/webhook", json={"type": "merchant_order", "data": {"id": "123"}})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_webhook_ignora_mp_payment_id_desconhecido(client, db_session):
    """Um webhook referenciando um pagamento que não existe no nosso banco
    não deve derrubar o endpoint (ex.: notificação de outra aplicação usando
    a mesma conta Mercado Pago)."""
    resp = client.post("/pix/webhook", json=_webhook_payload("mp_inexistente"))
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_consultar_cobranca_pix_inexistente_retorna_404(client, db_session):
    resp = client.get("/pix/pagamentos/txid-que-nao-existe")
    assert resp.status_code == 404


def test_custodia_reserva_fria_vazia_por_padrao(client, db_session, monkeypatch):
    """Sem MULTISIG_* configurado nem linha no banco, o endpoint informa
    que ainda não há reserva fria registrada — não quebra.

    Força as env vars vazias explicitamente (monkeypatch), em vez de supor
    que o ambiente onde os testes rodam está vazio — numa máquina de
    desenvolvedora com um .env de trabalho real (multisig já gerada,
    credenciais reais), esse teste quebrava porque o valor real vazava
    pro teste."""
    monkeypatch.setattr("app.routers.custodia.MULTISIG_DESCRIPTOR", "")
    monkeypatch.setattr("app.routers.custodia.MULTISIG_ENDERECO", "")
    resp = client.get("/custodia/reserva-fria")
    assert resp.status_code == 200
    assert resp.json()["configurado"] is False


def test_webhook_confirmado_credita_pool_com_conversao_registrada(client, db_session):
    """O webhook, além de abater a dívida, dispara a conversão BRL→sats de
    volta pro pool (o "passo 4") — mesmo em mock, deve deixar um registro
    de auditoria em ConversaoPool."""
    _, emprestimo = _criar_emprestimo_tier1(client)

    resp = client.post(
        f"/pix/emprestimos/{emprestimo['id']}/cobranca",
        json={"valor_sats": 5000, "valor_centavos_brl": 15000},
    )
    cobranca = resp.json()
    client.post("/pix/webhook", json=_webhook_payload(cobranca["mp_payment_id"]))

    conversao = (
        db_session.query(ConversaoPool)
        .filter(ConversaoPool.pagamento_pix_id.isnot(None))
        .first()
    )
    assert conversao is not None
    assert conversao.status == "concluida"
    assert conversao.quantidade_btc is not None
    assert conversao.quantidade_btc > 0
    assert conversao.binance_order_id.startswith("mock_")
    assert conversao.binance_withdraw_id.startswith("mock_")
