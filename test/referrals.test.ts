import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateMerchant } from '../src/admin.ts'
import { cardBySerial, deleteMember, earn, enrol, inviteCode, LoyaltyError, merchantById, undoLast, UNDO_WINDOW_MS } from '../src/loyalty.ts'
import { grantReferralBonuses, inviteLink, MAX_REFERRALS_PER_MONTH } from '../src/referrals.ts'
import { lastDays, report } from '../src/reports.ts'
import { tick } from '../src/scheduler.ts'
import { settle, setup } from './helpers.ts'

const LATER = () => Date.now() + UNDO_WINDOW_MS + 60_000

test('welcome gift: every new member starts with it, recorded as a bonus', () => {
  const { db, phones } = setup()
  const m = updateMerchant(db, phones, { welcome_units: 25 })
  const card = enrol(db, m, { name: 'Lina', marketingConsent: false })
  assert.equal(card.balance, 25)
  assert.equal(card.lifetime_earned, 25)
  const row = db.prepare('SELECT kind, units, note FROM ledger WHERE card_id = ?').get(card.id) as any
  assert.deepEqual({ ...row }, { kind: 'bonus', units: 25, note: 'welcome' })
  assert.deepEqual(report(db, m, lastDays(m, 7)).welcome, { members: 1, units: 25 })
  assert.equal(report(db, m, lastDays(m, 7)).visits.count, 0, 'a gift is not a visit')
  assert.throws(() => updateMerchant(db, m, { welcome_units: 101 }), LoyaltyError, 'not more than a whole reward')
  assert.throws(() => updateMerchant(db, m, { referral_units: -1 }), LoyaltyError)
})

test('bring a friend: the link carries the code, and both are paid once the first purchase is past the undo window', async () => {
  const { app, db, config, cafe } = setup()
  const m = updateMerchant(db, cafe, { referral_units: 1 })
  const lina = enrol(db, m, { name: 'Lina', marketingConsent: true })
  const link = inviteLink(config.publicUrl, m, db, lina)
  const code = inviteCode(db, cardBySerial(db, lina.serial)!)
  assert.equal(link, `https://cards.test/m/cafe?ref=${code}`)
  assert.equal(inviteCode(db, cardBySerial(db, lina.serial)!), code, 'the same code every time')

  const form = await app.request(`/m/cafe?ref=${code}`)
  assert.match(await form.text(), new RegExp(`name="ref" value="${code}"`))
  const joined = await app.request('/m/cafe/join', { method: 'POST', body: new URLSearchParams({ name: 'Omar', ref: code.toLowerCase() }) })
  const serial = /\/c\/([0-9A-Z]{16})\?t=/.exec(joined.headers.get('Location')!)![1]
  const omar = cardBySerial(db, serial)!
  assert.equal(omar.referred_by, lina.id)

  assert.deepEqual(grantReferralBonuses(db, LATER()), [], 'nothing before a purchase')
  earn(db, m, omar.serial, {})
  assert.deepEqual(grantReferralBonuses(db), [], 'not inside the undo window')
  const paid = grantReferralBonuses(db, LATER())
  assert.deepEqual(paid.map((p) => [p.serial, p.units]), [[omar.serial, 1], [lina.serial, 1]])
  assert.equal(cardBySerial(db, omar.serial)!.balance, 2, 'their stamp and the friend bonus')
  assert.equal(cardBySerial(db, lina.serial)!.balance, 1)
  assert.deepEqual(grantReferralBonuses(db, LATER()), [], 'paid once')

  const r = report(db, merchantById(db, m.id), lastDays(m, 7, LATER()))
  assert.equal(r.referrals.joined, 1)
  assert.equal(r.referrals.rewarded, 1)
  assert.deepEqual(r.referrals.top.map((t) => [t.name, t.friends]), [['Lina', 1]])
})

test('bring a friend: an undone first purchase pays nothing; a wrong code is ignored; a deleted inviter is not paid', () => {
  const { db, cafe, staffKey } = setup()
  staffKey(cafe.id)
  const counter = (db.prepare('SELECT id FROM staff').get() as { id: number }).id
  const m = updateMerchant(db, cafe, { referral_units: 2 })
  const lina = enrol(db, m, { name: 'Lina', marketingConsent: true })
  const code = inviteCode(db, lina)

  const omar = enrol(db, m, { name: 'Omar', marketingConsent: false, inviteCode: code })
  earn(db, m, omar.serial, { staffId: counter })
  undoLast(db, m, omar.serial, { staffId: counter })
  assert.deepEqual(grantReferralBonuses(db, LATER()), [], 'the purchase was taken back')

  assert.equal(enrol(db, m, { name: 'Sara', marketingConsent: false, inviteCode: 'NOPE123' }).referred_by, null)

  const dana = enrol(db, m, { name: 'Dana', marketingConsent: false, inviteCode: code })
  earn(db, m, dana.serial, {})
  deleteMember(db, m, lina.serial)
  assert.deepEqual(grantReferralBonuses(db, LATER()).map((p) => p.serial), [dana.serial], 'the friend is still paid')
})

test(`bring a friend: an inviter is paid for at most ${MAX_REFERRALS_PER_MONTH} friends a month`, () => {
  const { db, cafe } = setup()
  const m = updateMerchant(db, cafe, { referral_units: 1 })
  const lina = enrol(db, m, { name: 'Lina', marketingConsent: true })
  const code = inviteCode(db, lina)
  for (let i = 0; i < MAX_REFERRALS_PER_MONTH + 2; i++) {
    const f = enrol(db, m, { name: `Friend ${i}`, marketingConsent: false, inviteCode: code })
    earn(db, m, f.serial, {})
  }
  grantReferralBonuses(db, LATER())
  const toLina = db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE card_id = ? AND kind = 'bonus' AND note = 'referral'").get(lina.id) as { n: number }
  assert.equal(toLina.n, MAX_REFERRALS_PER_MONTH)
  const friends = db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE card_id != ? AND kind = 'bonus' AND note = 'referral'").get(lina.id) as { n: number }
  assert.equal(friends.n, MAX_REFERRALS_PER_MONTH + 2, 'every friend is paid')
})

test('bring a friend: switched off pays nothing; the scheduler pays and pushes when it is on', async () => {
  const { db, cafe, deps, pushed } = setup()
  const lina = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const omar = enrol(db, cafe, { name: 'Omar', marketingConsent: false, inviteCode: inviteCode(db, lina) })
  earn(db, cafe, omar.serial, {})
  assert.deepEqual(grantReferralBonuses(db, LATER()), [], 'referral_units is 0')
  updateMerchant(db, cafe, { referral_units: 1 })
  for (const c of [lina, omar]) {
    db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run(`d-${c.id}`, c.serial, String(c.id).repeat(64).slice(0, 64), Date.now())
  }
  const r = await tick(db, deps, LATER())
  assert.equal(r.bonuses, 2)
  await settle()
  assert.ok(pushed.flat().length >= 2, 'both wallets told')
})
