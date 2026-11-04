import type { DB } from './db.ts'
import { history, LoyaltyError, merchantCard, type Merchant } from './loyalty.ts'
import { localToEpoch, zoned, type MessageKind } from './messages.ts'

/**
 * What a merchant sees about their program (docs/STUDY.md §2.6): members, visits, how many come
 * back, rewards, which messages brought people back, and which counter scans. Every query is scoped
 * by merchant, like everything else.
 */

/** A member "came back" after a message if they visited within this many days of it. */
export const CAME_BACK_DAYS = 14
export const MAX_REPORT_DAYS = 366
const DAY_MS = 86_400_000

export interface Period {
  from: number
  to: number
  /** Local calendar days, "2026-11-04", oldest first. */
  days: string[]
  /** Each day's local midnight as a timestamp. */
  starts: number[]
}

/**
 * The last `days` calendar days in the merchant's time zone, today included, to the end of today.
 * Not "up to now": two purchases in the same millisecond are stored a millisecond apart, so the
 * newest can sit just past now.
 */
export function lastDays(m: Merchant, days: number, now = Date.now()): Period {
  const n = Math.min(Math.max(1, Math.floor(Number(days) || 1)), MAX_REPORT_DAYS)
  const today = zoned(m.timezone, now)
  // Calendar arithmetic, not 24-hour steps, so a daylight-saving change never skips or repeats a day.
  const date = (k: number) => new Date(Date.UTC(today.year, today.month - 1, today.day - k)).toISOString().slice(0, 10)
  const labels: string[] = []
  for (let k = n - 1; k >= 0; k--) labels.push(date(k))
  const starts = labels.map((d) => localToEpoch(m.timezone, `${d} 00:00`))
  return { from: starts[0], to: localToEpoch(m.timezone, `${date(-1)} 00:00`), days: labels, starts }
}

