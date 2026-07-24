"""Registra a conta Coinos dedicada ao pool, uma única vez.

Uso:
    cd backend
    python scripts/registrar_coinos_pool.py

Imprime o JWT — copie pro .env como COINOS_POOL_TOKEN=<token>.

⚠️ Guarde o username/senha impressos também (num lugar seguro, não no
git) — é a única forma de logar de novo nessa conta manualmente se
precisar (ex.: ver o saldo pela interface web do coinos.io).
"""

import secrets
import sys

import httpx

COINOS_URL = "https://coinos.io/api"


def main():
    username = f"arakne{secrets.token_hex(6)}"
    password = secrets.token_urlsafe(24)

    print(f"Registrando conta Coinos: {username}")
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                f"{COINOS_URL}/register",
                json={"user": {"username": username, "password": password}},
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": (
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                    ),
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        print(f"Falhou: {e.response.status_code} — {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Falhou: {e}", file=sys.stderr)
        sys.exit(1)

    token = data.get("token")
    if not token:
        print(f"Resposta sem token, algo mudou na API: {data}", file=sys.stderr)
        sys.exit(1)

    print()
    print("✅ Conta registrada com sucesso.")
    print(f"   username: {username}")
    print(f"   password: {password}  (guarde num lugar seguro, não commite)")
    print()
    print("Cole isto no seu .env:")
    print(f"COINOS_POOL_TOKEN={token}")
    print()
    print(f"Pra ver a conta pela web: entre em {COINOS_URL} com esse username/senha.")


if __name__ == "__main__":
    main()
