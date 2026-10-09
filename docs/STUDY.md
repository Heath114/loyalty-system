# Loyalty + retention product: feasibility and practicality study

**Status:** study, written 2026-10-05. Settles what the product is. Nothing is built. **Going ahead at least as the UniDash integration** (Bader, 2026-10-05); scope and timing are decided by the questions in §8.
**Working name:** `loyalty` (folder name only). [TBD: product name]
**First customer:** a phone store, reached through a friend of a friend. [TBD: confirm business, branches, contact]
**Related:** the UniDash version of the same idea is filed in the UniDash repo as
`docs/LOYALTY_WALLET_ADDON.md` (commit `2dea1f6`). It is a later consumer of this engine, not this product.

---

## 1. What the product is

A branded loyalty card that lives in the customer's **Apple Wallet or Google Wallet**, with no app to
install, plus **automatic retention messages** that land on the customer's lock screen: birthday
gifts, "we miss you", "your reward is ready", and merchant-specific moments such as "your warranty
ends next month". The merchant runs it from a web dashboard in Arabic and English. Staff record
purchases from any phone or tablet browser.

**What it is not:** a payment product, a cashback network like Wafii, an app the customer downloads,
or an SMS marketing tool. It never touches the merchant's money.

**Why it has to be a product, not a one-off:** the first customer is paying little. The work only
pays back if the same system is sold to many merchants, so every phone-store need is built as a
**setting any merchant can switch on**, never as phone-store code.

## 2. How it works, end to end

1. **Join.** The customer scans a QR at the counter (or a link on Instagram/WhatsApp), fills a short
   form (name, phone or email, optional birthday, marketing consent) and taps "Add to Apple Wallet"
   or "Save to Google Wallet". One tap, no account, no app.
2. **Earn.** At checkout the customer shows the card. How the purchase reaches the system is an open
   decision (section 8, decision 2). The study assumes staff scanning the card's QR on a web page as
   the version 1 default, because it works with any till.
3. **See progress.** The card itself updates: points, stamps, tier, next reward. No app needed.
4. **Come back.** Scheduled triggers send a lock-screen message through the card (birthday, win-back
   after N days, reward ready, warranty or anniversary reminders).
5. **Redeem.** Staff scan the card and mark the reward used. The card updates.
6. **Merchant sees results.** Members, visits, repeat rate, rewards issued and redeemed, which
   messages brought people back.

## 3. Who buys it

**Best fit:** businesses where a customer *can* come back often and the merchant wants them to:
cafés, bakeries, juice bars, restaurants, barbers, salons, car washes, gyms, and retail with repeat
purchases (phones and accessories, cosmetics, pet shops). Small chains of 2 to 10 branches are the
sweet spot: they feel the retention problem and can pay. Single shops pay less; big chains build
their own.

**Why the phone store is a good first test:** it is the hard case. Phones are bought every one to
two years, so stamps alone do not work. What brings a phone-store customer back is accessories,
cases, screen protectors, repairs, and the next upgrade. That forces the product to support
**date-based triggers on a purchase** (warranty ending, 12 or 24 months since the device, trade-in
offer), which every other merchant type can also use (a gym's membership renewal, a salon's
"six weeks since your last colour").

⚠️ **Reward design for a phone store:** margins on phones are thin, so points on a full phone price
would give away real money. The sensible shape is points on accessories, repairs and services, and
a fixed thank-you reward per device purchase, not a percentage. This is the merchant's choice, but
the product must let them set different earn rates per category.

## 4. Feasibility, feature by feature

Checked 2026-10-05 against Apple, Google and vendor documentation (sources in section 10).

| Feature | Verdict | Notes |
|---|---|---|
| Card in Apple Wallet | ✅ Standard | Signed `.pkpass`. We already hold an Apple developer account (team `LZ8RFD29KM`). One Pass Type ID can issue passes for many merchants, each with its own name, logo and colours. |
| Card in Google Wallet | ✅ Standard | Google Wallet has been live in Jordan since March 2025 and Jordan is on Google's supported list. Needs a Google Wallet issuer account; new issuers start in demo mode until Google approves publishing. [TBD: apply and confirm approval time] |
| Arabic and English on the card | ✅ | Both wallets support localised pass text. |
| Card updates (points, stamps) | ✅ Free | Apple pushes updates through APNs; Google through its API. No per-message cost. |
| Lock-screen messages (birthday, win-back) | ✅ with limits | Apple: a pass update can carry a notification message; the customer can turn notifications off per card. Google: at most **3 notifying messages per card per 24 hours**. Both are fine for retention, and both punish spam, so the product must cap messages per customer. |
| "You're near the shop" | ⚠️ Weak | Wallet can surface the card on the lock screen near a saved location, but neither platform promises a banner. Sell it as a bonus, never as a feature. |
| Customer-side app | ❌ Not needed | Deliberately. Removing the install step is the whole point. |
| Same tap as Apple Pay (in-store NFC) | 🔴 Not now | Needs Apple's NFC pass certificate (approval, not guaranteed) and VAS-capable terminals, which Jordanian bank terminals are not known to offer. Revisit only for a merchant whose terminal supports it. |
| SMS / WhatsApp | ➕ Optional add-on | Not needed for the core. Useful to send the join link and to reach customers who removed the card. Jordan SMS runs about $0.025 to $0.07 per message and needs a TRC-approved sender name, so it is a paid extra the merchant funds. |

