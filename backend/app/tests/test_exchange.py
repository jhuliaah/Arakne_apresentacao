"""Testes do services/exchange.py — cliente Binance em modo mock.

Como o serviço nunca deve cair silenciosamente em mock após uma falha real
(diferente de lnbits.py/pix.py — ver docstring do módulo pro racional),
estes testes cobrem: comportamento em mock puro, e que erros de runtime
levantam BinanceError em vez de mascarar como sucesso.
"""

import pytest

from app.services.exchange import BinanceError, BinanceService, exchange


def test_exchange_inicia_em_mock_sem_credenciais():
    servico = BinanceService("", "", "https://api.binance.com")
    assert servico.is_mock


def test_exchange_nao_e_mock_com_credenciais():
    servico = BinanceService("fake_key", "fake_secret", "https://api.binance.com")
    assert not servico.is_mock


def test_cotacao_mock_e_deterministica():
    assert exchange.is_mock
    c1 = exchange.cotacao_btc_brl()
    c2 = exchange.cotacao_btc_brl()
    assert c1 == c2
    assert c1["symbol"] == "BTCBRL"
    assert c1["price"] > 0


def test_comprar_btc_mercado_mock_calcula_quantidade_pela_cotacao():
    cotacao = exchange.cotacao_btc_brl()
    resultado = exchange.comprar_btc_mercado(1000.0)
    assert resultado["status"] == "FILLED"
    assert resultado["valor_brl_gasto"] == 1000.0
    esperado = round(1000.0 / cotacao["price"], 8)
    assert resultado["quantidade_btc"] == esperado


def test_sacar_lightning_mock_retorna_status_enviado():
    resultado = exchange.sacar_lightning("lnbc1000mockinvoice", 0.00001)
    assert resultado["status"] == "mock_enviado"
    assert resultado["withdraw_id"].startswith("mock_")


def test_comprar_btc_mercado_real_levanta_binance_error_em_falha(monkeypatch):
    """Confirma que uma falha de rede/API real NUNCA vira um resultado mock
    silencioso — precisa levantar BinanceError explicitamente, porque aqui
    (diferente de LNbits/Pix) uma falha mascarada como sucesso criaria uma
    inconsistência contábil real."""
    servico = BinanceService("fake_key", "fake_secret", "https://api.binance.invalid")
    assert not servico.is_mock

    with pytest.raises(BinanceError):
        servico.comprar_btc_mercado(100.0)


def test_sacar_lightning_real_levanta_binance_error_em_falha():
    servico = BinanceService("fake_key", "fake_secret", "https://api.binance.invalid")
    with pytest.raises(BinanceError):
        servico.sacar_lightning("lnbc1000fake", 0.00001)


def test_gerar_invoice_deposito_mock_retorna_invoice():
    assert exchange.is_mock
    resultado = exchange.gerar_invoice_deposito(50_000)
    assert resultado["invoice"].startswith("lnbc")


def test_sacar_onchain_mock_retorna_status_enviado():
    resultado = exchange.sacar_onchain("bc1qmockaddress", 0.0005)
    assert resultado["status"] == "mock_enviado"


def test_gerar_invoice_deposito_real_levanta_binance_error_em_falha():
    servico = BinanceService("fake_key", "fake_secret", "https://api.binance.invalid")
    with pytest.raises(BinanceError):
        servico.gerar_invoice_deposito(50_000)


def test_sacar_onchain_real_levanta_binance_error_em_falha():
    servico = BinanceService("fake_key", "fake_secret", "https://api.binance.invalid")
    with pytest.raises(BinanceError):
        servico.sacar_onchain("bc1qmockaddress", 0.0005)
