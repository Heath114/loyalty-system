# loyalty-system

A branded loyalty card that lives in Apple Wallet: no app to install. Built multi-tenant from the
start so one engine serves many merchants (the phone store pilot, UniDash venues, and whoever comes
next).

## What works today

The loyalty base, end to end:

- **Join:** a customer scans the counter QR (`/m/<slug>/qr.svg`), fills in their name, and gets a
  card page with **Add to Apple Wallet**. No app, no account. Phones without Wallet keep the card
  page itself, which shows the same QR.
- **The Wallet card:** a signed `.pkpass` store card in the merchant's colours, in English and Arabic
  (follows the phone's language), showing the balance, rewards ready, and progress to the next one.
- **Staff scanning:** `/staff` on any phone or tablet browser. Scan the card with the camera (or type
  its number), add a stamp or points, redeem a reward. Double taps are harmless: each action carries
  a request ID and is recorded once.
- **Live updates:** every change pushes to the customer's iPhone through Apple's Wallet web service
  and APNs. The card refreshes itself and shows a lock-screen message ("Your card: 3 / 10").
- **Many merchants from day one:** every card, ledger row and staff key belongs to a merchant, and
  every query is scoped by it. One merchant's staff cannot see another merchant's customers.
- **Stamps or points** per merchant: one stamp a visit, or N points per JOD, reward at a threshold.
  The balance is a cache of an append-only ledger.
- **NFC-ready:** the QR payload is signed and short enough for an NFC pass. Setting one variable
  switches NFC on once Apple grants the entitlement (`docs/APPLE_SETUP.md` §6).

Not built yet: Google Wallet, the merchant dashboard (merchants are set up from the command line),
scheduled messages (birthday, win-back), and reporting.

## Running it

```sh
npm install
npm test                 # 18 tests: ledger, signing (verified with openssl), Wallet web service, staff API
npm run dev-certs        # stand-in certificates: passes build, an iPhone will not accept them
cp .env.example .env     # use the "Local development" values at the bottom
npm run merchant -- create --slug cafe --name "Cafe" --program stamps --threshold 10 --reward "Free coffee"
npm run merchant -- staff-key --slug cafe --label "Counter 1"
npm run dev              # http://localhost:8787/m/cafe and /staff
```

For a real iPhone, follow [`docs/APPLE_SETUP.md`](docs/APPLE_SETUP.md): Pass Type ID, its
certificate, Apple's WWDR certificate, and an HTTPS host.

## Layout

| Path | What it is |
|---|---|
| `src/loyalty.ts` | Merchants, enrolment, earn, redeem. All the rules. |
| `src/db.ts` | SQLite schema (Node's built-in `node:sqlite`). |
| `src/pass/` | `pass.json`, localisation, images, and `.pkpass` signing (PKCS#7, SHA-256). |
| `src/routes/wallet.ts` | Apple's PassKit web service: device registration, updates, latest pass. |
| `src/apns.ts` | Push to Wallet over HTTP/2 with the pass certificate. |
| `src/routes/public.ts` | Join page, customer card page, `.pkpass` download, counter QR. |
| `src/routes/staff.ts` | Staff scanner page and its API. |
| `scripts/` | Merchant setup CLI, dev certificates. |

## Documents

- [`docs/STUDY.md`](docs/STUDY.md): the feasibility and practicality study. What the product is,
  costs, pricing, and the 12 questions that decide scope and timing (section 8).
  Imported from `The-Office-Development/the-office-handbook` `products/loyalty/STUDY.md` at `9929b7e`.
- [`docs/UNIDASH_ADDON.md`](docs/UNIDASH_ADDON.md): the UniDash version, an optional per-venue
  feature that will consume this engine. Imported from `The-Office-Development/UniDash`
  `docs/LOYALTY_WALLET_ADDON.md` (branch `develop`) at `58c04e0`.

The originals stay where they are; this repo is where the product is built.