**Overall verdict: feasible with what we already have.** Every core piece uses free platform
channels, and the hard parts (NFC, location) are optional extras, not the product.

## 5. What we would build (version 1)

Kept to what the product needs to sell, no more:

- **Merchant dashboard** (web, Arabic/English): card design (logo, colours), program rules (stamps or
  points, earn rate per category, rewards), triggers on/off with their message text, branches,
  staff logins, results.
- **Staff page** (web, any phone or tablet): scan a card, enter the purchase and category, redeem a
  reward. No install.
- **Join page** per merchant: the form and the two wallet buttons. The QR for the counter is printed
  from the dashboard.
- **Pass service:** issues and signs Apple passes, creates Google cards, implements Apple's pass
  web service (device registration and updates).
- **Scheduler:** runs the triggers daily, respects the per-customer message cap and quiet hours.
- **Multi-tenant from day one:** every record belongs to a merchant; one merchant can never read
  another's customers. This is the single most important property for selling to many clients.

**Hosting:** Cloudflare (Workers, D1, cron triggers), the same stack as the Printopack admin, on the
heathens1143 account. [TBD: confirm account before creating anything]

**Rough effort, an estimate not a commitment:** about 3 to 5 weeks of focused work for version 1,
plus waiting time for Google's publishing approval, which runs in parallel.

## 6. Costs

**Fixed, ours:**
- Apple developer account: already paid for UniDash.
- Google Wallet issuer account: no fee. [TBD: confirm]
- Hosting: Cloudflare's free allowances cover the first merchants; a paid Workers plan (about $5 a
  month) once traffic grows.
- Domain for the join pages: [TBD: name and domain]

**Per merchant:** close to zero. Card updates and lock-screen messages cost nothing. The only
per-message cost is SMS, and only if the merchant buys that add-on.

**Our real cost is time:** setup, card design and staff training for each merchant, and support.
Price the setup fee to cover it.

## 7. Pricing

**What the market charges** (section 10): Loopy Loyalty about $25 to $49 a month (stamps only, basic
messages), LoyaltyPass $99 (Arabic, Saudi-focused), Boomerangme $199 to $299 (the full set:
birthday automation, location messages, SMS, white-label). Nobody local sells branded wallet cards
with retention messages in Jordan; Wafii is a shared cashback app, not a branded card.

**Proposed, for decision** (section 8, decision 3):

| Plan | Monthly, per branch | What's included |
|---|---|---|
| Basic | JOD 15 | Wallet card, stamps or points, reward redemption, staff page, basic results |
| Pro | JOD 30 | Everything in Basic, plus all retention triggers (birthday, win-back, date-based reminders), categories, full results |
| Chain | JOD 25 per branch from 3 branches | Pro, with one dashboard across branches |
| Setup | JOD 100 to 150 once | Card design, program setup, counter QR, staff training |
| SMS add-on | at cost plus margin | Optional, prepaid message bundles |

**Our edge at these prices:** Boomerangme's retention automations cost about $199 a month; ours are
in a JOD 30 plan, in Arabic, invoiced in JOD, with someone in Amman who sets it up in person.

