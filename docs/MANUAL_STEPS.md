# Manual steps: everything code cannot do

Every step here needs a person: an account, a certificate, a signature, a phone in a hand, or a
decision only the partners can make. The code is ready for each of them. This file says, for each
step, **who** does it, **what it needs**, **exactly what to produce**, **where the result goes**,
**how to check it worked**, and **what it unblocks**.

Platform detail lives in [`APPLE_SETUP.md`](APPLE_SETUP.md) and [`GOOGLE_SETUP.md`](GOOGLE_SETUP.md);
this file is the checklist that ties them together and records where we are.

**Never commit or send:** `.env`, anything in `certs/` (`pass.key` above all), the Google service
account JSON, staff keys, admin passwords. This repo is **public** (step 1). `.gitignore` already
excludes `.env`, `certs/` and `data/`.

## Status at a glance

| # | Step | Who | Status (2026-11-04) | Unblocks |
|---|---|---|---|---|
| 1 | Make the repo private | Heath114 account owner | ⏳ deferred ("later", 2026-10-19) | Nothing technical; protects the study and pricing |
| 2 | Apple Pass Type ID + certificate | Apple team Account Holder or Admin | 🟡 key and CSR made, waiting on Apple | Any card on any iPhone |
| 3 | Apple WWDR G4 intermediate | done | ✅ 2026-11-04 | Signing |
| 4 | Google issuer account | done | ✅ 2026-10-19, Issuer ID `3388000000023224499`, demo mode | Google cards |
| 5 | Google service account key | Google account that owns the issuer | ⏳ not started | Any card on any Android |
| 6 | Google test accounts | same | ⏳ not started | Android test in demo mode |
| 7 | Temporary test link | whoever runs the test | ⏳ needs your OK (it opens this PC to the internet) | Real-phone test before hosting |
| 8 | Real-phone test | Malek (iPhone), someone with Android | ⏳ after 2 (Apple) and 5 to 7 (Google) | Confidence before a real merchant |
| 9 | Product name, domain, `PUBLIC_URL` | partners | ⏳ open (study §8, smaller decision 4) | Hosting, printed counter QRs |
| 10 | Host the server | partners, then whoever deploys | ⏳ open (study §5) | Real customers |
| 11 | Google publishing access | Google issuer owner | ⏳ after 8 | Android customers outside our test list |
| 12 | Before the first real merchant | partners | ⏳ | Going live |
| 13 | NFC tap (optional, later) | partners | 🔴 not started, not needed for v1 | Tap like Apple Pay |

---

## 1. Make the repo private

**Why:** `docs/STUDY.md` holds our pricing, our margins thinking and the competitor analysis;
`docs/UNIDASH_ADDON.md` describes UniDash internals. The code itself holds no secrets, but nothing
about this product needs to be public.

**Who:** the owner of the `Heath114` GitHub account (it is not under `mawccu` or the company org).

**Steps:** github.com/Heath114/loyalty-system → **Settings** → **General** → scroll to **Danger
Zone** → **Change repository visibility** → **Make private** → confirm.

**Optional, same visit:** transfer it to `The-Office-Development` (Settings → Transfer) so it sits
with the company's other repos. The old URL keeps redirecting; local clones keep working but should
have their `origin` updated.

**Check:** signed out (a private window), github.com/Heath114/loyalty-system shows 404.

**Unblocks:** nothing in code. Do it before the repo gets any merchant-specific content.

---

## 2. Apple: Pass Type ID and its certificate

**What it is:** the identity every card is signed with. Without it no iPhone accepts a card, not
even for testing. One Pass Type ID serves every merchant; each card carries its own merchant name,
colours and logo.

**Who:** someone with the **Account Holder** or **Admin** role on Apple developer team
`LZ8RFD29KM` (the team UniDash ships under). A Developer or App Manager role cannot create
identifiers or certificates. If that is Bader, send him the CSR file and this section.

