import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addLocation, cardBySerial, earn, enrol, LoyaltyError, merchantById } from '../src/loyalty.ts'
import {
  cancelCampaign, createCampaign, due, localToEpoch, MAX_PER_30_DAYS, record, setTrigger, zoned,
} from '../src/messages.ts'
import { buildPass, latestMessage, passJson } from '../src/pass/build.ts'
import { tick } from '../src/scheduler.ts'
import { unzipSync } from 'fflate'
import { setup } from './helpers.ts'

const DAY = 86_400_000
const TZ = 'Asia/Amman'

/** Local time in Amman, d days from now, as a timestamp. */
function amman(d: number, time = '12:00') {
  return localToEpoch(TZ, `${zoned(TZ, Date.now() + d * DAY).date} ${time}`)
}

const BIRTHDAY = { kind: 'birthday' as const, text: 'Happy birthday {name}! Coffee is on us today.', text_ar: 'عيد ميلاد سعيد يا {name}! قهوتك اليوم علينا.' }

/** Sends everything due at `at`, the way the scheduler does, and returns what went out. */
function send(db: Parameters<typeof due>[0], at: number) {
  return due(db, at).map((o) => record(db, o, at)).filter((m) => m !== null)
}

test('local time: Amman wall clock to a timestamp and back', () => {
  assert.equal(localToEpoch(TZ, '2026-10-20 18:00'), Date.UTC(2026, 9, 20, 15, 0))
  assert.equal(zoned(TZ, Date.UTC(2026, 9, 20, 21, 30)).date, '2026-10-21', 'past midnight in Amman')
  assert.throws(() => localToEpoch(TZ, 'Friday evening'), LoyaltyError)
})

test('birthday: on the day, in sending hours, once, personalised in the card language', () => {
  const { db, cafe } = setup()
  setTrigger(db, cafe, BIRTHDAY)
  const at = amman(1)
  const today = zoned(TZ, at).monthDay
  const lina = enrol(db, cafe, { name: 'Lina Haddad', birthday: today, marketingConsent: false, lang: 'ar' })
  const omar = enrol(db, cafe, { name: 'Omar', birthday: today, marketingConsent: true, lang: 'en' })
  enrol(db, cafe, { name: 'Sara', birthday: zoned(TZ, at + 2 * DAY).monthDay, marketingConsent: true })

  assert.equal(due(db, amman(1, '07:30')).length, 0, 'not before 10:00')
  assert.equal(due(db, amman(1, '21:15')).length, 0, 'not after 21:00')

  const sent = send(db, at)
  assert.deepEqual(sent.map((m) => m.card_id).sort(), [lina.id, omar.id].sort(), 'giving a birthday is enough, no offers box needed')
  assert.equal(sent.find((m) => m.card_id === lina.id)!.text, 'عيد ميلاد سعيد يا Lina! قهوتك اليوم علينا.')
  assert.equal(sent.find((m) => m.card_id === omar.id)!.text, 'Happy birthday Omar! Coffee is on us today.')
  assert.equal(due(db, at + 3600_000).length, 0, 'once a year')
})

test('birthday: 29 February is celebrated on the 28th in other years, and only when switched on', () => {
  const { db, cafe } = setup()
  enrol(db, cafe, { name: 'Leap', birthday: '02-29', marketingConsent: true })
  const feb28 = localToEpoch(TZ, '2027-02-28 12:00')
  assert.equal(due(db, feb28).length, 0, 'no birthday trigger yet')
  setTrigger(db, cafe, BIRTHDAY)
  assert.equal(due(db, feb28).length, 1)
  assert.equal(due(db, localToEpoch(TZ, '2028-02-28 12:00')).length, 0, '2028 has a 29th')
  setTrigger(db, cafe, { ...BIRTHDAY, enabled: false })
  assert.equal(due(db, feb28).length, 0, 'switched off')
})

