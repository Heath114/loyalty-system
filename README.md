# loyalty-system

A branded loyalty card that lives in Apple Wallet and Google Wallet: no app to install. It brings
customers back with messages on their lock screen (birthday, offers, "we miss you", "you're near
the shop"). Built multi-tenant from the start so one engine serves many merchants (the phone store
pilot, UniDash venues, and whoever comes next).

## What works today

The loyalty base, end to end:

- **Join:** a customer scans the counter QR (`/m/<slug>/qr.svg`), fills in their name (and, if they
  like, their birthday), and gets a card page with **Add to Apple Wallet** and **Add to Google
  Wallet** (Google's first on Android). No app, no account. Phones without a wallet keep the card
  page itself, which shows the same QR.
- **The Apple card:** a signed `.pkpass` store card in the merchant's colours, in English and Arabic
  (follows the phone's language), showing the balance, rewards ready, and progress to the next one.
- **The Google card:** the same card in Google Wallet (`src/google.ts`), same QR, same languages.
  Off until the Google issuer account exists ([`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md)).
- **Staff scanning:** `/staff` on any phone or tablet browser. Scan the card with the camera (or type
  its number), add a stamp or points, redeem a reward. Double taps are harmless: each action carries
  a request ID and is recorded once. Apple and Google cards scan the same way.
- **Live updates:** every change reaches the customer's card. Apple: through the Wallet web service
  and APNs, with a lock-screen message ("Your card: 3 / 10", "...Your reward is ready!"). Google:
  through the Wallet API, silent except when a reward becomes ready.
- **Retention messages** (`src/messages.ts`), sent by the server's scheduler every few minutes:
  - **Birthday:** on the member's birthday (day and month only, optional at joining).
  - **Win-back:** after N days without a visit, once per absence.
  - **Promotions:** a one-off offer to every member who ticked "send me offers", now or at a set time.
  - **Near the shop:** each branch's location is on the card. Apple offers the card on the lock screen
    nearby (best effort, Apple decides); Google sends a notification nearby to customers who allow
    location. Both platforms take at most 10 branches.

  On Apple the message appears on the lock screen and stays on the back of the card ("News"); on
  Google it is a card message with a notification. `{name}` in a message becomes the member's first
  name.
- **Message rules the merchant cannot override:** at most 1 message a day and 4 in 30 days per card,
  only between 10:00 and 21:00 in the merchant's time zone, offers and win-back only to members who
  agreed to them, and every message sent once (the database enforces it). These protect our Apple and
  Google accounts: one merchant spamming could get every merchant restricted (`docs/STUDY.md` §9).
- **Many merchants from day one:** every card, ledger row, message and staff key belongs to a
  merchant, and every query is scoped by it. One merchant's staff cannot see another merchant's customers.
- **Stamps or points** per merchant: one stamp a visit, or N points per JOD, reward at a threshold.
  The balance is a cache of an append-only ledger.
- **NFC-ready:** the QR payload is signed and short enough for an NFC pass. Setting one variable
  switches NFC on once Apple grants the entitlement (`docs/APPLE_SETUP.md` §6).

Not built yet: the merchant dashboard (merchants, messages and branches are set up from the command
line for now), date-based reminders on a purchase (warranty ending, `docs/STUDY.md` §3), earn rates
per category, and reporting.

## Running it

```sh
npm install
npm test                 # 39 tests: ledger, signing (verified with openssl), Wallet web service, staff API,
                         # messages and their caps, Google Wallet against an in-memory fake of its API
npm run dev-certs        # stand-in certificates: passes build, an iPhone will not accept them
cp .env.example .env     # use the "Local development" values at the bottom
npm run merchant -- create --slug cafe --name "Cafe" --program stamps --threshold 10 --reward "Free coffee"
npm run merchant -- staff-key --slug cafe --label "Counter 1"
npm run dev              # http://localhost:8787/m/cafe and /staff
```

Messages and branches, from the command line until the dashboard exists (full list at the top of
`scripts/merchant.ts`):

```sh
npm run merchant -- trigger --slug cafe --kind birthday --text "Happy birthday {name}! Your coffee is on us today." \
    --text-ar "عيد ميلاد سعيد يا {name}! قهوتك اليوم علينا."
npm run merchant -- trigger --slug cafe --kind winback --days 30 --text "We miss you, {name}. 20% off this week."
npm run merchant -- promo --slug cafe --text "Two for one on Friday" --at "2026-10-23 10:00"
npm run merchant -- location --slug cafe --label "Abdoun" --lat 31.9539 --lng 35.8836
npm run merchant -- show --slug cafe
```

For a real iPhone, follow [`docs/APPLE_SETUP.md`](docs/APPLE_SETUP.md): Pass Type ID, its
certificate, Apple's WWDR certificate, and an HTTPS host. For Android, follow
[`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md).

## Layout

| Path | What it is |
|---|---|
| `src/loyalty.ts` | Merchants, enrolment, earn, redeem, branches. All the card rules. |
| `src/messages.ts` | Birthday, win-back and promotion messages: what is due, the caps, sending hours. |
| `src/scheduler.ts` | The background run: refresh cards after a merchant change, send due messages. |
| `src/notify.ts` | Delivery of updates and messages to both wallets. |
| `src/db.ts` | SQLite schema and its migrations (Node's built-in `node:sqlite`). |
| `src/pass/` | `pass.json`, localisation, images, `.pkpass` signing (PKCS#7, SHA-256), and the shared customer copy (`copy.ts`). |
| `src/google.ts` | Google Wallet: class per merchant, object per card, messages, signed save links. |
| `src/routes/wallet.ts` | Apple's PassKit web service: device registration, updates, latest pass. |
| `src/apns.ts` | Push to Wallet over HTTP/2 with the pass certificate. |
| `src/routes/public.ts` | Join page, customer card page, `.pkpass` download, Google save, counter QR, logo. |
| `src/routes/staff.ts` | Staff scanner page and its API. |
| `scripts/` | Merchant setup CLI, dev certificates. |

## Documents

- [`docs/STUDY.md`](docs/STUDY.md): the feasibility and practicality study. What the product is,
  costs, pricing, and the 12 questions that decide scope and timing (section 8).
  Imported from `The-Office-Development/the-office-handbook` `products/loyalty/STUDY.md` at `9929b7e`.
- [`docs/UNIDASH_ADDON.md`](docs/UNIDASH_ADDON.md): the UniDash version, an optional per-venue
  feature that will consume this engine. Imported from `The-Office-Development/UniDash`
  `docs/LOYALTY_WALLET_ADDON.md` (branch `develop`) at `58c04e0`.
- [`docs/APPLE_SETUP.md`](docs/APPLE_SETUP.md) and [`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md):
  what has to happen on each platform's side before cards reach real phones.

The originals stay where they are; this repo is where the product is built.
