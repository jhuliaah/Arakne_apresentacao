"""Router for Pix endpoints — gerar cobrança dinâmica e receber webhook do
Mercado Pago.

Este é o rail *real* de repagamento (dinheiro sai da conta bancária dela).
Não substitui `/emprestimos/{id}/pagamento` (Lightning simulado) — os dois
convivem; o Pix é o caminho que a usuária de verdade usa fora do app.

Disfarce: "cobrança" aparece na UI como "concluir o padrão", nunca como
fatura ou empréstimo (ver seção 2 do doc mestre). Aqui na API os nomes já
são técnicos de propósito — a camada de disfarce é responsabilidade do
frontend.
"""

import logging
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import _naive_utc
from app.database import get_db
from app.models.conversao_pool import ConversaoPool
from app.models.emprestimo import Emprestimo
from app.models.pagamento_pix import PagamentoPix
from app.models.transacao_carteira import TransacaoCarteira
from app.schemas.pix import (
    CobrancaPixRequest,
    CobrancaPixResponse,
    PagamentoPixResponse,
    WebhookPixResponse,
)
from app.services.exchange import BinanceError, exchange
from app.services.coinos import coinos as lnbits
from app.services.pix import MercadoPagoPixError, pix
from app.services.risco import ao_quitar

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pix", tags=["pix"])


def _gerar_txid(emprestimo_id: int) -> str:
    """Referência única por transação — nunca reaproveitada, nunca ligada a
    identidade real. Ver docstring de services/pix.py."""
    return f"arakne-{emprestimo_id}-{secrets.token_hex(6)}"


@router.post(
    "/emprestimos/{emprestimo_id}/cobranca",
    response_model=CobrancaPixResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Gerar cobrança Pix dinâmica pra repagar um kit",
    description="Cria um QR/copia-e-cola próprio da transação (txid único). "
    "Quando ela pagar, o webhook do Mercado Pago confirma automaticamente.",
)
def criar_cobranca_pix(
    emprestimo_id: int,
    payload: CobrancaPixRequest,
    db: Session = Depends(get_db),
):
    emprestimo = db.query(Emprestimo).filter(Emprestimo.id == emprestimo_id).first()
    if not emprestimo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empréstimo não encontrado")
    if emprestimo.status == "quitado":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empréstimo já quitado")
    if payload.valor_sats > emprestimo.usuaria.saldo_devedor:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "valor_sats maior que o saldo devedor atual",
        )

    txid = _gerar_txid(emprestimo_id)
    resultado = pix.criar_cobranca(
        valor_brl=payload.valor_centavos_brl / 100,
        txid=txid,
        descricao="padrão concluído",
    )

    pagamento = PagamentoPix(
        emprestimo_id=emprestimo_id,
        txid=txid,
        mp_payment_id=resultado["mp_payment_id"],
        valor_sats=payload.valor_sats,
        valor_centavos_brl=payload.valor_centavos_brl,
        status="pendente",
        qr_code=resultado["qr_code"],
    )
    db.add(pagamento)
    db.commit()

    return CobrancaPixResponse(
        txid=txid,
        mp_payment_id=resultado["mp_payment_id"],
        status=resultado["status"],
        qr_code=resultado["qr_code"],
        qr_code_base64=resultado["qr_code_base64"],
        ticket_url=resultado["ticket_url"],
        valor_sats=payload.valor_sats,
        valor_centavos_brl=payload.valor_centavos_brl,
    )


@router.get(
    "/pagamentos/{txid}",
    response_model=PagamentoPixResponse,
    summary="Consultar status de uma cobrança Pix pelo txid",
    description="Útil como fallback por polling se o webhook não estiver "
    "configurado (ex.: rodando local sem túnel público).",
)
def consultar_pagamento_pix(txid: str, db: Session = Depends(get_db)):
    pagamento = db.query(PagamentoPix).filter(PagamentoPix.txid == txid).first()
    if not pagamento:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cobrança não encontrada")
    return pagamento


def _confirmar_pagamento(pagamento: PagamentoPix, db: Session) -> None:
    """Efeitos de um Pix confirmado: abate saldo_devedor, reusa ao_quitar()
    se zerar — o mesmo gatilho que o fluxo Lightning já usa (routers/
    emprestimos.py), só trocando a origem do evento (webhook Pix em vez de
    polling LNbits)."""
    if pagamento.status == "aprovado":
        return  # idempotente — webhook pode reenviar a mesma notificação

    pagamento.status = "aprovado"
    pagamento.confirmado_em = _naive_utc(datetime.now(UTC))

    emprestimo = pagamento.emprestimo
    usuaria = emprestimo.usuaria
    usuaria.saldo_devedor = max(0, usuaria.saldo_devedor - pagamento.valor_sats)

    if usuaria.saldo_devedor == 0 and emprestimo.status != "quitado":
        ao_quitar(usuaria)
        emprestimo.status = "quitado"
        emprestimo.quitado_em = _naive_utc(datetime.now(UTC))

    db.commit()

    # A partir daqui a dívida da usuária já está quitada e commitada — o que
    # segue é só o "passo 4" (BRL→sats de volta pro pool). Roda numa etapa
    # separada, deliberadamente: uma falha aqui (Binance fora do ar, saldo
    # insuficiente, etc.) NUNCA pode reverter nem atrasar a confirmação dela.
    _depositar_no_pool(pagamento, db)


