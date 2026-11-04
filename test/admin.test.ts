import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { unzipSync } from 'fflate'
import { createAdmin, parseLatLng, resetAdminPassword, resetLoginThrottle } from '../src/admin.ts'
import { createCategory, earn, enrol, merchantById, type Merchant } from '../src/loyalty.ts'
import { buildPass } from '../src/pass/build.ts'
import { solidPng } from '../src/pass/png.ts'
import { setup } from './helpers.ts'

beforeEach(() => resetLoginThrottle())

type App = ReturnType<typeof setup>['app']

/** Signs a fresh admin in and sets their own password, as the dashboard makes them. Returns a request helper. */
async function signedIn(app: App, db: ReturnType<typeof setup>['db'], m: Merchant, email = `owner@${m.slug}.test`) {
  const { password } = await createAdmin(db, m, { email })
  const login = (await (await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }), headers: { 'Content-Type': 'application/json' } })).json()) as any
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/admin/${path}`, {
      method,
      headers: { Authorization: `Bearer ${login.token}`, ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
    })
  const r = await call('POST', 'password', { current: password, next: 'a long new password' })
  assert.equal(r.status, 200)
  return { call, token: login.token as string, email }
}

test('sign in: wrong password refused, a made-up password must be changed before anything else', async () => {
  const { app, db, cafe } = setup()
  const { password } = await createAdmin(db, cafe, { email: 'Owner@Cafe.test', name: 'Owner' })
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })

  assert.equal((await post('/api/admin/login', { email: 'owner@cafe.test', password: 'nope nope nope' })).status, 401)
  assert.equal((await post('/api/admin/login', { email: 'someone@else.test', password })).status, 401, 'unknown email reads the same')
  const ok = (await (await post('/api/admin/login', { email: ' OWNER@cafe.test ', password })).json()) as any
  assert.ok(ok.token.startsWith('as_'))
  assert.equal(ok.must_change, true)

  const auth = { Authorization: `Bearer ${ok.token}` }
  const state = (await (await app.request('/api/admin/state', { headers: auth })).json()) as any
  assert.equal(state.admin.must_change, true)
  assert.equal(state.merchant.slug, 'cafe')
  assert.equal((await app.request('/api/admin/report', { headers: auth })).status, 403, 'nothing else until the password is theirs')

  assert.equal((await post('/api/admin/password', { current: password, next: 'short' }, ok.token)).status, 400)
  assert.equal((await post('/api/admin/password', { current: 'wrong', next: 'a long new password' }, ok.token)).status, 403)
  assert.equal((await post('/api/admin/password', { current: password, next: 'a long new password' }, ok.token)).status, 200)
  assert.equal((await app.request('/api/admin/report', { headers: auth })).status, 200)

  assert.equal((await post('/api/admin/logout', {}, ok.token)).status, 200)
  assert.equal((await app.request('/api/admin/state', { headers: auth })).status, 401, 'signed out')
  assert.equal((await app.request('/api/admin/state')).status, 401)
})

test('sign in: 8 wrong passwords lock that email for 15 minutes, even against the right one', async () => {
  const { app, db, cafe } = setup()
  const { password } = await createAdmin(db, cafe, { email: 'owner@cafe.test' })
  const login = (pw: string) => app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'owner@cafe.test', password: pw }), headers: { 'Content-Type': 'application/json' } })
  for (let i = 0; i < 8; i++) assert.equal((await login('wrong password ' + i)).status, 401)
  assert.equal((await login(password)).status, 429)
})

test('reset: a new made-up password, and every session of that admin ends', async () => {
  const { app, db, cafe } = setup()
  const { call } = await signedIn(app, db, cafe)
  assert.equal((await call('GET', 'state')).status, 200)
  const { password } = await resetAdminPassword(db, 'owner@cafe.test')
  assert.equal((await call('GET', 'state')).status, 401)
  const again = (await (await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'owner@cafe.test', password }), headers: { 'Content-Type': 'application/json' } })).json()) as any
  assert.equal(again.must_change, true)
})

test('scoping: an admin only ever reaches their own merchant', async () => {
  const { app, db, cafe, phones } = setup()
  const { call } = await signedIn(app, db, cafe)
  const theirs = enrol(db, phones, { name: 'Phone customer', marketingConsent: true })
  const theirCategory = createCategory(db, phones, { name: 'Phone', earn: 'fixed', fixed_units: 50 })
  enrol(db, cafe, { name: 'Cafe customer', marketingConsent: true })

  const list = (await (await call('GET', 'members')).json()) as any
  assert.deepEqual(list.rows.map((r: any) => r.member_name), ['Cafe customer'])
  assert.equal((await call('GET', `members/${theirs.serial}`)).status, 404)
  assert.equal((await call('DELETE', `members/${theirs.serial}`)).status, 404)
  assert.equal((await call('DELETE', `categories/${theirCategory.id}`)).status, 404)
  assert.equal((await call('PUT', `categories/${theirCategory.id}`, { name: 'Mine now', earn: 'fixed', fixed_units: 1 })).status, 404)
  assert.match(await (await call('GET', 'members.csv')).text(), /Cafe customer/)
  assert.doesNotMatch(await (await call('GET', 'members.csv')).text(), /Phone customer/)
})

test('merchant settings: validated, colours normalised, the program locked after the first purchase, cards refreshed', async () => {
  const { app, db, cafe } = setup()
  const { call } = await signedIn(app, db, cafe)
  const before = merchantById(db, cafe.id).changed_at
  const ok = await call('PUT', 'merchant', { name: 'Cafe Nour', name_ar: 'مقهى نور', bg_color: '#0a2850', fg_color: '#ffffff', reward_text: 'Free latte' })
  assert.equal(ok.status, 200)
  const m = merchantById(db, cafe.id)
  assert.deepEqual([m.name, m.name_ar, m.bg_color, m.reward_text], ['Cafe Nour', 'مقهى نور', 'rgb(10,40,80)', 'Free latte'])
  assert.ok(m.changed_at >= before && m.changed_at > 0, 'every card refreshes')

  assert.equal((await call('PUT', 'merchant', { bg_color: 'blue' })).status, 400)
  assert.equal((await call('PUT', 'merchant', { timezone: 'Mars/Olympus' })).status, 400)
  assert.equal((await call('PUT', 'merchant', { reward_threshold: 0 })).status, 400)
  assert.equal((await call('PUT', 'merchant', { name: '' })).status, 400)

  assert.equal((await call('PUT', 'merchant', { program: 'points', points_per_jod: 5, reward_threshold: 100 })).status, 200, 'no purchases yet')
  assert.equal((await call('PUT', 'merchant', { program: 'stamps', reward_threshold: 10 })).status, 200)
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: false })
  earn(db, merchantById(db, cafe.id), card.serial, {})
  assert.equal((await call('PUT', 'merchant', { program: 'points', points_per_jod: 5, reward_threshold: 100 })).status, 409)
  const state = (await (await call('GET', 'state')).json()) as any
  assert.equal(state.merchant.has_purchases, true)
})

test('images: PNG only, the right shape, and the upload replaces the stand-in icon on the card', async () => {
  const { app, db, config, cafe } = setup()
  const { call } = await signedIn(app, db, cafe)
  assert.equal((await call('POST', 'images/icon', new Uint8Array([1, 2, 3, 4]), { 'Content-Type': 'image/png' })).status, 400)
  assert.equal((await call('POST', 'images/icon', new Uint8Array(solidPng(40, '#ff0000')), { 'Content-Type': 'image/png' })).status, 400, 'too small')
  assert.equal((await call('POST', 'images/square', new Uint8Array(solidPng(100, '#ff0000')), { 'Content-Type': 'image/png' })).status, 400, 'Google wants 660')
  assert.equal((await call('POST', 'images/banner', new Uint8Array(solidPng(100, '#ff0000')), { 'Content-Type': 'image/png' })).status, 404)

  const icon = solidPng(87, '#ff0000')
  assert.equal((await call('POST', 'images/icon', new Uint8Array(icon), { 'Content-Type': 'image/png' })).status, 200)
  const state = (await (await call('GET', 'state')).json()) as any
  assert.deepEqual(state.images.icon, { width: 87, height: 87 })
  assert.equal(state.images.logo, null)
  assert.deepEqual(Buffer.from(await (await call('GET', 'images/icon')).arrayBuffer()), icon)

  const files = unzipSync(buildPass(db, config, merchantById(db, cafe.id), enrol(db, cafe, { name: 'Lina', marketingConsent: false })))
  assert.deepEqual(Buffer.from(files['icon.png']), icon)
  assert.equal(files['icon@3x.png'], undefined, 'no stand-in @3x to win over the upload')

  assert.equal((await call('DELETE', 'images/icon')).status, 200)
  assert.equal(((await (await call('GET', 'state')).json()) as any).images.icon, null)
})

test('staff keys: made in the dashboard, shown once, work at the counter until removed', async () => {
  const { app, db, cafe } = setup()
  const { call } = await signedIn(app, db, cafe)
  const made = (await (await call('POST', 'staff', { label: 'Counter 1' })).json()) as any
  assert.ok(made.key.startsWith('sk_'))
  const me = await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${made.key}` } })
  assert.equal(me.status, 200)
  const state = (await (await call('GET', 'state')).json()) as any
  assert.equal(state.staff[0].label, 'Counter 1')
  assert.ok(state.staff[0].last_used_at, 'last used is recorded')
  assert.ok(!JSON.stringify(state).includes(made.key), 'the key is never shown again')
  assert.equal((await call('DELETE', `staff/${made.id}`)).status, 200)
  assert.equal((await app.request('/api/staff/me', { headers: { Authorization: `Bearer ${made.key}` } })).status, 401)
})

