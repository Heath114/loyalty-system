import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.ts'
import { createCategory, createMerchant, enrol, LoyaltyError, type Card, type Merchant } from '../src/loyalty.ts'
import {
  createCampaign, createReminder, due, localToEpoch, record, reminders, removeReminder, setTrigger, updateReminder, zoned,
} from '../src/messages.ts'
import { setup, STAMPS } from './helpers.ts'

const DAY = 86_400_000
const TZ = 'Asia/Amman'

/** Local time in Amman, d days from now, as a timestamp. */
function amman(d: number, time = '12:00') {
  return localToEpoch(TZ, `${zoned(TZ, Date.now() + d * DAY).date} ${time}`)
}

function send(db: Parameters<typeof due>[0], at: number) {
  return due(db, at).map((o) => record(db, o, at)).filter((m) => m !== null)
}

/** A purchase in a category on a given day. */
function buy(db: Parameters<typeof due>[0], m: Merchant, card: Card, categoryId: number, at: number) {
  db.prepare('INSERT INTO ledger (merchant_id, card_id, kind, units, category_id, created_at) VALUES (?, ?, ?, 1, ?, ?)').run(
    m.id, card.id, 'earn', categoryId, at,
  )
}

const WARRANTY = '{name}, your phone warranty ends next month. Bring it in for a free check.'

test('reminder: N days after a purchase in the category, to members who agreed, once', () => {
  const { db, phones } = setup()
  const phone = createCategory(db, phones, { name: 'Phone', earn: 'fixed', fixed_units: 50 })
  const acc = createCategory(db, phones, { name: 'Accessories', earn: 'rate', points_per_jod: 10 })
  createReminder(db, phones, { category_id: phone.id, days: 335, text: WARRANTY, text_ar: '{name}، تنتهي كفالة هاتفك الشهر القادم.' })

  const lina = enrol(db, phones, { name: 'Lina Haddad', marketingConsent: true, lang: 'en' })
  const sami = enrol(db, phones, { name: 'Sami', marketingConsent: true, lang: 'ar' })
  const quiet = enrol(db, phones, { name: 'Quiet', marketingConsent: false })
  const caseOnly = enrol(db, phones, { name: 'Case only', marketingConsent: true })
  buy(db, phones, lina, phone.id, amman(0))
  buy(db, phones, sami, phone.id, amman(0))
  buy(db, phones, quiet, phone.id, amman(0))
  buy(db, phones, caseOnly, acc.id, amman(0))

  assert.equal(due(db, amman(334)).length, 0, 'not before the day')
  const sent = send(db, amman(335))
  assert.deepEqual(sent.map((m) => [m.card_id, m.kind]).sort(), [[lina.id, 'reminder'], [sami.id, 'reminder']].sort())
  assert.equal(sent.find((m) => m.card_id === lina.id)!.text, 'Lina, your phone warranty ends next month. Bring it in for a free check.')
  assert.equal(sent.find((m) => m.card_id === sami.id)!.text, 'Sami، تنتهي كفالة هاتفك الشهر القادم.')
  assert.ok(sent.every((m) => m.reminder_id != null))
  assert.equal(due(db, amman(336)).length, 0, 'once per purchase')
  assert.equal(reminders(db, phones.id)[0].sent, 2)
})

test('reminder: counts from the latest purchase in the category, so a returning customer is not reminded about the old one', () => {
  const { db, cafe } = setup()
  const colour = createCategory(db, cafe, { name: 'Colour', earn: 'fixed', fixed_units: 1 })
  createReminder(db, cafe, { category_id: colour.id, days: 42, text: 'Six weeks since your colour, {name}. Book your next one?' })
  const card = enrol(db, cafe, { name: 'Rana', marketingConsent: true })
  buy(db, cafe, card, colour.id, amman(0))
  buy(db, cafe, card, colour.id, amman(30))

  assert.equal(due(db, amman(42)).length, 0, 'she came back on day 30')
  assert.equal(send(db, amman(72)).length, 1, '42 days after the latest one')
})