/** Index of the local day a moment falls on, or -1 outside the period. */
function dayIndex(p: Period, at: number): number {
  if (at < p.from || at >= p.to) return -1
  let lo = 0
  let hi = p.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (p.starts[mid] <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface MessageResult {
  kind: MessageKind
  campaign_id: number | null
  reminder_id: number | null
  /** What the merchant called it: the promotion's or reminder's text, or the trigger's name. */
  label: string
  sent: number
  /** Members who visited within CAME_BACK_DAYS of it. Recent messages are still counting. */
  came_back: number
}

export interface Report {
  period: { from: number; to: number; days: number }
  members: { total: number; joined: number; offers: number; birthdays: number; in_apple: number; in_google: number }
  visits: {
    count: number
    visitors: number
    /** Visitors who came at least twice in the period. */
    repeat_visitors: number
    /** Visitors who joined before the period: existing members coming back. */
    returning_visitors: number
    units: number
    amount_fils: number
  }
  rewards: { redeemed: number; waiting: number }
  daily: { date: string; joined: number; visits: number }[]
  categories: { id: number; name: string; name_ar: string | null; archived: boolean; purchases: number; amount_fils: number; units: number }[]
  staff: { id: number; label: string; revoked: boolean; last_used_at: number | null; visits: number; redemptions: number }[]
  /** Visits recorded without a staff key (command line, imports). */
  unattributed_visits: number
  messages: MessageResult[]
}

type Row = Record<string, number | string | null>

export function report(db: DB, m: Merchant, p: Period): Report {
  const one = (sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) as Row
  const all = (sql: string, ...args: (number | string)[]) => db.prepare(sql).all(...args) as Row[]
  const n = (v: unknown) => Number(v ?? 0)
  const inPeriod = 'created_at >= ? AND created_at < ?'

  const members = one(
    `SELECT COUNT(*) AS total, COALESCE(SUM(${inPeriod}), 0) AS joined, COALESCE(SUM(marketing_consent), 0) AS offers,
       COUNT(birthday) AS birthdays, COALESCE(SUM(google_object_at IS NOT NULL), 0) AS in_google
     FROM cards WHERE merchant_id = ? AND deleted_at IS NULL`,
    p.from, p.to, m.id,
  )
  const inApple = one(
    `SELECT COUNT(DISTINCT r.serial) AS n FROM pass_registrations r JOIN cards c ON c.serial = r.serial
     WHERE c.merchant_id = ? AND c.deleted_at IS NULL`,
    m.id,
  )
  const visits = one(
    `SELECT COUNT(*) AS count, COUNT(DISTINCT card_id) AS visitors, COALESCE(SUM(units), 0) AS units, COALESCE(SUM(amount_fils), 0) AS amount
     FROM ledger WHERE merchant_id = ? AND kind = 'earn' AND ${inPeriod}`,
    m.id, p.from, p.to,
  )
  const repeat = one(
    `SELECT COUNT(*) AS n FROM (SELECT card_id FROM ledger WHERE merchant_id = ? AND kind = 'earn' AND ${inPeriod}
       GROUP BY card_id HAVING COUNT(*) >= 2)`,
    m.id, p.from, p.to,
  )
  const returning = one(
    `SELECT COUNT(DISTINCT l.card_id) AS n FROM ledger l JOIN cards c ON c.id = l.card_id
     WHERE l.merchant_id = ? AND l.kind = 'earn' AND l.created_at >= ? AND l.created_at < ? AND c.created_at < ?`,
    m.id, p.from, p.to, p.from,
  )
  const redeemed = one(`SELECT COUNT(*) AS n FROM ledger WHERE merchant_id = ? AND kind = 'redeem' AND ${inPeriod}`, m.id, p.from, p.to)
  // Integer division on two INTEGER columns: rewards a member could claim today.
  const waiting = one(
    `SELECT COALESCE(SUM(c.balance / k.reward_threshold), 0) AS n FROM cards c JOIN merchants k ON k.id = c.merchant_id
     WHERE c.merchant_id = ? AND c.deleted_at IS NULL`,
    m.id,
  )

  const daily = p.days.map((date) => ({ date, joined: 0, visits: 0 }))
  for (const r of all(`SELECT created_at FROM cards WHERE merchant_id = ? AND ${inPeriod}`, m.id, p.from, p.to)) {
    const i = dayIndex(p, n(r.created_at))
    if (i >= 0) daily[i].joined++
  }
  for (const r of all(`SELECT created_at FROM ledger WHERE merchant_id = ? AND kind = 'earn' AND ${inPeriod}`, m.id, p.from, p.to)) {
    const i = dayIndex(p, n(r.created_at))
    if (i >= 0) daily[i].visits++
  }

  const categories = all(
    `SELECT k.id, k.name, k.name_ar, k.archived_at, COUNT(l.id) AS purchases, COALESCE(SUM(l.amount_fils), 0) AS amount,
       COALESCE(SUM(l.units), 0) AS units
     FROM categories k LEFT JOIN ledger l ON l.category_id = k.id AND l.kind = 'earn' AND l.created_at >= ? AND l.created_at < ?
     WHERE k.merchant_id = ? GROUP BY k.id ORDER BY k.sort, k.id`,
    p.from, p.to, m.id,
  )
    .filter((r) => r.archived_at == null || n(r.purchases) > 0)
    .map((r) => ({
      id: n(r.id), name: String(r.name), name_ar: (r.name_ar as string) ?? null, archived: r.archived_at != null,
      purchases: n(r.purchases), amount_fils: n(r.amount), units: n(r.units),
    }))

  const staff = all(
    `SELECT s.id, s.label, s.revoked_at, s.last_used_at, COALESCE(SUM(l.kind = 'earn'), 0) AS visits,
       COALESCE(SUM(l.kind = 'redeem'), 0) AS redemptions
     FROM staff s LEFT JOIN ledger l ON l.staff_id = s.id AND l.created_at >= ? AND l.created_at < ?
     WHERE s.merchant_id = ? GROUP BY s.id ORDER BY visits DESC, s.id`,
    p.from, p.to, m.id,
  ).map((r) => ({
    id: n(r.id), label: String(r.label), revoked: r.revoked_at != null, last_used_at: r.last_used_at == null ? null : n(r.last_used_at),
    visits: n(r.visits), redemptions: n(r.redemptions),
  }))
  const unattributed = one(
    `SELECT COUNT(*) AS n FROM ledger WHERE merchant_id = ? AND kind = 'earn' AND staff_id IS NULL AND ${inPeriod}`,
    m.id, p.from, p.to,
  )

  return {
    period: { from: p.from, to: p.to, days: p.days.length },
    members: {
      total: n(members.total), joined: n(members.joined), offers: n(members.offers), birthdays: n(members.birthdays),
      in_apple: n(inApple.n), in_google: n(members.in_google),
    },
    visits: {
      count: n(visits.count), visitors: n(visits.visitors), repeat_visitors: n(repeat.n), returning_visitors: n(returning.n),
      units: n(visits.units), amount_fils: n(visits.amount),
    },
    rewards: { redeemed: n(redeemed.n), waiting: n(waiting.n) },
    daily,
    categories,
    staff,
    unattributed_visits: n(unattributed.n),
    messages: messageResults(db, m, p),
  }
}

/** Every message sent in the period, grouped by what sent it, with how many members came back after it. */
export function messageResults(db: DB, m: Merchant, p: Period): MessageResult[] {
  const rows = db
    .prepare(
      `SELECT m.kind, m.campaign_id, m.reminder_id, COUNT(*) AS sent,
         COALESCE(SUM(EXISTS (SELECT 1 FROM ledger l WHERE l.card_id = m.card_id AND l.kind = 'earn'
                                AND l.created_at > m.created_at AND l.created_at <= m.created_at + ?)), 0) AS came_back
       FROM messages m WHERE m.merchant_id = ? AND m.created_at >= ? AND m.created_at < ?
       GROUP BY m.kind, m.campaign_id, m.reminder_id ORDER BY MIN(m.created_at)`,
    )
    .all(CAME_BACK_DAYS * DAY_MS, m.id, p.from, p.to) as {
    kind: MessageKind; campaign_id: number | null; reminder_id: number | null; sent: number; came_back: number
  }[]
  const campaignText = db.prepare('SELECT text FROM campaigns WHERE id = ? AND merchant_id = ?')
  const reminderText = db.prepare(
    'SELECT r.text, r.days, k.name FROM reminders r JOIN categories k ON k.id = r.category_id WHERE r.id = ? AND r.merchant_id = ?',
  )
  return rows.map((r) => {
    let label = r.kind === 'birthday' ? 'Birthday' : r.kind === 'winback' ? 'Win-back' : r.kind
    if (r.campaign_id != null) label = (campaignText.get(r.campaign_id, m.id) as { text: string } | undefined)?.text ?? 'Promotion'
    if (r.reminder_id != null) {
      const x = reminderText.get(r.reminder_id, m.id) as { text: string; days: number; name: string } | undefined
      if (x) label = `${x.name}, ${x.days} days: ${x.text}`
    }
    return { ...r, sent: Number(r.sent), came_back: Number(r.came_back), label }
  })
}

export interface MemberRow {
  serial: string
  member_name: string
  member_phone: string | null
  member_email: string | null
  birthday: string | null
  marketing_consent: number
  balance: number
  lifetime_earned: number
  rewards_redeemed: number
  lang: string
  created_at: number
  visits: number
  last_visit: number | null
  in_apple: number
  in_google: number
}

const MEMBER_COLUMNS = `c.serial, c.member_name, c.member_phone, c.member_email, c.birthday, c.marketing_consent, c.balance,
  c.lifetime_earned, c.rewards_redeemed, c.lang, c.created_at,
  (SELECT COUNT(*) FROM ledger l WHERE l.card_id = c.id AND l.kind = 'earn') AS visits,
  (SELECT MAX(l.created_at) FROM ledger l WHERE l.card_id = c.id AND l.kind = 'earn') AS last_visit,
  EXISTS (SELECT 1 FROM pass_registrations r WHERE r.serial = c.serial) AS in_apple,
  c.google_object_at IS NOT NULL AS in_google`

/** The merchant's members, newest first, optionally searched by name, phone or card number. */
export function members(db: DB, m: Merchant, opts: { q?: string; limit?: number; offset?: number } = {}): { total: number; rows: MemberRow[] } {
  const limit = Math.min(Math.max(1, Math.floor(Number(opts.limit) || 50)), 500)
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0))
  const q = String(opts.q ?? '').trim()
  let where = 'c.merchant_id = ? AND c.deleted_at IS NULL'
  const args: (number | string)[] = [m.id]
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    // A card number is matched from 4 characters, so a short name does not hit random card numbers.
    const serial = q.replace(/[\s-]/g, '').toUpperCase()
    const bySerial = /^[0-9A-Z]{4,16}$/.test(serial) ? `%${serial}%` : ''
    where += " AND (c.member_name LIKE ? ESCAPE '\\' OR c.member_phone LIKE ? ESCAPE '\\' OR c.serial LIKE ?)"
    args.push(like, like, bySerial)
  }
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM cards c WHERE ${where}`).get(...args) as { n: number }).n
  const rows = db
    .prepare(`SELECT ${MEMBER_COLUMNS} FROM cards c WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as unknown as MemberRow[]
  return { total: Number(total), rows }
}

