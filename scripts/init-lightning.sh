#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Arakne — Lightning Network setup script
#
#  Rodar DEPOIS de `docker compose up`:
#    bash scripts/init-lightning.sh
#
#  Este script:
#    1. Cria wallet no Bitcoin Core
#    2. Minera 101 blocos (libera coins)
#    3. Cria wallet no LND
#    4. Envia 10 BTC para o LND
#    5. Minera 6 blocos para confirmar
# ──────────────────────────────────────────────────────────────
set -euo pipefail

RPC_USER="bitcoin"
RPC_PASS="bitcoin"

bcli() {
  docker compose exec -T bitcoin bitcoin-cli -regtest -rpcuser="$RPC_USER" -rpcpassword="$RPC_PASS" "$@"
}

lncli() {
  docker compose exec -T lnd lncli --regtest --rpcserver=localhost:10009 "$@"
}

echo "=== Arakne — Lightning Setup ==="
echo ""

# ── 1. Aguardar bitcoind ──────────────────────────────────────
echo "[1/5] Aguardando bitcoind..."
until bcli getblockchaininfo >/dev/null 2>&1; do
  sleep 1
done
echo "  ✓ bitcoind pronto."

# ── 2. Criar wallet e minerar blocos ───────────────────────────
echo "[2/5] Criando wallet no Bitcoin Core..."
bcli createwallet "default" 2>/dev/null || true
bcli loadwallet "default" 2>/dev/null || true

echo "  Minerando 101 blocos..."
ADDR=$(bcli getnewaddress)
bcli generatetoaddress 101 "$ADDR" >/dev/null
echo "  ✓ 101 blocos minerados."

# ── 3. Criar wallet no LND ─────────────────────────────────────
echo "[3/5] Criando wallet no LND..."
# Tenta criar; se já existir, tenta desbloquear
printf 'arakne123\narakne123\nn\n' | lncli create 2>/dev/null || \
printf 'arakne123\n' | lncli unlock 2>/dev/null || true
echo "  ✓ Wallet LND criada."

# ── 4. Enviar fundos para LND ──────────────────────────────────
echo "[4/5] Enviando 10 BTC para LND..."
LND_ADDR=$(lncli newaddress p2wkh 2>/dev/null \
  | grep -o '"address": *"[^"]*"' \
  | head -1 \
  | sed 's/.*"address": *"//;s/"$//')

if [ -n "$LND_ADDR" ]; then
  bcli sendtoaddress "$LND_ADDR" 10 >/dev/null 2>&1 || true
  echo "  ✓ 10 BTC enviados."
else
  echo "  ⚠ Não foi possível obter endereço LND — wallet pode já existir."
fi

# ── 5. Confirmar com mais blocos ──────────────────────────────
echo "[5/5] Minerando 6 blocos para confirmar..."
bcli generatetoaddress 6 "$ADDR" >/dev/null
echo "  ✓ 6 blocos minerados."

echo ""
echo "=== Setup concluído! ==="
echo ""
echo "  LNbits:     http://localhost:5000"
echo "  LND REST:   http://localhost:8081"
echo "  Backend:    http://localhost:8000/health"
echo "  Frontend:   http://localhost:5173"
echo ""
echo "  Para conectar LNbits ao LND:"
echo "    1. Acesse http://localhost:5000"
echo "    2. Crie uma nova wallet"
echo "    3. Em Settings > Wallet > LNDWallet:"
echo "       - Cert:   /root/.lnd/tls.cert"
echo "       - Macaroon: /root/.lnd/data/chain/bitcoin/regtest/admin.macaroon"
echo "       - Host:   lnd:10009"
