/** pattern-crypto — camada criptográfica que protege o nsec no dispositivo.
 *
 *  O nsec (chave privada Nostr) é criptografado com AES-GCM-256 usando uma
 *  chave derivada do padrão hexagonal (Ponto Arakne) via PBKDF2. O nsec
 *  NUNCA sai do dispositivo em plaintext — só decriptado em memória durante
 *  a sessão destravada.
 *
 *  - KDF:     PBKDF2 (WebCrypto nativo, 600k iterações, SHA-256)
 *  - Cipher:  AES-GCM-256 (IV 12 bytes por encrypt)
 *  - Salt:    16 bytes aleatórios, gerado no cadastro, stored no blob
 *  - Check:   SHA-256 do padrão (sem KDF) para skip antes do PBKDF2
 *
 *  Sem dependências extras — só WebCrypto API (globalThis.crypto.subtle).
 *  Compatível com browser e Node 22+ (mesma API WebCrypto nativa).
 */

// ── Constantes ─────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000; // recomendação OWASP 2023
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes (recomendado para AES-GCM)
const KEY_LENGTH = 256; // bits

// ── Helpers base64 (compat browser + Node 22) ──────────────────
// btoa/atob são globais em ambos os ambientes; operam sobre "binary strings"
// (code points 0–255), seguras para qualquer sequência de bytes.

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

// base64ToBytes cria new Uint8Array(n) (backed por ArrayBuffer, não
// SharedArrayBuffer) — tipamos o retorno como Uint8Array<ArrayBuffer> para
// satisfazer o BufferSource exigido por WebCrypto (decrypt/digest).
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Copia bytes para Uint8Array backed por ArrayBuffer (WebCrypto exige
 *  BufferSource = ArrayBufferView<ArrayBuffer>, que não aceita
 *  SharedArrayBuffer). Cópia barata (16–32 bytes nos fluxos do nsec). */
function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

// ── API pública ────────────────────────────────────────────────

/**
 * Deriva uma chave AES-GCM-256 a partir do padrão hexagonal usando PBKDF2.
 * @param pattern Sequência de vertex IDs (números) do HexPatternCanvas
 * @param salt Salt aleatório (16 bytes, gerado no cadastro, stored em localStorage)
 * @returns CryptoKey para AES-GCM
 */
export async function deriveKeyFromPattern(
  pattern: number[],
  salt: Uint8Array,
): Promise<CryptoKey> {
  // Serializa o padrão como string CSV → bytes via TextEncoder.
  const keyMaterial = new TextEncoder().encode(pattern.join(","));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: ab(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Criptografa o nsec (bytes da chave privada) com a chave derivada do padrão.
 * @param nsecBytes Bytes da chave privada Nostr (32 bytes)
 * @param pattern Padrão hexagonal da usuária
 * @returns Blob criptografado: { salt, iv, ciphertext } serializado como base64
 */
export async function encryptNsec(
  nsecBytes: Uint8Array,
  pattern: number[],
): Promise<string> {
  const salt = generateSalt();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKeyFromPattern(pattern, salt);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    ab(nsecBytes),
  );
  const ciphertext = new Uint8Array(ciphertextBuf);
  // JSON com salt/iv/ciphertext em base64, depois base64 do JSON inteiro.
  // Formato estável para a Phase 3 fazer localStorage.setItem("arakne_nsec_encrypted", blob).
  const payload = JSON.stringify({
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
  return btoa(payload);
}

/**
 * Decripta o nsec usando o padrão fornecido.
 * @param encryptedBlob Blob base64 retornado por encryptNsec
 * @param pattern Padrão hexagonal tentado
 * @returns Bytes da chave privada, OU null se o padrão estiver errado
 *          (não lança erro — retorna null para o caller tratar)
 */
export async function decryptNsec(
  encryptedBlob: string,
  pattern: number[],
): Promise<Uint8Array | null> {
  try {
    const payload = JSON.parse(atob(encryptedBlob)) as {
      salt: string;
      iv: string;
      ciphertext: string;
    };
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const key = await deriveKeyFromPattern(pattern, salt);
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintextBuf);
  } catch {
    // Padrão errado → chave errada → AES-GCM tag mismatch.
    // Ou blob malformado / base64 inválido. Em ambos os casos, retorna null.
    return null;
  }
}

/**
 * Calcula o hash SHA-256 do padrão (para verificação local rápida).
 * Não é seguro contra brute-force (sem KDF) — usado só como check rápido
 * antes de tentar decriptar (otimização: se o hash não bate, nem tenta PBKDF2).
 * @param pattern Sequência de vertex IDs
 * @returns Hash em hex
 */
export async function hashPattern(pattern: number[]): Promise<string> {
  const data = new TextEncoder().encode(pattern.join(","));
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hashBuf));
}

/**
 * Gera um salt aleatório de 16 bytes.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

// ── Criptografia com PIN (Opção E: share 1 guardada no backend) ────

/** Deriva uma chave AES-GCM-256 a partir de um PIN (string) usando PBKDF2.
 *  Mesmo esquema de `deriveKeyFromPattern`, mas o key material é o PIN
 *  (em vez da sequência de vértices do padrão hexagonal).
 *  @param pin PIN da usuária (string)
 *  @param salt Salt aleatório (16 bytes)
 *  @returns CryptoKey para AES-GCM */
async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(pin);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: ab(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Criptografa bytes arbitrários (ex.: share SSSS) com uma chave derivada do PIN.
 *  Reusado para guardar a share 1 no backend (Opção E: T=2 N=2).
 *  @param data Bytes a criptografar (ex.: 33 bytes da share SSSS)
 *  @param pin PIN da usuária (string)
 *  @returns Blob base64 (mesmo formato que encryptNsec: JSON {salt, iv, ciphertext} em base64)
 */
export async function encryptWithPin(
  data: Uint8Array,
  pin: string,
): Promise<string> {
  const salt = generateSalt();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKeyFromPin(pin, salt);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    ab(data),
  );
  const ciphertext = new Uint8Array(ciphertextBuf);
  const payload = JSON.stringify({
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
  return btoa(payload);
}

/** Decripta um blob produzido por encryptWithPin usando o PIN.
 *  @returns Bytes originais, ou null se o PIN estiver errado
 */
export async function decryptWithPin(
  blob: string,
  pin: string,
): Promise<Uint8Array | null> {
  try {
    const payload = JSON.parse(atob(blob)) as {
      salt: string;
      iv: string;
      ciphertext: string;
    };
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const key = await deriveKeyFromPin(pin, salt);
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintextBuf);
  } catch {
    // PIN errado → chave errada → AES-GCM tag mismatch.
    // Ou blob malformado / base64 inválido. Em ambos os casos, retorna null.
    return null;
  }
}
