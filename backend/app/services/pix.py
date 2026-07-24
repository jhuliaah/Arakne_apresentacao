"""Mercado Pago Pix API client — creates Pix Cobrança dinâmico charges and
reads back payment status by txid (external_reference).

Falls back to mock mode when MP_ACCESS_TOKEN is unconfigured, same pattern
as services/lnbits.py, so the hackathon demo works before a real Mercado
Pago account is wired up.

Por que Pix Cobrança dinâmico (não uma chave Pix fixa): uma chave fixa não
diz sozinha de qual usuária pseudônima veio um pagamento — atribuir por
nome/CPF de quem enviou exigiria guardar um mapa "identidade real ↔ usuária
pseudônima", que é um ponto único de exposição catastrófica se vazar. Cada
cobrança carrega um txid próprio (nosso `external_reference`); o webhook do
Mercado Pago devolve esse mesmo id, e a atribuição fica automática e
inequívoca, não importa de qual conta bancária ela mandou. Ver seção 8 do
doc mestre.
"""

import logging
import secrets

import httpx

from app.config import MP_ACCESS_TOKEN, MP_API_URL, MP_WEBHOOK_URL, PIX_NOME_RECEBEDOR

logger = logging.getLogger(__name__)


class MercadoPagoPixError(Exception):
    """Erro irrecuperável falando com o Mercado Pago (não cai em mock)."""


