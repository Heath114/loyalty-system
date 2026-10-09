# Loyalty + Wallet card add-on: product brief

**Status:** future addition. Post-launch, NOT for the launch build. Written 2026-10-05. ✅ **Will be built** (owner, 2026-10-05); timing and how far the shared engine goes beyond UniDash are decided by the questions in the handbook study, `products/loyalty/STUDY.md` §8.
**Tracked in:** `TASKS.md` → "🔭 Future ambitions".
**Sibling project:** a standalone version for a client (merchants without an app) is being scoped
separately. It shares the engine described here but has its own repo and decisions.

---

## 1. The idea in one paragraph

✅ **Decided by the owner, 2026-10-05: it is an OPTIONAL feature, switched on per venue.** A
merchant or restaurant chooses to run a loyalty program; once it does, that venue's customers are
enrolled automatically. A venue that has not opted in shows no card, no points and no offer. So
every program is the venue's own (its rules, its rewards, its card branding), never one
UniDash-wide scheme.

At a venue with the program on, every customer is enrolled automatically from their first paid order.
Points live on their **account**, not on a card. The **Apple Wallet / Google Wallet card** is an
optional window onto that account, offered once with a single tap after the first successful
payment. The card then becomes a free retention channel: birthday gifts, "we miss you", "one more
order to your reward", all as lock-screen notifications with no app open.

The pitch to a venue: *"Pay through us and your customers are in your loyalty program
automatically."* Stamp-card tools (Loopy, Boomerangme, LoyaltyPass) cannot say that, because they
are not in the payment flow.

## 2. What Apple and Google actually allow (checked 2026-10-05)

| Want | Reality |
|---|---|
| Card appears in Wallet automatically after Apple Pay | ❌ Never silent. Adding a pass always needs the user's tap on the system sheet (`PKAddPassesViewController`). We can make it one tap, right after payment. |
| Order appears in Wallet automatically after Apple Pay | ✅ Apple Pay **Order Tracking** (iOS 16+) attaches an order to Wallet with no extra tap. It is a receipt/status, not a loyalty card. ⚠️ Our `pay` plugin (`pay_ios` 1.2.0 in the pub cache) does **not** expose `orderDetails`, so this needs a native Swift bridge. |
| Lock-screen messages (birthday, win-back) | ✅ A pass update with a `changeMessage` shows a notification. Sent via APNs, costs nothing. The user can switch it off per pass. |
| "You're near the cafeteria" | ⚠️ `relevantLocations` only *surfaces* the pass on the lock screen; Apple promises no banner. Low value on a campus where students are always nearby anyway. |
| Earn points on the same tap as an in-store Apple Pay payment | 🔴 Out of scope. Needs Apple's NFC pass certificate (approval, 4+ weeks, not guaranteed) **and** VAS-certified terminals. Irrelevant to UniDash anyway: payment happens in the app, not at a terminal. |
| Android | ✅ Google Wallet launched in Jordan in March 2025, and Jordan is on Google's supported-countries list. "Save to Google Wallet" is the equivalent one-tap flow. |

## 3. How it must fit UniDash's existing rules

These come from `CLAUDE.md`, and each one constrains the design:

1. **Rewards are item-locked vouchers, never balance.** Balance is un-loadable operator credit, and
   `credit_balance` was revoked (migration 055) because *"an unlimited free-food lever is too
   powerful to leave in a UI"* (§12). A points-to-balance conversion would rebuild that lever.
   Rewards therefore issue through the existing voucher machinery (041/042, `issue_reorder_voucher`).
   ⚠️ Those migrations are Frankfurt-only; verify live before building on them.
2. **Points are earned only on `collected` orders.** Not on `placed` (could still cancel), not on
   `cancelled` or `not_picked_up` (§6 status flow). A voucher-paid order earns nothing, so rewards
   cannot compound into more rewards.
3. **Card stays the default payment method** (§12). A reward voucher is redeemed the way vouchers
   are today; nothing in this feature may nudge balance as a way to pay.
