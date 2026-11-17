# Going live from Bader's Mac

The code is done. What is left needs a person: an Apple certificate, a Google key, and a real phone
in a hand. This page does all of it from a Mac, in order, one Terminal command per step. Each
command can be run again safely, and says what to do next.

**Time:** about an hour for Apple and the iPhone test. Google adds half an hour and needs an
Android phone.

**You need:**

- The Mac, connected to the internet.
- A sign-in to developer.apple.com with the **Account Holder** or **Admin** role on team
  `LZ8RFD29KM` (the one UniDash ships under). A Developer role cannot make certificates.
- An iPhone with Wallet, for the test.
- For Google (later is fine): the Google account that owns our Wallet issuer (`3388000000023224499`),
  and an Android phone.

Every command below goes in **Terminal** (Spotlight: ⌘ Space, type Terminal, Enter). Paste a
command, press Enter, wait for it to finish before the next one.

---

## 1. Get the code

```sh
cd ~
git clone https://github.com/Heath114/loyalty-system
cd loyalty-system
git checkout claude/rewards-system-ipdw5f
```

If the Mac asks to install the "command line developer tools", click **Install**, wait for it to
finish, then paste the commands again. Once this branch is merged into `main`, skip the
`git checkout` line.

**Every later command runs from this folder.** In a new Terminal window, first: `cd ~/loyalty-system`

## 2. Set up the Mac

```sh
./scripts/mac.sh setup
```

