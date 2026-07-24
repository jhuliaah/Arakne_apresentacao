"""Minimal Bech32 encoder for Nostr npub (BIP-173 / NIP-19).

Nostr public keys are 32-byte X-only secp256k1 pubkeys. Bech32 encoding with
HRP ``npub`` produces the familiar ``npub1...`` string used across Nostr
clients (NIP-19).

This module implements only the **encoding** direction (bytes -> bech32
string), which is all the backend needs to expose npubs in the format the
frontend expects for NIP-17/59 gift-wrapping. Decoding is not needed here
because the backend never consumes a bech32 npub back into bytes — it only
stores and returns pubkeys.

No external dependencies. The algorithm is the reference BIP-173
implementation, trimmed to the encode path.
"""

from __future__ import annotations

from typing import Union

# Bech32 character set (BIP-173).
_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

# Generator constants for the Bech32 checksum polynomial.
_GEN = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]


def _bech32_polymod(values: list[int]) -> int:
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            chk ^= _GEN[i] if ((b >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _bech32_create_checksum(hrp: str, data: list[int]) -> list[int]:
    values = _bech32_hrp_expand(hrp) + data
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _convertbits(data: bytes, frombits: int, tobits: int, pad: bool = True) -> list[int]:
    """Convert between bit groupings (reference BIP-173 implementation)."""
    acc = 0
    bits = 0
    ret: list[int] = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for byte in data:
        if byte < 0 or (byte >> frombits):
            raise ValueError(f"invalid byte value {byte} for {frombits}-bit group")
        acc = ((acc << frombits) | byte) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    elif not pad and (bits >= frombits or ((acc << (tobits - bits)) & maxv)):
        raise ValueError("invalid padding")
    return ret


def bech32_encode(hrp: str, data: bytes) -> str:
    """Encode ``data`` as a bech32 string with human-readable part ``hrp``."""
    data5 = _convertbits(data, 8, 5, pad=True)
    combined = data5 + _bech32_create_checksum(hrp, data5)
    return hrp + "1" + "".join(_CHARSET[i] for i in combined)


def npub_encode(pubkey: Union[str, bytes]) -> str:
    """Encode a 32-byte pubkey (hex string or raw bytes) as ``npub1...``.

    If ``pubkey`` is already a bech32 string starting with ``npub1`` it is
    returned unchanged, so callers can pass stored values without first
    checking the format.
    """
    if isinstance(pubkey, str) and pubkey.startswith("npub1"):
        return pubkey
    if isinstance(pubkey, bytes):
        pubkey_bytes = pubkey
    else:
        pubkey_bytes = bytes.fromhex(pubkey)
    if len(pubkey_bytes) != 32:
        raise ValueError(f"npub must be 32 bytes, got {len(pubkey_bytes)}")
    return bech32_encode("npub", pubkey_bytes)


def to_npub(value: Union[str, bytes, None]) -> Union[str, None]:
    """Normalize a stored npub value to bech32 ``npub1...``.

    - ``None`` -> ``None``
    - already bech32 (``npub1...``) -> returned as-is
    - 64-char hex -> converted to bech32
    - anything else that fails conversion -> returned unchanged (best effort,
      so a corrupt stored value never breaks the endpoint)
    """
    if value is None:
        return None
    try:
        return npub_encode(value)
    except Exception:
        return value if isinstance(value, str) else None
