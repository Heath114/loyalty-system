import assert from 'node:assert/strict'
import { createVerify } from 'node:crypto'
import { test } from 'node:test'
import { addLocation, cardBySerial, enrol } from '../src/loyalty.ts'
import { createCampaign, localToEpoch, zoned } from '../src/messages.ts'
import { tick } from '../src/scheduler.ts'
import { barcodeMessage, linkToken } from '../src/tokens.ts'
import { fakeGoogle, settle, setup, testGoogleKeys } from './helpers.ts'

const DAY = 86_400_000
const amman = (d: number, time = '12:00') => localToEpoch('Asia/Amman', `${zoned('Asia/Amman', Date.now() + d * DAY).date} ${time}`)

function decodeJwt(jwt: string) {
  const [head, body, sig] = jwt.split('.')
  const valid = createVerify('RSA-SHA256').update(`${head}.${body}`).verify(testGoogleKeys().publicKey, Buffer.from(sig, 'base64url'))
  return { header: JSON.parse(Buffer.from(head, 'base64url').toString()), claims: JSON.parse(Buffer.from(body, 'base64url').toString()), valid }
}

/** Joins, then taps "Add to Google Wallet". Returns the card and where the tap led. */
async function saveToGoogle(s: ReturnType<typeof setup>, name = 'Lina') {
  const card = enrol(s.db, s.cafe, { name, marketingConsent: true, lang: 'ar' })
  const res = await s.app.request(`/c/${card.serial}/google?t=${linkToken(s.config.secret, card.serial)}`)
  return { card, res }
}

test('Save to Google Wallet: class and card created at Google, then a signed save link', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  addLocation(s.db, s.cafe, { label: 'Abdoun', latitude: 31.9539, longitude: 35.8836 })
  const { card, res } = await saveToGoogle(s)

  assert.equal(res.status, 302)
  const location = res.headers.get('Location')!
  assert.match(location, /^https:\/\/pay\.google\.com\/gp\/v\/save\//)
  const { header, claims, valid } = decodeJwt(location.split('/save/')[1])
  assert.ok(valid, 'signed with the service account key')
  assert.equal(header.alg, 'RS256')
  const issuer = testGoogleKeys().config.issuerId
  assert.deepEqual(
    { iss: claims.iss, aud: claims.aud, typ: claims.typ, origins: claims.origins, payload: claims.payload },
    {
      iss: 'cards@test.iam.gserviceaccount.com', aud: 'google', typ: 'savetowallet', origins: ['https://cards.test'],
      payload: { loyaltyObjects: [{ id: `${issuer}.card-${card.serial}`, classId: `${issuer}.merchant-cafe` }] },
    },
  )

  const cls = google.classes.get(`${issuer}.merchant-cafe`)
  assert.equal(cls.issuerName, 'Cafe')
  assert.equal(cls.programLogo.sourceUri.uri, 'https://cards.test/m/cafe/logo.png')
  assert.equal(cls.hexBackgroundColor, '#111111')
  assert.deepEqual(cls.merchantLocations, [{ latitude: 31.9539, longitude: 35.8836 }])
  assert.equal(cls.textModulesData[0].localizedBody.translatedValues[0].value, 'قهوة مجانية')

  const obj = google.objects.get(`${issuer}.card-${card.serial}`)
  assert.equal(obj.accountName, 'Lina')
  assert.equal(obj.barcode.value, barcodeMessage(s.config.secret, card.serial), 'same QR as the Apple card')
  assert.deepEqual(obj.loyaltyPoints.balance, { string: '0 / 3' })
  assert.ok(cardBySerial(s.db, card.serial)!.google_object_at, 'remembered as being in Google Wallet')

  // A second card for the same merchant reuses the class.
  google.calls.length = 0
  await saveToGoogle(s, 'Omar')
  assert.deepEqual(google.calls.map((c) => `${c.method} ${c.path.split('/')[3]}`), ['PATCH loyaltyObject', 'POST loyaltyObject'])

  assert.equal((await s.app.request(`/c/${card.serial}/google?t=wrong`)).status, 404)
})

test('Save to Google Wallet: an outage shows a friendly page and changes nothing', async () => {
  const google = fakeGoogle()
  google.down = true
  const s = setup({}, { google })
  const { card, res } = await saveToGoogle(s)
  assert.equal(res.status, 503)
  assert.match(await res.text(), /Google Wallet is not answering/)
  assert.equal(cardBySerial(s.db, card.serial)!.google_object_at, null)
})