It installs Node 22 if the Mac does not have it (through Homebrew; if Homebrew is missing it tells
you the one line to paste first, and asks for the Mac's password), then the packages, a settings
file (`.env`) with a fresh secret, Apple's WWDR certificate, and **our private key** with the
request Apple asks for. It ends by opening Apple's site, and Finder at `loyalty-pass.csr` on the
Desktop.

**Check:** every line starts with ✓, and the Desktop has `loyalty-pass.csr`.

The private key is `~/loyalty-system/certs/pass.key`. It never leaves this Mac (step 10 says the one
exception). Never email it, put it in chat, or commit it. The CSR on the Desktop is not secret.

## 3. Apple: the Pass Type ID and its certificate

On developer.apple.com, signed in, with team `LZ8RFD29KM` selected (top right):

1. **Certificates, IDs & Profiles** → **Identifiers** → filter (top right) **Pass Type IDs**.
2. If `pass.com.theoffice.loyalty` is **not** in the list: **+** → **Pass Type IDs** → Continue →
   Description `Loyalty cards`, Identifier `pass.com.theoffice.loyalty` → Continue → **Register**.
   Type the identifier exactly: it can never be renamed, and every card ever issued is tied to it.
3. Click `pass.com.theoffice.loyalty` → under **Production Certificates**, **Create Certificate**.
4. **Choose File** → Desktop → `loyalty-pass.csr` → **Continue** → **Download**. You get `pass.cer`
   in Downloads. Do not double-click it.

If a certificate already exists there (Malek made a request from his PC on 2026-11-04), it belongs
to his PC's key, not this Mac's: make a new one from this Mac's CSR anyway. If Apple says the limit
of certificates is reached, revoke the one nobody is using, then try again.

## 4. Give the certificate to the server

```sh
./scripts/mac.sh cert
```

It checks that `pass.cer` belongs to the key from step 2 and names our identifier and team, saves it
as `certs/pass.pem`, then checks the whole setup.

**Check:** `✓ It belongs to certs/pass.key`, then `✓ A test card builds and signs`. The only `!`
lines left should be about HTTPS, Google and email.

Put the renewal date it prints in the calendar. An expired certificate stops new cards installing
and stops updates to cards already in wallets.

## 5. Google (needed for Android, can wait)

In a browser, as the Google account that owns the issuer:

1. console.cloud.google.com → project picker (top bar) → **New project**, name `loyalty-cards`.
2. **APIs & Services → Library** → search **Google Wallet API** → **Enable**.
3. **IAM & Admin → Service accounts → Create service account**, name `loyalty-cards`. Skip the
   optional role and user steps.
4. Open it → **Keys → Add key → Create new key → JSON → Create**. A `.json` file downloads, once.
5. Copy the service account's email (`loyalty-cards@...iam.gserviceaccount.com`).
6. pay.google.com/business/console → our issuer → **Users** → **Invite a user** → that email →
   access **Developer** → Invite.
7. Same console → **Google Wallet API** → test accounts → add the Gmail address signed in on the
   Android test phone.

Then, with the file name Google gave it:

```sh
./scripts/mac.sh google ~/Downloads/loyalty-cards-xxxxxxxx.json
```

Then **delete that file from Downloads and empty the Bin**: whoever has it can make cards in our name.

## 6. A test shop

```sh
./scripts/mac.sh test-cafe you@example.com
```

Use your own email. It prints a **staff key** (`sk_...`) and a **dashboard password**, each shown
once. Keep this Terminal window open, or copy both into Notes for the test.

## 7. The phone test

```sh
./scripts/mac.sh tunnel
```

It installs Cloudflare's tunnel tool the first time, gives this Mac a temporary public HTTPS address
(`https://<random>.trycloudflare.com`), and starts the server. **Leave the window open** for the whole
test. While it runs, anyone with that random address can reach this test server: it holds only test
data, but stop it (Ctrl+C) when you are done.

The window prints three addresses. With them:

| # | Do | Expect |
|---|---|---|
| 1 | iPhone, Safari: the `/m/test-cafe` address | Join page, Arabic and English, nothing broken |
| 2 | Join with a name and a birthday; tick offers | Your card page, with **Add to Apple Wallet** |
| 3 | Tap **Add to Apple Wallet** → **Add** | The card in Wallet. The Mac's window prints `Wallet: card ... registered for updates` |
| 4 | Look at the card, front and back (⋯ → Pass Details) | Your name, `0 / 3`, the next reward; back in the phone's language |
| 5 | On the Mac, in Safari: the `/staff` address. Paste the staff key. Type the card number (under the QR on your card page) → **Find card** | Your card |
| 6 | **Add a stamp** | Within about 10 seconds: a lock-screen message "Your card: 1 / 3", and the card reads `1 / 3` |
| 7 | Add stamps up to 3 | The message says the reward is ready |
| 8 | Under **Give a reward**, tap the reward | The card goes back to `0 / 3` |
| 9 | Add a stamp, then **Undo my last entry** | The card goes back within seconds |
| 10 | The `/admin` address: sign in with your email and the password from step 6, choose your own | The dashboard, with your visit in Overview |
| 11 | Dashboard → Messages → Promotions → write one → send now (between 10:00 and 21:00 Amman time) | A lock-screen message with your text |
| 12 | Switch the iPhone to Arabic (Settings → General → Language), remove the card and add it again | The card in Arabic |
| 13 | Your card page → **Delete my card** | The card in Wallet turns void within seconds |
| 14 | Android, if step 5 is done: the same from row 1 with **Add to Google Wallet** | The card in Google Wallet, titled `[TEST ONLY]`; the balance follows row 6 |

Write down the date and any row that failed, and what it showed.

**Optional, the UniDash connection:** in a second Terminal window (`cd ~/loyalty-system`):

```sh
npm run merchant -- api-key --slug test-cafe --label Test
```

then, with the key it printed and the tunnel address:

```sh
curl -s -X POST https://<random>.trycloudflare.com/api/v1/members/u-1/purchases \
  -H "Authorization: Bearer lk_..." -H 'Content-Type: application/json' \
  -d '{"orderId":"o-1","member":{"name":"API test","lang":"en"}}'
```

It answers with a new member with 1 stamp; the dashboard's Overview lists "Test (system)".

## 8. If something goes wrong

**The card will not add to Wallet.** The reason is only in the iPhone's own log:

1. Connect the iPhone to the Mac with a cable; on the iPhone, tap **Trust**.
2. Open **Console** on the Mac (Spotlight: Console). Pick the iPhone in the left column, click
   **Start streaming**, and type `passd` in the search box.
3. Tap **Add to Apple Wallet** again. Red or yellow lines appear: the first one names the problem.

Most common: the certificate does not match the identifier. `./scripts/mac.sh check` says so.

**Updates and messages never arrive.** The card must be added *while the tunnel runs*: a card added
over another address keeps that address. Remove the card and add it again. The window must have
printed `Wallet: card ... registered for updates`; if it did not, Wallet never reached the server.
Lines starting `[wallet]` are Wallet's own complaints, word for word.

**Anything else:** `./scripts/mac.sh check --online` while the tunnel runs checks everything,
including that the address answers from the internet and that Google accepts our key.

## 9. After the test

1. Ctrl+C in the tunnel window: the server and the tunnel stop.
2. On the iPhone: Wallet → the test card → ⋯ → **Remove Pass**. They point at an address that no
   longer exists and will never update again.
3. `./scripts/mac.sh clean-test` deletes the test shop and its cards from this Mac (it asks first).

Then record the result in the handbook (tasks §9).

## 10. When there is a real server

The keys made here move to the server once, then stay there: `deploy/README.md` (our own server)
says exactly how. Copy them with `scp`, never by email or chat:

```sh
scp certs/pass.key certs/pass.pem certs/wwdr-g4.pem certs/google-service-account.json root@<server>:/opt/loyalty-system/certs/
```

After that, delete them from this Mac (or keep the Mac as the only backup, with FileVault on).

## 11. One more thing on GitHub

The repo is public, and it holds our pricing study. Signed in as `Heath114`:
github.com/Heath114/loyalty-system → **Settings** → **General** → bottom, **Danger Zone** →
**Change repository visibility** → **Make private**. Do it after step 1 (the clone keeps working; a
later `git pull` asks you to sign in).

---

**The commands at a glance**

| Command | When |
|---|---|
| `./scripts/mac.sh setup` | once, first |
| `./scripts/mac.sh cert` | after downloading `pass.cer` |
| `./scripts/mac.sh google <file>` | after downloading Google's key |
| `./scripts/mac.sh test-cafe <email>` | before the phone test |
| `./scripts/mac.sh tunnel` | during the phone test |
| `./scripts/mac.sh check` | any time: what is missing? |
| `./scripts/mac.sh clean-test` | after the test |
