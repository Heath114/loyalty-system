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
}

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
}

export class LoyaltyError extends Error {
  readonly status: 400 | 404 | 409
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message)
    this.status = status
  }
}

export type NewMerchant = Omit<Merchant, 'id' | 'name_ar' | 'reward_text_ar' | 'bg_color' | 'fg_color' | 'label_color' | 'points_per_jod'> &
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
  marketingConsent: boolean
}

export function enrol(db: DB, merchant: Merchant, e: Enrolment): Card {
  const name = e.name.trim()
  if (!name || name.length > 80) throw new LoyaltyError('Please enter your name')
  const phone = e.phone?.trim() || null
  if (phone && !/^\+?[0-9 ]{7,20}$/.test(phone)) throw new LoyaltyError('Please check the phone number')
  const email = e.email?.trim() || null
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LoyaltyError('Please check the email address')
  const now = Date.now()
  const serial = newSerial()
  db.prepare(
    `INSERT INTO cards (merchant_id, serial, auth_token, member_name, member_phone, member_email, marketing_consent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(merchant.id, serial, newAuthToken(), name, phone, email, e.marketingConsent ? 1 : 0, now, now)
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
