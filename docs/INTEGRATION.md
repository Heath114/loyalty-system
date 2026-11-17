# Connected systems: the API

For a system that records purchases itself, with no staff scan: UniDash first (points on a collected
order), a till later. Everything here is in `src/integration.ts` and `src/routes/integration.ts`, and
tested in `test/integration.test.ts`.

## The idea

- **One key per system per merchant.** A UniDash venue with the loyalty card switched on is a
  merchant here, and UniDash holds that merchant's key. Make it in the dashboard (Staff → Connected
  systems → New key) or from the command line:
  `npm run merchant -- api-key --slug <venue> --label UniDash`. It is shown once. It goes in the
  other system's **server** secrets (a Supabase edge function secret), never in an app.
- **Members by your ID** (`ref`: a UniDash user ID, a UUID is fine). We keep it with the card.
- **Purchases by your order ID.** The same order sent twice earns once, so retry freely.
- **Rewards are yours to give.** We take the points off and say which reward; you hand it over
  (UniDash: issue the item-locked voucher). If you cannot, reverse it and the points go back.
- **The wallet card follows by itself.** Every change reaches the member's Apple and Google card,
  with a lock-screen message, as it does for a staff scan.

## Calls

Base: `PUBLIC_URL/api/v1`. Header: `Authorization: Bearer lk_...`. Bodies are JSON. Amounts are in
**fils** (1 JOD = 1000). IDs (`ref`, `orderId`, `requestId`) are 1 to 100 of `A-Z a-z 0-9 . _ : @ -`.
Errors are `{"error": "..."}` in plain English with 400 (check the input), 401 (key), 404 (not
found), 409 (conflict, below).

| Call | What it does |
|---|---|
| `GET /program` | The merchant's program: stamps or points, reward threshold, categories, reward menu, bonus periods on now, whether Google Wallet is on. |
| `PUT /members/{ref}` | Creates the member (201) or changes what you send (200). Body: `name` (required to create), `email`, `phone`, `birthday` ("MM-DD"), `marketingConsent` (true/false: offers, win-back, reminders), `lang` ("ar"/"en", the card's language). Fields left out stay as they are. |
| `GET /members/{ref}` | The member and their last 10 entries (`?history=` up to 50). |
| `GET /members?after=&limit=` | Every `ref` we hold, sorted, 100 a page; `next` is the `after` for the next page. |
| `DELETE /members/{ref}` | The member asked to be deleted: their details are wiped, their wallet card voids, the `ref` is freed. Their visits stay in the numbers without a name. |
| `POST /members/{ref}/purchases` | A purchase. Body: `orderId` (required), `amountFils` (needed for points programs), `categoryId` (needed once the merchant has categories), `member` (optional: the `PUT` body, to create the member with their first order). 201 when it created the member. |
| `POST /members/{ref}/purchases/{orderId}/reverse` | The order was refunded or cancelled after it earned: its stamps or points come off. Repeat-safe. |
| `POST /members/{ref}/redemptions` | The member takes a reward. Body: `requestId` (required, yours, e.g. the voucher ID you are about to issue), `rewardId` (null or left out: the headline reward; otherwise an `id` from the menu). Answers with `reward` (`id`, `name`, `name_ar`, `cost`). 409 when the balance is short. |
| `POST /members/{ref}/redemptions/{requestId}/reverse` | The reward was not given after all: the points go back. |

Every answer about a member carries `member`:

```json
{
  "ref": "6f1c2a90-...", "serial": "27111YQAXMCE76PR", "name": "Lina", "program": "points",
  "balance": 105, "threshold": 100, "rewardsAvailable": 1, "toNextReward": 95,
  "lifetimeEarned": 105, "rewardsRedeemed": 0, "marketingConsent": true, "lang": "en",
  "menu": [{ "id": null, "name": "Free case", "name_ar": null, "cost": 100, "affordable": true }],
  "inWallet": { "apple": false, "google": false },
  "links": {
    "card": "https://.../c/27111YQAXMCE76PR?t=...",
    "apple": "https://.../c/27111YQAXMCE76PR/card.pkpass?t=...",
    "google": "https://.../c/27111YQAXMCE76PR/google?t=..."
  },
  "createdAt": 1794913651639
}
```

A purchase also answers `units` (what it earned, after any bonus period), `rewardReady` (it just
crossed the threshold: a good moment to tell the member), `enrolled` and `replayed`.

The `links` carry a token: show them to that member only. `apple` downloads the card (open it in
Safari or `SFSafariViewController` on iOS, or hand the file to `PKAddPassesViewController`); `google`
creates the card on Google's side and opens Google's save page; `card` is the member's page with
both buttons, the QR, the reward menu and their history. `google` is null until Google Wallet is set up.

### 409, and what to do

| Answer | Meaning | Do |
|---|---|---|
| `That request key was already used for another card` | The same `orderId` (or `requestId`) was sent for a different member. | A bug on the sending side: order IDs are unique. |
| `Not enough yet: 60 of 100` | Redeeming more than the balance. | Show the member the menu's `affordable`. |
| `The card no longer has those points to take back` | Reversing an order whose points were already spent on a reward. | Ask the merchant to correct it by hand (dashboard → Members → Add or take away). |
| `That entry was already taken back` | Staff undid it at the counter first. | Nothing. |

## UniDash, step by step

What `docs/UNIDASH_ADDON.md` asks for, mapped to these calls. All of it runs in UniDash's
server-side code (edge functions), with the venue's key from the secrets.

| In UniDash | Call |
|---|---|
| The owner console switches the program on for a venue | We create the merchant and its key (`npm run merchant -- create ...`, then `api-key`); UniDash stores the key against the venue. No key: no loyalty for that venue, nothing is called. |
| An order becomes **collected**, paid by card, at a venue with the program on | `POST /members/{user id}/purchases` with `orderId` = the order's ID, `amountFils` = what was paid, and `member` = name, email and `lang` from the profile. Not on `placed`, not on `cancelled` or `not_picked_up`, and **not for a voucher-paid order** (rewards must not earn rewards). |
| A collected order is refunded | `POST .../purchases/{order id}/reverse` |
| The profile shows the loyalty card | `GET /members/{user id}`: balance, progress, menu. 404 means no purchase yet at that venue. |
| "Add your card to Wallet", offered once after the first collected order, then on the profile | `links.apple` on iOS, `links.google` on Android. `inWallet` says whether it is already there. |
| The student takes a reward | `POST .../redemptions` with `requestId` = the voucher ID about to be issued, then issue the item-locked voucher through the existing voucher machinery. If issuing fails: `POST .../redemptions/{requestId}/reverse`. |
| A reward voucher expires unused | The owner decides (UNIDASH_ADDON §5): either nothing, or `POST .../redemptions/{requestId}/reverse` to give the points back. |
| The student changes their name, language or consent | `PUT /members/{user id}` |
| The student deletes their account | `DELETE /members/{user id}` at every venue they joined |

Birthday messages need a birthday, which UniDash does not collect today (UNIDASH_ADDON §5.3): leave
it out until the owner decides.

## Try it

```sh
npm run merchant -- api-key --slug test-cafe --label Test
KEY=lk_...   # what it printed
curl -s -X POST localhost:8787/api/v1/members/u-1/purchases -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d '{"orderId":"o-1","member":{"name":"Lina","lang":"en"}}'
```
