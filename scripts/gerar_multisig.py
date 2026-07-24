#!/usr/bin/env python3
"""Gera (ou combina) a reserva fria multisig 2-de-3 da custódia compartilhada
(seção 6 do doc mestre) — inteiramente offline, sem precisar de um nó Bitcoin
rodando. Usa BIP32/BIP39/BIP48 via a biblioteca `embit`.

⚠️ MODO DEMO vs. MODO REAL — leia antes de rodar

  Modo demo (`--gerar-3-demo`): gera as 3 seeds das stewards no mesmo
  processo, só pra provar viabilidade técnica no pitch/hackathon. As 3
  mnemonics saem juntas no mesmo arquivo de saída — ou seja, uma única
  pessoa com esse arquivo já teria o quorum sozinha. Isso anula o ponto
  inteiro da custódia compartilhada ("nenhuma parte sozinha move fundos",
  seção 6). NUNCA use a saída de `--gerar-3-demo` pra guardar fundos de
  verdade.

  Modo real (`--combinar-xpubs`): cada steward gera a própria seed
  separadamente, no próprio dispositivo (ex.: Sparrow Wallet, Bitcoin Core,
  ou até este mesmo script rodado localmente com `--gerar-1-steward`), e só
  compartilha o xpub (chave PÚBLICA) — nunca a seed. Este script então só
  combina os 3 xpubs recebidos num descriptor multisig, sem nunca ver
  nenhuma chave privada.

Uso:
  # Demo/pitch — gera as 3 chaves de uma vez (NÃO usar em produção)
  python3 gerar_multisig.py --gerar-3-demo --network regtest

  # Uma steward gera a própria chave, isolada, pra compartilhar só o xpub
  python3 gerar_multisig.py --gerar-1-steward --network testnet

  # Depois de coletar os 3 xpubs, monta o descriptor real
  python3 gerar_multisig.py --combinar-xpubs xpub1.json xpub2.json xpub3.json --network testnet
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from embit import bip32, bip39, networks
from embit.descriptor import Descriptor
from embit.descriptor.checksum import add_checksum

# BIP48 — path recomendado pra multisig P2WSH (script type 2'). O coin_type
# 1' cobre testnet/regtest/signet igualmente em BIP44/48; mainnet usa 0'.
COIN_TYPE = {"mainnet": "0h", "testnet": "1h", "regtest": "1h", "signet": "1h"}
ACCOUNT = "0h"
SCRIPT_TYPE = "2h"  # P2WSH multisig


def _net(network: str) -> dict:
    # embit usa "test" pro grupo testnet/regtest/signet (mesmas versions de
    # chave); mainnet é "main".
    return networks.NETWORKS["test"] if network != "mainnet" else networks.NETWORKS["main"]


def _path(network: str) -> str:
    return f"m/48h/{COIN_TYPE[network]}/{ACCOUNT}/{SCRIPT_TYPE}"


def gerar_steward(network: str) -> dict:
    """Gera UMA seed + xpub de conta multisig. A mnemonic nunca deve sair
    do dispositivo de quem a gerou — só o xpub (e o fingerprint) devem ser
    compartilhados com quem vai montar o descriptor."""
    net = _net(network)
    mnemonic = bip39.mnemonic_from_bytes(os.urandom(32))  # 24 palavras
    seed = bip39.mnemonic_to_seed(mnemonic)
    root = bip32.HDKey.from_seed(seed, version=net["xprv"])
    path = _path(network)
    conta = root.derive(path)
    xpub = conta.to_public().to_base58(version=net["Zpub"])
    return {
        "mnemonic": mnemonic,
        "fingerprint": root.my_fingerprint.hex(),
        "path": path,
        "xpub": xpub,
        "network": network,
    }


def montar_descriptor(stewards: list[dict], network: str, quorum: int = 2) -> dict:
    """Combina N xpubs (dicts com fingerprint/path/xpub) num descriptor
    wsh(sortedmulti(...)). `sortedmulti` (em vez de `multi`) ordena as
    chaves deterministicamente, então qualquer carteira reconstrói o mesmo
    descriptor não importa a ordem em que os xpubs foram informados."""
    net = _net(network)
    partes = ",".join(
        f"[{s['fingerprint']}/{s['path'].replace('m/', '')}]{s['xpub']}/0/*" for s in stewards
    )
    desc_str = add_checksum(f"wsh(sortedmulti({quorum},{partes}))")
    descriptor = Descriptor.from_string(desc_str)
    primeiro_endereco = descriptor.derive(0).script_pubkey().address(network=net)

    return {
        "descriptor": desc_str,
        "quorum": f"{quorum}-de-{len(stewards)}",
        "total_signatarios": len(stewards),
        "network": network,
        "primeiro_endereco_recebimento": primeiro_endereco,
        "gerado_em": datetime.now(timezone.utc).isoformat(),
    }


def _salvar(dados: dict, caminho: str) -> None:
    with open(caminho, "w") as f:
        json.dump(dados, f, indent=2, ensure_ascii=False)
    print(f"→ salvo em {caminho}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--network", default="regtest", choices=["regtest", "testnet", "signet", "mainnet"])
    parser.add_argument("--quorum", type=int, default=2, help="Quantas assinaturas exigidas (padrão: 2)")
    modo = parser.add_mutually_exclusive_group(required=True)
    modo.add_argument("--gerar-1-steward", action="store_true", help="Gera a chave de UMA steward (uso real, rodar isolado por pessoa)")
    modo.add_argument("--gerar-3-demo", action="store_true", help="Gera as 3 chaves juntas — SÓ para demo/pitch, nunca produção")
    modo.add_argument("--combinar-xpubs", nargs="+", metavar="ARQUIVO.json", help="Monta o descriptor a partir de N arquivos de xpub (saída de --gerar-1-steward)")
    parser.add_argument("--saida", default=None, help="Arquivo de saída (padrão: nome automático)")
    args = parser.parse_args()

    if args.gerar_1_steward:
        steward = gerar_steward(args.network)
        sufixo = f"{steward['fingerprint']}_{args.network}"
        saida_privada = args.saida or f"steward_PRIVADO_{sufixo}.json"
        saida_publica = f"steward_xpub_{sufixo}.json"

        publico = {k: v for k, v in steward.items() if k != "mnemonic"}

        print("⚠️  Guarde a mnemonic em local seguro OFFLINE (papel, metal). Nunca envie por chat/email.")
        print(f"   Fingerprint: {steward['fingerprint']}")
        print(f"   Compartilhe SÓ o arquivo '{saida_publica}' com quem monta o descriptor.")
        _salvar(steward, saida_privada)
        _salvar(publico, saida_publica)

    elif args.gerar_3_demo:
        print("⚠️  MODO DEMO — as 3 chaves saem no mesmo arquivo. NÃO use pra fundos reais.\n")
        stewards = [gerar_steward(args.network) for _ in range(3)]
        resultado = montar_descriptor(stewards, args.network, args.quorum)
        resultado["stewards_demo"] = stewards  # inclui as mnemonics — só porque é demo
        saida = args.saida or f"custodia_multisig_demo_{args.network}.json"
        _salvar(resultado, saida)
        print(f"\nDescriptor: {resultado['descriptor']}")
        print(f"Endereço:   {resultado['primeiro_endereco_recebimento']}")
        print("\nPreencha no .env do backend:")
        print(f"  MULTISIG_DESCRIPTOR={resultado['descriptor']}")
        print(f"  MULTISIG_ENDERECO={resultado['primeiro_endereco_recebimento']}")
        print(f"  MULTISIG_QUORUM={resultado['quorum']}")
        print(f"  MULTISIG_NETWORK={args.network}")

    elif args.combinar_xpubs:
        stewards = []
        for caminho in args.combinar_xpubs:
            with open(caminho) as f:
                s = json.load(f)
            if "mnemonic" in s:
                print(f"⚠️  {caminho} contém uma mnemonic — isso não deveria sair do dispositivo da steward. Abortando.", file=sys.stderr)
                sys.exit(1)
            stewards.append(s)
        redes = {s["network"] for s in stewards}
        if len(redes) > 1:
            print(f"⚠️  xpubs de redes diferentes: {redes}. Abortando.", file=sys.stderr)
            sys.exit(1)
        resultado = montar_descriptor(stewards, redes.pop(), args.quorum)
        saida = args.saida or f"custodia_multisig_{resultado['network']}.json"
        _salvar(resultado, saida)
        print(f"\nDescriptor: {resultado['descriptor']}")
        print(f"Endereço:   {resultado['primeiro_endereco_recebimento']}")


if __name__ == "__main__":
    main()
