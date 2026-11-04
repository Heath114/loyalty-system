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
  - **Reminders after a purchase:** N days after a member's latest purchase in a category ("your
    warranty ends next month" 335 days after a phone, "time for your colour" after 42 days).
  - **Promotions:** a one-off offer to every member who ticked "send me offers", now or at a set time.
  - **Near the shop:** each branch's location is on the card. Apple offers the card on the lock screen
    nearby (best effort, Apple decides); Google sends a notification nearby to customers who allow
    location. Both platforms take at most 10 branches.

  On Apple the message appears on the lock screen and stays on the back of the card ("News"); on
  Google it is a card message with a notification. `{name}` in a message becomes the member's first
  name.
- **Message rules the merchant cannot override:** at most 1 message a day and 4 in 30 days per card,
  only between 10:00 and 21:00 in the merchant's time zone, offers, win-back and reminders only to
  members who agreed to them, and every message sent once (the database enforces it). These protect our Apple and
  Google accounts: one merchant spamming could get every merchant restricted (`docs/STUDY.md` §9).
- **Many merchants from day one:** every card, ledger row, message and staff key belongs to a
  merchant, and every query is scoped by it. One merchant's staff cannot see another merchant's customers.
- **Stamps or points** per merchant: one stamp a visit, or N points per JOD, reward at a threshold.
  The balance is a cache of an append-only ledger.
- **Categories:** what was bought, each earning its own way: points per JOD, or a set number per
  purchase whatever it cost (a phone store's thank-you for a device, where points on the full price
  would give away the margin). Staff pick one with a tap; reminders and reports hang off them.
- **A menu of rewards:** besides the reward the card counts towards, more at other prices ("200
  points: a case, 1500: earbuds"). Staff see the ones a card can afford; the card lists them all.
- **Welcome gift and "bring a friend":** stamps or points on joining, and an invite link on every
  card: after the friend's first purchase both get a bonus (paid once the purchase is past the undo
  window, at most 10 friends a month per member).
- **Bonus periods:** "double points this weekend", on everything or one category, planned ahead.
- **Mistakes are cheap:** staff undo their own last entry within 10 minutes; the merchant adds or
  takes away by hand with a reason. Nothing is ever deleted from the ledger.
- **The merchant dashboard** (`/admin`, English and Arabic): an overview of members, visits, repeat
  and returning visitors, rewards, spending per category, which messages brought people back, and
  which counter device records visits; members (search, details, CSV download, deletion on request);
  every message; earning, categories, the reward menu, gifts and bonus periods; the card's names,
  colours, pictures and a printable counter poster; branches; counter device keys; contact details;
  and who else can sign in.
- **The staff page and the customer's pages in Arabic and English**, following the phone's language
  with a switch. The customer's card page shows their balance, the reward menu, a running bonus
  period, their invite link, their history, and lets them stop offers or delete their card.
- **A privacy notice per merchant** (`/m/<slug>/privacy`), linked from the join page: a plain
  template with the merchant's contact details, for the merchant's lawyer to read before going live.
- **Deleting a member** (Jordan PDPL), by the member from their card page or by the merchant: their
  details are wiped, their card shows as void in their wallet and stops working, and their visits
  stay in the numbers without a name.
- **NFC-ready:** the QR payload is signed and short enough for an NFC pass. Setting one variable
  switches NFC on once Apple grants the entitlement (`docs/APPLE_SETUP.md` §6).

Not built yet: creating a merchant from the dashboard (we create each merchant and its first sign-in
from the command line, on purpose: it is our step, with a contract behind it), password reset by
email (we reset from the command line), SMS or WhatsApp, and NFC (waits on Apple, `docs/APPLE_SETUP.md` §6).
Nothing has run on a real phone yet: [`docs/MANUAL_STEPS.md`](docs/MANUAL_STEPS.md) is what stands
between this code and the first customer.

## Running it

```sh
npm install
npm test                 # 89 tests: ledger, categories, undo and adjustments, the reward menu, gifts and
                         # referrals, bonus periods, signing (verified with openssl), Wallet web service, staff
                         # API, messages, reminders and their caps, reports, deletion, the customer pages, the
                         # dashboard API, Google Wallet against an in-memory fake of its API
npm run dev-certs        # stand-in certificates: passes build, an iPhone will not accept them
cp .env.example .env     # use the "Local development" values at the bottom
npm run merchant -- create --slug cafe --name "Cafe" --program stamps --threshold 10 --reward "Free coffee"
npm run merchant -- admin --slug cafe --email you@example.com    # dashboard sign-in, password shown once
npm run dev              # http://localhost:8787/admin, /m/cafe and /staff
```

