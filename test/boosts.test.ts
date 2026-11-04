import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdmin } from '../src/admin.ts'
import {
  activeBoost, boosts, cancelBoost, createBoost, createCategory, earn, enrol, LoyaltyError, runningBoosts, undoLast,
} from '../src/loyalty.ts'
import { lastDays, report } from '../src/reports.ts'
import { setup } from './helpers.ts'

const HOUR = 3600_000

test('bonus period: double points while it runs, rounded down, and only then', () => {
  const { db, phones } = setup()
  const now = Date.now()
  const card = enrol(db, phones, { name: 'Lina', marketingConsent: true })
  createBoost(db, phones, { label: 'Double points weekend', multiplier: 2, starts_at: now - HOUR, ends_at: now + HOUR })
  assert.equal(earn(db, phones, card.serial, { amountFils: 12_345 }).units, 246, '123 doubled')
  assert.equal(earn(db, phones, card.serial, { amountFils: 12_345, now: now + 2 * HOUR }).units, 123, 'over')
  assert.equal(earn(db, phones, card.serial, { amountFils: 12_345, now: now - 2 * HOUR }).units, 123, 'not started')
  const boosted = db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE boost_id IS NOT NULL').get() as { n: number }
  assert.equal(boosted.n, 1, 'the purchase records which period boosted it')
})

test('bonus period: on one category only; the biggest wins when two overlap; stamps double too', () => {
  const { db, phones, cafe } = setup()
  const now = Date.now()
  const acc = createCategory(db, phones, { name: 'Accessories', earn: 'rate', points_per_jod: 10 })
  const phone = createCategory(db, phones, { name: 'Phone', earn: 'fixed', fixed_units: 50 })
  const zero = createCategory(db, phones, { name: 'Check-up', earn: 'fixed', fixed_units: 0 })
  createBoost(db, phones, { label: 'Accessories x3', multiplier: 3, category_id: acc.id, starts_at: now - HOUR, ends_at: now + HOUR })
  createBoost(db, phones, { label: 'Everything x1.5', multiplier: 1.5, starts_at: now - HOUR, ends_at: now + HOUR })
  const card = enrol(db, phones, { name: 'Lina', marketingConsent: true })
  assert.equal(earn(db, phones, card.serial, { categoryId: acc.id, amountFils: 1_000 }).units, 30)
  assert.equal(earn(db, phones, card.serial, { categoryId: phone.id }).units, 75)
  assert.equal(earn(db, phones, card.serial, { categoryId: zero.id }).units, 0, 'nothing times anything is nothing')
  assert.equal(activeBoost(db, phones.id, acc.id)!.multiplier, 3)

  createBoost(db, cafe, { label: 'Double stamps', multiplier: 2, starts_at: now - HOUR, ends_at: now + HOUR })
  const coffee = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  assert.equal(earn(db, cafe, coffee.serial, {}).card.balance, 2)
})

test('bonus period: undo takes back exactly what was given; cancelling ends it at once', () => {
  const { db, cafe, staffKey } = setup()
  staffKey(cafe.id)
  const counter = (db.prepare('SELECT id FROM staff').get() as { id: number }).id
  const now = Date.now()
  const b = createBoost(db, cafe, { label: 'Double stamps', multiplier: 2, starts_at: now - HOUR, ends_at: now + HOUR })
  const card = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  earn(db, cafe, card.serial, { staffId: counter })
  assert.equal(undoLast(db, cafe, card.serial, { staffId: counter }).card.balance, 0)
  cancelBoost(db, cafe, b.id)
  assert.equal(earn(db, cafe, card.serial, {}).units, 1)
  assert.deepEqual(boosts(db, cafe.id), [], 'cancelled ones are not listed')
  assert.throws(() => cancelBoost(db, cafe, b.id), (e: LoyaltyError) => e.status === 404)
})

test('bonus period: validated', () => {
  const { db, cafe, phones } = setup()
  const now = Date.now()
  const ok = { label: 'x', multiplier: 2, starts_at: now, ends_at: now + HOUR }
  assert.throws(() => createBoost(db, cafe, { ...ok, multiplier: 1 }), LoyaltyError)
  assert.throws(() => createBoost(db, cafe, { ...ok, multiplier: 6 }), LoyaltyError)
  assert.throws(() => createBoost(db, cafe, { ...ok, label: '' }), LoyaltyError)
  assert.throws(() => createBoost(db, cafe, { ...ok, ends_at: now - 1 }), LoyaltyError)
  assert.throws(() => createBoost(db, cafe, { ...ok, starts_at: now - 2 * HOUR, ends_at: now - HOUR }), LoyaltyError, 'already over')
  assert.throws(() => createBoost(db, cafe, { ...ok, ends_at: now + 40 * 24 * HOUR }), LoyaltyError, 'at most 31 days')
  const theirs = createCategory(db, phones, { name: 'Phone', earn: 'fixed', fixed_units: 50 })
  assert.throws(() => createBoost(db, cafe, { ...ok, category_id: theirs.id }), (e: LoyaltyError) => e.status === 404)
})

test('bonus period: from the dashboard in local time, shown to staff while on, and in the report', async () => {
  const { app, db, cafe, staffKey } = setup()
  const { password } = await createAdmin(db, cafe, { email: 'o@cafe.test' })
  const login = (await (await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'o@cafe.test', password }), headers: { 'Content-Type': 'application/json' } })).json()) as any
  const h = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }
  await app.request('/api/admin/password', { method: 'POST', headers: h, body: JSON.stringify({ current: password, next: 'a long new password' }) })

  const later = await app.request('/api/admin/boosts', { method: 'POST', headers: h, body: JSON.stringify({ label: 'Eid', multiplier: 2, starts: '2099-03-20 00:00', ends: '2099-03-23 00:00' }) })
  assert.equal(((await later.json()) as any).boost.starts_at, Date.UTC(2099, 2, 19, 21, 0), 'midnight in Amman')
  const now = await app.request('/api/admin/boosts', { method: 'POST', headers: h, body: JSON.stringify({ label: 'Today', label_ar: 'اليوم', multiplier: 1.5, ends: '2099-01-01 00:00' }) })
  assert.equal(now.status, 400, 'more than 31 days')
  const today = new Date(Date.now() + 5 * HOUR + 3 * HOUR).toISOString().slice(0, 16).replace('T', ' ')
  assert.equal((await app.request('/api/admin/boosts', { method: 'POST', headers: h, body: JSON.stringify({ label: 'Today', label_ar: 'اليوم', multiplier: 2, ends: today }) })).status, 200)

  const state = (await (await app.request('/api/admin/state', { headers: h })).json()) as any
  assert.deepEqual(state.boosts.map((b: any) => b.label), ['Today', 'Eid'])

  const key = staffKey(cafe.id)
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const look = (await (await app.request('/api/staff/lookup', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: card.serial }) })).json()) as any
  assert.deepEqual(look.card.boosts.map((b: any) => [b.label_ar, b.multiplier]), [['اليوم', 2]], 'only the one running now')
  assert.equal(runningBoosts(db, cafe.id).length, 1)

  earn(db, cafe, card.serial, {})
  const r = report(db, cafe, lastDays(cafe, 7))
  assert.deepEqual(r.boosts.map((b) => [b.label, b.purchases, b.units]), [['Today', 1, 2]])
})