/** One member: their details, every visit and reward, and the messages they were sent. */
export function member(db: DB, m: Merchant, serial: string) {
  const card = merchantCard(db, m.id, String(serial ?? '').replace(/[\s-]/g, '').toUpperCase())
  const row = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM cards c WHERE c.id = ?`).get(card.id) as unknown as MemberRow
  const messages = db
    .prepare('SELECT kind, text, created_at FROM messages WHERE card_id = ? ORDER BY id DESC LIMIT 50')
    .all(card.id) as { kind: MessageKind; text: string; created_at: number }[]
  return { member: row, history: history(db, card, 100), messages }
}

/** Every member as CSV, for the merchant's own records: the data is theirs (docs/STUDY.md §8). */
export function membersCsv(db: DB, m: Merchant): string {
  const rows = db
    .prepare(`SELECT ${MEMBER_COLUMNS} FROM cards c WHERE c.merchant_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at`)
    .all(m.id) as unknown as MemberRow[]
  const head = ['card', 'name', 'phone', 'email', 'birthday', 'offers', 'balance', 'earned', 'rewards', 'visits', 'joined', 'last_visit', 'language']
  const iso = (t: number | null) => (t == null ? '' : new Date(t).toISOString().slice(0, 10))
  const cell = (v: unknown) => {
    let s = String(v ?? '')
    // A cell starting with = + - @ would run as a formula when opened in a spreadsheet.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) =>
    [r.serial, r.member_name, r.member_phone, r.member_email, r.birthday, r.marketing_consent ? 'yes' : 'no', r.balance, r.lifetime_earned,
      r.rewards_redeemed, r.visits, iso(r.created_at), iso(r.last_visit), r.lang].map(cell).join(','),
  )
  // The byte order mark makes Excel read the Arabic names as UTF-8.
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n'
}

export function checkDays(days: unknown): number {
  const d = Number(days ?? 30)
  if (!Number.isInteger(d) || d < 1 || d > MAX_REPORT_DAYS) throw new LoyaltyError(`Pick between 1 and ${MAX_REPORT_DAYS} days`)
  return d
}
