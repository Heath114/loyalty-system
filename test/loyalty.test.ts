import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  archiveCategory, cardBySerial, categories, createCategory, earn, enrol, history, LoyaltyError, merchantById, redeem, rewardsAvailable,
  unitsFor, updateCategory,
} from '../src/loyalty.ts'
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

test('categories: a fixed thank-you per phone, points per JOD on accessories, recorded on the ledger', () => {
  const { db, phones } = setup()
  const card = enrol(db, phones, { name: 'Lina', marketingConsent: true })
  // Before any category exists, the merchant's own rate applies and no category is needed.
  assert.equal(earn(db, phones, card.serial, { amountFils: 2_000 }).units, 20)

  const phone = createCategory(db, phones, { name: 'Phone', name_ar: 'هاتف', earn: 'fixed', fixed_units: 50 })
  const acc = createCategory(db, phones, { name: 'Accessories', earn: 'rate', points_per_jod: 10 })
  const repair = createCategory(db, phones, { name: 'Screen check', earn: 'fixed', fixed_units: 0 })

  assert.equal(earn(db, phones, card.serial, { amountFils: 650_000, categoryId: phone.id }).units, 50, 'not 6500 points on a 650 JOD phone')
  assert.equal(earn(db, phones, card.serial, { categoryId: phone.id }).units, 50, 'the amount is optional on a fixed category')
  assert.equal(earn(db, phones, card.serial, { amountFils: 12_345, categoryId: acc.id }).units, 123)
  assert.equal(earn(db, phones, card.serial, { categoryId: repair.id }).units, 0, 'records the visit without earning')
  assert.throws(() => earn(db, phones, card.serial, { categoryId: acc.id }), /Enter the purchase amount/)
  assert.throws(() => earn(db, phones, card.serial, { amountFils: 1_000 }), /Pick what was bought/, 'once categories exist, every purchase needs one')

  const rows = db.prepare('SELECT units, category_id FROM ledger WHERE card_id = ? ORDER BY id').all(card.id) as { units: number; category_id: number | null }[]
  assert.deepEqual(rows.map((r) => [r.units, r.category_id]), [[20, null], [50, phone.id], [50, phone.id], [123, acc.id], [0, repair.id]])
  assert.equal(history(db, cardBySerial(db, card.serial)!, 1)[0].category, 'Screen check')

  archiveCategory(db, phones, repair.id)
  assert.throws(() => earn(db, phones, card.serial, { categoryId: repair.id }), (e: LoyaltyError) => e.status === 409)
  assert.deepEqual(categories(db, phones.id).map((c) => c.name), ['Phone', 'Accessories'])
  assert.equal(categories(db, phones.id, { archived: true }).length, 3)

  const changed = updateCategory(db, phones, acc.id, { name: 'Accessories', earn: 'rate', points_per_jod: 20 })
  assert.equal(earn(db, phones, card.serial, { amountFils: 1_000, categoryId: changed.id }).units, 20, 'new rate from now on')
})

test('categories: validation, stamps earn a set number, another merchant\'s category is not found', () => {
  const { db, cafe, phones } = setup()
  assert.throws(() => createCategory(db, cafe, { name: 'Coffee', earn: 'rate', points_per_jod: 1 }), LoyaltyError, 'no rates on a stamp card')
  assert.throws(() => createCategory(db, cafe, { name: 'Big', earn: 'fixed', fixed_units: 4 }), LoyaltyError, 'more than a full card')
  assert.throws(() => createCategory(db, cafe, { name: ' ', earn: 'fixed', fixed_units: 1 }), LoyaltyError)
  assert.throws(() => createCategory(db, phones, { name: 'X', earn: 'rate', points_per_jod: -1 }), LoyaltyError)
  assert.throws(() => createCategory(db, phones, { name: 'X', earn: 'fixed', fixed_units: 1.5 }), LoyaltyError)

  const family = createCategory(db, cafe, { name: 'Family box', earn: 'fixed', fixed_units: 2 })
  const card = enrol(db, cafe, { name: 'Omar', marketingConsent: false })
  assert.equal(earn(db, cafe, card.serial, { categoryId: family.id }).card.balance, 2)
  assert.throws(() => earn(db, phones, card.serial, { categoryId: family.id, amountFils: 1000 }), (e: LoyaltyError) => e.status === 404)
  const phoneCard = enrol(db, phones, { name: 'Sara', marketingConsent: false })
  assert.throws(() => earn(db, phones, phoneCard.serial, { categoryId: family.id, amountFils: 1000 }), (e: LoyaltyError) => e.status === 404)
  assert.ok(merchantById(db, cafe.id).changed_at > 0, 'cards refresh: their "how it works" text changed')
})
