# Arakne

> "Every thread, a woman. Every knot, a trust."

A crochet/weaving learning app that, beneath the surface, is a peer-to-peer
microcredit network over the Lightning Network for women without banking
access due to coercive financial control. Crochet is the visible surface;
financial features are revealed through hidden gestures.

Project for the **Hack4Freedom São Paulo 2026** hackathon (women-only team).

---

## Overview

Arakne is a mobile-first app that presents itself as a crochet learning
platform — with 9 trails, 54 lessons, and 127 real materials. Beneath this
disguise lies a Bitcoin/Lightning microcredit network: users can request
loans (in sats), receive via Pix, pay debts, and exchange credit for cash
in person with a "Thread Supplier" from their own network.

The disguise is not cosmetic — it's a security requirement. The target
audience is women under coercive financial control (Afghanistan, India,
Northeastern Brazil, Colombia). The home screen shows no crypto or
financial symbols; the financial layer only appears after drawing the
"Arakne Stitch," a gesture-based pattern that functions as a password.

---

## Problem

Women under coercive financial control lack access to credit, personal bank
accounts, or financial independence. The abuser controls the phone, bank
statements, and any sign of autonomous financial activity. Traditional
microcredit solutions (Grameen Bank, SACCOs) require physical presence and
real identity — impossible for someone who must hide activity from the abuser.

---

## Solution

1. **Total disguise:** the app is a genuine crochet catalog. No mention of
   money, crypto, or loans on the visible surface.
2. **Social voucher access:** one woman refers another (voucher). No real
   identity — just a PIN + opaque identifier + Nostr key.
3. **Microcredit in sats via Lightning:** instant loan, no bank, no KYC.
   Debt is in sats; repayment can be via Pix.
4. **Spending layer via Pix:** the user converts sats to BRL and pays bills,
   or receives deposits via QR Pix.
5. **In-person Exchange Point:** a "Thread Supplier" in the network
   converts the user's credit into cash, outside the app — for those who
   cannot safely use Pix.
6. **Social recovery:** if the user loses the device or forgets the pattern,
   her "trusted weavers" help recover the account via Shamir's Secret
   Sharing + Nostr gift-wrap (NIP-59).

---