Everything else is in the dashboard. The same things from the command line, for us (full list at
the top of `scripts/merchant.ts`):

```sh
npm run merchant -- trigger --slug cafe --kind birthday --text "Happy birthday {name}! Your coffee is on us today." \
    --text-ar "عيد ميلاد سعيد يا {name}! قهوتك اليوم علينا."
npm run merchant -- trigger --slug cafe --kind winback --days 30 --text "We miss you, {name}. 20% off this week."
npm run merchant -- promo --slug cafe --text "Two for one on Friday" --at "2026-10-23 10:00"
npm run merchant -- location --slug cafe --label "Abdoun" --lat 31.9539 --lng 35.8836
npm run merchant -- category --slug cafe --name "Colour" --fixed 1
npm run merchant -- reminder --slug cafe --category 1 --days 42 --text "Time for your colour, {name}?"
npm run merchant -- staff-key --slug cafe --label "Counter 1"
npm run merchant -- admin-reset --email you@example.com          # a forgotten password
npm run merchant -- show --slug cafe
```

For a real iPhone, follow [`docs/APPLE_SETUP.md`](docs/APPLE_SETUP.md): Pass Type ID, its
certificate, Apple's WWDR certificate, and an HTTPS host. For Android, follow
[`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md).

## Layout

| Path | What it is |
|---|---|
| `src/loyalty.ts` | Merchants, enrolment, categories, earn, redeem, branches, member deletion. All the card rules. |
| `src/messages.ts` | Birthday, win-back, reminder and promotion messages: what is due, the caps, sending hours. |
| `src/reports.ts` | What the dashboard shows: the period report, message results, members, the CSV. |
| `src/referrals.ts` | "Bring a friend": invite links, paying referral bonuses, referral numbers. |
| `src/admin.ts` | Dashboard sign-in and sessions, admins, merchant settings, images, staff keys. |
| `src/scheduler.ts` | The background run: refresh cards after a merchant change, send due messages. |
| `src/notify.ts` | Delivery of updates and messages to both wallets. |
| `src/db.ts` | SQLite schema and its migrations (Node's built-in `node:sqlite`). |
| `src/pass/` | `pass.json`, localisation, images, `.pkpass` signing (PKCS#7, SHA-256), and the shared customer copy (`copy.ts`). |
| `src/google.ts` | Google Wallet: class per merchant, object per card, messages, signed save links. |
| `src/routes/wallet.ts` | Apple's PassKit web service: device registration, updates, latest pass. |
| `src/apns.ts` | Push to Wallet over HTTP/2 with the pass certificate. |
| `src/routes/public.ts` | Join, card, privacy and delete pages, `.pkpass` download, Google save, counter QR and poster, logo. |
| `src/routes/customer-copy.ts` | Every word on the customer's pages, in English and Arabic, and the privacy notice. |
| `src/routes/staff.ts` | Staff scanner page and its API. |
| `src/routes/admin.ts` | The dashboard page and its API; `admin.client.js` and `admin.css` are the page itself. |
| `scripts/` | Merchant setup CLI, dev certificates. |

## Documents

- [`docs/MANUAL_STEPS.md`](docs/MANUAL_STEPS.md): **start here before going live.** Every step that
  needs a person (Apple and Google accounts, certificates, hosting, the real-phone test, papers),
  who does it, what it must produce, how to check it, and where each one stands.
- [`docs/STUDY.md`](docs/STUDY.md): the feasibility and practicality study. What the product is,
  costs, pricing, and the 12 questions that decide scope and timing (section 8).
  Imported from `The-Office-Development/the-office-handbook` `products/loyalty/STUDY.md` at `9929b7e`.
- [`docs/UNIDASH_ADDON.md`](docs/UNIDASH_ADDON.md): the UniDash version, an optional per-venue
  feature that will consume this engine. Imported from `The-Office-Development/UniDash`
  `docs/LOYALTY_WALLET_ADDON.md` (branch `develop`) at `58c04e0`.
- [`docs/APPLE_SETUP.md`](docs/APPLE_SETUP.md) and [`docs/GOOGLE_SETUP.md`](docs/GOOGLE_SETUP.md):
  what has to happen on each platform's side before cards reach real phones.

The originals stay where they are; this repo is where the product is built.
