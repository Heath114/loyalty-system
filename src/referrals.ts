import { tx, type DB } from './db.ts'
import { crossedReward, inviteCode, merchantById, UNDO_WINDOW_MS, type Card, type Merchant } from './loyalty.ts'
import { localToEpoch, zoned } from './messages.ts'

/**
 * "Bring a friend". Every card has an invite link; a friend who joins through it and buys something
 * earns both of them the merchant's referral bonus. The bonus waits until the friend's first purchase
 * is past the undo window, so a purchase taken back never pays out, and the scheduler grants it.
 */

/** A member is rewarded for at most this many friends a calendar month: enough for real friends, dull for a fraud ring. */
export const MAX_REFERRALS_PER_MONTH = 10

export function inviteLink(publicUrl: string, m: Merchant, db: DB, card: Card): string {
  return `${publicUrl}/m/${m.slug}?ref=${inviteCode(db, card)}`
}

export interface Granted {
  serial: string
  units: number
  rewardReady: boolean
}

/**
 * Pays every referral that is due: friends whose first purchase (not undone) is older than the undo
 * window and who have no referral bonus yet. The friend is always paid; the member who invited them
 * only while they are a member and under the monthly cap. Safe to run twice: a unique index on the
 * ledger allows one referral bonus per card per friend. Returns the cards to push.
 */
export function grantReferralBonuses(db: DB, now = Date.now()): Granted[] {
  const due = db
    .prepare(
      `SELECT f.id AS friend_id, f.referred_by AS referrer_id, f.merchant_id, m.referral_units AS units
       FROM cards f JOIN merchants m ON m.id = f.merchant_id
       WHERE f.referred_by IS NOT NULL AND f.deleted_at IS NULL AND m.referral_units > 0
         AND EXISTS (SELECT 1 FROM ledger l WHERE l.card_id = f.id AND l.kind = 'earn' AND l.voided_at IS NULL AND l.created_at <= ?)
         AND NOT EXISTS (SELECT 1 FROM ledger b WHERE b.card_id = f.id AND b.kind = 'bonus' AND b.note = 'referral' AND b.ref_id = f.id)
       ORDER BY f.id`,
    )
    .all(now - UNDO_WINDOW_MS) as { friend_id: number; referrer_id: number; merchant_id: number; units: number }[]

  const out: Granted[] = []
  for (const d of due) {
    tx(db, () => {
      const m = merchantById(db, d.merchant_id)
      const pay = (cardId: number) => {
        const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as unknown as Card
        const at = Math.max(now, card.updated_at + 1)
        const r = db
          .prepare(
            `INSERT INTO ledger (merchant_id, card_id, kind, units, note, ref_id, created_at) VALUES (?, ?, 'bonus', ?, 'referral', ?, ?)
             ON CONFLICT DO NOTHING`,
          )
          .run(m.id, card.id, d.units, d.friend_id, at)
        if (!r.changes) return
        db.prepare('UPDATE cards SET balance = balance + ?, lifetime_earned = lifetime_earned + ?, updated_at = ? WHERE id = ?').run(
          d.units, d.units, at, card.id,
        )
        out.push({ serial: card.serial, units: d.units, rewardReady: crossedReward(m, card.balance + d.units, d.units) })
      }
      pay(d.friend_id)
      const referrer = db.prepare('SELECT * FROM cards WHERE id = ? AND merchant_id = ? AND deleted_at IS NULL').get(d.referrer_id, m.id) as Card | undefined
      if (!referrer) return
      const month = monthStart(m, now)
      const paidThisMonth = (db
        .prepare("SELECT COUNT(*) AS n FROM ledger WHERE card_id = ? AND kind = 'bonus' AND note = 'referral' AND ref_id != ? AND created_at >= ?")
        .get(referrer.id, referrer.id, month) as { n: number }).n
      if (paidThisMonth < MAX_REFERRALS_PER_MONTH) pay(referrer.id)
    })
  }
  return out
}

/** Midnight on the 1st of this month in the merchant's time zone. */
function monthStart(m: Merchant, now: number): number {
  const z = zoned(m.timezone, now)
  return localToEpoch(m.timezone, `${z.year}-${String(z.month).padStart(2, '0')}-01 00:00`)
}

export interface ReferralStats {
  /** Members who joined through a friend's link in the period. */
  joined: number
  /** Friends whose first purchase paid out in the period. */
  rewarded: number
  /** Members who brought the most friends, all time. */
  top: { serial: string; name: string; friends: number }[]
}

export function referralStats(db: DB, m: Merchant, from: number, to: number): ReferralStats {
  const joined = db
    .prepare('SELECT COUNT(*) AS n FROM cards WHERE merchant_id = ? AND referred_by IS NOT NULL AND created_at >= ? AND created_at < ?')
    .get(m.id, from, to) as { n: number }
  const rewarded = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ledger WHERE merchant_id = ? AND kind = 'bonus' AND note = 'referral' AND ref_id = card_id
         AND created_at >= ? AND created_at < ?`,
    )
    .get(m.id, from, to) as { n: number }
  const top = db
    .prepare(
      `SELECT r.serial, r.member_name AS name, COUNT(f.id) AS friends FROM cards f JOIN cards r ON r.id = f.referred_by
       WHERE f.merchant_id = ? AND r.deleted_at IS NULL GROUP BY r.id ORDER BY friends DESC, r.id LIMIT 5`,
    )
    .all(m.id) as { serial: string; name: string; friends: number }[]
  return { joined: Number(joined.n), rewarded: Number(rewarded.n), top: top.map((t) => ({ ...t, friends: Number(t.friends) })) }
}
