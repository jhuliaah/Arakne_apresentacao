#!/usr/bin/env python3
"""Arakne — Roteiro automatizado da demo do júri.

Executa o fluxo completo ponta-a-ponta via API:
1. Seed (reseta banco + cria Usuária A em tier 1)
2. Usuária B nasce pelo convite de A (POST /usuarias com codigo_indicacao)
3. Verifica tier 1 liberado para B
4. B pede empréstimo (tier 1 = 5.000 sats)
5. B paga parcialmente (2.000 sats) → saldo abaixa para 3.000
6. B paga o restante (3.000 sats) → tier sobe para 2
7. Verifica tier 2 e saldo zerado

Uso:
    cd backend
    python run_demo.py [--api-url http://localhost:8000]

Pré-requisitos:
    - Backend rodando (uvicorn app.main:app --port 8000)
    - python seed_demo.py executado ANTES (ou este script roda o seed)

Tempo total esperado: < 10 segundos (mock mode, sem rede Lightning real).
"""

import argparse
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

# Ensure we can import from app/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_API_URL = "http://localhost:8000"

# ── Colors (ANSI) ───────────────────────────────────────────
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"


def ok(msg: str):
    print(f"  {GREEN}✓{RESET} {msg}")


def fail(msg: str):
    print(f"  {RED}✗ {msg}{RESET}")


def step(msg: str):
    print(f"\n{BOLD}▶ {msg}{RESET}")


def info(msg: str):
    print(f"  {YELLOW}ℹ{RESET} {msg}")


# ── HTTP helpers ────────────────────────────────────────────

def api_post(url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    data = json.dumps(body or {}).encode("utf-8")
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    req = Request(url, data=data, headers=hdrs, method="POST")
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def api_get(url: str, headers: dict | None = None) -> dict:
    req = Request(url, headers=headers or {}, method="GET")
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def wait_for_backend(api_url: str, timeout: int = 30):
    """Wait for the backend to be ready."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            api_get(f"{api_url}/health")
            return True
        except Exception:
            time.sleep(0.5)
    return False


# ── Demo flow ────────────────────────────────────────────────

def run_demo(api_url: str):
    total_start = time.time()

    step("0. Verificando backend...")
    if not wait_for_backend(api_url):
        fail("Backend não respondeu em 30s — rode: uvicorn app.main:app --port 8000")
        sys.exit(1)
    health = api_get(f"{api_url}/health")
    assert health["status"] == "ok"
    ok(f"Backend OK ({api_url})")

    step("1. Seed — resetando banco + criando Fundadora...")
    # Import and run seed directly (same process)
    from seed_demo import reset_database, seed_fundadora
    reset_database()
    seed_fundadora()
    ok("Fundadora pronta (tier 3, saldo 0)")

    step("2. Usuária B nasce pelo convite da Fundadora...")
    # POST /usuarias with codigo_indicacao = Fundadora's invite code
    b_resp = api_post(f"{api_url}/usuarias", {
        "pin": "5678",
        "codigo_indicacao": "FUNDADORA_INVITE",
    })
    b_ident = b_resp["identificador"]
    ok(f"Usuária B criada: {b_ident}")
    assert b_resp["tier"] == 1, f"Expected tier 1, got {b_resp['tier']}"
    ok(f"B já nasce com tier 1 (aval automático) ✓")
    assert b_resp["saldo_devedor"] == 0
    assert b_resp["tier_congelado"] is False
    info(f"codigo_indicacao de B: {b_resp['codigo_indicacao']}")

    step("3. B pede empréstimo (tier 1 = 5.000 sats)...")
    emp_resp = api_post(f"{api_url}/emprestimos/{b_ident}")
    assert emp_resp["status"] == "ativo"
    assert emp_resp["valor_sats"] == 5000
    assert emp_resp["invoice_bolt11"] is not None
    emp_id = emp_resp["id"]
    ok(f"Empréstimo #{emp_id} criado — 5.000, status ativo")
    ok(f"Invoice bolt11: {emp_resp['invoice_bolt11'][:40]}...")

    step("4. B paga parcialmente (2.000 sats)...")
    pag_resp = api_post(
        f"{api_url}/emprestimos/{emp_id}/pagamento",
        {"valor_sats": 2000},
    )
    assert pag_resp["quitado"] is False
    assert pag_resp["saldo_devedor"] == 3000
    assert pag_resp["tier"] == 1  # tier não muda com parcial
    ok(f"Pagamento parcial: 2.000 → saldo = {pag_resp['saldo_devedor']}")
    ok(f"Tier permanece {pag_resp['tier']} (não quita → não sobe)")

    step("5. B paga o restante (3.000 sats)...")
    pag_resp2 = api_post(
        f"{api_url}/emprestimos/{emp_id}/pagamento",
        {"valor_sats": 3000},
    )
    assert pag_resp2["quitado"] is True
    assert pag_resp2["saldo_devedor"] == 0
    assert pag_resp2["tier"] == 2  # tier subiu 1 → 2
    ok(f"Pagamento final: 3.000 → saldo = {pag_resp2['saldo_devedor']}")
    ok(f"🎉 Tier subiu de 1 para {pag_resp2['tier']} (Artesã)!")

    step("6. Verificação final...")
    emp_final = api_get(f"{api_url}/emprestimos/{emp_id}")
    assert emp_final["status"] == "quitado"
    ok(f"Empréstimo #{emp_id}: status = quitado")

    # Login as B and check /usuarias/me
    login_resp = api_post(f"{api_url}/login", {
        "identificador": b_ident,
        "pin": "5678",
    })
    token = login_resp["token"]
    me = api_get(f"{api_url}/usuarias/me", {"Authorization": f"Bearer {token}"})
    assert me["tier"] == 2
    assert me["saldo_devedor"] == 0
    assert me["tier_congelado"] is False
    ok(f"GET /usuarias/me: tier={me['tier']}, saldo={me['saldo_devedor']}, congelado={me['tier_congelado']}")

    total_time = time.time() - total_start
    print(f"\n{GREEN}{BOLD}═══════════════════════════════════════════════{RESET}")
    print(f"{GREEN}{BOLD}  DEMA COMPLETA — {total_time:.2f}s{RESET}")
    print(f"{GREEN}{BOLD}  Todos os 6 passos passaram sem erro{RESET}")
    print(f"{GREEN}{BOLD}═══════════════════════════════════════════════{RESET}")
    print(f"\n  Tempo total: {total_time:.2f}s (meta: < 3 min = 180s)")
    print(f"  Status: {GREEN}PASS{RESET}")

    if total_time > 180:
        fail(f"ATENÇÃO: demorou {total_time:.1f}s — mais que 3 minutos!")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Roteiro da demo Arakne")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="URL do backend")
    args = parser.parse_args()
    run_demo(args.api_url)
