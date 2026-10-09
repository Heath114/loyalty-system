import assert from 'node:assert/strict'
import { test } from 'node:test'
import { earn, enrol, LoyaltyError, redeem, rewardsAvailable, unitsFor } from '../src/loyalty.ts'
import { barcodeMessage, parseBarcode } from '../src/tokens.ts'
import { setup } from './helpers.ts'

test('stamps: one per visit, redeem spends the threshold', () => {
  const { db, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  for (let i = 0; i < 4; i++) earn(db, cafe, card.serial, {})
  const r = redeem(db, cafe, card.serial, {})
  assert.equal(r.card.balance, 1)
  assert.equal(r.card.lifetime_earned, 4)
  assert.equal(r.card.rewards_redeemed, 1)
  assert.equal(rewardsAvailable(cafe, r.card), 0)
  const sum = db.prepare('SELECT SUM(units) s FROM ledger WHERE card_id = ?').get(card.id) as { s: number }
  assert.equal(sum.s, r.card.balance, 'balance is the ledger sum')
})

test('points: floor(JOD x rate), amount required', () => {
  const { phones } = setup()
  assert.equal(unitsFor(phones, 12_345), 123)
  assert.throws(() => unitsFor(phones, null), LoyaltyError)
  assert.throws(() => unitsFor(phones, -5), LoyaltyError)
})

test('redeeming without enough balance is refused and changes nothing', () => {
  const { db, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  earn(db, cafe, card.serial, {})
  assert.throws(() => redeem(db, cafe, card.serial, {}), (e: LoyaltyError) => e.status === 409)
  const count = db.prepare('SELECT COUNT(*) n FROM ledger WHERE card_id = ?').get(card.id) as { n: number }
  assert.equal(count.n, 1)
})

test('a repeated request key earns once', () => {
  const { db, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Sara', marketingConsent: false })
  const a = earn(db, cafe, card.serial, { idempotencyKey: 'k1' })
  const b = earn(db, cafe, card.serial, { idempotencyKey: 'k1' })
  assert.equal(a.replayed, false)
  assert.equal(b.replayed, true)
  assert.equal(b.card.balance, 1)
})

test('a merchant cannot touch another merchant\'s card', () => {
  const { db, cafe, phones } = setup()
  const card = enrol(db, cafe, { name: 'Ali', marketingConsent: false })
  assert.throws(() => earn(db, phones, card.serial, { amountFils: 5000 }), (e: LoyaltyError) => e.status === 404)
})

test('enrolment validates input', () => {
  const { db, cafe } = setup()
  assert.throws(() => enrol(db, cafe, { name: '  ', marketingConsent: false }), LoyaltyError)
  assert.throws(() => enrol(db, cafe, { name: 'A', phone: 'call me', marketingConsent: false }), LoyaltyError)
})

test('barcode message: round trip, tamper and wrong secret are rejected', () => {
  const msg = barcodeMessage('s', 'ABCDEFGHJKMNPQRS')
  assert.ok(msg.length <= 64, 'fits an NFC pass message')
  assert.equal(parseBarcode('s', msg), 'ABCDEFGHJKMNPQRS')
  assert.equal(parseBarcode('other', msg), null)
  assert.equal(parseBarcode('s', msg.replace('ABCD', 'ABCE')), null)
  assert.equal(parseBarcode('s', 'ABCDEFGHJKMNPQRS'), null)
})
