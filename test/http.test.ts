import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import { enrol } from '../src/loyalty.ts'
import { barcodeMessage, linkToken } from '../src/tokens.ts'
import { settle, setup } from './helpers.ts'

const TOKEN = 'a'.repeat(64)

test('join flow: form, enrol, card page, pkpass download', async () => {
  const { app, db, config } = setup()
  const form = await app.request('/m/cafe')
  assert.equal(form.status, 200)
  assert.match(await form.text(), /Collect 3 stamps/)

  const res = await app.request('/m/cafe/join', { method: 'POST', body: new URLSearchParams({ name: 'Lina', consent: '1' }) })
  assert.equal(res.status, 303)
  const loc = res.headers.get('Location')!
  const serial = /\/c\/([0-9A-Z]{16})\?t=/.exec(loc)![1]
  const card = db.prepare('SELECT * FROM cards WHERE serial = ?').get(serial) as any
  assert.equal(card.member_name, 'Lina')
  assert.equal(card.marketing_consent, 1)

  const page = await app.request(loc)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Add to Apple Wallet/)

  const pass = await app.request(`/c/${serial}/card.pkpass?t=${linkToken(config.secret, serial)}`)
  assert.equal(pass.status, 200)
  assert.equal(pass.headers.get('Content-Type'), 'application/vnd.apple.pkpass')
  assert.ok(unzipSync(new Uint8Array(await pass.arrayBuffer()))['pass.json'])

  assert.equal((await app.request(`/c/${serial}`)).status, 404, 'no token, no card')
  assert.equal((await app.request(`/c/${serial}/card.pkpass?t=wrong`)).status, 404)
})

test('join flow: bad input re-shows the form with the error', async () => {
  const { app } = setup()
  const res = await app.request('/m/cafe/join', { method: 'POST', body: new URLSearchParams({ name: ' ' }) })
  assert.equal(res.status, 400)
  assert.match(await res.text(), /Please enter your name/)
  assert.equal((await app.request('/m/nope')).status, 404)
})

test('Apple Wallet web service: register, list updates, fetch pass, unregister', async () => {
  const { app, db, config, cafe, staffKey, pushed } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const ptid = config.pass.passTypeIdentifier
  const reg = `/wallet/v1/devices/dev1/registrations/${ptid}/${card.serial}`
  const auth = { Authorization: `ApplePass ${card.auth_token}`, 'Content-Type': 'application/json' }
  const body = JSON.stringify({ pushToken: TOKEN })

  assert.equal((await app.request(reg, { method: 'POST', body, headers: { ...auth, Authorization: 'ApplePass nope' } })).status, 401)
  assert.equal((await app.request(reg, { method: 'POST', body, headers: auth })).status, 201)
  assert.equal((await app.request(reg, { method: 'POST', body, headers: auth })).status, 200, 'already registered')

  const list = await app.request(`/wallet/v1/devices/dev1/registrations/${ptid}`)
  const { serialNumbers, lastUpdated } = (await list.json()) as { serialNumbers: string[]; lastUpdated: string }
  assert.deepEqual(serialNumbers, [card.serial])
  assert.equal((await app.request(`/wallet/v1/devices/dev1/registrations/${ptid}?passesUpdatedSince=${lastUpdated}`)).status, 204)

  // Staff adds a stamp: the device gets a push, and the card shows as updated.
  const key = staffKey(cafe.id)
  const earn = await app.request('/api/staff/earn', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: card.serial, requestId: 'r1' }),
  })
  assert.equal(earn.status, 200)
  await settle()
  assert.deepEqual(pushed, [[TOKEN]])
  const after = await app.request(`/wallet/v1/devices/dev1/registrations/${ptid}?passesUpdatedSince=${lastUpdated}`)
  assert.deepEqual(((await after.json()) as any).serialNumbers, [card.serial])

  const passRes = await app.request(`/wallet/v1/passes/${ptid}/${card.serial}`, { headers: auth })
  assert.equal(passRes.status, 200)
  const json = JSON.parse(Buffer.from(unzipSync(new Uint8Array(await passRes.arrayBuffer()))['pass.json']).toString())
  assert.equal(json.storeCard.primaryFields[0].value, '1 / 3')
  const lm = passRes.headers.get('Last-Modified')!
  assert.equal((await app.request(`/wallet/v1/passes/${ptid}/${card.serial}`, { headers: { ...auth, 'If-Modified-Since': lm } })).status, 304)
  assert.equal((await app.request(`/wallet/v1/passes/${ptid}/${card.serial}`)).status, 401)

  assert.equal((await app.request(reg, { method: 'DELETE', headers: auth })).status, 200)
  assert.equal((await app.request(`/wallet/v1/devices/dev1/registrations/${ptid}`)).status, 204)
  assert.equal((await app.request('/wallet/v1/log', { method: 'POST', body: JSON.stringify({ logs: ['x'] }) })).status, 200)
})

