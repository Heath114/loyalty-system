import type { DB } from './db.ts'
import type { Merchant } from './loyalty.ts'
import { due, record, type Message, type Outgoing } from './messages.ts'
import { deliverMessages, refreshAppleCards, syncGoogleClass, type Channels } from './notify.ts'

/**
 * One pass of the background work: refresh cards whose merchant changed, then send whatever
 * messages are due. Safe to run as often as you like: every message is recorded once (messages.ts).
 */
export async function tick(db: DB, ch: Channels, now = Date.now()): Promise<{ refreshed: number; sent: number }> {
  const changed = db.prepare('SELECT * FROM merchants WHERE changed_at > synced_at').all() as unknown as Merchant[]
  for (const m of changed) await refreshAppleCards(db, ch, m, now)

  // Only merchants already in Google: the first sync happens when a customer first saves a card there.
  if (ch.google) {
    const stale = db.prepare('SELECT * FROM merchants WHERE google_synced_at > 0 AND changed_at > google_synced_at').all() as unknown as Merchant[]
    for (const m of stale) {
      await syncGoogleClass(db, ch.google, m).catch((e) => console.warn(`Google Wallet class for ${m.slug}: ${(e as Error).message}`))
    }
  }

  const sent: { outgoing: Outgoing; message: Message }[] = []
  for (const outgoing of due(db, now)) {
    const message = record(db, outgoing, now)
    if (message) sent.push({ outgoing, message })
  }
  await deliverMessages(db, ch, sent)
  return { refreshed: changed.length, sent: sent.length }
}

/** Runs tick() now and every few minutes, one at a time. Returns a function that stops it. */
export function startScheduler(db: DB, ch: Channels, everyMs = 5 * 60_000): () => void {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const r = await tick(db, ch)
      if (r.refreshed || r.sent) console.log(`scheduler: ${r.sent} messages sent, ${r.refreshed} merchants refreshed`)
    } catch (e) {
      console.error('scheduler run failed', e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(run, everyMs)
  void run()
  return () => clearInterval(timer)
}
