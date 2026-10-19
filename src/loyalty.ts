import { tx, type DB } from './db.ts'
import { newAuthToken, newSerial } from './tokens.ts'

export interface Merchant {
  id: number
  slug: string
  name: string
  name_ar: string | null
  program: 'stamps' | 'points'
  reward_threshold: number
  points_per_jod: number
  reward_text: string
  reward_text_ar: string | null
  bg_color: string
  fg_color: string
  label_color: string
  timezone: string
  changed_at: number
  synced_at: number
  google_synced_at: number
}

export type Lang = 'ar' | 'en'

export interface Card {
  id: number
  merchant_id: number
  serial: string
  auth_token: string
  member_name: string
  member_phone: string | null
  member_email: string | null
  marketing_consent: number
  balance: number
  lifetime_earned: number
  rewards_redeemed: number
  created_at: number
  updated_at: number
  lang: Lang
  birthday: string | null
  last_message_id: number | null
  google_object_at: number | null
}

export class LoyaltyError extends Error {
  readonly status: 400 | 404 | 409
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message)
    this.status = status
  }
}

export type NewMerchant = Omit<
  Merchant,
  'id' | 'name_ar' | 'reward_text_ar' | 'bg_color' | 'fg_color' | 'label_color' | 'points_per_jod' | 'timezone' | 'changed_at' | 'synced_at' | 'google_synced_at'
> &
  Partial<Pick<Merchant, 'name_ar' | 'reward_text_ar' | 'bg_color' | 'fg_color' | 'label_color' | 'points_per_jod'>>