test('admins: add a colleague with a one-time password, never remove yourself, removing someone ends their session', async () => {
  const { app, db, cafe } = setup()
  const owner = await signedIn(app, db, cafe)
  const added = (await (await owner.call('POST', 'admins', { email: 'manager@cafe.test', name: 'Manager' })).json()) as any
  assert.match(added.password, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
  assert.equal((await owner.call('POST', 'admins', { email: 'MANAGER@cafe.test' })).status, 409)

  const state = (await (await owner.call('GET', 'state')).json()) as any
  const me = state.admins.find((a: any) => a.email === 'owner@cafe.test')
  const manager = state.admins.find((a: any) => a.email === 'manager@cafe.test')
  assert.equal((await owner.call('DELETE', `admins/${me.id}`)).status, 409)

  const login = (await (await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'manager@cafe.test', password: added.password }), headers: { 'Content-Type': 'application/json' } })).json()) as any
  assert.equal((await owner.call('DELETE', `admins/${manager.id}`)).status, 200)
  assert.equal((await app.request('/api/admin/state', { headers: { Authorization: `Bearer ${login.token}` } })).status, 401)
  assert.equal((await app.request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'manager@cafe.test', password: added.password }), headers: { 'Content-Type': 'application/json' } })).status, 401)
})

test('messages, earning and branches through the dashboard', async () => {
  const { app, db, phones } = setup()
  const { call } = await signedIn(app, db, phones)
  const cat = (await (await call('POST', 'categories', { name: 'Phone', name_ar: 'هاتف', earn: 'fixed', fixed_units: 50 })).json()) as any
  assert.equal(cat.category.fixed_units, 50)
  const rem = await call('POST', 'reminders', { category_id: cat.category.id, days: 335, text: '{name}, your warranty ends next month.' })
  assert.equal(rem.status, 200)
  assert.equal((await call('PUT', 'triggers/birthday', { text: 'Happy birthday {name}!', enabled: true })).status, 200)
  assert.equal((await call('PUT', 'triggers/winback', { text: 'We miss you', days: 3 })).status, 400)
  assert.equal((await call('PUT', 'triggers/anniversary', { text: 'x' })).status, 400)

  const promo = (await (await call('POST', 'campaigns', { text: 'Two for one', at: '2099-01-02 18:30' })).json()) as any
  assert.equal(promo.campaign.send_at, Date.UTC(2099, 0, 2, 15, 30), '18:30 in Amman')
  assert.equal((await call('POST', 'campaigns', { text: 'Old', at: '2001-01-01 10:00' })).status, 400)
  assert.equal((await call('DELETE', `campaigns/${promo.campaign.id}`)).status, 200)

  const branch = await call('POST', 'locations', { label: 'Abdoun', where: 'https://www.google.com/maps/place/X/@31.9539,35.8836,17z' })
  assert.equal(branch.status, 200)
  assert.equal((await call('POST', 'locations', { label: 'Nowhere', where: 'next to the bakery' })).status, 400)

  const state = (await (await call('GET', 'state')).json()) as any
  assert.deepEqual(state.locations.map((l: any) => [l.label, l.latitude, l.longitude]), [['Abdoun', 31.9539, 35.8836]])
  assert.equal(state.reminders[0].days, 335)
  assert.equal(state.triggers.find((t: any) => t.kind === 'birthday').enabled, 1)
  assert.equal(state.categories.length, 1)

  const report = (await (await call('GET', 'report?days=7')).json()) as any
  assert.equal(report.daily.length, 7)
  assert.equal((await call('GET', 'report?days=0')).status, 400)
  assert.equal((await call('GET', 'nothing-here')).status, 404)
})

test('coordinates: typed, or taken from a Google Maps link', () => {
  assert.deepEqual(parseLatLng('31.9539, 35.8836'), { latitude: 31.9539, longitude: 35.8836 })
  assert.deepEqual(parseLatLng('31.9539 35.8836'), { latitude: 31.9539, longitude: 35.8836 })
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=31.95,35.88'), { latitude: 31.95, longitude: 35.88 })
  assert.deepEqual(parseLatLng('https://www.google.com/maps/@-33.8688,151.2093,14z'), { latitude: -33.8688, longitude: 151.2093 })
  assert.throws(() => parseLatLng('Abdoun circle'))
  assert.throws(() => parseLatLng('95, 35'))
})

test('pages: dashboard and poster render; every response refuses framing and keeps referrers in', async () => {
  const { app } = setup()
  const page = await app.request('/admin')
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Loyalty dashboard/)
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY')
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin')
  const poster = await app.request('/m/cafe/poster')
  assert.equal(poster.status, 200)
  const html = await poster.text()
  assert.match(html, /<svg/)
  assert.match(html, /اجمع 3 طوابع واحصل على قهوة مجانية/)
  assert.equal((await app.request('/m/nope/poster')).status, 404)
})
