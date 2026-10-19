import { tx, type DB } from './db.ts'
import { LoyaltyError, type Card, type Merchant } from './loyalty.ts'
import { personalise } from './pass/copy.ts'

/**
 * Retention messages: the merchant's automatic ones (birthday, win-back) and one-off promotions.
 * Each lands on the customer's lock screen through the card itself (see pass/build.ts and google.ts),
 * so it costs nothing to send and needs no app.
 */

export type TriggerKind = 'birthday' | 'winback'
export type MessageKind = TriggerKind | 'promo'

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

export interface Message {
  id: number
  merchant_id: number
  card_id: number
  kind: MessageKind
  campaign_id: number | null
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
  /** As the card shows it: personalised, in the card's language. */
  text: string
  /** Both languages, for Google Wallet, which picks one by the phone's language itself. */
  en: string
  ar: string | null
}

/**
 * Everything due now, already within the caps and the sending hours. Birthdays come first, then
 * promotions, then win-back, so when the daily cap leaves room for one message it is the most
 * personal one.
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
    const add = (card: Card, kind: MessageKind, dedupeKey: string, text: string, textAr: string | null, campaignId: number | null = null) => {
      const extra = planned.get(card.id) ?? 0
      const c = counts.get(local.date, card.id, now - 30 * DAY_MS) as { today: number; recent: number }
      if (c.today + extra >= MAX_PER_DAY || c.recent + extra >= MAX_PER_30_DAYS) return
      planned.set(card.id, extra + 1)
      const en = personalise(text, card)
      const ar = textAr ? personalise(textAr, card) : null
      out.push({ merchant, card, kind, dedupeKey, campaignId, text: card.lang === 'ar' ? (ar ?? en) : en, en, ar })
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

    // Promotions: members who agreed to offers.
    const live = db
      .prepare('SELECT * FROM campaigns WHERE merchant_id = ? AND cancelled_at IS NULL AND send_at <= ? AND send_at > ? ORDER BY send_at')
      .all(merchant.id, now, now - PROMO_WINDOW_MS) as unknown as Campaign[]
    for (const campaign of live) {
      const key = `promo:${campaign.id}`
      const cards = db
        .prepare(`SELECT c.* FROM cards c WHERE c.merchant_id = ? AND c.marketing_consent = 1 AND ${notSent} ORDER BY c.id`)
        .all(merchant.id, key) as unknown as Card[]
      for (const card of cards) add(card, 'promo', key, campaign.text, campaign.text_ar, campaign.id)
    }

    // Win-back: once per absence. The key is the last visit (or joining), so a member who comes back
    // and drifts away again gets it again.
    const winback = trigger.get('winback')
    if (winback?.days) {
      const cards = db
        .prepare(
          `SELECT * FROM (
             SELECT c.*, COALESCE((SELECT MAX(l.created_at) FROM ledger l WHERE l.card_id = c.id), c.created_at) AS last_seen
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
        `INSERT INTO messages (merchant_id, card_id, kind, campaign_id, dedupe_key, text, local_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (card_id, dedupe_key) DO NOTHING`,
      )
      .run(o.merchant.id, o.card.id, o.kind, o.campaignId, o.dedupeKey, o.text, zoned(o.merchant.timezone, now).date, now)
    if (!r.changes) return null
    db.prepare('UPDATE cards SET last_message_id = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?').run(r.lastInsertRowid, now, o.card.id)
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid) as unknown as Message
  })
}