test('without Google set up, there is no Google button or route', async () => {
  const s = setup()
  const card = enrol(s.db, s.cafe, { name: 'Lina', marketingConsent: true })
  const t = linkToken(s.config.secret, card.serial)
  assert.doesNotMatch(await (await s.app.request(`/c/${card.serial}?t=${t}`)).text(), /Google Wallet/)
  assert.equal((await s.app.request(`/c/${card.serial}/google?t=${t}`)).status, 404)
})

test('staff stamps update the Google card; only a ready reward notifies', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  const { card } = await saveToGoogle(s)
  const key = s.staffKey(s.cafe.id)
  const earn = (id: string) =>
    s.app.request('/api/staff/earn', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: card.serial, requestId: id }),
    })
  const obj = () => google.objects.get(`${testGoogleKeys().config.issuerId}.card-${card.serial}`)

  await earn('a')
  await settle()
  assert.deepEqual(obj().loyaltyPoints.balance, { string: '1 / 3' })
  assert.deepEqual(google.notifications, [], 'a plain stamp is silent on Google')
  await earn('b')
  await earn('c')
  await settle()
  assert.deepEqual(obj().loyaltyPoints.balance, { string: '3 / 3' })
  assert.deepEqual(obj().secondaryLoyaltyPoints.balance, { int: 1 })
  assert.equal(google.notifications.length, 1, 'the third stamp made the reward ready')
  assert.equal(obj().textModulesData[0].localizedBody.translatedValues[0].value, 'جاهزة للاستلام')
})

test('messages reach Google with both languages; out of quota they still land, silently', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  const { card } = await saveToGoogle(s)
  const id = `${testGoogleKeys().config.issuerId}.card-${card.serial}`
  createCampaign(s.db, s.cafe, { text: 'Two for one, {name}', text_ar: 'اثنان بسعر واحد يا {name}' })

  google.quota.set(id, 0)
  assert.equal((await tick(s.db, s.deps, amman(1))).sent, 1)
  const [msg] = google.objects.get(id).messages
  assert.equal(msg.body, 'Two for one, Lina')
  assert.equal(msg.localizedBody.translatedValues[0].value, 'اثنان بسعر واحد يا Lina')
  assert.equal(msg.messageType, 'TEXT', 'quota spent: added without the alert')
  assert.deepEqual(google.notifications, [])

  google.quota.set(id, 3)
  createCampaign(s.db, s.cafe, { text: 'Second', sendAt: amman(2, '10:00') })
  await tick(s.db, s.deps, amman(2, '11:00'))
  assert.equal(google.objects.get(id).messages[1].messageType, 'TEXT_AND_NOTIFY')
  assert.deepEqual(google.notifications, [`${id}: Second`])
})

test('a card holding many messages is trimmed to the newest few first', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  const { card } = await saveToGoogle(s)
  const since = cardBySerial(s.db, card.serial)!.google_object_at!
  for (let i = 1; i <= 9; i++) {
    s.db.prepare(`INSERT INTO messages (merchant_id, card_id, kind, dedupe_key, text, local_day, created_at) VALUES (?, ?, 'promo', ?, ?, '2026-01-01', ?)`)
      .run(s.cafe.id, card.id, `old:${i}`, `Old ${i}`, since + i)
  }
  createCampaign(s.db, s.cafe, { text: 'New', sendAt: amman(40, '10:00') })
  google.calls.length = 0
  await tick(s.db, s.deps, amman(40, '11:00'))
  const [trim, add] = google.calls
  assert.equal(trim.method, 'PATCH')
  assert.deepEqual(trim.body.messages.map((m: any) => m.body), ['Old 6', 'Old 7', 'Old 8', 'Old 9'])
  assert.match(add.path, /addMessage$/)
})

test('a card removed from Google Wallet stops getting Google calls', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  const { card } = await saveToGoogle(s)
  google.objects.clear()
  createCampaign(s.db, s.cafe, { text: 'Hello' })
  await tick(s.db, s.deps, amman(1))
  assert.equal(cardBySerial(s.db, card.serial)!.google_object_at, null)
})

test('a new branch reaches the Google class on the next scheduler run', async () => {
  const google = fakeGoogle()
  const s = setup({}, { google })
  await saveToGoogle(s)
  addLocation(s.db, s.cafe, { label: 'Sweifieh', latitude: 31.9566, longitude: 35.8627 })
  await tick(s.db, s.deps, amman(1, '09:00'))
  assert.deepEqual(google.classes.get(`${testGoogleKeys().config.issuerId}.merchant-cafe`).merchantLocations, [
    { latitude: 31.9566, longitude: 35.8627 },
  ])
})
