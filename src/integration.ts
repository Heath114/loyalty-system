import type { DB } from './db.ts'
import {
  cleanDetails, crossedReward, earn, enrol, LoyaltyError, merchantCard, redeem, rewardById, reverseEntry, type Card, type Lang,
  type Merchant, type Movement, type Undo,
} from './loyalty.ts'
import { newApiKey, sha256 } from './tokens.ts'

/**
 * Connected systems: another system records purchases and rewards itself, with no staff scan.
 * UniDash is the first (points on a collected order, the reward issued as its own voucher); a till
 * could be the next. Each system has a key per merchant, like a staff key per counter, and talks
 * about members by its own ID for them ("ref") and about purchases by its own order ID. Both are
 * idempotent: the same order sent twice earns once, whatever the network did.
 */

export interface ApiKey {
  id: number
  merchant_id: number
  label: string
  created_at: number
  revoked_at: number | null
  last_used_at: number | null
}

/** A key for one connected system. Shown once: only its hash is kept. */
export function createApiKey(db: DB, m: Merchant, label: unknown): { id: number; key: string } {
  const l = String(label ?? '').trim().slice(0, 60) || 'Connected system'
  const key = newApiKey()
  const { lastInsertRowid } = db
    .prepare('INSERT INTO api_keys (merchant_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(m.id, l, sha256(key), Date.now())
  return { id: Number(lastInsertRowid), key }
}

export function apiKeys(db: DB, merchantId: number): ApiKey[] {
  return db
    .prepare('SELECT id, merchant_id, label, created_at, revoked_at, last_used_at FROM api_keys WHERE merchant_id = ? ORDER BY revoked_at IS NOT NULL, id')
    .all(merchantId) as unknown as ApiKey[]
}

export function revokeApiKey(db: DB, m: Merchant, id: number): void {
  const { changes } = db.prepare('UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND merchant_id = ?').run(Date.now(), id, m.id)
  if (!changes) throw new LoyaltyError('Key not found', 404)
}

/** The live key a bearer token belongs to, or undefined. "Last used" is written at most once a minute. */
export function apiKeyFor(db: DB, key: string | undefined): { id: number; merchant_id: number } | undefined {
  if (!key || !key.startsWith('lk_')) return undefined
  const row = db.prepare('SELECT id, merchant_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(sha256(key)) as
    | { id: number; merchant_id: number }
    | undefined
  if (!row) return undefined
  const now = Date.now()
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(now, row.id, now - 60_000)
  return row
}

/** A member ID or order ID from the other system: a UUID, a number, anything up to 100 plain characters. */
const ID = /^[A-Za-z0-9._:@-]{1,100}$/

export function checkId(v: unknown, what: string): string {
  const s = String(v ?? '').trim()
  if (!ID.test(s)) throw new LoyaltyError(`The ${what} must be 1 to 100 letters, digits or . _ : @ -`)
  return s
}

export function memberByRef(db: DB, merchantId: number, ref: string): Card | undefined {
  return db.prepare('SELECT * FROM cards WHERE merchant_id = ? AND external_id = ? AND deleted_at IS NULL').get(merchantId, ref) as Card | undefined
}

function memberOr404(db: DB, m: Merchant, ref: string): Card {
  const card = memberByRef(db, m.id, checkId(ref, 'member ID'))
  if (!card) throw new LoyaltyError('Member not found', 404)
  return card
}

export interface MemberInput {
  name?: string
  email?: string | null
  phone?: string | null
  /** "MM-DD". */
  birthday?: string | null
  /** Agreed to offers (promotions, win-back, reminders). Birthday messages go to every member with a birthday. */
  marketingConsent?: boolean
  /** The language the wallet card and its messages use. */
  lang?: Lang
}

function checkLang(lang: unknown): Lang | undefined {
  if (lang == null || lang === '') return undefined
  if (lang !== 'ar' && lang !== 'en') throw new LoyaltyError('lang is "ar" or "en"')
  return lang
}

/**
 * Creates the member, or changes what was sent for one that exists. Fields left out stay as they are.
 * Returns whether anything printed on the card changed, so the caller refreshes the wallets.
 */
export function upsertMember(db: DB, m: Merchant, refInput: string, input: MemberInput): { card: Card; created: boolean; changed: boolean } {
  const ref = checkId(refInput, 'member ID')
  const lang = checkLang(input.lang)
  if (input.marketingConsent != null && typeof input.marketingConsent !== 'boolean') throw new LoyaltyError('marketingConsent is true or false')
  const found = memberByRef(db, m.id, ref)
  if (!found) {
    try {
      const card = enrol(db, m, {
        name: String(input.name ?? ''), phone: input.phone ?? undefined, email: input.email ?? undefined, birthday: input.birthday ?? undefined,
        marketingConsent: !!input.marketingConsent, lang: lang ?? 'ar', externalId: ref,
      })
      return { card, created: true, changed: false }
    } catch (e) {
      // Two first orders at once: the other request made the member a moment ago.
      const raced = /UNIQUE constraint failed: cards\.merchant_id, cards\.external_id/.test(String((e as Error).message)) && memberByRef(db, m.id, ref)
      if (!raced) throw e
      return upsertMember(db, m, ref, input)
    }
  }
  const d = cleanDetails({
    name: input.name === undefined ? found.member_name : input.name,
    phone: input.phone === undefined ? found.member_phone : input.phone,
    email: input.email === undefined ? found.member_email : input.email,
    birthday: input.birthday === undefined ? found.birthday : input.birthday,
  })
  const consent = input.marketingConsent === undefined ? found.marketing_consent : input.marketingConsent ? 1 : 0
  const next = { name: d.name, phone: d.phone, email: d.email, birthday: d.birthday, consent, lang: lang ?? found.lang }
  // The name and the language are on the card itself; the rest is only ours.
  const changed = next.name !== found.member_name || next.lang !== found.lang
  const same = !changed && next.phone === found.member_phone && next.email === found.member_email && next.birthday === found.birthday &&
    next.consent === found.marketing_consent
  if (same) return { card: found, created: false, changed: false }
  const now = Math.max(Date.now(), found.updated_at + 1)
  db.prepare(
    `UPDATE cards SET member_name = ?, member_phone = ?, member_email = ?, birthday = ?, marketing_consent = ?, lang = ?,
       updated_at = CASE WHEN ? THEN ? ELSE updated_at END WHERE id = ?`,
  ).run(next.name, next.phone, next.email, next.birthday, next.consent, next.lang, changed ? 1 : 0, now, found.id)
  return { card: merchantCard(db, m.id, found.serial), created: false, changed }
}

export interface Purchase {
  orderId: string
  amountFils?: number | null
  categoryId?: number | null
  /** Sent with a member's first order: they are made a member on the spot. */
  member?: MemberInput
}

export interface Recorded extends Movement {
  /** The member was created by this purchase. */
  enrolled: boolean
  rewardReady: boolean
}

const orderKey = (orderId: string) => `order:${orderId}`
const redeemKey = (requestId: string) => `redeem:${requestId}`
const reverseKey = (key: string) => `reverse:${key}`

/**
 * A purchase the other system recorded (UniDash: an order that was collected). The order ID makes it
 * idempotent: sending it again returns the first result and earns nothing more.
 */
export function recordPurchase(db: DB, m: Merchant, refInput: string, p: Purchase, apiKeyId: number): Recorded {
  const ref = checkId(refInput, 'member ID')
  const orderId = checkId(p.orderId, 'order ID')
  let enrolled = false
  let card = memberByRef(db, m.id, ref)
  if (!card) {
    if (!p.member) throw new LoyaltyError('Member not found: send "member" with their first purchase, or create them first', 404)
    const r = upsertMember(db, m, ref, p.member)
    card = r.card
    enrolled = r.created
  }
  const amount = p.amountFils == null ? null : Number(p.amountFils)
  const r = earn(db, m, card.serial, { amountFils: amount, categoryId: p.categoryId ?? null, apiKeyId, idempotencyKey: orderKey(orderId) })
  return { ...r, enrolled, rewardReady: !r.replayed && crossedReward(m, r.card.balance, r.units) }
}

/** An order that earned was refunded or cancelled after all: its points come off the card. */
export function reversePurchase(db: DB, m: Merchant, refInput: string, orderIdInput: string, apiKeyId: number): Undo {
  const card = memberOr404(db, m, refInput)
  const key = orderKey(checkId(orderIdInput, 'order ID'))
  return reverseEntry(db, m, card.serial, { key, reverseKey: reverseKey(key), apiKeyId })
}

export interface Redemption extends Movement {
  reward: { id: number | null; name: string; name_ar: string | null; cost: number }
}

/**
 * The member takes a reward: the headline one (rewardId null) or one from the menu. The other system
 * then gives it (UniDash: issues the voucher). requestId makes a retry harmless.
 */
export function redeemReward(db: DB, m: Merchant, refInput: string, r: { rewardId?: number | null; requestId: string }, apiKeyId: number): Redemption {
  const card = memberOr404(db, m, refInput)
  const key = redeemKey(checkId(r.requestId, 'request ID'))
  const rewardId = r.rewardId == null || (r.rewardId as unknown) === '' ? null : Number(r.rewardId)
  const out = redeem(db, m, card.serial, { rewardId, apiKeyId, idempotencyKey: key })
  // On a replay, the reward is the one first redeemed with this key, whatever this request asked for.
  const row = db.prepare('SELECT reward_id FROM ledger WHERE merchant_id = ? AND idempotency_key = ?').get(m.id, key) as { reward_id: number | null }
  const reward = row.reward_id == null
    ? { id: null, name: m.reward_text, name_ar: m.reward_text_ar, cost: m.reward_threshold }
    : (({ id, name, name_ar, cost }) => ({ id, name, name_ar, cost }))(rewardById(db, m.id, row.reward_id))
  return { ...out, reward }
}

/** The reward was never given after all (the voucher could not be issued, or it expired unused): the points go back. */
export function reverseRedemption(db: DB, m: Merchant, refInput: string, requestIdInput: string, apiKeyId: number): Undo {
  const card = memberOr404(db, m, refInput)
  const key = redeemKey(checkId(requestIdInput, 'request ID'))
  return reverseEntry(db, m, card.serial, { key, reverseKey: reverseKey(key), apiKeyId })
}

/** The member is still known by this ID, or is found by it; for routes that only read. */
export function member(db: DB, m: Merchant, ref: string): Card {
  return memberOr404(db, m, ref)
}

/** Whether a member's card is in a wallet: Apple when a device registered for updates, Google once saved there. */
export function inWallet(db: DB, card: Card): { apple: boolean; google: boolean } {
  const apple = !!db.prepare('SELECT 1 FROM pass_registrations WHERE serial = ? LIMIT 1').get(card.serial)
  return { apple, google: card.google_object_at != null }
}

/** Every member ID this merchant's connected systems know, for a system that wants to check it is in step. */
export function memberRefs(db: DB, merchantId: number, opts: { after?: string; limit?: number } = {}): string[] {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 1000)
  return (db
    .prepare('SELECT external_id FROM cards WHERE merchant_id = ? AND external_id IS NOT NULL AND deleted_at IS NULL AND external_id > ? ORDER BY external_id LIMIT ?')
    .all(merchantId, opts.after ?? '', limit) as { external_id: string }[]).map((r) => r.external_id)
}
