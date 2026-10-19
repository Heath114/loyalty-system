import { notifyCards, type Pusher } from './apns.ts'
import type { DB } from './db.ts'
import type { GoogleWallet } from './google.ts'
import { cardBySerial, locations, merchantById, type Card, type Merchant } from './loyalty.ts'
import type { Message, Outgoing } from './messages.ts'

/** Where card updates go: Apple through APNs, Google through its Wallet API (when configured). */
export interface Channels {
  push: Pusher
  google: GoogleWallet | null
}

/** Google allows a burst, not a flood: a few calls at a time is quick enough for a promotion. */
const GOOGLE_PARALLEL = 8
/** A Google card holds at most 10 messages; past this many we trim it back to the newest few. */
const GOOGLE_TRIM_AT = 9
const GOOGLE_KEEP = 4

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

/** Google says the card is not there: the customer removed it, or never finished saving it. */
function forgetGoogle(db: DB, card: Card): void {
  db.prepare('UPDATE cards SET google_object_at = NULL WHERE id = ?').run(card.id)
}

function warnGoogle(card: Card, e: unknown): void {
  console.warn(`Google Wallet, card ${card.serial}: ${(e as Error).message}`)
}

/**
 * After a stamp, points or a redemption: both wallets show the new balance. Apple always alerts
 * (the balance field's changeMessage); Google only when a reward has just become ready, to keep its
 * 3 notifications a day for what matters.
 */
export async function cardChanged(db: DB, ch: Channels, serial: string, opts: { rewardReady?: boolean } = {}): Promise<void> {
  const card = cardBySerial(db, serial)
  if (!card) return
  const google = async () => {
    if (!ch.google || card.google_object_at == null) return
    try {
      if (!(await ch.google.updateCard(merchantById(db, card.merchant_id), card, !!opts.rewardReady))) forgetGoogle(db, card)
    } catch (e) {
      warnGoogle(card, e)
    }
  }
  await Promise.all([notifyCards(db, ch.push, [serial]), google()])
}

/** Puts freshly recorded messages on lock screens: one push batch for Apple, a call per card for Google. */
export async function deliverMessages(db: DB, ch: Channels, sent: { outgoing: Outgoing; message: Message }[]): Promise<void> {
  if (sent.length === 0) return
  const apple = notifyCards(db, ch.push, sent.map((s) => s.outgoing.card.serial)).catch((e) => console.error('APNs batch failed', e))
  const google = ch.google
  if (google) {
    const recent = db.prepare('SELECT id, text FROM messages WHERE card_id = ? AND id < ? AND created_at >= ? ORDER BY id DESC')
    await inBatches(sent, GOOGLE_PARALLEL, async ({ outgoing, message }) => {
      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(message.card_id) as unknown as Card
      if (card.google_object_at == null) return
      const earlier = recent.all(card.id, message.id, card.google_object_at) as { id: number; text: string }[]
      const keep = earlier.length >= GOOGLE_TRIM_AT ? earlier.slice(0, GOOGLE_KEEP).reverse() : null
      try {
        const there = await google.sendMessage(outgoing.merchant, card, { id: message.id, en: outgoing.en, ar: outgoing.ar }, keep)
        if (!there) forgetGoogle(db, card)
      } catch (e) {
        warnGoogle(card, e)
      }
    })
  }
  await apple
}

/** Makes sure Google has the merchant's current class. Call before creating a card's object. */
export async function syncGoogleClass(db: DB, google: GoogleWallet, m: Merchant): Promise<void> {
  if (m.google_synced_at && m.google_synced_at >= m.changed_at) return
  await google.syncClass(m, locations(db, m.id))
  db.prepare('UPDATE merchants SET google_synced_at = ? WHERE id = ?').run(Math.max(Date.now(), m.changed_at), m.id)
}

/**
 * Something printed on every card of a merchant changed (branches, images): every card is marked
 * updated and Apple devices are told to fetch it again. Google's copy is the class, which the
 * scheduler syncs separately so a Google outage does not hold Apple back.
 */
export async function refreshAppleCards(db: DB, ch: Channels, m: Merchant, now = Date.now()): Promise<void> {
  db.prepare('UPDATE cards SET updated_at = MAX(updated_at + 1, ?) WHERE merchant_id = ?').run(now, m.id)
  const serials = (db.prepare('SELECT serial FROM cards WHERE merchant_id = ?').all(m.id) as { serial: string }[]).map((r) => r.serial)
  db.prepare('UPDATE merchants SET synced_at = ? WHERE id = ?').run(m.changed_at, m.id)
  await notifyCards(db, ch.push, serials)
}
