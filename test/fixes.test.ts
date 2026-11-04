import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdmin } from '../src/admin.ts'
import { adjust, cardBySerial, earn, enrol, history, LoyaltyError, redeem, undoLast, UNDO_WINDOW_MS } from '../src/loyalty.ts'
import { lastDays, members, report } from '../src/reports.ts'
import { settle, setup } from './helpers.ts'

function balanceIsLedgerSum(db: ReturnType<typeof setup>['db'], cardId: number) {
  const row = db.prepare('SELECT c.balance, (SELECT COALESCE(SUM(units), 0) FROM ledger WHERE card_id = c.id) AS sum FROM cards c WHERE c.id = ?').get(cardId) as { balance: number; sum: number }
  assert.equal(row.balance, row.sum, 'balance is still the ledger sum')
}

function lastStaffId(db: ReturnType<typeof setup>['db']) {
  return (db.prepare('SELECT id FROM staff ORDER BY id DESC LIMIT 1').get() as { id: number }).id
}

test('undo: the last stamp by this key, within 10 minutes, marked and reversed, never deleted', () => {
  const { db, cafe, staffKey } = setup()
  staffKey(cafe.id)
  const counter = lastStaffId(db)
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  earn(db, cafe, card.serial, { staffId: counter })
  earn(db, cafe, card.serial, { staffId: counter })

  const u = undoLast(db, cafe, card.serial, { staffId: counter })
  assert.deepEqual(u.undone, { kind: 'earn', units: 1 })
  assert.equal(u.card.balance, 1)
  assert.equal(u.card.lifetime_earned, 1)
  const rows = db.prepare('SELECT kind, units, voided_at IS NOT NULL AS voided, ref_id FROM ledger WHERE card_id = ? ORDER BY id').all(card.id) as any[]
  assert.equal(rows.length, 3, 'nothing deleted')
  assert.deepEqual(rows.map((r) => [r.kind, r.units, r.voided]), [['earn', 1, 0], ['earn', 1, 1], ['void', -1, 0]])
  balanceIsLedgerSum(db, card.id)

  // The one before is now the latest: undo works on it too, one step at a time.
  undoLast(db, cafe, card.serial, { staffId: counter })
  assert.equal(cardBySerial(db, card.serial)!.balance, 0)
  assert.throws(() => undoLast(db, cafe, card.serial, { staffId: counter }), (e: LoyaltyError) => e.status === 409, 'nothing left')
})

test('undo: a reward given by mistake comes back; another key, or after 10 minutes, cannot undo', () => {
  const { db, cafe, staffKey } = setup()
  staffKey(cafe.id)
  const a = lastStaffId(db)
  staffKey(cafe.id)
  const b = lastStaffId(db)
  const card = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  for (let i = 0; i < 3; i++) earn(db, cafe, card.serial, { staffId: a })
  redeem(db, cafe, card.serial, { staffId: a })

  assert.throws(() => undoLast(db, cafe, card.serial, { staffId: b }), (e: LoyaltyError) => e.status === 409, 'not their entry')
  assert.throws(() => undoLast(db, cafe, card.serial, { staffId: a, now: Date.now() + UNDO_WINDOW_MS + 1000 }), (e: LoyaltyError) => e.status === 409, 'too late')
  const u = undoLast(db, cafe, card.serial, { staffId: a })
  assert.deepEqual(u.undone, { kind: 'redeem', units: -3 })
  assert.equal(u.card.balance, 3)
  assert.equal(u.card.rewards_redeemed, 0)
  balanceIsLedgerSum(db, card.id)
})

test('undo: a repeated request is answered once; the HTTP route pushes the new balance', async () => {
  const { app, db, cafe, staffKey, pushed } = setup()
  const key = staffKey(cafe.id)
  const card = enrol(db, cafe, { name: 'Sara', marketingConsent: false })
  db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run('d', card.serial, 'e'.repeat(64), Date.now())
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  await post('/api/staff/earn', { serial: card.serial, requestId: 'e1' })
  await post('/api/staff/earn', { serial: card.serial, requestId: 'e2' })
  const first = (await (await post('/api/staff/undo', { serial: card.serial, requestId: 'u1' })).json()) as any
  const again = (await (await post('/api/staff/undo', { serial: card.serial, requestId: 'u1' })).json()) as any
  assert.equal(first.card.balance, 1)
  assert.equal(again.card.balance, 1, 'a double tap undoes once')
  assert.equal(again.replayed, true)
  await settle()
  assert.equal(pushed.length, 3, 'two stamps and one undo reached the phone')
})

test('undone visits leave the reports and the member list; the staff report shows how many were undone', () => {
  const { db, cafe, staffKey } = setup()
  staffKey(cafe.id)
  const counter = lastStaffId(db)
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  earn(db, cafe, card.serial, { staffId: counter })
  earn(db, cafe, card.serial, { staffId: counter })
  undoLast(db, cafe, card.serial, { staffId: counter })
  const r = report(db, cafe, lastDays(cafe, 7))
  assert.equal(r.visits.count, 1)
  assert.equal(r.visits.repeat_visitors, 0)
  assert.deepEqual(r.staff.map((s) => [s.visits, s.undone]), [[1, 1]])
  assert.equal(members(db, cafe).rows[0].visits, 1)
})

test('adjust: by hand with a reason, never below zero, not a visit; through the dashboard it updates the wallet', async () => {
  const { app, db, phones, pushed } = setup()
  const card = enrol(db, phones, { name: 'Lina', marketingConsent: true })
  assert.throws(() => adjust(db, phones, card.serial, { units: -5, note: 'oops' }), (e: LoyaltyError) => e.status === 409)
  assert.throws(() => adjust(db, phones, card.serial, { units: 50, note: ' ' }), LoyaltyError)
  assert.throws(() => adjust(db, phones, card.serial, { units: 0, note: 'nothing' }), LoyaltyError)
  assert.throws(() => adjust(db, phones, card.serial, { units: 1.5, note: 'half' }), LoyaltyError)
  assert.equal(adjust(db, phones, card.serial, { units: 120, note: 'Forgot to scan the case on 1 Nov' }).card.balance, 120)
  assert.equal(history(db, cardBySerial(db, card.serial)!, 1)[0].note, 'Forgot to scan the case on 1 Nov')
  assert.equal(report(db, phones, lastDays(phones, 7)).visits.count, 0, 'not a visit')
  balanceIsLedgerSum(db, card.id)

  const { password } = await createAdmin(db, phones, { email: 'o@phones.test' })
  const login = (await (await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'o@phones.test', password }), headers: { 'Content-Type': 'application/json' } })).json()) as any
  const h = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }
  await app.request('/api/admin/password', { method: 'POST', headers: h, body: JSON.stringify({ current: password, next: 'a long new password' }) })
  db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run('d', card.serial, 'f'.repeat(64), Date.now())
  const res = await app.request(`/api/admin/members/${card.serial}/adjust`, { method: 'POST', headers: h, body: JSON.stringify({ units: -20, note: 'Correction' }) })
  assert.equal(res.status, 200)
  assert.equal(((await res.json()) as any).balance, 100)
  await settle()
  assert.deepEqual(pushed.at(-1), ['f'.repeat(64)])
  const row = db.prepare("SELECT admin_id FROM ledger WHERE kind = 'adjust' ORDER BY id DESC LIMIT 1").get() as { admin_id: number }
  assert.ok(row.admin_id, 'who adjusted is recorded')
})