**The first customer:** offer a founding price in exchange for being our reference and case study,
for example the setup fee waived and Pro at the Basic price for the first year. [TBD: what the
friend's contact has actually offered, and the terms Bader wants]

## 8. The go question: what is decided, and what decides the rest

✅ **Decided by Bader, 2026-10-05: we build it, at least as the UniDash integration.** The loyalty
card is an optional, per-venue UniDash feature (UniDash repo, `docs/LOYALTY_WALLET_ADDON.md`), and
that part is going ahead in the future whatever this study concludes. So "do we go for it" is no
longer yes or no. It is **how far beyond UniDash we go, and when**.

### The three possible scopes

| Scope | What we build | When it fits |
|---|---|---|
| **A. UniDash only** | The engine inside UniDash, for UniDash venues. The phone store is told no, or later. | Little demand outside UniDash, or no time before UniDash is stable. |
| **B. Shared engine + pilot** | The engine built once, multi-tenant and independent of UniDash. UniDash plugs into it, and the phone store runs on it as a paid pilot. | Some outside demand, staff-scan acceptable, capacity for a few extra weeks. |
| **C. Full product** | Scope B plus a sales push: pricing page, onboarding, support routine, more merchants. | Proven demand from several merchants at our price, and the pilot shows staff actually use it. |

⚠️ Whatever the scope, the engine is built **multi-tenant and independent of UniDash from the
start**. That costs little extra and keeps B and C open. Building it inside UniDash's tables and then
extracting it later is the expensive path.

### The questions that decide the scope and the timing

Each one says what its answer changes. Together they complete the "do we go for it" question.

**Demand: is there a market beyond one customer?**
1. **Will the phone store pay, how much, and will its staff use it?** A real commitment in writing, not
   interest. A no or a token amount means it does not justify scope B alone.
2. **Will 3 to 5 more merchants say yes at our price before we build?** Ask cafés, salons, phone and
   accessory shops we can reach. Several yeses move us to B, and on to C after the pilot. None keeps us at A.
3. **Do UniDash venues want it, and will they pay for it?** Ask Drinkat. This decides whether the
   UniDash integration is a paid add-on or a free feature, and how early it is worth building.

**Practicality: can it work in a real shop?**
4. **How does a non-UniDash merchant record a purchase?** If staff scanning on a phone is acceptable,
   scope B is a few weeks. If merchants insist on their till doing it (POS integration), the scope grows
   per till brand and C gets much harder.
5. **Will staff actually scan, every time, at rush hour?** Only a pilot answers this. If they do not, the
   standalone product fails however good it is; UniDash is immune, because earning there is automatic.
6. **Does Google approve us as a Wallet issuer, and how fast?** Without it, Android customers (most of
   Jordan) get no card. Apply early: it is free and takes time.

**Economics: does it pay for the time it takes?**
7. **What price do merchants accept, and how many do we need to break even?** About 4 weeks of build
   plus setup and support per merchant, against JOD 15 to 30 a month each. If break-even needs more
   merchants than question 2 suggests we can sign, stay at A.
8. **At UniDash, who pays for a reward: the venue, us, or split?** This decides whether rewards cost
   us money. It ties to UniDash's open question on fees for voucher orders. Owner decision.
9. **What does each merchant cost us in setup and support?** If every merchant needs an in-person visit
   and hand-holding, the setup fee must cover it, or C does not scale with two partners.

**Timing and capacity: when can we start?**
10. **When is UniDash stable after launch?** Live on both stores, live payments, first weeks of real
    orders without fires. That is the earliest start for anything here.
11. **Where does PulseBoard stand?** Under the priority rule it also comes first.
12. **Who builds it and who supports merchants: Bader, Malek, or both?** This sets how long A, B or C
    take in calendar time.

### How the answers map to a scope

- **Stay at A** if questions 1 and 2 bring no paying commitment, or question 7 does not break even.
- **Go to B** if the phone store commits (1), staff scanning is acceptable (4), Google approves us (6),
  and UniDash is stable (10). The pilot then answers question 5.
- **Go to C** only after B's pilot shows staff scanning works (5) and several merchants signed (2) at
  a price that breaks even (7).

### Smaller decisions, needed only for B or C

1. ~~**Go or no go**~~ replaced by the questions above.
2. **How purchases are recorded in version 1:** staff scan (recommended: any till, hard to cheat),
   customer scan with staff confirmation, or the store's POS. Ask the phone store what till it uses.
3. **Pricing:** the table in section 7, and the first customer's terms.
4. **Name and domain** for the product.
5. **SMS/WhatsApp add-on:** offer it at launch or later.
6. **Who owns the customer data:** the merchant (recommended: it makes the product easy to trust),
   and what happens to it if a merchant leaves.

## 9. Risks

- **Staff forget to scan.** The biggest practical risk for any loyalty system. Mitigation: a staff
  page that takes under five seconds, and per-staff counts in the results so owners can see who scans.
- **Customers remove the card or mute it.** Mitigation: the message cap, useful messages only, and
  the optional SMS fallback.
- **Spam gets us restricted.** Apple and Google can limit an issuer whose passes are abused. One
  merchant spamming could hurt every merchant on our account. Mitigation: hard caps in the product,
  not just guidance.
- **Personal data.** Names, phones, birthdays under Jordan's PDPL: consent recorded at join, a
  privacy page per merchant, deletion on request. Birthday stays optional.
- **Cheap first customer sets the price anchor.** Keep the founding price clearly temporary and in
  writing.
- **Competitors undercut.** Our defence is local setup, Arabic and JOD, not price alone.

## 10. Sources

- Apple, loyalty and membership passes: https://developer.apple.com/wallet/loyalty-passes/
- Google Wallet supported countries: https://support.google.com/wallet/answer/12060037
- Google Wallet live in Jordan (March 2025): https://www.nfcw.com/2025/03/20/390323/google-wallet-goes-live-with-visa-cards-in-jordan
- Google Wallet notification limit (3 per pass per 24 hours): https://help.passkit.com/en/articles/12527916-understanding-google-wallet-pass-notifications and https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications
- Apple Wallet location behaviour: https://neatpass.app/learn/apple-wallet-location-alert-not-triggering
- NFC passes, certificate and VAS terminals: https://help.passkit.com/en/articles/4430727-enabling-and-using-nfc-passes
- Boomerangme pricing: https://boomerangme.com/pricing
- Market pricing comparison (a competitor's blog, read with care): https://www.loyaltypass.co/blog/guide/loyalty-program-pricing-comparison
- Wafii (Amman): https://www.cbinsights.com/company/wafii
- Jordan SMS pricing: https://www.sent.dm/resources/jordan-sms-pricing
