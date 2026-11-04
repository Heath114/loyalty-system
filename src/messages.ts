import { tx, type DB } from './db.ts'
import { categoryById, LoyaltyError, type Card, type Merchant } from './loyalty.ts'
import { personalise } from './pass/copy.ts'

/**
 * Retention messages: the merchant's automatic ones (birthday, win-back, reminders counted from a
 * purchase) and one-off promotions.
 * Each lands on the customer's lock screen through the card itself (see pass/build.ts and google.ts),
 * so it costs nothing to send and needs no app.
 */

export type TriggerKind = 'birthday' | 'winback'
export type MessageKind = TriggerKind | 'promo' | 'reminder'

export interface Trigger {
  merchant_id: number
  kind: TriggerKind
  enabled: number
  /** winback: days without a visit before the message goes. */
  days: number | null
  text: string
  text_ar: string | null
}

export interface Campaign {
  id: number
  merchant_id: number
  text: string
  text_ar: string | null
  send_at: number
  created_at: number
  cancelled_at: number | null
}

/**
 * A message counted from a purchase in a category: "your warranty ends next month" 335 days after a
 * phone, "time for your colour?" 42 days after one. It counts from the member's most recent purchase
 * in that category, so a customer who already came back is not reminded about the older visit.
 */
export interface Reminder {
  id: number
  merchant_id: number
  category_id: number
  days: number
  text: string
  text_ar: string | null
  enabled: number
  created_at: number
  archived_at: number | null
}

export interface Message {
  id: number
  merchant_id: number
  card_id: number
  kind: MessageKind
  campaign_id: number | null
  reminder_id: number | null
  dedupe_key: string
  /** As the card shows it: personalised, in the card's language. */
  text: string
  local_day: string
  created_at: number
}

/** Messages only go out between these hours, merchant's local time: nothing lands on a lock screen at night. */
export const SEND_HOURS = { from: 10, until: 21 }
/**
 * Hard caps per card, whatever a merchant asks for. Apple and Google can restrict an issuer whose
 * passes spam, and one merchant overdoing it would hurt every merchant on our accounts
 * (docs/STUDY.md section 9). Google also refuses a fourth notification to a card within a day.
 */
export const MAX_PER_DAY = 1
export const MAX_PER_30_DAYS = 4
/** A promo still undelivered this long after its send time (that card was capped, the server was down) is dropped for that card rather than arriving stale. */
export const PROMO_WINDOW_MS = 48 * 3600_000
/** Long enough for an offer, short enough to read on a lock screen. */
export const MAX_TEXT = 180
/**
 * A reminder goes out from its day until this many days after, if caps or sending hours held it back.
 * Purchases older than that are not reminded, so a reminder created today does not reach years of
 * past customers at once.
 */
export const REMINDER_WINDOW_DAYS = 7
export const MAX_REMINDERS = 20
const DAY_MS = 86_400_000

function checkText(text: string | null | undefined, required: boolean): string | null {
  const t = text?.trim() ?? ''
  if (!t) {
    if (required) throw new LoyaltyError('Write the message')
    return null
  }
  if (t.length > MAX_TEXT) throw new LoyaltyError(`Keep the message under ${MAX_TEXT} characters`)
  return t
}

export function triggers(db: DB, merchantId: number): Trigger[] {
  return db.prepare('SELECT * FROM triggers WHERE merchant_id = ? ORDER BY kind').all(merchantId) as unknown as Trigger[]
}

/** Creates or replaces one of the merchant's automatic messages. {name} in the text becomes the member's first name. */
export function setTrigger(
  db: DB, merchant: Merchant,
  t: { kind: TriggerKind; text: string; text_ar?: string | null; days?: number | null; enabled?: boolean },
): Trigger {
  if (t.kind !== 'birthday' && t.kind !== 'winback') throw new LoyaltyError('Kind must be birthday or winback')
  const days = t.kind === 'winback' ? Number(t.days) : null
  if (days !== null && !(Number.isInteger(days) && days >= 7 && days <= 365)) {
    throw new LoyaltyError('Win-back needs a number of days between 7 and 365')
  }
  db.prepare(
    `INSERT INTO triggers (merchant_id, kind, enabled, days, text, text_ar) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (merchant_id, kind) DO UPDATE SET enabled = excluded.enabled, days = excluded.days, text = excluded.text,
       text_ar = excluded.text_ar`,
  ).run(merchant.id, t.kind, t.enabled === false ? 0 : 1, days, checkText(t.text, true), checkText(t.text_ar, false))
  return triggers(db, merchant.id).find((x) => x.kind === t.kind)!
}