## Tech Stack

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React 18 + Vite + TypeScript)                  │
│  State machine (23 views, no React Router)                │
│  PWA mobile-first · Tailwind · shadcn/ui                  │
│  Port 5173 (dev) / Vercel (prod)                          │
├──────────────────────────────────────────────────────────┤
│  Backend (FastAPI + SQLAlchemy + SQLite)                   │
│  10 routers · 18 models · 139 tests (pytest)              │
│  Port 8000 (dev) / Railway (prod)                         │
├──────────────────────────────────────────────────────────┤
│  External services (all with mock fallback)               │
│  Coinos (Lightning) · Mercado Pago (Pix) · Binance (BRL)  │
│  embit (offline multisig) · Breez SDK (mobile wallet)     │
└──────────────────────────────────────────────────────────┘
```

### Backend — `backend/` (FastAPI + Python 3.12+)

| Layer | Technology | Status |
|---|---|---|
| REST API | FastAPI + Pydantic | ✅ 10 routers operational |
| Database | SQLite via SQLAlchemy | ✅ `Base.metadata.create_all()` (no Alembic) |
| Lightning (pool) | Coinos API (coinos.io) | ✅ integrated, mock fallback |
| Lightning (loans) | Coinos API | ✅ integrated, mock fallback |
| Pix (loan repayment) | Mercado Pago Checkout Transparente | ✅ real + mock |
| Pix (wallet deposit) | Mercado Pago + active polling | ✅ real + mock |
| BRL→sats conversion | Binance API | ✅ complete code, mock fallback |
| Cold storage | embit (2-of-3 multisig) | ✅ offline script functional |
| Risk engine | `services/risco.py` (4 tiers) | ✅ implemented and tested |
| Social recovery | SSSS T=2 N=2 + NIP-59 | ✅ implemented |

### Frontend — `frontend/` (React 18 + Vite + TypeScript)

| Layer | Technology |
|---|---|
| Framework | React 18 (no React Router — manual state machine) |
| Build | Vite 8 + TypeScript |
| Styling | Custom CSS + Cinzel/Fraunces/Inter (Google Fonts via @fontsource) |
| QR Code | `qrcode` (generation) + `jsqr` (camera scanning) |
| Nostr crypto | `nostr-tools` (nsec/npub, NIP-59 gift-wrap, NIP-44) |
| SSSS | `shamir-secret-sharing` (audited by Cure53 and Zellic) |
| Pattern crypto | Native WebCrypto (AES-GCM-256 + PBKDF2 600k iterations) |
| Breez SDK | `@breeztech/breez-sdk-spark/web` (non-custodial wallet) |
| Deploy | Vercel (`vercel.json` with SPA rewrites) |

### Docker (optional, full stack)

`docker-compose.yml` runs Bitcoin Core (regtest) + LND + LNbits + backend
+ frontend. For demos, mock mode needs no Docker — just run
`dev-up.sh --mock`.

---

## Nostr — Identity, Encryption, and Social Recovery

Arakne uses the **Nostr** protocol (Notes and Other Stuff Transmitted over
Relays) as the identity and encrypted communication layer for social account
recovery. We don't use Nostr as a social network — we use only the
cryptographic and transport primitives the protocol offers.

### Why Nostr?

The threat model requires account recovery to work **months after** signup,
with no central server, no phone, and no intermediary knowing who asked for
help or who responded. Nostr solves this with:

- **Keys instead of accounts:** the user's identity is a secp256k1 keypair
  (nsec/npub), generated locally, with no server registration.
- **Decentralized relays:** gift-wrapped messages persist on public relays;
  there is no Arakne server in the recovery path.
- **End-to-end encryption:** NIP-44 (ephemeral session key + AES-GCM)
  ensures only the recipient can read the content.

### Identity generation (`nostr-keys.ts`)

The private key (nsec) is generated with `generateSecretKey()` from
`nostr-tools/pure` — 32 cryptographically secure random bytes. **We do not
use NIP-06** (BIP-39 mnemonic derivation), because the Nostr protocol marks
NIP-06 as `unrecommended`, and the social recovery model (SSSS + NIP-59)
doesn't depend on a seed phrase. The npub (bech32, `npub1...`) is the
backup identifier — much shorter than 12 words.

The nsec **never leaves the device in plaintext**. It's encrypted in
`localStorage` with AES-GCM-256, key derived from the Arakne Stitch pattern
via PBKDF2 (600k iterations, native WebCrypto).

### NIP-59 gift-wrap (`gift-wrap.ts`)

NIP-59 creates a triple privacy layer over Nostr messages:

```
Rumor (kind 1, unsigned)
  └→ Seal (kind 13, NIP-44, signed by sender)
       └→ Wrap (kind 1059, random ephemeral key, NIP-44)
            └→ published to relay
```

1. **Rumor** — the actual content (a JSON with type `shard`, `request`, or
   `response`). Has the author's `pubkey` but no `sig`, so it's not a
   publishable or traceable event.
2. **Seal** — signs the rumor with the sender's key and encrypts (NIP-44)
   to the recipient's public key. `created_at` is randomized.
3. **Wrap** — wraps the seal with a random ephemeral key, encrypted
   (NIP-44) to the recipient. Tag `p` = recipient.

The relay only sees the wrap (kind 1059) with an ephemeral pubkey — **it
doesn't know who sent it, who received it, or what the content is**. The
recipient unwraps it with their private key.

### Relay pool (`nostr-pool.ts`)

Singleton `SimplePool` from `nostr-tools/pool` — one instance for the whole
app. Publishes to **3 hardcoded relays** with redundancy (if 1-2 go down,
the wrap survives on the others):

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`

- **Publish:** to all 3 relays simultaneously (`Promise.allSettled`).
  Returns `true` if ≥1 accepted.
- **Subscribe:** round-robin across all 3. `SimplePool` deduplicates events
  by `id` automatically.
- **Sync query:** `querySync()` waits for EOSE on all relays and returns
  full history (to download pending wraps when the user reopens the app).

### Social recovery — full flow

**Distribution (at signup):**
1. The owner's nsec is split into 2 shares via SSSS (T=2, N=2).
2. **Share 0** → gift-wrapped (NIP-59) addressed to the inviter (her trusted
   weaver), published to all 3 relays.
3. **Share 1** → encrypted with the owner's PIN (AES-GCM) and sent to the
   backend (`POST /usuarias/me/recovery-share`). The backend stores only
   the opaque blob — it never sees the PIN or the share in plaintext.

**Recovery (on new device):**
1. The owner generates a local ephemeral nsec (only to receive responses).
2. Logs in with `identifier` + PIN → fetches and decrypts share 1 from the
   backend.
