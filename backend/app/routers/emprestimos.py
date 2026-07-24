"""Router for Emprestimo endpoints — create, pay, and check loans.

Disguise: empréstimo = "kit de material", quitação = "padrão concluído".
These disguised terms appear in LNbits invoice memos, not in API field names.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import _naive_utc
from app.database import get_db
from app.models.emprestimo import Emprestimo
from app.models.usuaria import Usuaria
from app.schemas.emprestimo import (
    EmprestimoCreateRequest,
    EmprestimoCreateResponse,
    EmprestimoResponse,
    PagamentoRequest,
    PagamentoResponse,
)
from app.services.coinos import coinos as lnbits
from app.services.risco import ao_quitar, limite_por_tier, pode_emprestar

router = APIRouter(prefix="/emprestimos", tags=["emprestimos"])


@router.post(
    "/{identificador}",
    response_model=EmprestimoCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Solicitar empréstimo (kit de material)",
    description="Valida elegibilidade, gera invoice Lightning, paga da wallet pool, registra empréstimo ativo. "
    "O body é opcional: sem `valor_sats`, solicita o limite disponível inteiro; com `valor_sats`, solicita "
    "aquele valor parcial (incrementa `saldo_devedor` em vez de sobrescrevê-lo).",
)
def create_emprestimo(
    identificador: str,
    payload: EmprestimoCreateRequest | None = None,
    db: Session = Depends(get_db),
):
    usuaria = (
        db.query(Usuaria)
        .filter(Usuaria.identificador == identificador)
        .first()
    )
    if not usuaria:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuária não encontrada")

    if not pode_emprestar(usuaria):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Usuária não pode pegar empréstimo no momento",
        )

    limite = limite_por_tier(usuaria.tier)
    disponivel = limite - usuaria.saldo_devedor

    # Sem body → solicita o limite disponível inteiro; com body → valor parcial.
    valor = payload.valor_sats if payload and payload.valor_sats else disponivel
    if valor <= 0 or valor > disponivel:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Valor inválido: disponível é {disponivel} sats",
        )

    # Ensure user has an LNbits wallet (create if missing)
    if not usuaria.lnbits_wallet_key:
        wallet = lnbits.create_wallet(f"usuaria_{usuaria.identificador}")
        usuaria.lnbits_wallet_key = wallet["adminkey"]

    # Create invoice on user's wallet (simulates credit disbursement)
    invoice = lnbits.create_invoice(
        usuaria.lnbits_wallet_key, valor, "kit de material"
    )

    # Pool wallet pays the invoice (sats flow: pool → user)
    lnbits.pay_invoice(lnbits.pool_key, invoice["payment_request"])

    emprestimo = Emprestimo(
        usuaria_id=usuaria.id,
        valor_sats=valor,
        invoice_id=invoice["payment_hash"],
        status="ativo",
    )
    # Incrementa (não sobrescreve) o saldo devedor — assim empréstimos
    # parciais acumulam e o limite disponível diminui corretamente.
    usuaria.saldo_devedor += valor
    db.add(emprestimo)
    db.commit()
    db.refresh(emprestimo)

    return EmprestimoCreateResponse(
        id=emprestimo.id,
        usuaria_id=emprestimo.usuaria_id,
        valor_sats=emprestimo.valor_sats,
        invoice_id=emprestimo.invoice_id,
        status=emprestimo.status,
        criado_em=emprestimo.criado_em,
        quitado_em=emprestimo.quitado_em,
        invoice_bolt11=invoice.get("payment_request"),
    )


@router.post(
    "/{emprestimo_id}/pagamento",
    response_model=PagamentoResponse,
    summary="Pagar empréstimo (concluir padrão)",
    description="Recebe um valor, atualiza saldo_devedor. Se zerar, chama ao_quitar() e marca como quitado.",
)
def pagar_emprestimo(
    emprestimo_id: int,
    payload: PagamentoRequest,
    db: Session = Depends(get_db),
):
    emprestimo = (
        db.query(Emprestimo).filter(Emprestimo.id == emprestimo_id).first()
    )
    if not emprestimo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empréstimo não encontrado")
    if emprestimo.status == "quitado":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empréstimo já quitado")

    usuaria = emprestimo.usuaria
    valor = payload.valor_sats

    # Create invoice on pool wallet (user pays back: user → pool)
    invoice = lnbits.create_invoice(lnbits.pool_key, valor, "padrão concluído")

    # User's wallet pays the invoice
    if usuaria.lnbits_wallet_key:
        lnbits.pay_invoice(usuaria.lnbits_wallet_key, invoice["payment_request"])

    usuaria.saldo_devedor = max(0, usuaria.saldo_devedor - valor)
    quitado = False

    if usuaria.saldo_devedor == 0:
        ao_quitar(usuaria)
        emprestimo.status = "quitado"
        emprestimo.quitado_em = _naive_utc(datetime.now(UTC))
        quitado = True

    db.commit()

    return PagamentoResponse(
        emprestimo_id=emprestimo.id,
        valor_pago=valor,
        saldo_devedor=usuaria.saldo_devedor,
        quitado=quitado,
        tier=usuaria.tier,
    )


@router.get(
    "/{emprestimo_id}",
    response_model=EmprestimoResponse,
    summary="Detalhes de um empréstimo",
)
def get_emprestimo(emprestimo_id: int, db: Session = Depends(get_db)):
    emprestimo = (
        db.query(Emprestimo).filter(Emprestimo.id == emprestimo_id).first()
    )
    if not emprestimo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empréstimo não encontrado")
    return emprestimo


@router.get(
    "/{emprestimo_id}/status",
    summary="Verificar status de pagamento no LNbits (polling)",
)
def check_payment_status(emprestimo_id: int, db: Session = Depends(get_db)):
    """Poll LNbits to confirm if a Lightning payment was received."""
    emprestimo = (
        db.query(Emprestimo).filter(Emprestimo.id == emprestimo_id).first()
    )
    if not emprestimo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empréstimo não encontrado")

    paid = (
        lnbits.check_payment(lnbits.pool_key, emprestimo.invoice_id)
        if emprestimo.invoice_id
        else False
    )

    return {
        "id": emprestimo.id,
        "status": emprestimo.status,
        "paid": paid,
        "saldo_devedor": emprestimo.usuaria.saldo_devedor,
    }