def _depositar_no_pool(pagamento: PagamentoPix, db: Session) -> None:
    """Converte o BRL recebido em sats e credita a wallet-pool via Lightning.

    Decisão de denominação: o valor SACADO da corretora e depositado no pool
    é fixado em `pagamento.valor_sats` (o que foi de fato abatido da dívida
    dela) — não em "quanto BTC o valor_brl comprou". Se o preço do BTC
    variou entre o repagamento dela e essa conversão, o fundo absorve a
    diferença — mesmo princípio já registrado na seção 9 do doc mestre
    (proteção cambial do empréstimo: "a diferença é absorvida pelo fundo,
    não pela mutuária"), só que do lado do repagamento em vez do empréstimo.
    """
    conversao = ConversaoPool(
        pagamento_pix_id=pagamento.id,
        valor_centavos_brl=pagamento.valor_centavos_brl,
        status="pendente",
    )
    db.add(conversao)
    db.commit()
    db.refresh(conversao)

    try:
        compra = exchange.comprar_btc_mercado(pagamento.valor_centavos_brl / 100)
        conversao.binance_order_id = compra["order_id"]
        conversao.quantidade_btc = compra["quantidade_btc"]
        conversao.preco_medio_brl = compra["preco_medio"]

        invoice = lnbits.create_invoice(
            lnbits.pool_key,
            amount_sats=pagamento.valor_sats,
            memo=f"conversao-{pagamento.txid}",
        )

        valor_btc_saque = pagamento.valor_sats / 100_000_000
        saque = exchange.sacar_lightning(
            invoice=invoice["payment_request"], valor_btc=valor_btc_saque
        )
        conversao.binance_withdraw_id = saque["withdraw_id"]
        conversao.status = "concluida"
        conversao.concluido_em = _naive_utc(datetime.now(UTC))
    except BinanceError as e:
        logger.error(
            "Conversão BRL→sats falhou pro pagamento %s (dívida da usuária já "
            "quitada, isso é só pendência de reconciliação): %s",
            pagamento.txid,
            e,
        )
        conversao.status = "falhou"
        conversao.erro = str(e)
    except Exception as e:
        # Qualquer outra falha inesperada — nunca deixa propagar e derrubar
        # o webhook (a resposta ao Mercado Pago precisa ser 200 de qualquer
        # jeito, o repagamento dela já foi confirmado antes desta função).
        logger.error(
            "Conversão BRL→sats falhou de forma inesperada pro pagamento %s: %s",
            pagamento.txid,
            e,
        )
        conversao.status = "falhou"
        conversao.erro = str(e)

    db.commit()


@router.post(
    "/webhook",
    response_model=WebhookPixResponse,
    summary="Webhook do Mercado Pago — confirmação de pagamento Pix",
    description="Endpoint público (sem auth — o Mercado Pago não manda Bearer "
    "token nosso). Sempre responde 200 pra evitar reenvio em loop; notificações "
    "irrelevantes ou de txid desconhecido são silenciosamente ignoradas.",
)
async def webhook_pix(request: Request, db: Session = Depends(get_db)):
    try:
        payload = await request.json()
    except Exception:
        return WebhookPixResponse(ok=True)

    mp_payment_id = pix.extrair_payment_id_da_notificacao(payload)
    if not mp_payment_id:
        return WebhookPixResponse(ok=True)  # notificação de outro tipo (ex.: merchant_order)

    try:
        detalhe = pix.consultar_pagamento(mp_payment_id)
    except MercadoPagoPixError:
        # Deixa o Mercado Pago reenviar mais tarde em vez de mascarar como sucesso.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Falha ao consultar pagamento")

    if detalhe["status"] != "approved":
        return WebhookPixResponse(ok=True)

    pagamento = (
        db.query(PagamentoPix).filter(PagamentoPix.mp_payment_id == mp_payment_id).first()
    )
    if pagamento:
        _confirmar_pagamento(pagamento, db)
        return WebhookPixResponse(ok=True)

    # Não é repagamento de empréstimo — pode ser um depósito de carteira
    # (routers/carteira.py::depositar), que não cria PagamentoPix (essa
    # tabela é só pra repagamento). Casa pelo txid (external_reference)
    # em vez de mp_payment_id, já que é isso que a carteira guarda.
    txid = detalhe.get("external_reference")
    transacao = (
        db.query(TransacaoCarteira).filter(TransacaoCarteira.txid == txid).first()
        if txid
        else None
    )
    if transacao and transacao.status == "pendente":
        transacao.status = "concluida"
        db.commit()
        # Nota: isso só confirma a linha do extrato. Creditar sats de
        # verdade na wallet LNbits da usuária (a partir do BRL recebido)
        # é uma etapa separada, ainda não implementada aqui — mesmo
        # descompasso já registrado no doc mestre (carteira individual
        # ainda não tem fluxo de crédito real conectado).
        return WebhookPixResponse(ok=True)

    if not transacao:
        logger.warning("Webhook Pix: mp_payment_id %s sem cobrança correspondente", mp_payment_id)
    return WebhookPixResponse(ok=True)
