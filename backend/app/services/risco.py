"""Motor de risco — regras determinísticas de elegibilidade de crédito.

Regras (do spec do Arakne):
- Tier 0: sem crédito.
- Tier 1: liberado com 1 aval recebido (NÃO exige padrão completo). Limite 5.000 sats.
- Tier 2: liberado ao quitar tier 1. Limite 15.000 sats.
- Tier 3: liberado ao quitar tier 2. Limite 40.000 sats.
  A partir daqui a usuária pode gerar links de indicação.
- Atraso >14 dias: congela a usuária E a avalista (pausa, não punição).
  Nunca reduz tier retroativamente.
- Completar padrões de crochê NÃO libera crédito — desacoplado do motor.
"""

from app.models.usuaria import Usuaria

# ── Constantes ──────────────────────────────────────────────

TIER_LIMITS: dict[int, int] = {
    0: 0,
    1: 5_000,
    2: 15_000,
    3: 40_000,
}

ATRASO_LIMITE_DIAS = 14


# ── Helpers ─────────────────────────────────────────────────

def limite_por_tier(tier: int) -> int:
    """Retorna o limite de crédito em sats para o tier dado."""
    return TIER_LIMITS.get(tier, 0)


def ao_receber_aval(usuaria: Usuaria) -> None:
    """Chamado quando uma usuária recebe um aval.

    Se está no tier 0, sobe para tier 1.
    Não tem efeito em tiers superiores (não reduz nem aumenta).
    """
    if usuaria.tier == 0:
        usuaria.tier = 1


def pode_avalizar(usuaria: Usuaria) -> bool:
    """Verifica se a usuária pode gerar links de indicação (dar aval).

    Regra: apenas tier >= 3 pode gerar links de indicação.
    """
    return usuaria.tier >= 3


def pode_ser_ponto_troca(usuaria: Usuaria) -> bool:
    """Verifica se a usuária pode se oferecer como Ponto de Troca (nó de liquidez).

    Regra: tier >= 1 (já recebeu ao menos um aval — alguém confia nela) e
    não congelada. Deliberadamente mais permissivo que pode_avalizar(), já
    que virar um nó de liquidez espalha a rede em vez de concentrá-la.
    """
    return usuaria.tier >= 1 and not usuaria.tier_congelado


# ── Funções principais ───────────────────────────────────────

def pode_emprestar(usuaria: Usuaria) -> bool:
    """Verifica se a usuária pode pegar um novo empréstimo agora.

    Condições (todas devem ser verdadeiras):
    1. tier >= 1 (recebeu pelo menos 1 aval)
    2. não congelada (tier_congelado == False)
    3. ainda há limite disponível (saldo_devedor < limite_por_tier(tier))
    4. avalista (se existir) também não congelada

    Permite empréstimos parciais: enquanto o saldo devedor for menor que o
    limite do tier, a usuária pode solicitar mais um empréstimo do restante.
    """
    if usuaria.tier < 1:
        return False
    if usuaria.tier_congelado:
        return False
    if usuaria.saldo_devedor >= limite_por_tier(usuaria.tier):
        return False
    if usuaria.avalista is not None and usuaria.avalista.tier_congelado:
        return False
    return True


def ao_quitar(usuaria: Usuaria) -> None:
    """Chamado quando uma usuária quita um empréstimo.

    Efeitos:
    - Limpa saldo_devedor para 0
    - Descongela a usuária (regulariza o atraso)
    - Descongela a avalista (se houver)
    - Sobe o tier: 1→2, 2→3 (máximo tier 3)
    """
    usuaria.saldo_devedor = 0
    usuaria.tier_congelado = False
    if usuaria.avalista is not None:
        usuaria.avalista.tier_congelado = False
    if 1 <= usuaria.tier < 3:
        usuaria.tier += 1


def ao_atrasar(usuaria: Usuaria, dias_atraso: int) -> None:
    """Chamado quando uma usuária está em atraso no pagamento.

    Se dias_atraso > 14:
    - Congela a usuária (tier_congelado = True)
    - Congela a avalista dela (se houver)

    Nunca reduz o tier — é uma pausa de acesso, não uma punição.
    """
    if dias_atraso > ATRASO_LIMITE_DIAS:
        usuaria.tier_congelado = True
        if usuaria.avalista is not None:
            usuaria.avalista.tier_congelado = True
