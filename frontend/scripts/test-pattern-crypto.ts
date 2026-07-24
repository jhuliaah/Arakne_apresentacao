/** Smoke test para src/lib/pattern-crypto.ts e pattern-storage.ts.
 *
 *  Rode com:  npx tsx scripts/test-pattern-crypto.ts
 *
 *  Não usa vitest (será configurado na Phase 4). Valida:
 *  - generateSalt / deriveKeyFromPattern / encryptNsec / decryptNsec round-trip
 *  - decryptNsec com padrão errado → null (não lança erro)
 *  - hashPattern determinismo e distinção de padrões
 *  - createAndStoreIdentity / unlockWithPattern / hasStoredIdentity / clear
 *
 *  Padrões de teste têm 8+ vértices (requisito de entropia do HexPatternCanvas).
 */

// ── localStorage mock (Node não tem localStorage nativo) ─────────
// pattern-storage.ts só acessa localStorage dentro de funções (não no
// top-level do módulo), então o mock pode ser instalado após os imports.
const store = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, String(value));
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => {
    store.clear();
  },
  key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
  get length(): number {
    return store.size;
  },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

import {
  deriveKeyFromPattern,
  encryptNsec,
  decryptNsec,
  hashPattern,
  generateSalt,
} from "../src/lib/pattern-crypto";
import {
  createAndStoreIdentity,
  unlockWithPattern,
  hasStoredIdentity,
  clearStoredIdentity,
} from "../src/lib/pattern-storage";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

// Padrões de teste: 8 vértices (mínimo de entropia do HexPatternCanvas).
const PATTERN = [0, 1, 5, 10, 15, 20, 25, 30];
const PATTERN_WRONG = [0, 2, 6, 11, 16, 21, 26, 31];
const PATTERN_ALT = [3, 7, 9, 12, 18, 22, 28, 35];

// ── Testes pattern-crypto ──────────────────────────────────────

console.log("1) generateSalt()");
const salt = generateSalt();
assert(salt.length === 16, `salt tem 16 bytes (veio: ${salt.length})`);

console.log("2) deriveKeyFromPattern()");
const key = await deriveKeyFromPattern(PATTERN, salt);
assert(key !== null && key !== undefined, "retorna CryptoKey não-null");
assert(key.type === "secret", `tipo é "secret" (veio: ${key.type})`);
assert(
  key.algorithm.name === "AES-GCM",
  `algoritmo é AES-GCM (veio: ${key.algorithm.name})`,
);

console.log("3) encryptNsec()");
const nsecBytes = crypto.getRandomValues(new Uint8Array(32));
const blob = await encryptNsec(nsecBytes, PATTERN);
assert(
  typeof blob === "string" && blob.length > 0,
  "retorna string base64 não-vazia",
);
try {
  atob(blob);
  assert(true, "blob é base64 válido (decodifica sem erro)");
} catch {
  assert(false, "blob é base64 válido");
}

console.log("4) decryptNsec round-trip");
const decrypted = await decryptNsec(blob, PATTERN);
assert(decrypted !== null, "decrypt retorna não-null com padrão certo");
if (decrypted) {
  assert(
    decrypted.length === 32,
    `decrypted tem 32 bytes (veio: ${decrypted.length})`,
  );
  let equal = true;
  for (let i = 0; i < 32; i++) {
    if (decrypted[i] !== nsecBytes[i]) {
      equal = false;
      break;
    }
  }
  assert(equal, "bytes decriptados === bytes originais (round-trip OK)");
}

console.log("5) decryptNsec com padrão errado → null (não lança erro)");
const wrongResult = await decryptNsec(blob, PATTERN_WRONG);
assert(wrongResult === null, "retorna null com padrão errado");

console.log("6) hashPattern()");
const hash1 = await hashPattern(PATTERN);
assert(typeof hash1 === "string", "retorna string");
assert(hash1.length === 64, `hash tem 64 chars (veio: ${hash1.length})`);
assert(/^[0-9a-f]+$/.test(hash1), "hash é hex válido (apenas 0-9a-f)");

console.log("7) hashPattern distingue padrões diferentes");
const hash2 = await hashPattern(PATTERN_ALT);
assert(hash1 !== hash2, "padrões diferentes → hashes diferentes");
const hash1Again = await hashPattern(PATTERN);
assert(hash1 === hash1Again, "mesmo padrão → mesmo hash (determinístico)");

// ── Testes pattern-storage ─────────────────────────────────────

console.log("8) hasStoredIdentity() antes de criar");
store.clear();
assert(hasStoredIdentity() === false, "retorna false quando não há identidade");

console.log("9) createAndStoreIdentity()");
const identity = await createAndStoreIdentity(PATTERN);
assert(
  identity.nsec.startsWith("nsec1"),
  `nsec começa com nsec1 (veio: ${identity.nsec.slice(0, 8)}…)`,
);
assert(identity.npub.startsWith("npub1"), "npub começa com npub1");
assert(identity.mnemonic.split(/\s+/).length === 12, "mnemonic tem 12 palavras");
assert(identity.privateKeyHex.length === 64, "privateKeyHex tem 64 chars");
assert(identity.publicKeyHex.length === 64, "publicKeyHex tem 64 chars");
assert(hasStoredIdentity() === true, "hasStoredIdentity() === true após create");
assert(store.has("arakne_nsec_encrypted"), "arakne_nsec_encrypted no localStorage");
assert(store.has("arakne_pattern_hash"), "arakne_pattern_hash no localStorage");
assert(store.has("arakne_npub"), "arakne_npub no localStorage");
assert(!store.has("arakne_mnemonic"), "mnemonic NÃO foi guardado no localStorage");

console.log("10) unlockWithPattern() com padrão certo");
const unlocked = await unlockWithPattern(PATTERN);
assert(unlocked !== null, "retorna NostrIdentity não-null");
if (unlocked) {
  assert(unlocked.nsec === identity.nsec, "nsec destravado === nsec criado");
  assert(unlocked.npub === identity.npub, "npub destravado === npub criado");
  assert(unlocked.privateKeyHex === identity.privateKeyHex, "privateKeyHex bate");
  assert(unlocked.publicKeyHex === identity.publicKeyHex, "publicKeyHex bate");
  assert(unlocked.mnemonic === "", "mnemonic é vazio no unlock (não recuperável)");
}

console.log("11) unlockWithPattern() com padrão errado → null");
const unlockedWrong = await unlockWithPattern(PATTERN_WRONG);
assert(unlockedWrong === null, "retorna null com padrão errado");

console.log("12) clearStoredIdentity()");
clearStoredIdentity();
assert(hasStoredIdentity() === false, "hasStoredIdentity() === false após clear");
assert(!store.has("arakne_nsec_encrypted"), "arakne_nsec_encrypted removido");
assert(!store.has("arakne_pattern_hash"), "arakne_pattern_hash removido");
assert(!store.has("arakne_npub"), "arakne_npub removido");

console.log();
if (failures === 0) {
  console.log("✅ Todos os checks passaram.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) falharam.`);
  process.exit(1);
}
