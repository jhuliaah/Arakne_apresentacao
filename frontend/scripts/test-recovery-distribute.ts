/** Smoke test para src/lib/ssss.ts + src/lib/recovery-distribute.ts (Track 3A).
 *
 *  Rode com:  npx tsx scripts/test-recovery-distribute.ts
 *
 *  Valida:
 *  1. splitNsec(nsec) → 3 shares de 33 bytes
 *  2. combineNsec([s0, s1]) → nsec original (round-trip com T=2)
 *  3. combineNsec([s0, s1, s2]) → também funciona (T=2, mas N=3 combina)
 *  4. combineNsecWithCheck([s0, s1], ownerPubkey) → nsec
 *  5. combineNsecWithCheck([s0, s1], wrongPubkey) → lança erro
 *  6. distributeShares(nsec, ownerNpub, [3 npubs]) → published >= 1
 *
 *  Para o teste de distribuição, geramos 3 identidades com
 *  `createNostrIdentity()` e descartamos o nsec de 2 delas para simular
 *  shadows (npub placeholder, sem chave privada conhecida).
 *
 *  Nota: o teste de `distributeShares` faz publish real nos relays
 *  hardcoded (wss://relay.damus.io, nos.lol, relay.nostr.band). Pode
 *  falhar se a rede estiver indisponível — nesse caso published=0 e o
 *  check de `published >= 1` falha. Isso é esperado em ambiente offline.
 */

// Polyfill mínimo de localStorage para Node/tsx — em produção, o browser
// fornece localStorage nativamente. Sem isso, os checks de
// isDistributed()/markDistributed() não podem ser testados fora do browser.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
}

import { createNostrIdentity, decodeNsec } from "../src/lib/nostr-keys";
import { getPublicKey } from "nostr-tools/pure";
import {
  splitNsec,
  combineNsec,
  combineNsecWithCheck,
  N,
  T,
  SHARE_BYTES,
} from "../src/lib/ssss";
import {
  distributeShares,
  markDistributed,
  isDistributed,
  clearDistributed,
} from "../src/lib/recovery-distribute";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

