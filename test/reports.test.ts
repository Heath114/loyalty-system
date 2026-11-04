import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import { createCategory, deleteMember, DELETED_NAME, earn, enrol, LoyaltyError, redeem, type Card, type Merchant } from '../src/loyalty.ts'
import { createCampaign, createReminder, due, record, setTrigger } from '../src/messages.ts'
import { cardDeleted } from '../src/notify.ts'
import { lastDays, member, members, membersCsv, report } from '../src/reports.ts'
import { barcodeMessage, linkToken } from '../src/tokens.ts'
import { fakeGoogle, settle, setup } from './helpers.ts'

const DAY = 86_400_000

function at(db: Parameters<typeof report>[0], table: 'cards' | 'ledger', id: number, t: number) {
  db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(t, id)
}

function lastLedgerId(db: Parameters<typeof report>[0], card: Card): number {
  return (db.prepare('SELECT MAX(id) AS id FROM ledger WHERE card_id = ?').get(card.id) as { id: number }).id
}

test('period: the last N local days, today included, oldest first', () => {
  const { cafe } = setup()
  const now = Date.UTC(2026, 10, 4, 10, 0) // 13:00 in Amman
  const p = lastDays(cafe, 7, now)
  assert.deepEqual(p.days, ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
  assert.equal(p.from, Date.UTC(2026, 9, 28, 21, 0), 'local midnight in Amman, UTC+3')
  assert.equal(p.to, Date.UTC(2026, 10, 4, 21, 0), 'to the end of today, local time')
  assert.equal(lastDays(cafe, 5000, now).days.length, 366)
})

test('report: members, visits, repeat and returning visitors, rewards, days, categories, staff', () => {
  const { db, phones, staffKey } = setup()
  const now = Date.now()

  staffKey(phones.id)
  const counter = db.prepare('SELECT id FROM staff WHERE merchant_id = ?').get(phones.id) as { id: number }
  const phone = createCategory(db, phones, { name: 'Phone', earn: 'fixed', fixed_units: 50 })
  const acc = createCategory(db, phones, { name: 'Accessories', earn: 'rate', points_per_jod: 10 })

  // An old member who comes back twice this week, and a new one who comes once.
  const old = enrol(db, phones, { name: 'Old', marketingConsent: true, birthday: '01-15' })
  at(db, 'cards', old.id, now - 60 * DAY)
  const fresh = enrol(db, phones, { name: 'Fresh', marketingConsent: false })
  earn(db, phones, old.serial, { categoryId: phone.id, staffId: counter.id })
  earn(db, phones, old.serial, { categoryId: acc.id, amountFils: 6_000, staffId: counter.id })
  earn(db, phones, fresh.serial, { categoryId: acc.id, amountFils: 2_500 })
  // A visit outside the period does not count.
  earn(db, phones, fresh.serial, { categoryId: acc.id, amountFils: 1_000 })
  at(db, 'ledger', lastLedgerId(db, fresh), now - 30 * DAY)
  redeem(db, phones, old.serial, { staffId: counter.id })

  const p = lastDays(phones, 7)
  const r = report(db, phones, p)
  assert.deepEqual(r.members, { total: 2, joined: 1, offers: 1, birthdays: 1, in_apple: 0, in_google: 0 })
  assert.deepEqual(r.visits, { count: 3, visitors: 2, repeat_visitors: 1, returning_visitors: 1, units: 50 + 60 + 25, amount_fils: 8_500 })
  assert.deepEqual([r.rewards.redeemed, r.rewards.waiting], [1, 0])
  assert.deepEqual(r.rewards.given.map((g) => [g.name, g.count]), [['Free case', 1]])
  assert.equal(r.daily.length, 7)
  assert.deepEqual(r.daily.at(-1), { date: p.days.at(-1), joined: 1, visits: 3 })
  assert.deepEqual(r.categories.map((c) => [c.name, c.purchases, c.amount_fils, c.units]), [['Phone', 1, 0, 50], ['Accessories', 2, 8_500, 85]])
  assert.deepEqual(r.staff.map((s) => [s.label, s.visits, s.redemptions]), [['t', 2, 1]])
  assert.equal(r.unattributed_visits, 1)
})

test('report: which messages brought members back within 14 days', () => {
  const { db, cafe } = setup()
  const now = Date.now()
  setTrigger(db, cafe, { kind: 'birthday', text: 'Happy birthday {name}!' })
  const colour = createCategory(db, cafe, { name: 'Colour', earn: 'fixed', fixed_units: 1 })
  const rem = createReminder(db, cafe, { category_id: colour.id, days: 10, text: 'Time for your colour?' })
  const a = enrol(db, cafe, { name: 'A', marketingConsent: true })
  const b = enrol(db, cafe, { name: 'B', marketingConsent: true })
  const promo = createCampaign(db, cafe, { text: 'Two for one' })
  const sentAt = now - 20 * DAY
  const insert = db.prepare('INSERT INTO messages (merchant_id, card_id, kind, campaign_id, reminder_id, dedupe_key, text, local_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run(cafe.id, a.id, 'promo', promo.id, null, 'promo:x', 'Two for one', 'd', sentAt)
  insert.run(cafe.id, b.id, 'promo', promo.id, null, 'promo:x', 'Two for one', 'd', sentAt)
  insert.run(cafe.id, a.id, 'reminder', null, rem.id, 'reminder:x', 'Time for your colour?', 'd', sentAt + 1)
  // A came back 3 days after; B came back, but 20 days after, which is too late to credit the message.
  db.prepare("INSERT INTO ledger (merchant_id, card_id, kind, units, created_at) VALUES (?, ?, 'earn', 1, ?)").run(cafe.id, a.id, sentAt + 3 * DAY)
  db.prepare("INSERT INTO ledger (merchant_id, card_id, kind, units, created_at) VALUES (?, ?, 'earn', 1, ?)").run(cafe.id, b.id, sentAt + 20 * DAY - 1)

  const r = report(db, cafe, lastDays(cafe, 30, now))
  assert.deepEqual(r.messages.map((m) => [m.kind, m.label, m.sent, m.came_back]), [
    ['promo', 'Two for one', 2, 1],
    ['reminder', 'Colour, 10 days: Time for your colour?', 1, 1],
  ])
})

test('members: newest first, search by name, phone or card number, one member\'s detail', () => {
  const { db, cafe, phones } = setup()
  const lina = enrol(db, cafe, { name: 'Lina Haddad', phone: '0791234567', marketingConsent: true })
  const omar = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  enrol(db, phones, { name: 'Lina at another shop', marketingConsent: true })
  earn(db, cafe, lina.serial, {})

  assert.deepEqual(members(db, cafe).rows.map((r) => r.member_name), ['Omar', 'Lina Haddad'])
  assert.deepEqual(members(db, cafe, { q: 'lina' }).rows.map((r) => r.member_name), ['Lina Haddad'], 'never another merchant\'s')
  assert.deepEqual(members(db, cafe, { q: '0791' }).rows.map((r) => r.member_name), ['Lina Haddad'])
  assert.deepEqual(members(db, cafe, { q: omar.serial.slice(0, 4).toLowerCase() + ' ' + omar.serial.slice(4, 8) }).rows.map((r) => r.serial), [omar.serial])
  assert.equal(members(db, cafe, { q: '%' }).total, 0, 'LIKE wildcards are literal')
  assert.equal(members(db, cafe, { limit: 1 }).rows.length, 1)
  assert.equal(members(db, cafe, { limit: 1 }).total, 2)

  const d = member(db, cafe, lina.serial)
  assert.equal(d.member.visits, 1)
  assert.equal(d.history.length, 1)
  assert.throws(() => member(db, phones, lina.serial), (e: LoyaltyError) => e.status === 404)
})

test('members CSV: Arabic survives Excel, formulas do not run, quotes are escaped', () => {
  const { db, cafe } = setup()
  enrol(db, cafe, { name: 'ليلى', marketingConsent: true })
  enrol(db, cafe, { name: '=HYPERLINK("http://x")', marketingConsent: false })
  enrol(db, cafe, { name: 'Sara, "the regular"', marketingConsent: false })
  const csv = membersCsv(db, cafe)
  assert.ok(csv.startsWith('﻿card,name,phone'))
  assert.match(csv, /,ليلى,/)
  assert.match(csv, /,"'=HYPERLINK\(""http:\/\/x""\)",/)
  assert.match(csv, /,"Sara, ""the regular""",/)
})

test('delete a member: details wiped, card void in Apple Wallet and inactive in Google, nothing more is sent', async () => {
  const g = fakeGoogle()
  const { app, db, config, cafe, deps, pushed, staffKey } = setup({}, { google: g })
  setTrigger(db, cafe, { kind: 'birthday', text: 'Happy birthday {name}!' })
  const card = enrol(db, cafe, { name: 'Lina', phone: '0791234567', birthday: '03-07', marketingConsent: true })
  earn(db, cafe, card.serial, {})
  const token = 'c'.repeat(64)
  db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run('dev1', card.serial, token, Date.now())
  const t = linkToken(config.secret, card.serial)
  assert.equal((await app.request(`/c/${card.serial}/google?t=${t}`)).status, 302)
  createCampaign(db, cafe, { text: 'Hello {name}' })

  const gone = deleteMember(db, cafe, card.serial)
  await cardDeleted(db, deps, gone)
  await settle()

  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id) as any
  assert.equal(row.member_name, DELETED_NAME)
  assert.deepEqual([row.member_phone, row.birthday, row.marketing_consent, row.google_object_at], [null, null, 0, null])
  assert.ok(row.deleted_at)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE card_id = ?').get(card.id) as any).n, 1, 'the visit still counts')
  assert.deepEqual(pushed.at(-1), [token], 'their iPhone is told to fetch the card once more')
  assert.equal(g.objects.get(`${config.google!.issuerId}.card-${card.serial}`).state, 'INACTIVE')

  // Apple's web service hands out the void card, and takes no new devices.
  const ptid = config.pass.passTypeIdentifier
  const auth = { Authorization: `ApplePass ${card.auth_token}` }
  const pass = await app.request(`/wallet/v1/passes/${ptid}/${card.serial}`, { headers: auth })
  assert.equal(pass.status, 200)
  const json = JSON.parse(Buffer.from(unzipSync(new Uint8Array(await pass.arrayBuffer()))['pass.json']).toString())
  assert.equal(json.voided, true)
  assert.equal(json.storeCard.secondaryFields[0].value, DELETED_NAME)
  const reg = await app.request(`/wallet/v1/devices/dev2/registrations/${ptid}/${card.serial}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ pushToken: 'd'.repeat(64) }),
  })
  assert.equal(reg.status, 401)

  // Their card page, the counter and every message are closed to them.
  assert.equal((await app.request(`/c/${card.serial}?t=${t}`)).status, 404)
  const look = await app.request('/api/staff/lookup', {
    method: 'POST', headers: { Authorization: `Bearer ${staffKey(cafe.id)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: barcodeMessage(config.secret, card.serial) }),
  })
  assert.equal(look.status, 404)
  assert.equal(due(db, Date.now()).length, 0)
  assert.equal(members(db, cafe).total, 0)
  assert.throws(() => deleteMember(db, cafe, card.serial), (e: LoyaltyError) => e.status === 404)
})

test('delete a member: their past messages lose the personalised text', () => {
  const { db, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  createCampaign(db, cafe, { text: 'Hello {name}' })
  const noon = Date.now()
  for (const o of due(db, noon)) record(db, o, noon)
  deleteMember(db, cafe, card.serial)
  const texts = (db.prepare('SELECT text FROM messages WHERE card_id = ?').all(card.id) as { text: string }[]).map((r) => r.text)
  assert.ok(texts.every((x) => x === ''))
})

export type { Merchant }