test('staff API: key required, scan resolves QR or typed number, scoped to the merchant', async () => {
  const { app, db, config, cafe, phones, staffKey } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const post = (path: string, key: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const cafeKey = staffKey(cafe.id)
  const phonesKey = staffKey(phones.id)

  assert.equal((await post('/api/staff/lookup', 'sk_wrong', { code: card.serial })).status, 401)

  const byQr = await post('/api/staff/lookup', cafeKey, { code: barcodeMessage(config.secret, card.serial) })
  assert.equal(((await byQr.json()) as any).card.serial, card.serial)
  const typed = card.serial.match(/.{4}/g)!.join(' ').toLowerCase()
  assert.equal((await post('/api/staff/lookup', cafeKey, { code: typed })).status, 200)
  assert.equal((await post('/api/staff/lookup', cafeKey, { code: 'L1.forged.qr' })).status, 404)
  assert.equal((await post('/api/staff/lookup', phonesKey, { code: card.serial })).status, 404, 'other merchant')

  for (const id of ['a', 'b', 'c', 'c']) await post('/api/staff/earn', cafeKey, { serial: card.serial, requestId: id })
  const red = await post('/api/staff/redeem', cafeKey, { serial: card.serial, requestId: 'r' })
  const out = (await red.json()) as any
  assert.equal(red.status, 200)
  assert.equal(out.card.balance, 0, 'three stamps (one replayed), one reward')
  assert.equal((await post('/api/staff/redeem', cafeKey, { serial: card.serial, requestId: 'r2' })).status, 409)

  db.prepare('UPDATE staff SET revoked_at = ? WHERE merchant_id = ?').run(Date.now(), cafe.id)
  assert.equal((await post('/api/staff/lookup', cafeKey, { code: card.serial })).status, 401, 'revoked key')
})

test('staff page and counter QR render', async () => {
  const { app } = setup()
  const staff = await app.request('/staff')
  assert.equal(staff.status, 200)
  assert.match(await staff.text(), /jsQR/)
  const qr = await app.request('/m/cafe/qr.svg')
  assert.equal(qr.headers.get('Content-Type'), 'image/svg+xml')
})

test('malformed JSON is a 400, not a 500', async () => {
  const { app, cafe, staffKey } = setup()
  const res = await app.request('/api/staff/earn', {
    method: 'POST', headers: { Authorization: `Bearer ${staffKey(cafe.id)}`, 'Content-Type': 'application/json' }, body: '{nope',
  })
  assert.equal(res.status, 400)
})

test('join flow: optional birthday and the phone language are kept; a bad birthday re-shows the form', async () => {
  const { app, db, config } = setup()
  const join = (fields: Record<string, string>, lang = 'ar-JO,ar;q=0.9,en;q=0.8') =>
    app.request('/m/cafe/join', { method: 'POST', body: new URLSearchParams(fields), headers: { 'Accept-Language': lang } })
  const card = (res: Response) => {
    const serial = /\/c\/([0-9A-Z]{16})\?t=/.exec(res.headers.get('Location')!)![1]
    return db.prepare('SELECT * FROM cards WHERE serial = ?').get(serial) as any
  }

  const lina = card(await join({ name: 'Lina', bday_day: '7', bday_month: '3' }))
  assert.equal(lina.birthday, '03-07')
  assert.equal(lina.lang, 'ar')
  assert.equal(card(await join({ name: 'Omar' }, 'en-US,en;q=0.9')).lang, 'en')
  assert.equal(card(await join({ name: 'Sara', bday_day: '', bday_month: '' })).birthday, null)

  const bad = await join({ name: 'Lina', bday_day: '31', bday_month: '2' })
  assert.equal(bad.status, 400)
  const text = await bad.text()
  assert.match(text, /Please check the birthday/)
  assert.match(text, /value="2" selected/, 'keeps what they picked')

  // Downloading the pass from a phone in English switches the card to English.
  const t = linkToken(config.secret, lina.serial)
  await app.request(`/c/${lina.serial}/card.pkpass?t=${t}`, { headers: { 'Accept-Language': 'en-GB' } })
  assert.equal((db.prepare('SELECT lang FROM cards WHERE id = ?').get(lina.id) as any).lang, 'en')
})

test('logo for Google Wallet: the uploaded square logo, else a plain square in the card colour', async () => {
  const { app, db, cafe } = setup()
  const plain = await app.request('/m/cafe/logo.png')
  assert.equal(plain.status, 200)
  assert.equal(plain.headers.get('Content-Type'), 'image/png')
  const square = Buffer.from(await plain.arrayBuffer())
  assert.equal(square.readUInt32BE(16), 660, '660 px wide, the size Google asks for')

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  db.prepare('INSERT INTO merchant_images (merchant_id, name, png) VALUES (?, ?, ?)').run(cafe.id, 'square.png', png)
  assert.deepEqual(Buffer.from(await (await app.request('/m/cafe/logo.png')).arrayBuffer()), png)
  assert.equal((await app.request('/m/nope/logo.png')).status, 404)
})
