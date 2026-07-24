"""Pydantic schemas for the custódia (reserva fria) reference endpoint."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CustodiaMultisigResponse(BaseModel):
    """Dados públicos da reserva fria — nunca inclui chave privada."""

    model_config = ConfigDict(from_attributes=True)

    descriptor: str
    endereco: str
    quorum: str
    total_signatarios: int
    network: str
    criado_em: datetime


class CustodiaMultisigVazia(BaseModel):
    """Retornado quando ainda não há multisig registrada (nem em env, nem no banco)."""

    configurado: bool = False
    mensagem: str = (
        "Nenhuma reserva fria registrada ainda. Rode scripts/gerar_multisig.py "
        "e preencha MULTISIG_DESCRIPTOR/MULTISIG_ENDERECO no .env, ou insira uma "
        "linha em custodia_multisig."
    )