export function createMerchant(db: DB, m: NewMerchant): Merchant {
  if (!/^[a-z0-9-]{2,40}$/.test(m.slug)) throw new LoyaltyError('Slug must be 2 to 40 lowercase letters, digits or hyphens')
  db.prepare(
    `INSERT INTO merchants (slug, name, name_ar, program, reward_threshold, points_per_jod, reward_text, reward_text_ar,
       bg_color, fg_color, label_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.slug, m.name, m.name_ar ?? null, m.program, m.reward_threshold, m.points_per_jod ?? 1, m.reward_text,
    m.reward_text_ar ?? null, m.bg_color ?? 'rgb(17,17,17)', m.fg_color ?? 'rgb(255,255,255)',
    m.label_color ?? 'rgb(180,180,180)', Date.now(),
  )
  return merchantBySlug(db, m.slug)!
}

export function merchantBySlug(db: DB, slug: string): Merchant | undefined {
  return db.prepare('SELECT * FROM merchants WHERE slug = ?').get(slug) as Merchant | undefined
}

export function merchantById(db: DB, id: number): Merchant {
  return db.prepare('SELECT * FROM merchants WHERE id = ?').get(id) as unknown as Merchant
}

/** Marks something printed on every one of the merchant's cards as changed; the scheduler then refreshes them. */
export function touchMerchant(db: DB, merchantId: number): void {
  db.prepare('UPDATE merchants SET changed_at = ? WHERE id = ?').run(Date.now(), merchantId)
}

export function cardBySerial(db: DB, serial: string): Card | undefined {
  return db.prepare('SELECT * FROM cards WHERE serial = ?').get(serial) as Card | undefined
}

/** A card scoped to the merchant asking: another merchant's card reads as not found. */
export function merchantCard(db: DB, merchantId: number, serial: string): Card {
  const card = db.prepare('SELECT * FROM cards WHERE serial = ? AND merchant_id = ?').get(serial, merchantId) as Card | undefined
  if (!card) throw new LoyaltyError('Card not found', 404)
  return card
}

export interface Enrolment {
  name: string
  phone?: string
  email?: string
  /** "MM-DD". */
  birthday?: string
  marketingConsent: boolean
  lang?: Lang
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Day and month from the join form as "MM-DD", or null when both are left empty. */
export function parseBirthday(day: string, month: string): string | null {
  if (!day && !month) return null
  const d = Number(day)
  const m = Number(month)
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) {
    throw new LoyaltyError('Please check the birthday')
  }
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The phone's language from its Accept-Language header: Arabic if that comes first, otherwise English. */
export function langFrom(acceptLanguage: string | undefined): Lang {
  return /^\s*ar\b/i.test(acceptLanguage ?? '') ? 'ar' : 'en'
}

export function enrol(db: DB, merchant: Merchant, e: Enrolment): Card {
  const name = e.name.trim()
  if (!name || name.length > 80) throw new LoyaltyError('Please enter your name')
  const phone = e.phone?.trim() || null
  if (phone && !/^\+?[0-9 ]{7,20}$/.test(phone)) throw new LoyaltyError('Please check the phone number')
  const email = e.email?.trim() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LoyaltyError('Please check the email address')
  if (e.birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(e.birthday)) throw new LoyaltyError('Please check the birthday')
  const now = Date.now()
  const serial = newSerial()
  db.prepare(
    `INSERT INTO cards (merchant_id, serial, auth_token, member_name, member_phone, member_email, birthday, marketing_consent, lang,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(merchant.id, serial, newAuthToken(), name, phone, email, e.birthday || null, e.marketingConsent ? 1 : 0, e.lang ?? 'ar', now, now)
  return cardBySerial(db, serial)!
}

/** Units a purchase earns: one stamp per visit, or floor(JOD x points_per_jod) points. */
export function unitsFor(merchant: Merchant, amountFils: number | null): number {
  if (merchant.program === 'stamps') return 1
  if (amountFils == null || !Number.isInteger(amountFils) || amountFils <= 0) {
    throw new LoyaltyError('Enter the purchase amount')
  }
  return Math.floor((amountFils / 1000) * merchant.points_per_jod)
}

export interface Movement {
  card: Card
  units: number
  /** True when this request repeated an earlier one with the same idempotency key. */
  replayed: boolean
}

function existing(db: DB, merchantId: number, key: string | undefined): { card_id: number; units: number } | undefined {
  if (!key) return undefined
  return db.prepare('SELECT card_id, units FROM ledger WHERE merchant_id = ? AND idempotency_key = ?').get(merchantId, key) as
    | { card_id: number; units: number }
    | undefined
}

function replay(db: DB, prior: { card_id: number; units: number }, serial: string): Movement {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(prior.card_id) as unknown as Card
  if (card.serial !== serial) throw new LoyaltyError('That request key was already used for another card', 409)
  return { card, units: prior.units, replayed: true }
}

/**
 * Records a purchase. The idempotency key makes a double tap at the counter safe: the second
 * request returns the first result instead of earning twice.
 */
export function earn(
  db: DB, merchant: Merchant, serial: string,
  opts: { amountFils?: number | null; staffId?: number | null; idempotencyKey?: string },
): Movement {
  return tx(db, () => {
    const prior = existing(db, merchant.id, opts.idempotencyKey)
    if (prior) return replay(db, prior, serial)
    const card = merchantCard(db, merchant.id, serial)
    const units = unitsFor(merchant, opts.amountFils ?? null)
    const now = Math.max(Date.now(), card.updated_at + 1)
    db.prepare(
      `INSERT INTO ledger (merchant_id, card_id, kind, units, amount_fils, staff_id, idempotency_key, created_at)
       VALUES (?, ?, 'earn', ?, ?, ?, ?, ?)`,
    ).run(merchant.id, card.id, units, opts.amountFils ?? null, opts.staffId ?? null, opts.idempotencyKey ?? null, now)
    db.prepare('UPDATE cards SET balance = balance + ?, lifetime_earned = lifetime_earned + ?, updated_at = ? WHERE id = ?').run(
      units, units, now, card.id,
    )
    return { card: merchantCard(db, merchant.id, serial), units, replayed: false }
  })
}

/** Redeems one reward, spending reward_threshold units. */
export function redeem(
  db: DB, merchant: Merchant, serial: string,
  opts: { staffId?: number | null; idempotencyKey?: string },
): Movement {
  return tx(db, () => {
    const prior = existing(db, merchant.id, opts.idempotencyKey)
    if (prior) return replay(db, prior, serial)
    const card = merchantCard(db, merchant.id, serial)
    if (card.balance < merchant.reward_threshold) {
      throw new LoyaltyError(`Not enough yet: ${card.balance} of ${merchant.reward_threshold}`, 409)
    }
    const units = -merchant.reward_threshold
    const now = Math.max(Date.now(), card.updated_at + 1)
    db.prepare(
      `INSERT INTO ledger (merchant_id, card_id, kind, units, staff_id, idempotency_key, created_at)
       VALUES (?, ?, 'redeem', ?, ?, ?, ?)`,
    ).run(merchant.id, card.id, units, opts.staffId ?? null, opts.idempotencyKey ?? null, now)
    db.prepare('UPDATE cards SET balance = balance + ?, rewards_redeemed = rewards_redeemed + 1, updated_at = ? WHERE id = ?').run(
      units, now, card.id,
    )
    return { card: merchantCard(db, merchant.id, serial), units, replayed: false }
  })
}

export function rewardsAvailable(merchant: Merchant, card: Card): number {
  return Math.floor(card.balance / merchant.reward_threshold)
}

export function history(db: DB, card: Card, limit = 20) {
  return db
    .prepare('SELECT kind, units, amount_fils, created_at FROM ledger WHERE card_id = ? ORDER BY id DESC LIMIT ?')
    .all(card.id, limit) as { kind: string; units: number; amount_fils: number | null; created_at: number }[]
}

export interface Location {
  id: number
  merchant_id: number
  label: string
  latitude: number
  longitude: number
  /** What the lock screen says near this branch. Empty: a default naming the merchant. */
  text: string | null
  text_ar: string | null
}

/** Apple and Google both take at most 10 locations per card. */
export const MAX_LOCATIONS = 10

export function locations(db: DB, merchantId: number): Location[] {
  return db.prepare('SELECT * FROM locations WHERE merchant_id = ? ORDER BY id').all(merchantId) as unknown as Location[]
}

export function addLocation(db: DB, merchant: Merchant, l: Omit<Location, 'id' | 'merchant_id' | 'text' | 'text_ar'> & Partial<Pick<Location, 'text' | 'text_ar'>>): Location {
  if (!l.label.trim()) throw new LoyaltyError('Give the branch a name')
  if (!(Math.abs(l.latitude) <= 90) || !(Math.abs(l.longitude) <= 180)) throw new LoyaltyError('Latitude or longitude out of range')
  return tx(db, () => {
    if (locations(db, merchant.id).length >= MAX_LOCATIONS) throw new LoyaltyError(`At most ${MAX_LOCATIONS} branches`, 409)
    const { lastInsertRowid } = db
      .prepare('INSERT INTO locations (merchant_id, label, latitude, longitude, text, text_ar) VALUES (?, ?, ?, ?, ?, ?)')
      .run(merchant.id, l.label.trim(), l.latitude, l.longitude, l.text?.trim() || null, l.text_ar?.trim() || null)
    touchMerchant(db, merchant.id)
    return db.prepare('SELECT * FROM locations WHERE id = ?').get(lastInsertRowid) as unknown as Location
  })
}

export function removeLocation(db: DB, merchant: Merchant, id: number): void {
  const { changes } = db.prepare('DELETE FROM locations WHERE id = ? AND merchant_id = ?').run(id, merchant.id)
  if (!changes) throw new LoyaltyError('Branch not found', 404)
  touchMerchant(db, merchant.id)
}