3. Gift-wraps a `request` addressed to the inviter, published to relays.
4. The inviter (with app open) receives the wrap via subscribe, unwraps it,
   locates the share 0 she kept, and responds via gift-wrap with the share.
5. The owner combines share 0 + share 1 via SSSS and validates the pubkey
   of the reconstructed nsec against the expected npub
   (`combineNsecWithCheck`).

**Why SSSS and not just encryption?** Because `combine()` from the
`shamir-secret-sharing` library (audited by Cure53 and Zellic) doesn't
detect incorrect or tampered shares — it returns deterministic garbage.
`combineNsecWithCheck()` derives the pubkey from the reconstructed nsec and
compares it with the expected one before accepting the result. This detects
mixed shares, tampered shares, or shares from different vaults.

### PIN-based recovery fallback

If the account has no SSSS shares configured (case of accounts created via
`/demo-setup` without going through `RecoverySetupPage`), the system
generates a new Nostr identity, links it to the backend via `updateNpub`,
and the owner draws a new Arakne Stitch. Balance, tier, and loans are in
the backend (not the nsec), so the account is fully recoverable without SSSS.

---

## Breez SDK — Non-Custodial Lightning Wallet

The **Breez SDK (Spark)** is the user's individual Lightning wallet —
truly non-custodial. The key/seed never leaves the device, never sent to
the backend. This is structural, not a convention: it's what distinguishes
this layer from the pool (which **is** custodial by design, via Coinos on
the backend).

### Why non-custodial?

The Arakne pool (collective fund) is custodial by design — it's a credit
cooperative, not an individual wallet. But the user's personal wallet (for
receiving deposits, making day-to-day payments) needs to be hers: if the
backend goes down, if the operator disappears, if someone confiscates the
server — the user still has her sats. The Breez SDK solves this by running
a nodeless Lightning node in the browser itself (WASM), with no
intermediary server.

### Seed derivation from nsec

The Breez SDK requires a BIP-39 mnemonic as input format. Arakne **does
not use NIP-06** (Nostr → BIP-39 derivation via HD paths), because the
protocol marks NIP-06 as `unrecommended`. Instead, the same 32 bytes of
the nsec are reinterpreted as **BIP-39 entropy** via `entropyToMnemonic()`
from the `bip39` library:

```
nsec (32 bytes) → hex → entropyToMnemonic() → 24 BIP-39 words
```

This is deterministic: the same nsec always produces the same mnemonic, so
a user's Breez wallet is always recoverable from the same Nostr identity —
without needing to store/show the mnemonic separately. "One master key,
two output formats": Nostr uses the raw bytes, Breez uses the same entropy
encoded as 24 words.

### Operations (`breez-wallet.ts`)

| Function | What it does |
|---|---|
| `initBreezWallet(nsecBytes, config)` | Initializes WASM module, derives mnemonic from nsec, connects to SDK |
| `getBalanceSats(sdk)` | Queries balance in sats via `sdk.getInfo()` |
| `receberPagamento(sdk, amount, desc)` | Generates Lightning invoice via `sdk.receivePayment()` |
| `prepararEnvio(sdk, destination)` | Fee quote via `sdk.prepareSendPayment()` — doesn't move anything yet |
| `confirmarEnvio(sdk, result)` | Executes payment via `sdk.sendPayment()` — spends real sats |

The send flow is always **two steps**: first `prepararEnvio()` (shows the
fee for the user to confirm), then `confirmarEnvio()` (executes). Never
chains the two without human confirmation in between — it's real money.

### Configuration

