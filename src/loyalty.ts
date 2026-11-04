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
  deleted_at: number | null
}

export class LoyaltyError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429
  constructor(message: string, status: 400 | 401 | 403 | 404 | 409 | 429 = 400) {
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

/** A live card. A deleted member's card reads as not found, unless asked for (Apple's web service, to void it). */
export function cardBySerial(db: DB, serial: string, opts: { deleted?: boolean } = {}): Card | undefined {
  return db.prepare(`SELECT * FROM cards WHERE serial = ? ${opts.deleted ? '' : 'AND deleted_at IS NULL'}`).get(serial) as Card | undefined
}

/** A card scoped to the merchant asking: another merchant's card, or a deleted one, reads as not found. */
export function merchantCard(db: DB, merchantId: number, serial: string): Card {
  const card = db.prepare('SELECT * FROM cards WHERE serial = ? AND merchant_id = ? AND deleted_at IS NULL').get(serial, merchantId) as Card | undefined
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

export interface Category {
  id: number
  merchant_id: number
  name: string
  name_ar: string | null
  /** 'rate': points per JOD spent (points programs). 'fixed': a set number of stamps or points per purchase. */
  earn: 'rate' | 'fixed'
  points_per_jod: number | null
  fixed_units: number | null
  sort: number
  archived_at: number | null
  created_at: number
}

export interface CategoryInput {
  name: string
  name_ar?: string | null
  earn: 'rate' | 'fixed'
  points_per_jod?: number | null
  fixed_units?: number | null
  sort?: number
}

export const MAX_CATEGORIES = 30

/** The merchant's categories in the order staff see them. Archived ones only when asked for. */
export function categories(db: DB, merchantId: number, opts: { archived?: boolean } = {}): Category[] {
  return db
    .prepare(`SELECT * FROM categories WHERE merchant_id = ? ${opts.archived ? '' : 'AND archived_at IS NULL'} ORDER BY sort, id`)
    .all(merchantId) as unknown as Category[]
}

/** One of the merchant's categories; another merchant's reads as not found. */
export function categoryById(db: DB, merchantId: number, id: number): Category {
  const c = db.prepare('SELECT * FROM categories WHERE id = ? AND merchant_id = ?').get(id, merchantId) as Category | undefined
  if (!c) throw new LoyaltyError('Category not found', 404)
  return c
}

function checkCategory(m: Merchant, c: CategoryInput) {
  const name = String(c.name ?? '').trim()
  if (!name || name.length > 40) throw new LoyaltyError('Give the category a name of up to 40 characters')
  const nameAr = String(c.name_ar ?? '').trim() || null
  if (nameAr && nameAr.length > 40) throw new LoyaltyError('Keep the Arabic name under 40 characters')
  if (c.earn === 'rate') {
    if (m.program !== 'points') throw new LoyaltyError('A stamp card earns a set number of stamps per purchase, not a rate')
    const rate = Number(c.points_per_jod)
    if (!(Number.isFinite(rate) && rate >= 0 && rate <= 1000)) throw new LoyaltyError('Points per JOD must be between 0 and 1000')
    return { name, nameAr, earn: 'rate' as const, rate, fixed: null }
  }
  if (c.earn === 'fixed') {
    const fixed = Number(c.fixed_units)
    const most = m.program === 'stamps' ? m.reward_threshold : 1_000_000
    if (!(Number.isInteger(fixed) && fixed >= 0 && fixed <= most)) {
      throw new LoyaltyError(m.program === 'stamps' ? `Stamps per purchase must be between 0 and ${most}` : 'Points per purchase must be a whole number, 0 or more')
    }
    return { name, nameAr, earn: 'fixed' as const, rate: null, fixed }
  }
  throw new LoyaltyError('Choose how the category earns: rate or fixed')
}

/**
 * Categories change what the card's "how it works" text says, so every card is refreshed after a
 * change. Rates apply to purchases from then on; past ones keep what they earned.
 */
export function createCategory(db: DB, m: Merchant, c: CategoryInput): Category {
  const v = checkCategory(m, c)
  return tx(db, () => {
    if (categories(db, m.id).length >= MAX_CATEGORIES) throw new LoyaltyError(`At most ${MAX_CATEGORIES} categories`, 409)
    const { lastInsertRowid } = db
      .prepare('INSERT INTO categories (merchant_id, name, name_ar, earn, points_per_jod, fixed_units, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, v.name, v.nameAr, v.earn, v.rate, v.fixed, Number(c.sort) || 0, Date.now())
    touchMerchant(db, m.id)
    return categoryById(db, m.id, Number(lastInsertRowid))
  })
}

export function updateCategory(db: DB, m: Merchant, id: number, c: CategoryInput): Category {
  const v = checkCategory(m, c)
  const existing = categoryById(db, m.id, id)
  db.prepare('UPDATE categories SET name = ?, name_ar = ?, earn = ?, points_per_jod = ?, fixed_units = ?, sort = ? WHERE id = ? AND merchant_id = ?').run(
    v.name, v.nameAr, v.earn, v.rate, v.fixed, c.sort == null ? existing.sort : Number(c.sort) || 0, id, m.id,
  )
  touchMerchant(db, m.id)
  return categoryById(db, m.id, id)
}

/** Takes a category off the staff page. Purchases already recorded in it keep it. */
export function archiveCategory(db: DB, m: Merchant, id: number): void {
  categoryById(db, m.id, id)
  db.prepare('UPDATE categories SET archived_at = COALESCE(archived_at, ?) WHERE id = ? AND merchant_id = ?').run(Date.now(), id, m.id)
  touchMerchant(db, m.id)
}

/**
 * Units a purchase earns. Without a category: one stamp per visit, or floor(JOD x points_per_jod)
 * points. With one: its fixed units, or floor(JOD x its rate).
 */
export function unitsFor(merchant: Merchant, amountFils: number | null, category: Category | null = null): number {
  const hasAmount = amountFils != null
  if (hasAmount && !(Number.isInteger(amountFils) && amountFils > 0)) throw new LoyaltyError('Check the purchase amount')
  if (category?.earn === 'fixed') return category.fixed_units ?? 0
  if (!category && merchant.program === 'stamps') return 1
  if (!hasAmount) throw new LoyaltyError('Enter the purchase amount')
  const rate = category ? (category.points_per_jod ?? 0) : merchant.points_per_jod
  // Rounded to whole fils first, so 12.345 JOD x 10 is 123 points, never 123.44999 floored to 123 by luck.
  return Math.floor(Math.round(amountFils * rate) / 1000)
}

/** The category a purchase goes in. Once a merchant has categories, every purchase needs one. */
function purchaseCategory(db: DB, merchant: Merchant, categoryId: number | null | undefined): Category | null {
  if (categoryId == null || (categoryId as unknown) === '') {
    if (categories(db, merchant.id).length > 0) throw new LoyaltyError('Pick what was bought')
    return null
  }
  const c = categoryById(db, merchant.id, Number(categoryId))
  if (c.archived_at != null) throw new LoyaltyError('That category is no longer used', 409)
  return c
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
  opts: { amountFils?: number | null; categoryId?: number | null; staffId?: number | null; idempotencyKey?: string },
): Movement {
  return tx(db, () => {
    const prior = existing(db, merchant.id, opts.idempotencyKey)
    if (prior) return replay(db, prior, serial)
    const card = merchantCard(db, merchant.id, serial)
    const category = purchaseCategory(db, merchant, opts.categoryId)
    const units = unitsFor(merchant, opts.amountFils ?? null, category)
    const now = Math.max(Date.now(), card.updated_at + 1)
    db.prepare(
      `INSERT INTO ledger (merchant_id, card_id, kind, units, amount_fils, category_id, staff_id, idempotency_key, created_at)
       VALUES (?, ?, 'earn', ?, ?, ?, ?, ?, ?)`,
    ).run(merchant.id, card.id, units, opts.amountFils ?? null, category?.id ?? null, opts.staffId ?? null, opts.idempotencyKey ?? null, now)
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

/** How long staff have to take back a stamp, points or a reward they recorded by mistake. */
export const UNDO_WINDOW_MS = 10 * 60_000

export interface Undo extends Movement {
  /** What was taken back. */
  undone: { kind: 'earn' | 'redeem'; units: number }
}

/**
 * Takes back the card's latest stamp, points or reward, if that staff key recorded it in the last
 * 10 minutes: the "I tapped the wrong customer" button. The row is marked and a 'void' row reverses
 * it; nothing is deleted. Anything older, or recorded by someone else, is the merchant's to adjust.
 */
export function undoLast(
  db: DB, merchant: Merchant, serial: string,
  opts: { staffId: number | null; idempotencyKey?: string; now?: number },
): Undo {
  return tx(db, () => {
    const prior = existing(db, merchant.id, opts.idempotencyKey)
    if (prior) {
      const r = replay(db, prior, serial)
      return { ...r, undone: { kind: -prior.units > 0 ? 'earn' : 'redeem', units: -prior.units } as Undo['undone'] }
    }
    const card = merchantCard(db, merchant.id, serial)
    const last = db
      .prepare("SELECT * FROM ledger WHERE card_id = ? AND kind IN ('earn', 'redeem') AND voided_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(card.id) as { id: number; kind: 'earn' | 'redeem'; units: number; staff_id: number | null; created_at: number } | undefined
    const clock = opts.now ?? Date.now()
    if (!last || last.staff_id !== opts.staffId || last.created_at < clock - UNDO_WINDOW_MS) {
      throw new LoyaltyError('Nothing to undo: only your own last entry on this card, within 10 minutes', 409)
    }
    const units = -last.units
    if (card.balance + units < 0) throw new LoyaltyError('The card no longer has those points to take back', 409)
    const now = Math.max(clock, card.updated_at + 1)
    db.prepare('UPDATE ledger SET voided_at = ? WHERE id = ?').run(now, last.id)
    db.prepare(
      `INSERT INTO ledger (merchant_id, card_id, kind, units, staff_id, idempotency_key, ref_id, created_at)
       VALUES (?, ?, 'void', ?, ?, ?, ?, ?)`,
    ).run(merchant.id, card.id, units, opts.staffId, opts.idempotencyKey ?? null, last.id, now)
    db.prepare(
      `UPDATE cards SET balance = balance + ?, lifetime_earned = lifetime_earned - ?, rewards_redeemed = rewards_redeemed - ?,
         updated_at = ? WHERE id = ?`,
    ).run(units, last.kind === 'earn' ? last.units : 0, last.kind === 'redeem' ? 1 : 0, now, card.id)
    return { card: merchantCard(db, merchant.id, serial), units, replayed: false, undone: { kind: last.kind, units: last.units } }
  })
}

/**
 * The merchant adds or takes away stamps or points by hand, with a reason: a purchase staff forgot to
 * record, a goodwill gesture, a correction. Not a visit, so it moves no report and no win-back clock.
 */
export function adjust(db: DB, merchant: Merchant, serial: string, opts: { units: number; note: string; adminId?: number | null }): Movement {
  const units = Number(opts.units)
  if (!Number.isInteger(units) || units === 0 || Math.abs(units) > 1_000_000) throw new LoyaltyError('Enter a whole number to add, or a negative one to take away')
  const note = String(opts.note ?? '').trim()
  if (!note || note.length > 120) throw new LoyaltyError('Write the reason, up to 120 characters')
  return tx(db, () => {
    const card = merchantCard(db, merchant.id, serial)
    if (card.balance + units < 0) throw new LoyaltyError(`The card has only ${card.balance}`, 409)
    const now = Math.max(Date.now(), card.updated_at + 1)
    db.prepare(
      "INSERT INTO ledger (merchant_id, card_id, kind, units, admin_id, note, created_at) VALUES (?, ?, 'adjust', ?, ?, ?, ?)",
    ).run(merchant.id, card.id, units, opts.adminId ?? null, note, now)
    db.prepare('UPDATE cards SET balance = balance + ?, updated_at = ? WHERE id = ?').run(units, now, card.id)
    return { card: merchantCard(db, merchant.id, serial), units, replayed: false }
  })
}

/** A reward became ready with this change: the balance crossed a multiple of the threshold upwards. */
export function crossedReward(merchant: Merchant, balanceAfter: number, units: number): boolean {
  const t = merchant.reward_threshold
  return units > 0 && Math.floor(balanceAfter / t) > Math.floor((balanceAfter - units) / t)
}

export const DELETED_NAME = 'Deleted member'

/**
 * A member asked to be deleted (Jordan PDPL). Their name, phone, email and birthday are wiped and
 * every message stops; the card can no longer be scanned or opened. The visits stay, without a name,
 * so the merchant's numbers stay true. Returns the serial, for voiding the card in their wallet.
 */
export function deleteMember(db: DB, merchant: Merchant, serial: string): Card {
  return tx(db, () => {
    const card = merchantCard(db, merchant.id, serial)
    const now = Math.max(Date.now(), card.updated_at + 1)
    db.prepare(
      `UPDATE cards SET member_name = ?, member_phone = NULL, member_email = NULL, birthday = NULL, marketing_consent = 0,
         deleted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(DELETED_NAME, now, now, card.id)
    // The text of messages sent to them was personalised with their name.
    db.prepare("UPDATE messages SET text = '' WHERE card_id = ?").run(card.id)
    return db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id) as unknown as Card
  })
}

export function rewardsAvailable(merchant: Merchant, card: Card): number {
  return Math.floor(card.balance / merchant.reward_threshold)
}

export interface HistoryRow {
  kind: 'earn' | 'redeem' | 'adjust' | 'bonus' | 'void'
  units: number
  amount_fils: number | null
  created_at: number
  category: string | null
  category_ar: string | null
  /** Set on an earn or redeem that was undone. */
  voided_at: number | null
  /** adjust: the reason; bonus: 'welcome' or 'referral'. */
  note: string | null
}

export function history(db: DB, card: Card, limit = 20): HistoryRow[] {
  return db
    .prepare(
      `SELECT l.kind, l.units, l.amount_fils, l.created_at, c.name AS category, c.name_ar AS category_ar, l.voided_at, l.note
       FROM ledger l LEFT JOIN categories c ON c.id = l.category_id WHERE l.card_id = ? ORDER BY l.id DESC LIMIT ?`,
    )
    .all(card.id, limit) as unknown as HistoryRow[]
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
