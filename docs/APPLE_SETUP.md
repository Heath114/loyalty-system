# Apple Wallet setup

What has to happen on Apple's side before a card installs on a real iPhone, and before it can be
tapped like Apple Pay. Steps 1 to 5 make the QR card work end to end. Step 6 is the NFC upgrade.

Team: `LZ8RFD29KM` (the Apple developer account already paid for UniDash, per `docs/STUDY.md` §4).

## 1. Register a Pass Type ID

developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → **+** → **Pass Type IDs**.
Identifier, reverse-DNS: e.g. `pass.<domain>.loyalty`. [TBD: product name and domain, study §8
smaller decision 4]. One Pass Type ID serves every merchant: each card carries its own merchant name,
colours and logo.

## 2. Create its certificate

On the Pass Type ID → **Create Certificate**. Apple asks for a CSR:

```sh
openssl req -new -newkey rsa:2048 -nodes -keyout certs/pass.key -out certs/pass.csr -subj "/CN=loyalty pass"
```

Upload `pass.csr`, download `pass.cer`, convert it:

```sh
openssl x509 -inform DER -in pass.cer -out certs/pass.pem
```

If the certificate was made through Keychain instead, export it as `.p12` and split it:

```sh
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out certs/pass.pem -legacy
openssl pkcs12 -in pass.p12 -nocerts -nodes -out certs/pass.key -legacy
```

The certificate expires after a year. Renew it before then: an expired certificate stops new cards
installing and stops updates reaching existing ones.

## 3. Download Apple's WWDR intermediate (G4)

From https://www.apple.com/certificateauthority/ → "Worldwide Developer Relations - G4":

```sh
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out certs/wwdr-g4.pem
```

## 4. Host it on HTTPS

Wallet only registers for updates, and only shows the lock-screen messages, when `PUBLIC_URL` is
HTTPS with a valid certificate. Over plain HTTP the card still installs and scans, but never updates.

Hosting: this runs on **Node 22**, not Cloudflare Workers as the study first assumed (§5). Wallet update
pushes go to APNs over HTTP/2 using the Pass Type ID certificate as a TLS client certificate, and
Workers can do neither. Any small Node host works (a VPS, Fly.io, Render, or our own server behind
Caddy). The database is a single SQLite file, `DB_PATH`, which must sit on a persistent disk and be
backed up. [TBD: pick the host]

## 5. Try it on a phone

1. Fill in `.env` (see `.env.example`), then `npm start`.
2. `npm run merchant -- create ...` and `npm run merchant -- staff-key ...` (examples at the top of
   `scripts/merchant.ts`). Upload the merchant's icon and logo with `npm run merchant -- image ...`:
   `icon.png` 29×29 (plus `@2x` 58, `@3x` 87) shows in notifications; `logo.png` up to 160×50
   (plus `@2x`) shows on the card.
3. On an iPhone, open `PUBLIC_URL/m/<slug>`, join, tap **Add to Apple Wallet**.
4. On a second phone, open `PUBLIC_URL/staff`, paste the staff key, scan the card in Wallet. The
   balance on the first phone updates within seconds and shows a lock-screen message.

If the card refuses to install, open Console.app on a Mac with the iPhone connected and filter for
`passd`: it names the exact problem.

Before going live, replace the plain **Add to Apple Wallet** button with Apple's official badge
artwork and follow its usage guidelines: https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/

## 6. NFC: tap the card like Apple Pay

Today the card is scanned by its QR. A tap at an NFC reader (the same gesture as Apple Pay, with the
card popping up automatically) needs three things, none of which code can supply:

1. **Apple's NFC pass entitlement.** Apply at https://developer.apple.com/contact/passkit/ describing
   the loyalty use. Apple reviews it; approval takes weeks and is not guaranteed. Once granted, the
   Pass Type ID certificate is reissued with NFC enabled.
2. **A key pair for the merchant reader.** An ECC P-256 key pair. The private key goes into the
   reader; the public key goes into `NFC_ENCRYPTION_PUBLIC_KEY` as base64 of the compressed point (in
   the format Apple's NFC pass documentation specifies).
3. **A VAS-capable reader at the counter.** Apple VAS readers (e.g. from certified terminal vendors)
   that read the pass and hand our message to the staff page or till. Jordanian bank terminals are
   not known to support this (study §4), so it is a separate reader. [TBD: reader model and cost]

The code is ready for it: when `NFC_ENCRYPTION_PUBLIC_KEY` is set, every pass carries an `nfc` block
whose message is exactly what the QR carries, so the staff API accepts a tap and a scan the same way.
The key stays unset until the entitlement exists, because a pass with an `nfc` block signed by a
certificate without the entitlement will not install.