/** A promotion for every member who agreed to offers, sent at sendAt (default now) within the sending hours. */
export function createCampaign(db: DB, merchant: Merchant, c: { text: string; text_ar?: string | null; sendAt?: number }): Campaign {
  const now = Date.now()
  const sendAt = c.sendAt ?? now
  if (!Number.isFinite(sendAt) || sendAt < now - 60_000) throw new LoyaltyError('The send time is in the past')
  const { lastInsertRowid } = db
    .prepare('INSERT INTO campaigns (merchant_id, text, text_ar, send_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(merchant.id, checkText(c.text, true), checkText(c.text_ar, false), sendAt, now)
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(lastInsertRowid) as unknown as Campaign
}

export function cancelCampaign(db: DB, merchant: Merchant, id: number): void {
  const { changes } = db
    .prepare('UPDATE campaigns SET cancelled_at = ? WHERE id = ? AND merchant_id = ? AND cancelled_at IS NULL')
    .run(Date.now(), id, merchant.id)
  if (!changes) throw new LoyaltyError('Promotion not found', 404)
}

/** The merchant's campaigns, newest first, with how many cards each reached. */
export function campaigns(db: DB, merchantId: number): (Campaign & { sent: number })[] {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id) AS sent
       FROM campaigns c WHERE c.merchant_id = ? ORDER BY c.send_at DESC`,
    )
    .all(merchantId) as unknown as (Campaign & { sent: number })[]
}

export function reminders(db: DB, merchantId: number): (Reminder & { sent: number; category: string; category_ar: string | null })[] {
  return db
    .prepare(
      `SELECT r.*, k.name AS category, k.name_ar AS category_ar, (SELECT COUNT(*) FROM messages m WHERE m.reminder_id = r.id) AS sent
       FROM reminders r JOIN categories k ON k.id = r.category_id
       WHERE r.merchant_id = ? AND r.archived_at IS NULL ORDER BY k.sort, k.id, r.days`,
    )
    .all(merchantId) as unknown as (Reminder & { sent: number; category: string; category_ar: string | null })[]
}

function reminderById(db: DB, merchantId: number, id: number): Reminder {
  const r = db.prepare('SELECT * FROM reminders WHERE id = ? AND merchant_id = ? AND archived_at IS NULL').get(id, merchantId) as Reminder | undefined
  if (!r) throw new LoyaltyError('Reminder not found', 404)
  return r
}

export interface ReminderInput {
  category_id: number
  days: number
  text: string
  text_ar?: string | null
  enabled?: boolean
}

function checkReminder(db: DB, merchant: Merchant, r: ReminderInput) {
  categoryById(db, merchant.id, Number(r.category_id))
  const days = Number(r.days)
  if (!(Number.isInteger(days) && days >= 1 && days <= 1095)) {
    throw new LoyaltyError('A reminder goes between 1 and 1095 days (3 years) after the purchase')
  }
  return {
    category: Number(r.category_id), days, text: checkText(r.text, true), textAr: checkText(r.text_ar, false), enabled: r.enabled === false ? 0 : 1,
  }
}

export function createReminder(db: DB, merchant: Merchant, r: ReminderInput): Reminder {
  const v = checkReminder(db, merchant, r)
  return tx(db, () => {
    if (reminders(db, merchant.id).length >= MAX_REMINDERS) throw new LoyaltyError(`At most ${MAX_REMINDERS} reminders`, 409)
    const { lastInsertRowid } = db
      .prepare('INSERT INTO reminders (merchant_id, category_id, days, text, text_ar, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(merchant.id, v.category, v.days, v.text, v.textAr, v.enabled, Date.now())
    return reminderById(db, merchant.id, Number(lastInsertRowid))
  })
}

export function updateReminder(db: DB, merchant: Merchant, id: number, r: ReminderInput): Reminder {
  reminderById(db, merchant.id, id)
  const v = checkReminder(db, merchant, r)
  db.prepare('UPDATE reminders SET category_id = ?, days = ?, text = ?, text_ar = ?, enabled = ? WHERE id = ? AND merchant_id = ?').run(
    v.category, v.days, v.text, v.textAr, v.enabled, id, merchant.id,
  )
  return reminderById(db, merchant.id, id)
}

/** Stops a reminder for good. Messages it already sent stay in the record. */
export function removeReminder(db: DB, merchant: Merchant, id: number): void {
  reminderById(db, merchant.id, id)
  db.prepare('UPDATE reminders SET archived_at = ? WHERE id = ? AND merchant_id = ?').run(Date.now(), id, merchant.id)
}

/** Wall-clock parts of a moment in a time zone. */
export function zoned(timeZone: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const [year, month, day, hour, minute] = [n('year'), n('month'), n('day'), n('hour'), n('minute')]
  const pad = (v: number) => String(v).padStart(2, '0')
  return { year, month, day, hour, minute, date: `${year}-${pad(month)}-${pad(day)}`, monthDay: `${pad(month)}-${pad(day)}` }
}

/** "2026-10-20 18:00" in the merchant's time zone, as a timestamp. */
export function localToEpoch(timeZone: string, local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim())
  if (!m) throw new LoyaltyError('Write the time as 2026-10-20 18:00')
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // The zone's offset at an instant: its wall clock read as if it were UTC, minus the instant.
  const offset = (at: number) => {
    const z = zoned(timeZone, at)
    return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - at
  }
  // Twice, so a guess on the wrong side of a daylight-saving change corrects itself.
  return wall - offset(wall - offset(wall))
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** A message ready to go: recorded with record(), then delivered (notify.ts). */
export interface Outgoing {
  merchant: Merchant
  card: Card
  kind: MessageKind
  dedupeKey: string
  campaignId: number | null
  reminderId: number | null
  /** As the card shows it: personalised, in the card's language. */
  text: string
  /** Both languages, for Google Wallet, which picks one by the phone's language itself. */
  en: string
  ar: string | null
}

/**
 * Everything due now, already within the caps and the sending hours. Birthdays come first, then
 * reminders about the member's own purchase, then promotions, then win-back, so when the daily cap
 * leaves room for one message it is the most personal one.
 */
export function due(db: DB, now = Date.now()): Outgoing[] {
  const out: Outgoing[] = []
  for (const merchant of db.prepare('SELECT * FROM merchants').all() as unknown as Merchant[]) {
    const local = zoned(merchant.timezone, now)
    if (local.hour < SEND_HOURS.from || local.hour >= SEND_HOURS.until) continue

    const planned = new Map<number, number>()
    const counts = db.prepare(
      'SELECT COALESCE(SUM(local_day = ?), 0) AS today, COUNT(*) AS recent FROM messages WHERE card_id = ? AND created_at > ?',
    )
    const add = (
      card: Card, kind: MessageKind, dedupeKey: string, text: string, textAr: string | null,
      ref: { campaignId?: number; reminderId?: number } = {},
    ) => {
      const extra = planned.get(card.id) ?? 0
      const c = counts.get(local.date, card.id, now - 30 * DAY_MS) as { today: number; recent: number }
      if (c.today + extra >= MAX_PER_DAY || c.recent + extra >= MAX_PER_30_DAYS) return
      planned.set(card.id, extra + 1)
      const en = personalise(text, card)
      const ar = textAr ? personalise(textAr, card) : null
      out.push({
        merchant, card, kind, dedupeKey, campaignId: ref.campaignId ?? null, reminderId: ref.reminderId ?? null,
        text: card.lang === 'ar' ? (ar ?? en) : en, en, ar,
      })
    }
    const notSent = 'NOT EXISTS (SELECT 1 FROM messages m WHERE m.card_id = c.id AND m.dedupe_key = ?)'
    const trigger = new Map(triggers(db, merchant.id).filter((t) => t.enabled).map((t) => [t.kind, t]))

    // Birthday. Giving a birthday on the join form is asking for the birthday message, so it does not
    // also need the offers box. 29 February birthdays are celebrated on the 28th in other years.
    const birthday = trigger.get('birthday')
    if (birthday) {
      const days = [local.monthDay]
      if (local.monthDay === '02-28' && !isLeapYear(local.year)) days.push('02-29')
      const key = `birthday:${local.year}`
      const cards = db
        .prepare(`SELECT c.* FROM cards c WHERE c.merchant_id = ? AND c.birthday IN (?, ?) AND ${notSent} ORDER BY c.id`)
        .all(merchant.id, days[0], days[1] ?? days[0], key) as unknown as Card[]
      for (const card of cards) add(card, 'birthday', key, birthday.text, birthday.text_ar)
    }

    // Reminders: members who agreed to offers and reminders, counted from their latest purchase in
    // the category. Within the window, so a capped day is caught up the next day, never years later.
    const rules = db
      .prepare('SELECT * FROM reminders WHERE merchant_id = ? AND enabled = 1 AND archived_at IS NULL ORDER BY days, id')
      .all(merchant.id) as unknown as Reminder[]
    const purchases = db.prepare(
      `SELECT c.*, l.id AS purchase_id FROM ledger l JOIN cards c ON c.id = l.card_id
       WHERE l.merchant_id = ? AND l.category_id = ? AND l.kind = 'earn' AND l.voided_at IS NULL AND l.created_at <= ? AND l.created_at > ?
         AND c.marketing_consent = 1
         AND NOT EXISTS (SELECT 1 FROM ledger later WHERE later.card_id = l.card_id AND later.category_id = l.category_id
                           AND later.kind = 'earn' AND later.voided_at IS NULL AND later.id > l.id)
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.card_id = c.id AND m.dedupe_key = ? || l.id)
       ORDER BY l.created_at, l.id`,
    )
    for (const rule of rules) {
      // The key's prefix is built here: a bound number concatenated in SQL can come out as "1.0".
      const rows = purchases.all(
        merchant.id, rule.category_id, now - rule.days * DAY_MS, now - (rule.days + REMINDER_WINDOW_DAYS) * DAY_MS, `reminder:${rule.id}:`,
      ) as unknown as (Card & { purchase_id: number })[]
      for (const { purchase_id, ...card } of rows) {
        add(card, 'reminder', `reminder:${rule.id}:${purchase_id}`, rule.text, rule.text_ar, { reminderId: rule.id })
      }
    }

    // Promotions: members who agreed to offers.
    const live = db
      .prepare('SELECT * FROM campaigns WHERE merchant_id = ? AND cancelled_at IS NULL AND send_at <= ? AND send_at > ? ORDER BY send_at')
      .all(merchant.id, now, now - PROMO_WINDOW_MS) as unknown as Campaign[]
    for (const campaign of live) {
      const key = `promo:${campaign.id}`
      const cards = db
        .prepare(`SELECT c.* FROM cards c WHERE c.merchant_id = ? AND c.marketing_consent = 1 AND ${notSent} ORDER BY c.id`)
        .all(merchant.id, key) as unknown as Card[]
      for (const card of cards) add(card, 'promo', key, campaign.text, campaign.text_ar, { campaignId: campaign.id })
    }

    // Win-back: once per absence. The key is the last visit (or joining), so a member who comes back
    // and drifts away again gets it again.
    const winback = trigger.get('winback')
    if (winback?.days) {
      const cards = db
        .prepare(
          `SELECT * FROM (
             SELECT c.*, COALESCE((SELECT MAX(l.created_at) FROM ledger l WHERE l.card_id = c.id AND l.kind IN ('earn', 'redeem')
                                     AND l.voided_at IS NULL), c.created_at) AS last_seen
             FROM cards c WHERE c.merchant_id = ? AND c.marketing_consent = 1
           ) AS x
           WHERE x.last_seen <= ?
             AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.card_id = x.id AND m.dedupe_key = 'winback:' || x.last_seen)
           ORDER BY x.id`,
        )
        .all(merchant.id, now - winback.days * DAY_MS) as unknown as (Card & { last_seen: number })[]
      for (const { last_seen, ...card } of cards) add(card, 'winback', `winback:${last_seen}`, winback.text, winback.text_ar)
    }
  }
  return out
}

/**
 * Saves a message and makes it the one the card shows. Returns null if it was already sent, so a
 * message can never go out twice even if two runs overlap.
 */
export function record(db: DB, o: Outgoing, now = Date.now()): Message | null {
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO messages (merchant_id, card_id, kind, campaign_id, reminder_id, dedupe_key, text, local_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (card_id, dedupe_key) DO NOTHING`,
      )
      .run(o.merchant.id, o.card.id, o.kind, o.campaignId, o.reminderId, o.dedupeKey, o.text, zoned(o.merchant.timezone, now).date, now)
    if (!r.changes) return null
    db.prepare('UPDATE cards SET last_message_id = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?').run(r.lastInsertRowid, now, o.card.id)
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid) as unknown as Message
  })
}