- **API key:** free, obtained at [breez.technology](https://breez.technology)
  ("Request API Key" form). Without it, `connect()` fails — there's no mock
  mode here, because it makes no sense to simulate a non-custodial wallet:
  it's either real, or it doesn't exist.
- **Variable:** `VITE_BREEZ_API_KEY` in `frontend/.env`
- **SDK:** `@breeztech/breez-sdk-spark/web` (subpath `/web` for SPA/browser)
- **WASM:** the WebAssembly module is loaded via `init()` before any call —
  needs to run once per session.

### Pool vs. individual wallet distinction

| | Pool (backend) | Individual wallet (frontend) |
|---|---|---|
| Custody | Custodial (Coinos) | Non-custodial (Breez SDK) |
| Key | Pool account JWT in `.env` | User's nsec (derived) |
| Operation | Loans, repayment, BRL conversion | Day-to-day deposit/spending |
| Backend | `services/coinos.py` | Runs in browser (WASM) |
| Mock | Yes (automatic fallback) | No (either real, or doesn't exist) |

---

## Screen Flows (Frontend)

### Onboarding (new device)

```
Splash → CreateAccount (PIN + optional nickname)
       → RecoverySetup (distribute SSSS shares)
       → Catalog (crochet trails)
```

### Login (device with account)

```
PatternLogin (draw Arakne Stitch) → Catalog
```

### Disguised portal

```
Trail 9 → Level 1 → Lesson 1 ("Ponto Renascido")
        → HexPatternCanvas (draw correct pattern)
        → FinancialPage revealed
```

### FinancialPage ("Your atelier")

- Level card (tier) and outstanding balance ("pattern in progress")
- Yarn basket (wallet): balance in sats + BRL conversion
- Buttons: "Pull yarns" (loan), "Receive yarns" (deposit),
  "Deliver yarns" (Pix payment), "Return yarns" (repayment)
- Thread Suppliers (exchange points)
- Trusted weaver (recovery guarantor)
- Bell 🎀 (social recovery request notifications)

### Account recovery

```
Splash → "Recover access"
       → "I have my PIN" (identifier + PIN)
       → Fallback: generates new Nostr identity, links to backend
       → New Arakne Stitch → Catalog
```

### Invite (referral link)

```
/convite/FUNDADORA_INVITE → InviteDecision
                          → Accept → CreateAccount (born tier 1)
```

---

## Secrets and Environment Variables

The project has **3 operation modes**:

### Mock mode (demo, zero credentials)

```bash
bash scripts/dev-up.sh --mock
```

The script swaps `.env` for `.env.mock` (all fields empty), runs the seed,
starts everything. On exit (Ctrl+C), it restores the real `.env`. No
external calls are made — Coinos, Pix, and Binance all fall back to mock
automatically.

### Backend variables (`.env`)

| Variable | Description | Empty = |
|---|---|---|
| `COINOS_URL` | Coinos API URL | default `https://coinos.io/api` |
| `COINOS_POOL_TOKEN` | JWT for pool account on Coinos | mock (no real Lightning) |
| `MP_ACCESS_TOKEN` | Mercado Pago token (Pix) | mock (no real PSP) |
| `MP_WEBHOOK_URL` | Public URL for MP webhook | manual polling |
| `PIX_NOME_RECEBEDOR` | Commercial name on Pix | cosmetic default |
| `BINANCE_API_KEY` | Binance API key | mock (no buy/withdraw) |
| `BINANCE_API_SECRET` | Binance API secret | mock |
| `MULTISIG_DESCRIPTOR` | 2-of-3 multisig descriptor | endpoint reports "not configured" |
| `MULTISIG_ENDERECO` | Cold storage address | same |
| `MULTISIG_QUORUM` | Quorum (e.g. `2-de-3`) | `2-de-3` |
| `MULTISIG_NETWORK` | Bitcoin network (`mainnet`/`regtest`) | `regtest` |

### Frontend variables (`frontend/.env`)

| Variable | Description |
|---|---|
| `VITE_BREEZ_API_KEY` | Breez SDK key (non-custodial wallet) |
| `VITE_API_URL` | Backend URL in prod (e.g.: Railway). Without it, uses `/api` (vite proxy) |

---

## Target Audience

Women without banking access due to coercive financial control:

- **Afghanistan** — women prohibited from having bank accounts
- **India** — dowry/family control over women's finances
- **Northeastern Brazil** — financial dependency in abusive relationships
- **Colombia** — internally displaced persons without banking documentation

The crochet disguise is the protection: the abuser looking at the phone sees
a crafts app. The financial layer only appears with the secret gesture.

---

## Brand Identity

- **Myth:** Arachne was punished by Athena for weaving the truth about the
  gods' abuses. "Arachne was punished for weaving the truth; we finish what
  she started."
- **Palette:** imperial blue, gold, burgundy, cream, dusk blue
- **Typography:** Cinzel (wordmark) · Fraunces (headings) · Inter (UI)
- **Vocabulary:** no financial terms in the UI. "Yarns" = sats,
  "atelier" = wallet, "threads" = shares, "pattern completed" = payment
  settled, "stitch lesson" = help request in social recovery.

---

## Credit Engine

| Tier | Requirement | Limit (sats) |
|---|---|---|
| 0 | No credit | 0 |
| 1 | 1 voucher (referral) | 5,000 |
| 2 | Tier 1 repaid | 15,000 |
| 3 | Tier 2 repaid + referral | 40,000 |

- Delay > 14 days → `tier_congelado` (specified, scheduler pending)
- Completing crochet patterns does not unlock credit
- Never reduces tier retroactively

---

## Team

Project for the Hack4Freedom São Paulo 2026 hackathon (women-only team).

- **Jhulia Carvalho** — Architecture; business model; Pix payment rail;
  financial flow; fiat/bitcoin integration.
- **Dilaine Oliveira** — Frontend; Nostr identities; Recovery; UX design;
  learning trails; implementation of security mechanisms and Arakne Stitch.

---

## Repository and Links

- **Main repo:** github.com/jhuliaah/Arakne
- **Frontend deploy:** Vercel (`vercel.json` included)
- **Backend deploy:** Railway (configure env vars in dashboard)

---

## How to Run

### Mock mode demo (recommended for evaluators)

```bash
bash scripts/dev-up.sh --mock
```

This starts backend (:8000) + frontend (:5173) with zero real credentials.
On exit (Ctrl+C), the original `.env` is restored.

### Local development (with real credentials)

```bash
bash scripts/dev-up.sh --all   # seed + multisig + tunnel + start everything
```

Or manually:

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python seed_demo.py
uvicorn app.main:app --port 8000 --reload --reload-exclude "*.db"

# Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev
```

### Demo credentials

| User | Identifier | PIN | Tier |
|---|---|---|---|
| Founder | `FUNDADORA` | `1234` | 3 |
| Supplier | `FORNECEDORA` | `1234` | 3 |
| Invitee | (created during demo) | — | 1 |

Visit `http://localhost:5173/demo-setup` to connect the browser to the
Founder account. Use `http://localhost:5173/convite/FUNDADORA_INVITE`
to create an invitee.

### Quick verification

| Check | How |
|---|---|
| Backend running | `curl http://localhost:8000/health` |
| Frontend loading | Open `http://localhost:5173` |
| Seed created masters | `python seed_demo.py` lists FUNDADORA + FORNECEDORA |
| Automated demo | `cd backend && python run_demo.py` (< 10s, mock) |
| Backend tests | `cd backend && pytest` (139 tests) |

---

## Status

### Implemented and functional architecture

| Component | Status |
|---|---|
| Crochet catalog (9 trails, 54 lessons, 127 materials) | ✅ |
| Disguised portal (trail 9 → Arakne Stitch) | ✅ |
| FinancialPage (balance, loan, wallet, exchanges) | ✅ |
| Credit engine (4 tiers, social voucher) | ✅ |
| Lightning loan (Coinos) | ✅ |
| Pix repayment (Mercado Pago) | ✅ |
| Pix deposit + active polling (no webhook) | ✅ |
| Internal wallet (TransacaoCarteira ledger) | ✅ |
| Exchange Point (approve/reject, reputation) | ✅ |
| Nostr identity (direct nsec, AES-GCM + PBKDF2) | ✅ |
| Social recovery (SSSS T=2 N=2 + NIP-59 gift-wrap) | ✅ |
| PIN recovery (fallback without SSSS) | ✅ |
| Lockout after 8 attempts (exponential backoff) | ✅ |
| 2-of-3 multisig custody (offline embit script) | ✅ |
| BRL→sats conversion (Binance API) | ✅ (complete code) |
| Breez SDK (non-custodial wallet) | ✅ (typing fixed) |
| Automated demo (run_demo.py) | ✅ |
| Full mock mode (--mock in dev-up.sh) | ✅ |
| Vercel deploy (vercel.json + VITE_API_URL) | ✅ |
| 139 pytest tests (backend) | ✅ |

---

## Next Steps (Roadmap)

### Functional pending items

| Item | Priority | Description |
|---|---|---|
| Delay scheduler | High | `ao_atrasar()` exists but is never called — no cron/job in repo |
| Wallet deposit webhook | High | Deposit confirms via polling, but dedicated webhook still missing |
| Loan exchange rate protection | High | `valor_sats` and `valor_brl` are independent — no automatic lock |
| Voucher with sats lock | Medium | Specified (500 sats fixed, returned on repayment), zero code |
| Boleto as alternative channel | Medium | Specified, no parser/generator in repo |
| Exchange Point Lightning settlement | Medium | Confirm/reject works; moving sats between wallets doesn't |
| Unique QR for Exchange Point | Medium | Currently uses text identifier |
| `vender_btc_mercado()` disconnected | High | Function ready but not called by `/carteira/pagar` |

### Target architecture (post-hackathon)

| Mechanism | MVP today | Target |
|---|---|---|
| Lightning custody | Coinos (hosted) | Own node, mainnet |
| Cold storage | Demo script | Real stewards, key rotation |
| User wallet | Breez SDK (evaluated) | Truly non-custodial |
| Repayment | Pix (Mercado Pago) | + LLC with dedicated commercial name |
| Exchange rate protection | Not implemented | Local currency denomination + 30-50% buffer |
| Interest | Not implemented | Floating rates based on Selic, downward spread |
| Multi-currency | `pais` field gates | Per-country rails (M-Pesa, UPI, etc.) |
| Investment layer | Wireframes | Pool staking (pending legal validation) |
| Fund governance | Not implemented | Multisig with real stewards |

### Financial roadmap — risk management and investment fund

#### Risk management

The current credit engine operates with 4 tiers based on social voucher
and progressive repayment (see Credit Engine section). The roadmap envisions
evolution toward a more sophisticated risk management system:

- **Automated delay:** `ao_atrasar()` already exists in the code but isn't
  called due to lack of a scheduler. The goal is a periodic job that
  checks loans overdue by more than 14 days and automatically freezes the
  tier of the borrower and her guarantor.
- **Voucher with sats lock:** a guarantor at tier ≥ 2 pays a fixed 500
  sats to unlock the referral link. The lock is only returned when the
  referred borrower repays her first loan — not when she takes it. This
  aligns incentives: the guarantor only refers people she truly trusts.
- **Loan exchange rate protection:** currently `valor_sats` and
  `valor_brl` are independent. The goal is to denominate the debt in local
  currency (e.g.: BRL) with the rate locked at loan time. The fund absorbs
  the exchange rate difference — if BTC rose between loan and repayment,
  the borrower pays the same BRL amount; if it fell, the fund absorbs the
  loss. This requires a 30–50% buffer of the total fund as exchange rate
  reserve.
- **Floating interest rates based on Selic:** downward spread (the
  borrower pays less than market rate). The rate isn't fixed — it floats
  with the country's base interest rate, so the fund remains sustainable
  across different economic cycles. The exact spread needs to be
  calibrated alongside the exchange rate buffer.

#### Investment fund (pool capitalization)

The Arakne pool is custodial and operates as a credit cooperative:
borrowers request loans, repay via Pix, and the BRL returns as sats to
the pool. But the pool needs initial capital and replenishment —
especially when there's default or unfavorable exchange rate variation.

The roadmap envisions an **investment layer** separate from the main app:

- **Investors provide capital to the pool** via staking positions (the
  language is DeFi — "position," not "share" — but the regulatory
  substance is close to a Brazilian FIDC, which is a real legal pending
  issue, not resolved by renaming).
- **The invested principal is never withdrawn** — it's locked in the
  pool as base capital. The investor only receives the **profit**, if
  any, distributed per monthly cycle (Curve/GMX style).
- **The investor has no access to the crochet app** — it's a different
  audience (investors, not borrowers), with its own interface, no
  textile disguise, and a separate legal entity from the operating one.
- **The architecture envisions a `posicao_staking` table** in the same
  backend, not a token — the system runs on Bitcoin/Lightning, not on a
  chain with smart contracts.

#### Second app (open capitalization)

To scale pool capitalization without exposing borrowers, the roadmap
envisions a **second app**, more open, that **draws from the same fund**:

- The main app (Arakne) remains disguised and focused on borrowers —
  crochet, microcredit, social recovery.
- The second app is open (no disguise), aimed at investors who want to
  provide capital to the fund. It connects to the **same backend** and
  the **same Lightning pool**, but has its own investment/staking
  interface.
- This model allows people outside the borrower network to contribute
  capital (including from outside Brazil, via Lightning), without going
  through the crochet onboarding or social voucher process.
- The app separation protects the disguise: an abuser who finds the
  investment app can't track the borrower, and vice versa.

### Known inconsistencies

1. `ao_atrasar()` exists and is correct, but is never called — delays have
   no automatic effect.
2. Wallet ledger (`TransacaoCarteira`) and spending balance are two
   unreconciled sources (partially mitigated by active polling).
3. `vender_btc_mercado()` ready but not called by `/carteira/pagar`.
4. Orphaned models (`Padrao`, `ProgressoPadrao`) — earlier disguise design,
   superseded by `Trilha`/`Aula`/`Material`.

---

## License

Hackathon project. All rights reserved to the authors.
