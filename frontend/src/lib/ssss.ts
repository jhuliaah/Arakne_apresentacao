/** ssss — wrapper fino sobre `shamir-secret-sharing` (privy-io).
 *
 *  Divide o nsec da dona (32 bytes) em N=2 shares com threshold T=2 —
 *  qualquer 2 shares reconstruem o nsec, mas 1 share isolada não revela
 *  nada. As shares são distribuídas: share 0 à convidadora via NIP-59
 *  gift-wrap, share 1 ao backend (criptografada com PIN da usuária).
 *
 *  Decisões da Fase 0 do plano de recuperação Nostr:
 *  - M-of-N fixo em 2-de-2 (Opção E: convidadora + backend).
 *  - Lib `shamir-secret-sharing@0.0.4` (auditada por Cure53 + Zellic,
 *    zero dependências, ESM/Node, funciona em browser).
 *
 *  ARMADILHA CRÍTICA: `combine()` NÃO detecta shares incorretas — ela
 *  retorna lixo deterministicamente se as shares forem de segredos
 *  diferentes ou tiverem sido adulteradas. Por isso expomos
 *  `combineNsecWithCheck()`, que deriva o pubkey do nsec reconstruído e
 *  compara com o esperado. SEMPRE use essa versão em fluxos de
 *  recuperação reais — nunca chame `combine()` "raw" e confie no resultado.
 */

import { split, combine } from "shamir-secret-sharing";
import { getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Total de shares geradas (convidadora + backend). Fixo em 2 (Opção E). */
export const N = 2;
/** Threshold para reconstruir (M). Fixo em 2 (Fase 0). */
export const T = 2;

/** Tamanho esperado do nsec em bytes (secp256k1 scalar). */
const NSEC_BYTES = 32;

/** Tamanho de cada share: 1 byte de índice + N bytes de payload = 33 bytes. */
export const SHARE_BYTES = NSEC_BYTES + 1;

/**
 * Divide um nsec (32 bytes) em 2 shares (cada uma 33 bytes).
 *
 * @param nsecBytes - bytes da chave privada (exatamente 32 bytes)
 * @returns array de 2 Uint8Array, cada uma com 33 bytes
 * @throws se `nsecBytes.length !== 32`
 */
export async function splitNsec(
  nsecBytes: Uint8Array,
): Promise<Uint8Array[]> {
  if (nsecBytes.length !== NSEC_BYTES) {
    throw new Error(
      `splitNsec: esperado ${NSEC_BYTES} bytes, recebido ${nsecBytes.length}`,
    );
  }
  const shares = await split(nsecBytes, N, T);
  // Sanity check defensivo — a lib garante 33 bytes por share, mas confirmamos.
  for (let i = 0; i < shares.length; i++) {
    if (shares[i].length !== SHARE_BYTES) {
      throw new Error(
        `splitNsec: share ${i} com tamanho inesperado ${shares[i].length} (esperado ${SHARE_BYTES})`,
      );
    }
  }
  return shares;
}

/**
 * Reconstrói o nsec a partir de ≥2 shares.
 *
 * ARMADILHA: `shamir-secret-sharing` não detecta shares incorretas —
 * retorna lixo deterministicamente. Use `combineNsecWithCheck()` em
 * qualquer fluxo de produção. Esta função raw só é útil para testes
 * ou quando você confia plenamente na origem das shares.
 *
 * @param shares - array com ≥2 (e ≤2) shares de 33 bytes
 * @returns nsec reconstruído (32 bytes)
 */
export async function combineNsec(
  shares: Uint8Array[],
): Promise<Uint8Array> {
  if (shares.length < T) {
    throw new Error(
      `combineNsec: precisa de ≥${T} shares, recebido ${shares.length}`,
    );
  }
  const secret = await combine(shares);
  if (secret.length !== NSEC_BYTES) {
    throw new Error(
      `combineNsec: segredo reconstruído com tamanho ${secret.length} (esperado ${NSEC_BYTES})`,
    );
  }
  return secret;
}

/**
 * Reconstrói o nsec e valida que o pubkey derivado bate com o esperado.
 *
 * CRÍTICO: `shamir-secret-sharing` não detecta shares incorretas —
 * `combine()` retorna lixo deterministicamente se as shares forem de
 * segredos diferentes ou tiverem sido adulteradas. Esta função deriva
 * o pubkey do nsec reconstruído e compara com `expectedPubkeyHex`.
 *
 * @param shares - array com ≥2 shares de 33 bytes
 * @param expectedPubkeyHex - pubkey (hex, 64 chars) que o nsec deve derivar
 * @returns nsec reconstruído (32 bytes), se o pubkey bater
 * @throws se o pubkey derivado não bater com o esperado
 */
export async function combineNsecWithCheck(
  shares: Uint8Array[],
  expectedPubkeyHex: string,
): Promise<Uint8Array> {
  const recovered = await combineNsec(shares);
  const derivedPubkey = getPublicKey(recovered);
  if (derivedPubkey !== expectedPubkeyHex) {
    throw new Error(
      `Reconstrução falhou: pubkey não bate. Esperado ${expectedPubkeyHex}, derivado ${derivedPubkey}. ` +
        `(nsec hex: ${bytesToHex(recovered)})`,
    );
  }
  return recovered;
}
