"""LNbits REST API client — creates wallets, invoices, and payments.

Falls back to mock mode when LNbits is unreachable or unconfigured,
so the hackathon demo works even without a running Lightning node.
"""

import logging
import secrets

import httpx

from app.config import LNBITS_ADMIN_KEY, LNBITS_POOL_KEY, LNBITS_URL

logger = logging.getLogger(__name__)


class LNbitsService:
    """Synchronous LNbits API client with automatic mock fallback.

    If LNBITS_ADMIN_KEY or LNBITS_POOL_KEY are empty, the service starts
    in mock mode. If a real API call fails at runtime, it also switches
    to mock mode for all subsequent calls.
    """

    def __init__(self, base_url: str, admin_key: str, pool_key: str):
        self.base_url = base_url.rstrip("/")
        self.admin_key = admin_key
        self._pool_key = pool_key
        self._mock = not (admin_key and pool_key)

    # ── Properties ───────────────────────────────────────────────

    @property
    def is_mock(self) -> bool:
        return self._mock

    @property
    def pool_key(self) -> str:
        """Pool wallet admin key (or a mock value in mock mode)."""
        if self._mock:
            return "mock_pool_key"
        return self._pool_key

    # ── Mock helpers ─────────────────────────────────────────────

    @staticmethod
    def _mock_wallet(name: str) -> dict:
        return {
            "id": "mock_" + secrets.token_hex(8),
            "adminkey": "mock_admin_" + secrets.token_hex(16),
            "inkey": "mock_inkey_" + secrets.token_hex(16),
        }

    @staticmethod
    def _mock_balance() -> dict:
        # Saldo fixo de demo — 50.000 sats. Determinístico pra testes.
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
        """Create a new wallet in LNbits. Returns {id, adminkey, inkey}."""
        if self._mock:
            return self._mock_wallet(name)
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{self.base_url}/api/v1/wallet",
                    headers={"X-API-KEY": self.admin_key},
                    json={"name": name},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning("LNbits create_wallet failed — switching to mock: %s", e)
            self._mock = True
            return self._mock_wallet(name)

    def create_invoice(self, wallet_key: str, amount_sats: int, memo: str) -> dict:
        """Create a Lightning invoice. Returns {payment_hash, payment_request}."""
        if self._mock or not wallet_key:
            return self._mock_invoice(amount_sats, memo)
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{self.base_url}/api/v1/payments",
                    headers={"X-API-KEY": wallet_key},
                    json={"out": False, "amount": amount_sats, "memo": memo},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning("LNbits create_invoice failed — switching to mock: %s", e)
            self._mock = True
            return self._mock_invoice(amount_sats, memo)

    def pay_invoice(self, wallet_admin_key: str, bolt11: str) -> dict:
        """Pay a Lightning invoice from a wallet. Returns {payment_hash}."""
        if self._mock or not wallet_admin_key:
            return self._mock_pay(bolt11)
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    f"{self.base_url}/api/v1/payments",
                    headers={"X-API-KEY": wallet_admin_key},
                    json={"out": True, "bolt11": bolt11},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning("LNbits pay_invoice failed — switching to mock: %s", e)
            self._mock = True
            return self._mock_pay(bolt11)

    def check_payment(self, wallet_key: str, payment_hash: str) -> bool:
        """Check if an invoice has been paid.

        Em mock mode, devolve True (simula pagamento confirmado) — o mock
        existe pra a demo funcionar sem um nó Lightning real, então fingir
        "pago" é o comportamento esperado.

        Em runtime real, uma falha de rede/API NÃO pode mascarar como
        "pago" um pagamento que não sabemos se foi confirmado — isso
        faria o motor de risco subir tier de uma usuária que talvez nem
        tenha pago. Retorna False em erro, deixando quem chama decidir
        (polling de novo, alertar, etc.).
        """
        if self._mock or not wallet_key:
            return True
        try:
            with httpx.Client(timeout=5) as client:
                resp = client.get(
                    f"{self.base_url}/api/v1/payments/{payment_hash}",
                    headers={"X-API-KEY": wallet_key},
                )
                resp.raise_for_status()
                return resp.json().get("paid", False)
        except Exception as e:
            logger.warning("LNbits check_payment failed: %s", e)
            return False

    def get_wallet_balance(self, wallet_key: str) -> dict:
        """Consulta o saldo de uma wallet em millisatoshis.

        Retorna {balance_msats}. Em mock mode, devolve um saldo de demo
        fixo (50.000 sats) pra a UI da carteira ter o que mostrar.
        """
        if self._mock or not wallet_key:
            return self._mock_balance()
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{self.base_url}/api/v1/wallet",
                    headers={"X-API-KEY": wallet_key},
                )
                resp.raise_for_status()
                data = resp.json()
                # LNbits devolve saldo em millisatoshis.
                return {"balance_msats": int(data.get("balance", 0))}
        except Exception as e:
            logger.warning("LNbits get_wallet_balance failed — switching to mock: %s", e)
            self._mock = True
            return self._mock_balance()


# Module-level singleton
lnbits = LNbitsService(LNBITS_URL, LNBITS_ADMIN_KEY, LNBITS_POOL_KEY)
