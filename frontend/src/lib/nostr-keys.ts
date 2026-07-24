/** Identidade Nostr no dispositivo — geração direta de nsec + NIP-19 (bech32).
 *
 *  Tudo aqui é 100% local: a chave privada (nsec) NUNCA sai do dispositivo,
 *  nunca é enviada ao backend, nunca é persistida por este módulo. O chamador
 *  decide onde (e se) guarda o nsec — recomendamos encrypt/decrypt antes de
 *  qualquer persistência.
 *
 *  O nsec é gerado diretamente com `generateSecretKey()` (32 bytes aleatórios
 *  via `nostr-tools/pure`). Não usamos mais NIP-06 (derivação por mnemônico
 *  BIP-39) — o protocolo Nostr marca o NIP-06 como `unrecommended` e o novo
 *  modelo de recuperação do Arakne (social via NIP-17/59 + SSSS) não depende
 *  de mnemonic. O npub passa a ser o identificador de backup anotado em
 *  QR/papel — muito mais curto que 12 palavras.
 *
 *  NIP-19: codificação bech32 (nsec1... / npub1...).
 */

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export interface NostrIdentity {
  /** Chave privada bech32 (nsec1...). NUNCA enviar ao backend. */
  nsec: string;
  /** Chave pública bech32 (npub1...). Pode ser compartilhada. */
  npub: string;
  /** Chave privada em hex (32 bytes / 64 chars). */
  privateKeyHex: string;
  /** Chave pública em hex (32 bytes / 64 chars). */
  publicKeyHex: string;
}

/** Gera uma nova identidade Nostr: nsec direto (32 bytes aleatórios) + npub.
 *
 *  Não há mais derivação por mnemonic — o nsec é a própria chave mestra.
 *  Para backup, anote o npub (público, curto) e use recuperação social
 *  (NIP-17/59 + SSSS) distribuída a avalistas.
 */
export function createNostrIdentity(): NostrIdentity {
  const privateKey = generateSecretKey(); // Uint8Array de 32 bytes
  const publicKey = getPublicKey(privateKey); // hex string (64 chars)
  const privateKeyHex = bytesToHex(privateKey);
  const publicKeyHex = publicKey;
  const nsec = nip19.nsecEncode(privateKey);
  const npub = nip19.npubEncode(publicKeyHex);
  return { nsec, npub, privateKeyHex, publicKeyHex };
}

/** Decodifica nsec1... → bytes da chave privada (32 bytes). */
export function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error(`Esperado nsec1..., recebido ${decoded.type}.`);
  }
  return decoded.data;
}

/** Codifica bytes da chave privada → nsec1... */
export function encodeNsec(privateKeyBytes: Uint8Array): string {
  return nip19.nsecEncode(privateKeyBytes);
}

/** Decodifica npub1... → hex da chave pública (64 chars). */
export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub") {
    throw new Error(`Esperado npub1..., recebido ${decoded.type}.`);
  }
  return decoded.data;
}

// Re-export utilitário para callers que precisem converter hex ↔ bytes
// sem depender diretamente de @noble/hashes.
export { bytesToHex, hexToBytes };
