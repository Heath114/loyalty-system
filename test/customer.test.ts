import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateMerchant } from '../src/admin.ts'
import { adjust, cardBySerial, createBoost, createReward, earn, enrol, inviteCode } from '../src/loyalty.ts'
import { linkToken } from '../src/tokens.ts'
import { settle, setup } from './helpers.ts'

const AR = { 'Accept-Language': 'ar-JO,ar;q=0.9' }

test('card page: Arabic by the phone, English on request; rewards, friends, bonus period and history', async () => {
  const { app, db, config, phones } = setup()
  const m = updateMerchant(db, phones, { referral_units: 50, welcome_units: 10, name_ar: 'بيت الهواتف', reward_text_ar: 'غطاء مجاني' })
  createReward(db, m, { name: 'Screen protector', name_ar: 'واقي شاشة', cost: 5 })
  createBoost(db, m, { label: 'Double points', label_ar: 'نقاط مضاعفة', multiplier: 2, starts_at: Date.now() - 1000, ends_at: Date.now() + 3600_000 })
  const card = enrol(db, m, { name: 'Lina', marketingConsent: true })
  earn(db, m, card.serial, { amountFils: 2_000 })
  adjust(db, m, card.serial, { units: 3, note: 'internal reason the customer never sees' })
  const t = linkToken(config.secret, card.serial)

  const ar = await (await app.request(`/c/${card.serial}?t=${t}`, { headers: AR })).text()
  assert.match(ar, /<html lang="ar" dir="rtl">/)
  assert.match(ar, /مرحبًا Lina/)
  assert.match(ar, /أضف إلى Apple Wallet/)
  assert.match(ar, /الآن: نقاط مضاعفة\. كل عملية شراء تكسبك ×2/)
  assert.match(ar, /واقي شاشة/)
  assert.match(ar, /متاحة لك الآن/, 'the screen protector costs 5 and the card has more')
  assert.match(ar, new RegExp(`https://cards.test/m/phones\\?ref=${inviteCode(db, cardBySerial(db, card.serial)!)}`))
  assert.match(ar, /هدية الترحيب/)
  assert.match(ar, /تصحيح من المتجر/)
  assert.doesNotMatch(ar, /internal reason/, 'the merchant\'s note stays with the merchant')
  assert.match(ar, /\+40/, '2 JOD at 10 points, doubled')

  const en = await (await app.request(`/c/${card.serial}?t=${t}&lang=en`, { headers: AR })).text()
  assert.match(en, /<html lang="en" dir="ltr">/)
  assert.match(en, /Hi Lina/)
  assert.match(en, /Invite a friend/)
  assert.match(en, /Welcome gift/)
})

test('join page: welcome gift and a friend\'s invitation are announced; the privacy notice is linked', async () => {
  const { app, db, phones } = setup()
  const m = updateMerchant(db, phones, { referral_units: 50, welcome_units: 10 })
  const lina = enrol(db, m, { name: 'Lina', marketingConsent: true })
  const html = await (await app.request(`/m/phones?ref=${inviteCode(db, lina)}&lang=en`)).text()
  assert.match(html, /start with 10 points as a welcome gift/)
  assert.match(html, /A friend invited you\. After your first purchase you both get 50 points\./)
  assert.match(html, /href="\/m\/phones\/privacy\?lang=en"/)
  const stranger = await (await app.request('/m/phones?ref=NOTACODE&lang=en')).text()
  assert.doesNotMatch(stranger, /A friend invited you/)
})

test('offers: the customer switches them off and on from their card page', async () => {
  const { app, db, config, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const t = linkToken(config.secret, card.serial)
  const off = await app.request(`/c/${card.serial}/offers?t=${t}&lang=en`, { method: 'POST', body: new URLSearchParams({ on: '0' }) })
  assert.equal(off.status, 303)
  assert.equal(cardBySerial(db, card.serial)!.marketing_consent, 0)
  assert.match(await (await app.request(off.headers.get('Location')!)).text(), /You do not receive offers or reminders/)
  await app.request(`/c/${card.serial}/offers?t=${t}`, { method: 'POST', body: new URLSearchParams({ on: '1' }) })
  assert.equal(cardBySerial(db, card.serial)!.marketing_consent, 1)
  assert.equal((await app.request(`/c/${card.serial}/offers?t=wrong`, { method: 'POST', body: new URLSearchParams({ on: '0' }) })).status, 404)
  assert.equal(cardBySerial(db, card.serial)!.marketing_consent, 1, 'a wrong link changes nothing')
})

test('delete my card: asked once more, then wiped and voided in the wallet', async () => {
  const { app, db, config, cafe, pushed } = setup()
  const card = enrol(db, cafe, { name: 'Lina', phone: '0791234567', marketingConsent: true })
  db.prepare('INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)').run('d', card.serial, 'a'.repeat(64), Date.now())
  const t = linkToken(config.secret, card.serial)
  const ask = await (await app.request(`/c/${card.serial}/delete?t=${t}`, { headers: AR })).text()
  assert.match(ask, /هل تريد حذف بطاقتك؟/)
  assert.match(ask, /0 \/ 3/, 'says what they lose')
  assert.equal(cardBySerial(db, card.serial)!.member_name, 'Lina', 'asking deletes nothing')

  assert.equal((await app.request(`/c/${card.serial}/delete?t=wrong`, { method: 'POST' })).status, 404)
  const done = await app.request(`/c/${card.serial}/delete?t=${t}`, { method: 'POST', headers: AR })
  assert.match(await done.text(), /تم حذف بطاقتك/)
  await settle()
  const row = db.prepare('SELECT member_name, member_phone, deleted_at FROM cards WHERE id = ?').get(card.id) as any
  assert.equal(row.member_phone, null)
  assert.ok(row.deleted_at)
  assert.deepEqual(pushed.at(-1), ['a'.repeat(64)], 'the wallet fetches the void card')
  assert.equal((await app.request(`/c/${card.serial}?t=${t}`)).status, 404)
})

test('privacy notice: per merchant, in both languages, with how to reach them', async () => {
  const { app, db, cafe } = setup()
  updateMerchant(db, cafe, { contact_phone: '+962 6 555 0000', contact_email: 'hello@cafe.test', name_ar: 'مقهى' })
  const en = await (await app.request('/m/cafe/privacy?lang=en')).text()
  assert.match(en, /Privacy notice for the Cafe loyalty card/)
  assert.match(en, /Contact: \+962 6 555 0000 · hello@cafe\.test/)
  const ar = await (await app.request('/m/cafe/privacy', { headers: AR })).text()
  assert.match(ar, /إشعار الخصوصية لبطاقة الولاء من مقهى/)
  assert.match(ar, /حقوقك/)
  assert.throws(() => updateMerchant(db, cafe, { contact_email: 'not an email' }))
  assert.equal((await app.request('/m/nope/privacy')).status, 404)
})
