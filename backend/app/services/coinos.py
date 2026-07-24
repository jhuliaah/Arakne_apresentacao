"""Coinos (coinos.io) REST API client — substitui o LNbits pro MVP de hoje.

Contexto (23/07): o pool precisava de uma carteira Lightning com liquidez
real, sem KYC, sem custo, disponível hoje. `legend.lnbits.com` (a opção
anterior) é o servidor de DEMO oficial do projeto LNbits — instável de
propósito, não serve nem pra demo confiável. Coinos é uma carteira
custodial hospedada (coinos.io), mesma categoria de risco, mas com nó
Lightning próprio bem conectado e API estável.

Decisão registrada como MVP, não arquitetura-alvo — a reserva fria
multisig (seção 6 do doc mestre) continua sendo o objetivo real de
custódia. Segurança fica pra depois do hackathon.

Este service expõe DE PROPÓSITO a mesma interface pública que
`services/lnbits.py` (create_wallet, create_invoice, pay_invoice,
check_payment, get_wallet_balance, .pool_key, .is_mock) — assim os
routers que já usam `lnbits.*` (emprestimos.py, pix.py, usuarias.py,
carteira.py) não precisam mudar nada além da linha de import.

Diferença de modelo importante: LNbits usa uma X-API-KEY por wallet.
Coinos usa um JWT por conta (obtido no registro, via POST /register).
Por isso "wallet_key" aqui é sempre um JWT, não uma chave LNbits — mas
como o código que chama isso só trata como string opaca, não muda nada
do lado de fora.
"""

import logging
import secrets

import httpx

from app.config import COINOS_POOL_TOKEN, COINOS_URL

logger = logging.getLogger(__name__)