test('promotion: members who agreed to offers only, within its window, not when cancelled', () => {
  const { db, cafe, phones } = setup()
  const yes = enrol(db, cafe, { name: 'Yes', marketingConsent: true })
  enrol(db, cafe, { name: 'No', marketingConsent: false })
  enrol(db, phones, { name: 'Other shop', marketingConsent: true })
  createCampaign(db, cafe, { text: 'Two for one on Friday' })
  const later = createCampaign(db, cafe, { text: 'Later', sendAt: amman(2) })

  const sent = send(db, amman(1))
  assert.deepEqual(sent.map((m) => [m.card_id, m.text]), [[yes.id, 'Two for one on Friday']])
  assert.equal(send(db, amman(1, '18:00')).length, 0, 'the scheduled one waits for its time')
  cancelCampaign(db, cafe, later.id)
  assert.equal(send(db, amman(2)).length, 0, 'cancelled')

  createCampaign(db, cafe, { text: 'Stale' })
  assert.equal(due(db, amman(3)).length, 0, 'not delivered within 48 hours: dropped, not sent late')
  assert.throws(() => createCampaign(db, cafe, { text: 'x', sendAt: Date.now() - DAY }), LoyaltyError)
  assert.throws(() => createCampaign(db, cafe, { text: 'x'.repeat(181) }), LoyaltyError)
})

test('caps: one message a day per card, birthday first; the promo follows the next day', () => {
  const { db, cafe } = setup()
  setTrigger(db, cafe, BIRTHDAY)
  const card = enrol(db, cafe, { name: 'Lina', birthday: zoned(TZ, amman(1)).monthDay, marketingConsent: true, lang: 'en' })
  createCampaign(db, cafe, { text: 'Two for one on Friday', sendAt: amman(1, '10:00') })

  assert.deepEqual(send(db, amman(1)).map((m) => m.kind), ['birthday'])
  assert.deepEqual(send(db, amman(1, '20:00')).map((m) => m.kind), [], 'already had one today')
  assert.deepEqual(send(db, amman(2, '10:05')).map((m) => [m.card_id, m.kind]), [[card.id, 'promo']])
})

test(`caps: at most ${MAX_PER_30_DAYS} messages in 30 days`, () => {
  const { db, cafe } = setup()
  enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  let count = 0
  for (let d = 1; d <= 6; d++) {
    // A fresh promotion every day, each sent on its own day.
    db.prepare('INSERT INTO campaigns (merchant_id, text, send_at, created_at) VALUES (?, ?, ?, ?)').run(cafe.id, `Day ${d}`, amman(d, '10:00'), Date.now())
    count += send(db, amman(d, '11:00')).length
  }
  assert.equal(count, MAX_PER_30_DAYS)
})

test('win-back: after N days away, once per absence, again after the next visit', () => {
  const { db, cafe } = setup()
  setTrigger(db, cafe, { kind: 'winback', days: 30, text: 'We miss you, {name}.' })
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  enrol(db, cafe, { name: 'Quiet', marketingConsent: false })
  earn(db, cafe, card.serial, {})

  assert.equal(due(db, amman(20)).length, 0, '20 days is not 30')
  assert.deepEqual(send(db, amman(31)).map((m) => m.text), ['We miss you, Lina.'])
  assert.equal(due(db, amman(45)).length, 0, 'once per absence')

  // Back in the shop on day 50, then away again.
  db.prepare('INSERT INTO ledger (merchant_id, card_id, kind, units, created_at) VALUES (?, ?, ?, 1, ?)').run(cafe.id, card.id, 'earn', amman(50))
  assert.equal(due(db, amman(70)).length, 0)
  assert.equal(send(db, amman(81)).length, 1)
  assert.throws(() => setTrigger(db, cafe, { kind: 'winback', days: 2, text: 'x' }), LoyaltyError)
})

test('a message is recorded once, even if two runs overlap', () => {
  const { db, cafe } = setup()
  enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  createCampaign(db, cafe, { text: 'Hello' })
  const [o] = due(db, amman(1))
  assert.ok(record(db, o, amman(1)))
  assert.equal(record(db, o, amman(1)), null)
})