4. **Who pays for a reward is an owner decision, not ours to derive.** A redeemed reward is food the
   venue serves without a card payment. Who funds it (venue, us, split) and whether we earn a fee on
   it ties directly to the open §12a question: *"are we owed a fee on a cancelled or
   voucher-compensated order?"* Settle both together.
5. **Student-facing copy rules still apply** (§0 copy rule, §12b) to every pass message.
6. **No SMS** (§15, owner 2026-09-05). Every retention message goes through the Wallet pass or the
   existing FCM push, both free. Nothing in this feature may need a phone number.

## 4. The pieces to build

**Data (new tables, RLS + grants per §6a):**
- `loyalty_accounts`: one per user, auto-created on first `collected` order. Points, tier, reward progress.
- `loyalty_ledger`: append-only earn/redeem rows keyed to `orders.id`. Never edited, like the order lock in 061.
- `wallet_pass_registrations`: device library ID, push token, pass serial (Apple PassKit web service).
- Birthday: **the source has no birthday field today** (checked 2026-10-05). Collecting it is
  opt-in, needs a privacy-policy update and a store data-safety update (Jordan PDPL).

**Server (edge functions):**
- Pass issuance: signed `.pkpass` (needs a Pass Type ID certificate on the existing Apple developer
  account) and a Google Wallet JWT (needs a Google Wallet issuer account).
- Apple's PassKit web service endpoints: register / unregister device, list updated serials, fetch
  latest pass, log.
- A trigger on `collected` that writes the ledger row, updates the pass and pushes the change.
- Scheduled jobs: birthday, win-back after N days without an order, "one away from your reward".

**App:**
- One-time, dismissible "Add your UniDash card to Wallet" after the first successful card order.
  App Store rules forbid forcing or repeatedly nagging, so it is offered once and then lives on the
  profile screen.
- Loyalty card section on the profile: points, progress, rewards.
- Optional: Apple Pay Order Tracking via a native bridge (see §2).

**Per-venue switch:** a `cafeterias` column (or a `loyalty_programs` row per venue) that turns the
program on. Everything above checks it: no ledger row, no pass, no Wallet offer and no message for
a venue that is off. Turning it off stops earning and messaging; already-issued reward vouchers
stay valid until they expire.

**Owner console:** program settings per venue (points per JOD, reward item, birthday gift), reward
cost reporting for the collection statement.

## 5. Open questions (owner)

1. Who funds a reward, and do we take a fee on a reward order? (See §3.4.)
2. Points per JOD spent, or stamps per order? Stamps are simpler to explain; points survive price changes.
3. Is the birthday gift worth collecting a date of birth? It is the one feature that needs new personal data.
4. ~~Per-venue programs, or one UniDash-wide program?~~ ✅ **Decided 2026-10-05: optional, per venue** (§1).
5. Do points expire? If yes, the expiry must be stated on the card and in the terms.
6. **Who may switch a venue's program on, and who edits its rules?** Recommended, the stricter
   option: switching on is an owner-console act (it is a commercial add-on, like
   `acceptance_window_minutes`, which is owner-console only), and the rules are set by the client's
   `admin`. A `manager` runs the branch and does not change the program.
7. Is it a paid add-on for the venue, and at what price? (Not ours to derive: owner decision.)

## 6. Sources

- Apple, loyalty and membership passes: https://developer.apple.com/wallet/loyalty-passes/
- PassKit, NFC passes (certificate + VAS terminals): https://help.passkit.com/en/articles/4430727-enabling-and-using-nfc-passes
- Google Wallet supported countries: https://support.google.com/wallet/answer/12060037
- Google Wallet live in Jordan (Mar 2025): https://www.nfcw.com/2025/03/20/390323/google-wallet-goes-live-with-visa-cards-in-jordan
- Competitor pricing (Boomerangme $199-299/mo, Loopy ~$25-49, LoyaltyPass $99): https://boomerangme.com/pricing, https://www.loyaltypass.co/blog/guide/loyalty-program-pricing-comparison