async function main(): Promise<void> {
  console.log("1) Gerar identidade da dona + 2 avalistas (shadows)");
  const owner = createNostrIdentity();
  const avalista1 = createNostrIdentity(); // simulando avalista real
  const shadow1 = createNostrIdentity(); // shadow (nsec descartado)
  const shadow2 = createNostrIdentity(); // shadow (nsec descartado)
  assert(
    owner.npub.startsWith("npub1"),
    `owner.npub começa com npub1 (veio: ${owner.npub.slice(0, 12)}...)`,
  );
  assert(
    avalista1.npub !== owner.npub,
    "avalista1.npub ≠ owner.npub",
  );
  assert(
    shadow1.npub !== owner.npub && shadow1.npub !== avalista1.npub,
    "shadow1.npub é distinto",
  );
  assert(
    shadow2.npub !== owner.npub &&
      shadow2.npub !== avalista1.npub &&
      shadow2.npub !== shadow1.npub,
    "shadow2.npub é distinto",
  );

  const nsecBytes = decodeNsec(owner.nsec);
  assert(nsecBytes.length === 32, `nsec tem 32 bytes (veio: ${nsecBytes.length})`);

  console.log("2) splitNsec(nsecBytes) → 3 shares de 33 bytes");
  const shares = await splitNsec(nsecBytes);
  assert(shares.length === N, `geradas ${N} shares (veio: ${shares.length})`);
  for (let i = 0; i < shares.length; i++) {
    assert(
      shares[i].length === SHARE_BYTES,
      `share ${i} tem ${SHARE_BYTES} bytes (veio: ${shares[i].length})`,
    );
  }
  // Shares devem ser diferentes entre si
  assert(
    shares[0].length === shares[1].length &&
      shares[0].some((b, idx) => b !== shares[1][idx]),
    "share 0 ≠ share 1 (bytes diferentes)",
  );

  console.log("3) combineNsec([s0, s1]) → nsec original (T=2)");
  const recovered2 = await combineNsec([shares[0], shares[1]]);
  assert(recovered2.length === 32, `nsec reconstruído tem 32 bytes (veio: ${recovered2.length})`);
  let equal2 = recovered2.length === nsecBytes.length;
  for (let i = 0; i < nsecBytes.length && equal2; i++) {
    if (recovered2[i] !== nsecBytes[i]) equal2 = false;
  }
  assert(equal2, "nsec reconstruído (2 shares) bate com o original byte a byte");

  console.log("4) combineNsec([s0, s1, s2]) → também funciona (N=3 combina)");
  const recovered3 = await combineNsec([shares[0], shares[1], shares[2]]);
  assert(recovered3.length === 32, `nsec reconstruído (3 shares) tem 32 bytes`);
  let equal3 = recovered3.length === nsecBytes.length;
  for (let i = 0; i < nsecBytes.length && equal3; i++) {
    if (recovered3[i] !== nsecBytes[i]) equal3 = false;
  }
  assert(equal3, "nsec reconstruído (3 shares) bate com o original");

  // Combinações alternativas (T=2 → qualquer par deve funcionar)
  const recovered02 = await combineNsec([shares[0], shares[2]]);
  let equal02 = true;
  for (let i = 0; i < nsecBytes.length && equal02; i++) {
    if (recovered02[i] !== nsecBytes[i]) equal02 = false;
  }
  assert(equal02, "combine([s0, s2]) também reconstrói o nsec");

  const recovered12 = await combineNsec([shares[1], shares[2]]);
  let equal12 = true;
  for (let i = 0; i < nsecBytes.length && equal12; i++) {
    if (recovered12[i] !== nsecBytes[i]) equal12 = false;
  }
  assert(equal12, "combine([s1, s2]) também reconstrói o nsec");

  console.log("5) combineNsecWithCheck([s0, s1], ownerPubkeyHex) → nsec");
  const checked = await combineNsecWithCheck([shares[0], shares[1]], owner.publicKeyHex);
  assert(checked.length === 32, "combineNsecWithCheck retorna 32 bytes quando pubkey bate");
  let equalChecked = true;
  for (let i = 0; i < nsecBytes.length && equalChecked; i++) {
    if (checked[i] !== nsecBytes[i]) equalChecked = false;
  }
  assert(equalChecked, "combineNsecWithCheck retorna o nsec original");

  console.log("6) combineNsecWithCheck([s0, s1], wrongPubkeyHex) → lança erro");
  const wrongPubkeyHex = avalista1.publicKeyHex;
  let threw = false;
  try {
    await combineNsecWithCheck([shares[0], shares[1]], wrongPubkeyHex);
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert(
      msg.includes("Reconstrução falhou") || msg.includes("pubkey"),
      `erro tem mensagem esperada (veio: ${msg.slice(0, 80)}...)`,
    );
  }
  assert(threw, "combineNsecWithCheck lança Error quando pubkey não bate");

  // Sanity: shares de identidades diferentes NÃO devem reconstruir o nsec
  // (mas combine() retorna lixo sem lançar — daí a importância do check).
  const otherIdentity = createNostrIdentity();
  const otherShares = await splitNsec(decodeNsec(otherIdentity.nsec));
  const mixedLiar = await combineNsec([shares[0], otherShares[1]]);
  const mixedPubkey = getPublicKey(mixedLiar);
  assert(
    mixedPubkey !== owner.publicKeyHex,
    "combine de shares misturadas gera pubkey diferente (lixeira detectável via check)",
  );

  console.log("7) distributeShares(nsec, ownerNpub, [3 npubs]) → published >= 1");
  // Limpa flag antes do teste
  clearDistributed();
  assert(!isDistributed(), "isDistributed() === false antes de distribute");

  const result = await distributeShares(
    owner.nsec,
    owner.npub,
    [avalista1.npub, shadow1.npub, shadow2.npub],
  );

  assert(result.totalShares === N, `result.totalShares === ${N}`);
  assert(result.threshold === T, `result.threshold === ${T}`);
  assert(
    typeof result.vaultId === "string" && result.vaultId.length > 0,
    "result.vaultId é string não-vazia",
  );
  assert(
    result.published + result.failed === N,
    `published + failed === ${N} (veio: ${result.published}+${result.failed})`,
  );
  assert(
    result.published >= 1,
    `published >= 1 (veio: ${result.published}) — pode falhar se rede offline`,
  );

  assert(isDistributed(), "isDistributed() === true depois de distribute");

  // Limpa ao final para não poluir localStorage entre runs
  clearDistributed();
  assert(!isDistributed(), "clearDistributed() limpa o flag");

  console.log();
  if (failures === 0) {
    console.log("✅ Todos os checks passaram.");
    process.exit(0);
  } else {
    console.error(`❌ ${failures} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Erro fatal no smoke test:", err);
  process.exit(1);
});