class MercadoPagoPixService:
    """Cliente síncrono da API de Pagamentos do Mercado Pago, restrito a Pix.

    Se MP_ACCESS_TOKEN estiver vazio, o serviço inicia em modo mock. Se uma
    chamada real falhar em runtime, cai pra mock só naquela chamada — ao
    contrário do LNbits, aqui um 5xx passageiro do PSP não deve travar o
    serviço inteiro pro resto da sessão, então cada método trata sua própria
    falha (não existe um "self._mock = True" permanente pós-erro).
    """

    def __init__(self, access_token: str, base_url: str):
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self._mock = not bool(access_token)
        self._is_test_credential = access_token.startswith("TEST-")
        # Mapa mp_payment_id -> txid, só usado em modo mock: permite que
        # consultar_pagamento() devolva o external_reference certo depois,
        # como o Mercado Pago real faria — sem isso, uma segunda chamada
        # mock não teria como saber qual txid corresponde a qual pagamento.
        self._mock_txids: dict[str, str] = {}

    @property
    def is_mock(self) -> bool:
        return self._mock

    def _headers(self, idempotency_key: str | None = None) -> dict:
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key
        return headers

    # ── Mock helpers ─────────────────────────────────────────────

    def _mock_cobranca(self, valor_brl: float, txid: str) -> dict:
        mp_payment_id = "mock_" + secrets.token_hex(8)
        self._mock_txids[mp_payment_id] = txid
        return {
            "mp_payment_id": mp_payment_id,
            "txid": txid,
            "status": "pending",
            "qr_code": f"00020126mockpix{txid}52040000530398654{valor_brl:.2f}5802BR6009MOCKCITY",
            "qr_code_base64": "",
            "ticket_url": f"https://mock.mercadopago.local/pix/{txid}",
        }

    def _mock_consulta(self, mp_payment_id: str) -> dict:
        return {
            "mp_payment_id": mp_payment_id,
            "status": "approved",
            "external_reference": self._mock_txids.get(mp_payment_id),
        }

    @staticmethod
    def _mock_payout(chave_pix: str, valor_centavos_brl: int) -> dict:
        return {
            "id": "mock-payout-" + secrets.token_hex(8),
            "status": "approved",
            "chave_pix": chave_pix,
            "valor_centavos_brl": valor_centavos_brl,
        }

    @staticmethod
    def _detectar_tipo_chave_pix(chave: str) -> str:
        """Detecta o tipo de chave Pix a partir do formato.

        Heurística simples (não exaustiva — cobre os 4 tipos do Banco Central):
          - CPF: 11 dígitos numéricos
          - CNPJ: 14 dígitos numéricos
          - telefone: +5511999999999 ou 5511999999999 (12-13 dígitos)
          - email: contém @
          - aleatória: caso contrário (UUID-like de 32 chars)

        Retorna um dos tipos aceitos pelo Mercado Pago: "CPF", "CNPJ",
        "phone", "email" ou "random".
        """
        chave = chave.strip()
        if "@" in chave:
            return "email"
        digitos = "".join(c for c in chave if c.isdigit())
        if chave.startswith("+") and len(digitos) in (12, 13):
            return "phone"
        if len(digitos) == 11 and not chave.startswith("+"):
            return "CPF"
        if len(digitos) == 14:
            return "CNPJ"
        if len(digitos) in (12, 13) and chave.startswith("55"):
            return "phone"
        return "random"

    # ── API methods ──────────────────────────────────────────────

    def criar_cobranca(self, valor_brl: float, txid: str, descricao: str) -> dict:
        """Cria uma cobrança Pix dinâmica (QR + copia-e-cola) no Mercado Pago.

        `txid` é gravado como `external_reference` — é ele que volta no
        webhook e permite casar o pagamento com o empréstimo certo, sem
        precisar saber quem é a pagadora de verdade.

        Retorna {mp_payment_id, txid, status, qr_code, qr_code_base64, ticket_url}.
        """
        if self._mock:
            return self._mock_cobranca(valor_brl, txid)
        try:
            payer: dict = {"email": f"{txid}@example.com"}
            if self._is_test_credential:
                payer["first_name"] = "APRO"
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    f"{self.base_url}/v1/payments",
                    headers=self._headers(idempotency_key=txid),
                    json={
                        "transaction_amount": round(valor_brl, 2),
                        "description": f"{PIX_NOME_RECEBEDOR} — {descricao}",
                        "payment_method_id": "pix",
                        "external_reference": txid,
                        "notification_url": MP_WEBHOOK_URL or None,
                        "payer": payer,
                    }
                )
                resp.raise_for_status()
                data = resp.json()
                transacao = data.get("point_of_interaction", {}).get("transaction_data", {})
                return {
                    "mp_payment_id": str(data["id"]),
                    "txid": txid,
                    "status": data.get("status", "pending"),
                    "qr_code": transacao.get("qr_code", ""),
                    "qr_code_base64": transacao.get("qr_code_base64", ""),
                    "ticket_url": transacao.get("ticket_url", ""),
                }
        except Exception as e:
            logger.warning("Mercado Pago criar_cobranca falhou — caindo pra mock: %s", e)
            return self._mock_cobranca(valor_brl, txid)

    def consultar_pagamento(self, mp_payment_id: str) -> dict:
        """Consulta o status atual de um pagamento pelo id do Mercado Pago.

        Retorna {mp_payment_id, status, external_reference}. `status` é um
        dos valores nativos do Mercado Pago: "pending", "approved",
        "rejected", "cancelled", etc.
        """
        if self._mock or not mp_payment_id:
            return self._mock_consulta(mp_payment_id)
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{self.base_url}/v1/payments/{mp_payment_id}",
                    headers=self._headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "mp_payment_id": str(data["id"]),
                    "status": data.get("status", "pending"),
                    "external_reference": data.get("external_reference"),
                }
        except Exception as e:
            logger.warning("Mercado Pago consultar_pagamento falhou: %s", e)
            raise MercadoPagoPixError(str(e)) from e

    def pagar_pix(self, chave_pix: str, valor_centavos_brl: int, descricao: str) -> dict:
        """Envia um Pix (Payout) para uma chave Pix qualquer — o rail do
        off-ramp carteira → comerciante.

        Diferente de `criar_cobranca` (que gera um QR pra alguém pagar), aqui
        o dinheiro sai da conta Mercado Pago da fundadora e cai na conta do
        dono da `chave_pix`. Por isso o método é sensível: uma falha real em
        runtime NUNCA cai em mock — levanta MercadoPagoPixError. Fingir que
        "o Pix foi enviado" quando não foi criaria um rombo contábil real
        (usuária viu saldo abatido, comerciante não recebeu).

        Retorna {id, status, chave_pix, valor_centavos_brl}. `status` segue
        os valores nativos do Mercado Pago ("approved" = enviado e creditado).
        """
        if self._mock:
            return self._mock_payout(chave_pix, valor_centavos_brl)
        key_type = self._detectar_tipo_chave_pix(chave_pix)
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    f"{self.base_url}/v1/payments",
                    headers=self._headers(),
                    json={
                        "transaction_amount": valor_centavos_brl / 100,
                        "description": descricao,
                        "payment_method_id": "pix",
                        "pix": {
                            "key": chave_pix,
                            "key_type": key_type,
                        },
                        # Mercado Pago exige um payer com e-mail; a fundadora
                        # é a pagadora aqui (conta do token), usamos um
                        # e-mail sintético por payout.
                        "payer": {"email": "contato@arakne.local"},
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "id": str(data["id"]),
                    "status": data.get("status", "pending"),
                    "chave_pix": chave_pix,
                    "valor_centavos_brl": valor_centavos_brl,
                }
        except Exception as e:
            logger.error("Mercado Pago pagar_pix falhou: %s", e)
            raise MercadoPagoPixError(str(e)) from e

    def buscar_pagamento_por_txid(self, txid: str) -> dict | None:
        """Busca o status de um pagamento no Mercado Pago pelo external_reference.

        Usa GET /v1/payments/search?external_reference={txid} — o mesmo txid
        que gravamos como external_reference em criar_cobranca/depositar.
        Permite confirmar depósitos da carteira via polling no frontend,
        sem depender do webhook (que pode falhar se o túnel cloudflared
        estiver fora do ar).

        Retorna {mp_payment_id, status, external_reference} ou None se
        nenhum pagamento for encontrado para o txid. Em mock, sempre retorna
        "approved" para o txid mapeado.
        """
        if self._mock:
            return self._mock_consulta(self._mock_lookup_id(txid))
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{self.base_url}/v1/payments/search",
                    params={"external_reference": txid},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results") or []
                if not results:
                    return None
                pagamento = results[0]
                return {
                    "mp_payment_id": str(pagamento["id"]),
                    "status": pagamento.get("status", "pending"),
                    "external_reference": pagamento.get("external_reference"),
                }
        except Exception as e:
            logger.warning("Mercado Pago buscar_pagamento_por_txid falhou: %s", e)
            raise MercadoPagoPixError(str(e)) from e

    def _mock_lookup_id(self, txid: str) -> str:
        """Em mock, inverte o mapa _mock_txids pra achar o mp_payment_id
        que corresponde ao txid dado. Se não houver, devolve string vazia
        e _mock_consulta retorna external_reference=None (sem match)."""
        for mp_id, t in self._mock_txids.items():
            if t == txid:
                return mp_id
        return ""

    @staticmethod
    def extrair_payment_id_da_notificacao(payload: dict) -> str | None:
        """Extrai o id de pagamento de um payload de webhook do Mercado Pago.

        O Mercado Pago manda variações de formato ao longo do tempo; cobrimos
        as duas mais comuns:
          - {"type": "payment", "data": {"id": "123"}}
          - {"topic": "payment", "resource": ".../v1/payments/123"}
        Notificações de outros tipos (ex.: "merchant_order") devolvem None —
        o chamador deve ignorá-las sem erro.
        """
        if payload.get("type") == "payment" or payload.get("topic") == "payment":
            data = payload.get("data") or {}
            if isinstance(data, dict) and data.get("id"):
                return str(data["id"])
            resource = payload.get("resource", "")
            if resource:
                return resource.rstrip("/").rsplit("/", 1)[-1]
        return None


# Module-level singleton
pix = MercadoPagoPixService(MP_ACCESS_TOKEN, MP_API_URL)
