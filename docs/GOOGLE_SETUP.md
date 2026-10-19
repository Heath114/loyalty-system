# Google Wallet setup

What has to happen on Google's side before the **Add to Google Wallet** button appears and works.
Until then `GOOGLE_ISSUER_ID` stays empty and the card is Apple only; nothing else changes.

Most of Jordan carries Android, so this is the step that decides whether most customers get a card
at all (`docs/STUDY.md` §8, question 6). It costs nothing; the wait is Google's review, so start it
early.

## 1. Get an issuer account

https://pay.google.com/business/console → **Google Wallet API** → sign up. Use the company's Google
account, not a personal one. [TBD: which account, and the business name Google should show]

The console gives an **Issuer ID** (a long number). That is `GOOGLE_ISSUER_ID`.

## 2. Make a service account for the server

1. https://console.cloud.google.com → create a project (or reuse one) → **APIs & Services** →
   enable **Google Wallet API**.
2. **IAM & Admin → Service accounts** → create one, e.g. `loyalty-cards`. No roles are needed in Cloud.
3. On the service account → **Keys → Add key → JSON**. Google downloads the key file once. Keep it
   with the Apple certificates (`certs/`, never committed) and point `GOOGLE_SERVICE_ACCOUNT_PATH` at
   it, or paste its contents into `GOOGLE_SERVICE_ACCOUNT_JSON` on hosts that only take variables.
4. Back in the Pay & Wallet Console → **Users** → invite the service account's email
   (`...@...iam.gserviceaccount.com`) with **Developer** access. Without this every API call is refused.

The same key signs the "Save to Google Wallet" links, so nothing else is needed for the button.

## 3. Test, then ask Google to publish

A new issuer starts in **demo mode**: only Google accounts with a role on the issuer account, or
added as **test accounts** in the console, can save a card, and every card's title starts with
"[TEST ONLY]". To reach real customers, request publishing access in the console (**Request
publishing access**). Google wants a completed business profile, at least one class (the first
customer to tap the button creates one; a test account's tap is enough) and screenshots of the card.
Once granted, the "[TEST ONLY]" label goes from existing cards too. [TBD: how long Google's review
takes, once we have applied]

While waiting:

1. Fill in `.env` and start the server on its HTTPS host. Google fetches the card's logo from
   `PUBLIC_URL/m/<slug>/logo.png`, so it must be reachable from the internet.
2. Upload a square logo per merchant, at least 660×660, which Google shows in a circle:
   `npm run merchant -- image --slug <slug> --name square.png --file ./logo-square.png`.
   Without it Google gets the Apple icon (small) or a plain square in the card colour.
3. On an Android phone, open `PUBLIC_URL/m/<slug>`, join, tap **Add to Google Wallet**.
4. Scan it from `/staff` on another phone: the balance updates within seconds.

## How it behaves

- **The card:** one Google "class" per merchant (name, logo, colour, reward text, branches) and one
  "object" per card (member, balance, QR). The server creates both the first time a customer taps the
  button, then keeps them current. Changes to a merchant reach Google within a few minutes.
- **Notifications:** Google allows **3 per card per 24 hours**, counting both messages and balance
  alerts. So balance changes are silent on Google except when a reward becomes ready, and our own cap
  (1 message a day) keeps the rest well inside it. If Google still says the card is out of
  notifications, the message goes on the card without the alert.
- **Near the shop:** each branch is a `merchantLocations` point on the class. Google decides the
  radius and timing and writes the notification text itself; it only reaches customers who allow
  Google Wallet location access and notifications.
- **Removed cards:** when Google says a card no longer exists, the server stops sending it updates.

Before going live, replace the plain **Add to Google Wallet** button with Google's official button
artwork and follow its brand guidelines: https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines
