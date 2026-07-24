#!/usr/bin/env python3
"""Move sats do pool (LNbits, "quente") pra reserva fria (multisig
on-chain) — a ponte descrita na seção 21 do doc mestre, fechando o
ciclo que faltava entre custódia operacional e custódia de longo prazo.

Caminho técnico (não existe atalho direto — protocolos diferentes):
  LNbits (Lightning) → paga invoice → Binance (recebe Lightning)
                                    → saca on-chain → endereço multisig

⚠️ MOVIMENTA DINHEIRO REAL. Por padrão este script roda em DRY-RUN — só
mostra o que faria, não executa nada. Passe --confirmar-envio-real pra
de fato mover os sats. Essa trava existe de propósito: o vazamento de
chave desta mesma sessão aconteceu por pressa numa operação em lote sem
checar antes — este script não repete esse erro.

Uso:
  # Sempre rode sem a flag primeiro — confirma valores antes de qualquer coisa
  python3 scripts/mover_pool_para_reserva_fria.py

  # Só depois de conferir a saída acima, com a flag explícita
  python3 scripts/mover_pool_para_reserva_fria.py --confirmar-envio-real
"""

import argparse
import sys
import time

sys.path.insert(0, "backend")

from app.config import MULTISIG_ENDERECO  # noqa: E402
from app.services.exchange import BinanceError, exchange  # noqa: E402
from app.services.lnbits import lnbits  # noqa: E402

# Deixa esse tanto de sats sempre disponível no LNbits pra operação do dia
# a dia (empréstimos, repagamentos) — só move o excedente acima disso.
# Calibrar depois com dado real de uso; valor de partida conservador.
BUFFER_MINIMO_QUENTE_SATS = 50_000


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--confirmar-envio-real",
        action="store_true",
        help="Sem esta flag, o script só mostra o que faria (dry-run). Só passe depois de conferir a saída do dry-run.",
    )
    parser.add_argument(
        "--buffer-sats",
        type=int,
        default=BUFFER_MINIMO_QUENTE_SATS,
        help=f"Quanto deixar no LNbits (padrão: {BUFFER_MINIMO_QUENTE_SATS})",
    )
    args = parser.parse_args()

    if not MULTISIG_ENDERECO:
        print("✗ MULTISIG_ENDERECO não configurado no .env. Rode scripts/gerar_multisig.py primeiro.")
        sys.exit(1)

    if lnbits.is_mock:
        print("✗ LNbits está em modo mock (LNBITS_ADMIN_KEY/LNBITS_POOL_KEY vazios). Nada real pra mover.")
        sys.exit(1)

    if exchange.is_mock:
        print("✗ Binance está em modo mock (BINANCE_API_KEY/BINANCE_API_SECRET vazios). Nada real pra mover.")
        sys.exit(1)

    print("── Consultando saldo real do pool no LNbits ──")
    saldo = lnbits.get_wallet_balance(lnbits.pool_key)
    saldo_sats = saldo.get("balance_sats", saldo.get("balance", 0))
    print(f"  Saldo atual do pool: {saldo_sats} sats")

    valor_a_mover = saldo_sats - args.buffer_sats
    if valor_a_mover <= 0:
        print(f"  Nada a mover — saldo está no buffer mínimo ({args.buffer_sats} sats) ou abaixo.")
        sys.exit(0)

    print(f"  Buffer mantido no quente: {args.buffer_sats} sats")
    print(f"  Valor a mover pra reserva fria: {valor_a_mover} sats")
    print(f"  Endereço de destino (multisig): {MULTISIG_ENDERECO}")
    print()

    if not args.confirmar_envio_real:
        print("── DRY-RUN — nada foi executado ──")
        print("Revise os valores acima. Se estiverem corretos, rode de novo com:")
        print("  python3 scripts/mover_pool_para_reserva_fria.py --confirmar-envio-real")
        sys.exit(0)

    print("── ⚠️  EXECUTANDO DE VERDADE — dinheiro real vai se mover ──")

    print("1/3 — Gerando invoice de depósito na Binance...")
    try:
        deposito = exchange.gerar_invoice_deposito(valor_a_mover)
    except BinanceError as e:
        print(f"✗ Falhou gerando invoice de depósito: {e}")
        sys.exit(1)
    invoice = deposito["invoice"]
    print(f"  Invoice: {invoice[:40]}...")

    print("2/3 — Pagando a invoice a partir da wallet-pool do LNbits...")
    try:
        pagamento = lnbits.pay_invoice(lnbits.pool_key, invoice)
    except Exception as e:
        print(f"✗ Falhou pagando a invoice pelo LNbits: {e}")
        print("  A invoice da Binance foi gerada mas NÃO foi paga — nada se moveu ainda.")
        sys.exit(1)
    print(f"  Pago: {pagamento}")

    print("  Aguardando 15s pra Binance confirmar o crédito do depósito...")
    time.sleep(15)

    print("3/3 — Sacando on-chain da Binance pro endereço multisig...")
    valor_btc = valor_a_mover / 100_000_000
    try:
        saque = exchange.sacar_onchain(MULTISIG_ENDERECO, valor_btc)
    except BinanceError as e:
        print(f"✗ Falhou sacando on-chain: {e}")
        print("  ATENÇÃO: os sats JÁ SAÍRAM do LNbits e chegaram na Binance (passo 2 confirmado),")
        print("  mas o saque pra multisig falhou. O saldo está na sua conta Binance, não perdido —")
        print("  verifique lá e saque manualmente se precisar, ou rode este script de novo.")
        sys.exit(1)

    print(f"  Saque solicitado: {saque}")
    print()
    print("── Concluído. Confirme a chegada na multisig pelo explorador de blocos")
    print(f"   ou no Sparrow Wallet, endereço {MULTISIG_ENDERECO} ──")


if __name__ == "__main__":
    main()