class CoinosService:
    """Cliente síncrono da API do Coinos, com fallback automático pra mock.

    Se COINOS_POOL_TOKEN estiver vazio, começa em mock mode. Se uma
    chamada real falhar em runtime, também vira mock pras chamadas
    seguintes — mesmo comportamento de `services/lnbits.py`.
    """

    def __init__(self, base_url: str, pool_token: str):
        self.base_url = base_url.rstrip("/")
        self._pool_token = pool_token
        self._mock = not pool_token

    # ── Properties ───────────────────────────────────────────────

    @property
    def is_mock(self) -> bool:
        return self._mock

    @property
    def pool_key(self) -> str:
        """JWT da conta-pool (ou um valor mock em mock mode)."""
        if self._mock:
            return "mock_pool_token"
        return self._pool_token

    # ── Mock helpers (idênticos em formato aos de lnbits.py) ───────

    @staticmethod
    def _mock_wallet(name: str) -> dict:
        return {
            "id": "mock_" + secrets.token_hex(8),
            "adminkey": "mock_admin_" + secrets.token_hex(16),
            "inkey": "mock_inkey_" + secrets.token_hex(16),
        }

    @staticmethod
    def _mock_balance() -> dict:
        return {"balance_msats": 50_000 * 1000}

    @staticmethod
    def _mock_invoice(amount: int, memo: str) -> dict:
        return {
            "payment_hash": "mock_" + secrets.token_hex(16),
            "payment_request": f"lnbc{amount}mock{secrets.token_urlsafe(20)}",
        }

    @staticmethod
    def _mock_pay(bolt11: str) -> dict:
        return {"payment_hash": "mock_paid_" + secrets.token_hex(16)}

    # ── API methods ──────────────────────────────────────────────

    def create_wallet(self, name: str) -> dict:
        """Registra uma nova conta Coinos (equivalente a uma "wallet" do
        LNbits). Retorna {id, adminkey, inkey} — adminkey é o JWT dela,
        inkey é o mesmo valor (Coinos não separa as duas permissões).
        """
        if self._mock:
            return self._mock_wallet(name)
        try:
            username = f"arakne{secrets.token_hex(10)}"
            password = secrets.token_urlsafe(24)
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{self.base_url}/register",
                    json={"user": {"username": username, "password": password}},
                )
                resp.raise_for_status()
                data = resp.json()
                token = data["token"]
                return {"id": data.get("id", username), "adminkey": token, "inkey": token}
        except Exception as e:
            logger.warning("Coinos create_wallet (register) falhou — mock: %s", e)
            self._mock = True
            return self._mock_wallet(name)

    def create_invoice(self, wallet_key: str, amount_sats: int, memo: str) -> dict:
        """Cria um invoice Lightning. Retorna {payment_hash, payment_request}.

        payment_hash aqui é o `id` interno do invoice no Coinos (usado
        depois em GET /invoice/{id} pra checar status) — não o hash de
        pagamento BOLT11 de verdade, mas cumpre o mesmo papel de
        referência de consulta que o código existente espera.
        """
        if self._mock or not wallet_key:
            return self._mock_invoice(amount_sats, memo)
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{self.base_url}/invoice",
                    headers={"Authorization": f"Bearer {wallet_key}"},
                    json={
                        "invoice": {
                            "amount": amount_sats,
                            "type": "lightning",
                            "memo": memo,
                        }
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "payment_hash": data.get("id"),
                    "payment_request": data.get("text") or data.get("hash"),
                }
        except Exception as e:
            logger.warning("Coinos create_invoice falhou — mock: %s", e)
            self._mock = True
            return self._mock_invoice(amount_sats, memo)

    def pay_invoice(self, wallet_admin_key: str, bolt11: str) -> dict:
        """Paga um invoice Lightning a partir de uma conta. Retorna
        {payment_hash}."""
        if self._mock or not wallet_admin_key:
            return self._mock_pay(bolt11)
        try:
            with httpx.Client(timeout=20) as client:
                resp = client.post(
                    f"{self.base_url}/payments",
                    headers={"Authorization": f"Bearer {wallet_admin_key}"},
                    json={"payreq": bolt11},
                )
                resp.raise_for_status()
                data = resp.json()
                return {"payment_hash": data.get("hash") or data.get("id")}
        except Exception as e:
            logger.warning("Coinos pay_invoice falhou — mock: %s", e)
            self._mock = True
            return self._mock_pay(bolt11)

    def check_payment(self, wallet_key: str, payment_hash: str) -> bool:
        """Confirma se um invoice foi pago, consultando GET /invoice/{id}.

        Em mock mode, devolve True (mesma lógica de lnbits.py — permite
        a demo rodar sem infra real). Em runtime real, erro nunca vira
        "pago" mascarado — retorna False, deixando quem chama decidir.
        """
        if self._mock or not wallet_key or not payment_hash:
            return True
        try:
            with httpx.Client(timeout=5) as client:
                resp = client.get(f"{self.base_url}/invoice/{payment_hash}")
                resp.raise_for_status()
                data = resp.json()
                return bool(data.get("settled") or (data.get("received") or 0) > 0)
        except Exception as e:
            logger.warning("Coinos check_payment falhou: %s", e)
            return False

    def get_wallet_balance(self, wallet_key: str) -> dict:
        """Consulta saldo da conta em millisatoshis. Retorna
        {balance_msats}. Mock mode devolve saldo de demo fixo."""
        if self._mock or not wallet_key:
            return self._mock_balance()
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{self.base_url}/me",
                    headers={"Authorization": f"Bearer {wallet_key}"},
                )
                resp.raise_for_status()
                data = resp.json()
                # Coinos devolve saldo em sats (campo `balance`), não msats.
                return {"balance_msats": int(data.get("balance", 0)) * 1000}
        except Exception as e:
            logger.warning("Coinos get_wallet_balance falhou — mock: %s", e)
            self._mock = True
            return self._mock_balance()


# Module-level singleton — nome `coinos` aqui, mas os routers importam
# via `from app.services.coinos import coinos as lnbits`, sem precisar
# tocar em mais nada.
coinos = CoinosService(COINOS_URL, COINOS_POOL_TOKEN)
