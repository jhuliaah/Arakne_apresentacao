/** recovery-serialize — helpers de serialização para shares SSSS.
 *
 *  As shards geradas pelo SSSS são Uint8Array; para transporte dentro do
 *  `content` JSON do rumor (NIP-59), codificamos em base64. Estas funções
 *  são compatíveis com browser e Node 22+ (btoa/atob são globais em ambos).
 *
 *  Não usa Buffer (Node-only) nem fetch — só btoa/atob + TextEncoder implícito.
 */

/** Converte Uint8Array para string base64 (para transporte no content do rumor). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/** Converte string base64 de volta para Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