**What is already done (2026-11-04, on Malek's PC):**

- A private key, `certs/pass.key` (RSA 2048). It never leaves the PC that runs the server. Not in
  git, never emailed, never pasted in chat.
- The certificate signing request made from it, `certs/pass.csr`, with a copy on the Desktop as
  `loyalty-pass.csr`. Subject: `CN=loyalty pass, O=Al Hujra Information Technology LLC, C=JO`. Its
  public key's SHA-256 starts `49ebc069c7886c84`. A CSR is not secret: it is fine to send.

**What to create, exactly:**

| Field | Value | Why |
|---|---|---|
| Identifier type | **Pass Type IDs** | not App IDs |
| Description | `Loyalty cards` | only we see it |
| Identifier | `pass.com.theoffice.loyalty` | Customers never see it, so it does not wait for the product name. It cannot be renamed later, and every card ever issued is tied to it, so change it **now** if you want a different one. It must start with `pass.`. |

**Steps:**

1. developer.apple.com/account → **Certificates, IDs & Profiles** → **Identifiers** → **+**.
2. Choose **Pass Type IDs** → Continue.
3. Description `Loyalty cards`, Identifier `pass.com.theoffice.loyalty` → Continue → **Register**.
4. Open the Pass Type ID you just made (filter the Identifiers list by "Pass Type IDs") →
   **Create Certificate** under Production Certificates. (Same thing another way: Certificates →
   **+** → **Pass Type ID Certificate** → pick the identifier.)
5. **Choose File** → the `loyalty-pass.csr` from the Desktop → Continue → **Download**. You get
   `pass.cer`.
6. Put `pass.cer` in the PC's Downloads folder (or send it: it is a public certificate).

**What to do with the result (whoever runs the server):**

```sh
openssl x509 -inform DER -in ~/Downloads/pass.cer -out certs/pass.pem
# The certificate must belong to our key: these two lines must print the same hash.
openssl x509 -in certs/pass.pem -noout -pubkey | openssl sha256
openssl pkey -in certs/pass.key -pubout | openssl sha256
# And it must name the identifier and the team:
openssl x509 -in certs/pass.pem -noout -subject -enddate
# subject should contain UID=pass.com.theoffice.loyalty and OU=LZ8RFD29KM
```

Then in `.env`: `PASS_TYPE_ID=pass.com.theoffice.loyalty`, `APPLE_TEAM_ID=LZ8RFD29KM`,
`PASS_CERT_PATH=certs/pass.pem`, `PASS_KEY_PATH=certs/pass.key`.

**Expiry:** the certificate lasts **one year**. Put the `-enddate` in the calendar a month early.
An expired certificate stops new cards installing **and** stops updates reaching cards already in
wallets. Renewing: a new CSR from the same key (or a new key), step 4 again, swap `pass.pem`,
restart. Cards already in wallets keep working with the new certificate because the Pass Type ID
stays the same.

**If the key is lost:** make a new key and CSR, revoke the old certificate on the portal, issue a
new one. Same identifier, so cards keep working once the server has the new pair.

**Never:** send `pass.key` anywhere, upload it to a host's web UI you do not control, or commit it.
Anyone holding it can sign cards in our name.

---

## 3. Apple WWDR G4 intermediate ✅

Done 2026-11-04: `certs/wwdr-g4.pem`, downloaded from apple.com/certificateauthority. SHA-256
fingerprint `EA:47:57:88:55:38:DD:8C:B5:9F:F4:55:6F:67:60:87:D8:3C:85:E7:09:02:C1:22:E4:2C:08:08:B5:BC:E1:4C`,
valid until 2030-12-10. Nothing to do until then. It is public; a host can download it again.

---

## 4. Google: issuer account ✅

Done 2026-10-19. Issuer ID `3388000000023224499` (not secret: it is in every Google card's ID).
Still in **demo mode** (step 11 ends that).

Open detail for the issuer profile, needed by step 11: the business name Google shows on cards
and on the publishing request. [TBD: Al Hujra Information Technology LLC, or the product name
from step 9]

---

## 5. Google: the service account key

**What it is:** a robot Google account the server uses to create cards in Google Wallet and to
sign the "Add to Google Wallet" links. Its key is a JSON file; whoever holds it can create cards in
our name, so it is handled like `pass.key`.

**Who:** whoever owns the Google account that created the issuer in step 4.

**Steps:**

1. console.cloud.google.com → top bar project picker → **New project**, name `loyalty-cards`
   (or reuse an existing company project).
2. **APIs & Services → Library** → search **Google Wallet API** → **Enable**.
3. **IAM & Admin → Service accounts → Create service account**. Name `loyalty-cards`. Skip the
   optional role and user steps: it needs **no** Cloud roles.
4. Open it → **Keys → Add key → Create new key → JSON → Create**. The browser downloads the file
   **once**; Google cannot show it again.
5. Copy the service account's email (`loyalty-cards@<project>.iam.gserviceaccount.com`).
6. pay.google.com/business/console → our issuer → **Users** → **Invite a user** → paste that email
   → access level **Developer** → Invite. Without this every call is refused with 403.

**What the file must contain** (check before using it): a JSON object with `"type":
"service_account"`, `client_email` (the email from point 5) and `private_key` (a block starting
`-----BEGIN PRIVATE KEY-----`). The server refuses to start without the last two.

**Where it goes:** `certs/google-service-account.json` on the server, then in `.env`:
`GOOGLE_ISSUER_ID=3388000000023224499`, `GOOGLE_SERVICE_ACCOUNT_PATH=certs/google-service-account.json`.
On a host that only takes environment variables, paste the whole file into
`GOOGLE_SERVICE_ACCOUNT_JSON` instead.

**Check:** start the server; the log line ends `Google Wallet on`. The first card a test account
saves creates the merchant's class on Google's side.

**If it leaks:** Cloud console → the service account → Keys → delete that key, make a new one.

---

## 6. Google: test accounts (while in demo mode)

In demo mode only Google accounts with a role on the issuer, or listed as test accounts, can save a
card, and every card's title starts with `[TEST ONLY]`.

**Steps:** pay.google.com/business/console → our issuer → **Google Wallet API** → **Manage** (or
**Test accounts**, depending on the console version) → add the Gmail address signed in on each
Android phone we test with.

**Needs:** an Android phone with Google Wallet. Malek's test phone is an iPhone (2026-11-04), so
the Android half of step 8 waits for someone with an Android phone.

---

## 7. A temporary test link (before we have a host)

**Why:** Wallet only sends a card's updates and lock-screen messages to a server on **HTTPS with a
real certificate**. Before step 10 exists, a free Cloudflare "quick tunnel" gives the server on
this PC a public `https://<random>.trycloudflare.com` address for as long as it runs.

**The trade-off, decided by a person:** while the tunnel runs, anyone with the random address can
reach the test server. It holds only test data, staff actions need a staff key, and the address is
unguessable, but it is still this PC on the internet. Run it only during a test, and stop it after.

**Steps:**

1. Start the server with `PUBLIC_URL` set to the tunnel address (it is printed by the tunnel; the
   server must restart after `PUBLIC_URL` changes, the tunnel does not).
2. Tunnel, in its own terminal (Cloudflare's signed binary, downloaded 2026-11-04):
   `C:\Users\USER\tools\cloudflared\cloudflared.exe tunnel --no-autoupdate --url http://localhost:8787`
3. Ctrl+C both when done.

**After the test:** cards added during it point at an address that no longer exists, so they never
update again. Delete them from the phone (Wallet → card → ... → Remove Pass) and delete
`data/loyalty.db` before using the PC for anything real.

**Without the tunnel:** a phone on the same Wi-Fi can open `http://<PC's LAN IP>:8787`. The card
installs and scans but never updates (no HTTPS). Windows may ask to allow Node through the firewall.

---

## 8. The real-phone test

**Needs:** step 2 for iPhone; steps 5 and 6 for Android; step 7 (or step 10) for live updates.

**Setup (on the PC running the server):**

```sh
npm run merchant -- create --slug test-cafe --name "Test Cafe" --name-ar "مقهى تجريبي" --program stamps \
    --threshold 3 --reward "Free coffee" --reward-ar "قهوة مجانية"
npm run merchant -- staff-key --slug test-cafe --label "Test counter"
npm run merchant -- admin --slug test-cafe --email you@example.com      # dashboard sign-in, shown once
npm start
```

**What to check, in order, and what "pass" looks like:**

| # | Do | Expect |
|---|---|---|
| 1 | iPhone Safari: `PUBLIC_URL/m/test-cafe` | Join page, Arabic and English, no broken layout |
| 2 | Join with a name and a birthday | Card page with **Add to Apple Wallet** |
| 3 | Tap **Add to Apple Wallet** | Wallet's add sheet shows the card in the merchant colours; **Add** works |
| 4 | Look at the card front and back | Name, `0 / 3`, next reward line, back fields in the phone's language |
| 5 | PC browser: `PUBLIC_URL/staff`, paste the staff key, type the card number | The card is found |
| 6 | **Add a stamp** | Within about 10 seconds the iPhone shows a lock-screen message "Your card: 1 / 3" and the card reads `1 / 3` |
| 7 | Add stamps up to 3 | Message says the reward is ready |
| 8 | **Redeem reward** | Card back to `0 / 3` |
| 9 | Dashboard (`PUBLIC_URL/admin`) → Messages → Promotions → send now (the test card must have ticked offers) | Lock-screen message with the promotion text, between 10:00 and 21:00 Amman time |
| 10 | Switch the iPhone to Arabic, remove and re-add the card | Card reads in Arabic |
| 11 | Android (when 5 and 6 are done): same flow with **Add to Google Wallet** | Card in Google Wallet titled `[TEST ONLY]`, balance updates on step 6 |
| 12 | Dashboard → Members → the test member → **Delete this member** (tap twice) | The card in Wallet turns void within seconds; scanning it at `/staff` says it is not one of our cards |

**If the card refuses to install:** the reason only shows in the iPhone's system log. On a Mac:
Console.app → the iPhone → filter `passd`. Without a Mac, note the exact Safari message and check
`openssl x509 -in certs/pass.pem -noout -subject` names the same `UID=` as `PASS_TYPE_ID` in `.env`;
that mismatch is the usual cause.

**If updates never arrive:** `PUBLIC_URL` must be the HTTPS address the phone used; the server log
shows `POST /wallet/v1/devices/...` when the card registered. No such line means Wallet never
registered: check HTTPS and that the card was added after the server had the right `PUBLIC_URL`.

**Record the result** in the handbook (tasks §9) with the date and which rows failed.

---

## 9. Product name, domain and `PUBLIC_URL`

**Decision, partners:** the product's name and its domain (study §8, smaller decision 4). Until
there is one, a subdomain of the company domain works, e.g. `cards.theoffice.it.com`.

**Why it has to be settled before the first real merchant:** `PUBLIC_URL` is written into every
card when it is issued (Apple's update address, Google's allowed origin) and into every counter QR
that gets printed. Moving it later means every existing card stops updating until its owner
re-adds it, and every printed QR is wrong. Same for `APP_SECRET`: changing it invalidates every
card's QR code.

**What to produce:** the domain, and a DNS record pointing it at the host (step 10). On Cloudflare
DNS (where `theoffice.it.com` lives) that is one `A` or `CNAME` record.

---

## 10. Host the server

**Decision, partners. What the host must offer (non-negotiable):**

- **Node 22.13 or newer**, running all the time (the scheduler sends messages every 5 minutes).
- **Exactly one instance.** The database is one SQLite file and the scheduler must not run twice.
  No autoscaling, no "scale to zero".
- **A persistent disk** for `DB_PATH` (default `data/loyalty.db`), and **backups** of it (nightly,
  encrypted, restore-tested, like the UniDash backups).
- **HTTPS with a real certificate** on the domain from step 9.
- **Outbound HTTP/2 to `api.push.apple.com:443`** using the pass certificate as a client
  certificate. This is why **Cloudflare Workers and Pages cannot host it**.
- A way to keep `certs/` and `.env` on the server, readable only by the app.

**Options:**

| Option | Cost | Notes |
|---|---|---|
| Our own server (Hetzner CX33, chosen 2026-09-25 in the handbook, task 7.42, not ordered) + Caddy for HTTPS | about EUR 7 a month, shared with other systems | Most control; we run updates, backups and monitoring (handbook 7.51) |
| Fly.io with a volume | a few USD a month | One machine + one volume; set `min_machines_running = 1`, never 2 |
| Railway or Render with a disk | a few USD a month | Fine if the disk is persistent; check the plan does not sleep |

**Deploy, whatever the host:** `npm ci --omit=dev`, copy `certs/` and `.env`, `npm start` under a
process manager that restarts it (systemd, Fly, Railway). `GET /health` answers `{"ok":true}`.

**Environment on the host:** everything in `.env.example`, with `PUBLIC_URL` the real HTTPS
domain, a fresh `APP_SECRET` (`openssl rand -base64 32`, never reused from a test), and the Apple
and Google values from steps 2 and 5.

---

## 11. Google publishing access

After step 8 passes on Android. pay.google.com/business/console → **Google Wallet API** →
**Request publishing access**. Google asks for:

- a complete **business profile** (legal name, address, website, contact),
- at least one **class** (made automatically the first time a test account saves a card),
- **screenshots** of the card in Google Wallet, front and details,
- the **business name** shown to customers (step 4).

When granted, `[TEST ONLY]` disappears from existing cards and any Android phone can save one.
[TBD: Google's review time, record it when we apply]

---

## 12. Before the first real merchant

Not code. Each one is a paper, a picture or a decision.

- **Official wallet buttons.** Replace the plain text buttons with Apple's **Add to Apple Wallet**
  badge and Google's **Add to Google Wallet** button, unmodified, in both languages.
  https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/ and
  https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines
- **Privacy notice per merchant** (Jordan PDPL): who holds the data (the merchant), what is
  collected (name, optional phone, optional birthday as day and month, visits), why, how long, and
  how to ask for deletion. Link it from the join page. Deletion itself is in the dashboard
  (Members → the member → Delete this member): it wipes their details, voids the card in their
  wallet and stops every message.
- **Merchant agreement**, from the handbook's contract tool (`tools/render_contract.py`): price
  (study §7), who owns the customer data (recommended: the merchant), what happens to it if they
  leave, message rules they cannot override (1 a day, 4 in 30 days, 10:00 to 21:00).
- **The merchant's artwork:** a square logo at least 660 by 660 (Google), a wide logo up to 480 by
  150 (Apple, shown at 160 by 50), an icon at least 87 by 87, the card colours. The merchant uploads
  them in the dashboard (Card); each upload is checked for shape and size.
- **Counter material:** print the poster (dashboard → Card → Print the poster, or
  `PUBLIC_URL/m/<slug>/poster`): name, reward and join QR in Arabic and English, sized for A5.
- **The merchant's dashboard sign-in:** `npm run merchant -- admin --slug <slug> --email <owner's email>`.
  It prints a one-time password: hand it over in person or by phone, never in the same message as
  the email address. They must choose their own at the first sign-in, and can add colleagues
  themselves (Settings). A forgotten password: `npm run merchant -- admin-reset --email ...`.
- **Staff:** one key per counter device, made in the dashboard (Staff → New key, shown once). Show
  staff the five-second flow: scan, tap what was bought, add.
- **First customer's terms** (study §7): founding price in writing, clearly temporary.

---

## 13. NFC tap (optional, later)

Not needed for version 1: cards are scanned by QR. Needs Apple's NFC pass entitlement (an
application to Apple, weeks, not guaranteed), a P-256 key pair per reader, and a VAS-capable
reader at the counter (Jordanian bank terminals are not known to support it). Full detail in
[`APPLE_SETUP.md`](APPLE_SETUP.md) §6. The code switches it on with one variable once all three
exist.

---

## Secrets: what each one is and where it lives

| Secret | Made by | Lives in | If it leaks |
|---|---|---|---|
| `certs/pass.key` | step 2 | the server only | Revoke the certificate on Apple's portal, new key + CSR + certificate |
| `certs/pass.pem` | Apple | the server | Not secret on its own; useless without the key |
| Google service account JSON | step 5 | the server only | Delete that key in the Cloud console, make a new one |
| `APP_SECRET` | `openssl rand -base64 32` | `.env` on the server | Changing it invalidates every card QR and card link: rotate only if it truly leaked |
| Staff keys (`sk_...`) | dashboard or CLI, shown once | the counter device's browser | Remove it in the dashboard (Staff); make a new one |
| Admin passwords | CLI (first one), then the dashboard; shown once | the merchant's head | `npm run merchant -- admin-reset`; every session of that admin ends |