test('Apple pass: messages land in the news field with a "%@" alert, in the card language', () => {
  const { db, config, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true, lang: 'ar' })
  const news = (c: typeof card) => (passJson(config, cafe, c, { message: latestMessage(db, c) }) as any).storeCard.backFields[0]

  assert.deepEqual(news(card), { key: 'news', label: 'NEWS', value: 'ستظهر هنا عروض وأخبار Cafe.', changeMessage: '%@' })
  createCampaign(db, cafe, { text: 'Two for one', text_ar: 'اثنان بسعر واحد' })
  send(db, amman(1))
  const after = cardBySerial(db, card.serial)!
  assert.equal(news(after).value, 'اثنان بسعر واحد')
  assert.ok(after.updated_at > card.updated_at, 'marked updated, so Wallet fetches it')

  const files = unzipSync(buildPass(db, config, cafe, after))
  assert.equal(JSON.parse(Buffer.from(files['pass.json']).toString()).storeCard.backFields[0].value, 'اثنان بسعر واحد')
})

test('Apple pass: branches become lock-screen locations; a ready reward changes the alert wording', () => {
  const { db, config, cafe } = setup()
  addLocation(db, cafe, { label: 'Abdoun', latitude: 31.9539, longitude: 35.8836 })
  addLocation(db, cafe, { label: 'Sweifieh', latitude: 31.9566, longitude: 35.8627, text: 'Fresh bread at Sweifieh now' })
  let card = enrol(db, cafe, { name: 'Lina', marketingConsent: true, lang: 'en' })
  const json = JSON.parse(Buffer.from(unzipSync(buildPass(db, config, cafe, card))['pass.json']).toString())
  assert.deepEqual(json.locations, [
    { latitude: 31.9539, longitude: 35.8836, relevantText: "You're near Cafe. Show your card when you pay." },
    { latitude: 31.9566, longitude: 35.8627, relevantText: 'Fresh bread at Sweifieh now' },
  ])
  assert.equal(json.storeCard.primaryFields[0].changeMessage, 'CHANGE_BALANCE')
  for (let i = 0; i < 3; i++) card = earn(db, cafe, card.serial, {}).card
  assert.equal((passJson(config, cafe, card) as any).storeCard.primaryFields[0].changeMessage, 'CHANGE_BALANCE_READY')

  assert.throws(() => addLocation(db, cafe, { label: 'Moon', latitude: 120, longitude: 0 }), LoyaltyError)
  for (let i = 0; i < 8; i++) addLocation(db, cafe, { label: `B${i}`, latitude: 31, longitude: 35 })
  assert.throws(() => addLocation(db, cafe, { label: 'Eleventh', latitude: 31, longitude: 35 }), (e: LoyaltyError) => e.status === 409)
})

test('scheduler: sends due messages and pushes them to Apple devices; refreshes cards after a branch change', async () => {
  const { db, cafe, deps, pushed } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run('d1', card.serial, 'b'.repeat(64), Date.now())
  createCampaign(db, cafe, { text: 'Hello' })

  assert.deepEqual(await tick(db, deps, amman(1)), { refreshed: 0, sent: 1 })
  assert.deepEqual(pushed, [['b'.repeat(64)]])

  addLocation(db, cafe, { label: 'Abdoun', latitude: 31.95, longitude: 35.88 })
  const before = (db.prepare('SELECT updated_at FROM cards WHERE id = ?').get(card.id) as { updated_at: number }).updated_at
  assert.deepEqual(await tick(db, deps, amman(1, '13:00')), { refreshed: 1, sent: 0 })
  const afterRow = db.prepare('SELECT updated_at FROM cards WHERE id = ?').get(card.id) as { updated_at: number }
  assert.ok(afterRow.updated_at > before)
  assert.equal(pushed.length, 2)
  assert.deepEqual(await tick(db, deps, amman(1, '13:05')), { refreshed: 0, sent: 0 }, 'refreshed once')
  assert.equal(merchantById(db, cafe.id).synced_at, merchantById(db, cafe.id).changed_at)
})