test('reminder: caught up within the window after a capped day, never sent for purchases long past', () => {
  const { db, cafe } = setup()
  const colour = createCategory(db, cafe, { name: 'Colour', earn: 'fixed', fixed_units: 1 })
  setTrigger(db, cafe, { kind: 'birthday', text: 'Happy birthday {name}!' })
  const card = enrol(db, cafe, { name: 'Rana', marketingConsent: true, birthday: zoned(TZ, amman(42)).monthDay })
  const old = enrol(db, cafe, { name: 'Old', marketingConsent: true })
  buy(db, cafe, card, colour.id, amman(0))
  buy(db, cafe, old, colour.id, amman(-400))
  createReminder(db, cafe, { category_id: colour.id, days: 42, text: 'Time for your colour?' })

  assert.deepEqual(send(db, amman(42)).map((m) => m.kind), ['birthday'], 'birthday first, one a day')
  assert.deepEqual(send(db, amman(43)).map((m) => m.kind), ['reminder'], 'the reminder follows the next day')
  assert.equal(due(db, amman(44)).length, 0, 'the 400-day-old purchase is outside the window')
})

test('reminder: comes before a promotion on the same day; off and removed reminders send nothing', () => {
  const { db, cafe } = setup()
  const colour = createCategory(db, cafe, { name: 'Colour', earn: 'fixed', fixed_units: 1 })
  const r = createReminder(db, cafe, { category_id: colour.id, days: 10, text: 'Time for your colour?' })
  const card = enrol(db, cafe, { name: 'Rana', marketingConsent: true })
  buy(db, cafe, card, colour.id, amman(0))
  createCampaign(db, cafe, { text: 'Two for one', sendAt: amman(10, '10:00') })
  assert.deepEqual(due(db, amman(10)).map((o) => o.kind), ['reminder'], 'the cap leaves room for one, the personal one')

  updateReminder(db, cafe, r.id, { category_id: colour.id, days: 10, text: 'Time for your colour?', enabled: false })
  assert.deepEqual(due(db, amman(10)).map((o) => o.kind), ['promo'])
  updateReminder(db, cafe, r.id, { category_id: colour.id, days: 10, text: 'Time for your colour?' })
  removeReminder(db, cafe, r.id)
  assert.deepEqual(due(db, amman(10)).map((o) => o.kind), ['promo'])
  assert.equal(reminders(db, cafe.id).length, 0)
  assert.throws(() => removeReminder(db, cafe, r.id), (e: LoyaltyError) => e.status === 404)
})

test('reminder: validation, and another merchant\'s category or reminder is not found', () => {
  const { db, cafe, phones } = setup()
  const colour = createCategory(db, cafe, { name: 'Colour', earn: 'fixed', fixed_units: 1 })
  assert.throws(() => createReminder(db, cafe, { category_id: colour.id, days: 0, text: 'x' }), LoyaltyError)
  assert.throws(() => createReminder(db, cafe, { category_id: colour.id, days: 2000, text: 'x' }), LoyaltyError)
  assert.throws(() => createReminder(db, cafe, { category_id: colour.id, days: 10, text: ' ' }), LoyaltyError)
  assert.throws(() => createReminder(db, phones, { category_id: colour.id, days: 10, text: 'x' }), (e: LoyaltyError) => e.status === 404)
  const r = createReminder(db, cafe, { category_id: colour.id, days: 10, text: 'x' })
  assert.throws(() => updateReminder(db, phones, r.id, { category_id: colour.id, days: 10, text: 'y' }), (e: LoyaltyError) => e.status === 404)
})

test('upgrade: a database from before reminders keeps its messages and accepts the new kind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loyalty-'))
  try {
    const path = join(dir, 'old.db')
    const old = openDb(path, { version: 1 })
    const m = createMerchant(old, STAMPS)
    const card = enrol(old, m, { name: 'Lina', marketingConsent: true })
    old.prepare("INSERT INTO messages (merchant_id, card_id, kind, dedupe_key, text, local_day, created_at) VALUES (?, ?, 'promo', 'promo:1', 'Hello', '2026-10-20', 1)")
      .run(m.id, card.id)
    old.close()

    const db = openDb(path)
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 3)
    const kept = db.prepare('SELECT * FROM messages').all() as any[]
    assert.deepEqual(kept.map((x) => [x.kind, x.text, x.reminder_id]), [['promo', 'Hello', null]])
    db.prepare("INSERT INTO messages (merchant_id, card_id, kind, dedupe_key, text, local_day, created_at) VALUES (?, ?, 'reminder', 'r', 'x', '2026-10-21', 2)")
      .run(m.id, card.id)
    assert.throws(() => db.prepare("INSERT INTO messages (merchant_id, card_id, kind, dedupe_key, text, local_day, created_at) VALUES (?, ?, 'spam', 's', 'x', 'd', 3)").run(m.id, card.id))
    assert.deepEqual((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
