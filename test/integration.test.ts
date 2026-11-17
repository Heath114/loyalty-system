import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiKey, revokeApiKey } from '../src/integration.ts'
import { createCategory, createReward, enrol, merchantById } from '../src/loyalty.ts'
import { report, lastDays } from '../src/reports.ts'
import { setup } from './helpers.ts'

type App = ReturnType<typeof setup>['app']

function client(app: App, key: string) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await app.request(`/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, body: (await r.json()) as any }
  }
}

test('integration: a key works for its own merchant only, and not once revoked', async () => {
  const { app, db, cafe, phones } = setup()
  const k = createApiKey(db, cafe, 'UniDash')
  assert.ok(k.key.startsWith('lk_'))
  const api = client(app, k.key)
  const program = await api('GET', 'program')
  assert.equal(program.status, 200)
  assert.equal(program.body.merchant.slug, 'cafe')
  assert.deepEqual(program.body.rewards.map((r: any) => r.cost), [3])

  assert.equal((await client(app, 'lk_nope')('GET', 'program')).status, 401)
  assert.equal((await client(app, 'sk_nope')('GET', 'program')).status, 401, 'a staff key is not an API key')

  // A member made through the cafe's key is invisible to the phone store's.
  await api('PUT', 'members/user-1', { name: 'Lina' })
  const other = client(app, createApiKey(db, phones, 'Till').key)
  assert.equal((await other('GET', 'members/user-1')).status, 404)

  revokeApiKey(db, cafe, k.id)
  assert.equal((await api('GET', 'program')).status, 401)
})

test('integration: members by the other system\'s ID, created once, updated in place', async () => {
  const { app, db, cafe } = setup()
  const api = client(app, createApiKey(db, cafe, 'UniDash').key)

  const made = await api('PUT', 'members/6f1c2a90-aaaa-4bbb-8ccc-1234567890ab', { name: 'Lina Haddad', email: 'lina@uni.test', lang: 'en', marketingConsent: true })
  assert.equal(made.status, 201)
  assert.equal(made.body.created, true)
  const m = made.body.member
  assert.equal(m.ref, '6f1c2a90-aaaa-4bbb-8ccc-1234567890ab')
  assert.equal(m.balance, 0)
  assert.equal(m.toNextReward, 3)
  assert.equal(m.marketingConsent, true)
  assert.match(m.links.card, /^https:\/\/cards\.test\/c\/[0-9A-Z]{16}\?t=/)
  assert.match(m.links.apple, /\/card\.pkpass\?t=/)
  assert.equal(m.links.google, null, 'no Google link until Google Wallet is set up')
  assert.deepEqual(m.inWallet, { apple: false, google: false })

  // The card page the link opens is the member's.
  const page = await app.request(m.links.card.replace('https://cards.test', ''))
  assert.equal(page.status, 200)

  const again = await api('PUT', 'members/6f1c2a90-aaaa-4bbb-8ccc-1234567890ab', { name: 'Lina H.' })
  assert.equal(again.status, 200)
  assert.equal(again.body.created, false)
  assert.equal(again.body.member.serial, m.serial, 'the same card')
  assert.equal(again.body.member.name, 'Lina H.')
  assert.equal(again.body.member.marketingConsent, true, 'fields left out stay')
  assert.equal((await api('PUT', 'members/has%20space', { name: 'X' })).status, 400, 'IDs are plain characters')
  assert.equal((await api('PUT', 'members/ok-id', { name: '' })).status, 400)
  assert.equal((await api('PUT', 'members/ok-id', { name: 'X', birthday: '13-01' })).status, 400)
  assert.equal((await api('PUT', 'members/ok-id', { name: 'X', lang: 'fr' })).status, 400)
  assert.equal((await api('GET', 'members/nobody')).status, 404)

  const list = await api('GET', 'members')
  assert.deepEqual(list.body.refs, ['6f1c2a90-aaaa-4bbb-8ccc-1234567890ab'])

  // A card made at the counter has no ref and is not listed.
  enrol(db, cafe, { name: 'Walk-in', marketingConsent: false })
  assert.equal((await api('GET', 'members')).body.refs.length, 1)
})

test('integration: a purchase per order ID, once, enrolling on the first order; reversed on a refund', async () => {
  const { app, db, phones } = setup()
  const api = client(app, createApiKey(db, phones, 'UniDash').key)

  assert.equal((await api('POST', 'members/u1/purchases', { orderId: 'o-1', amountFils: 4500 })).status, 404, 'unknown member, no details')

  const first = await api('POST', 'members/u1/purchases', { orderId: 'o-1', amountFils: 4500, member: { name: 'Omar' } })
  assert.equal(first.status, 201)
  assert.equal(first.body.enrolled, true)
  assert.equal(first.body.units, 45, '4.5 JOD x 10 points')
  assert.equal(first.body.member.balance, 45)

  const retry = await api('POST', 'members/u1/purchases', { orderId: 'o-1', amountFils: 4500, member: { name: 'Omar' } })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.member.balance, 45, 'the same order earns once')

  const second = await api('POST', 'members/u1/purchases', { orderId: 'o-2', amountFils: 6000 })
  assert.equal(second.body.member.balance, 105)
  assert.equal(second.body.rewardReady, true, 'crossed 100')

  // The same order ID for someone else is a mistake, not a second purchase.
  await api('PUT', 'members/u2', { name: 'Sara' })
  assert.equal((await api('POST', 'members/u2/purchases', { orderId: 'o-2', amountFils: 6000 })).status, 409)

  const refund = await api('POST', 'members/u1/purchases/o-1/reverse')
  assert.equal(refund.status, 200)
  assert.equal(refund.body.units, -45)
  assert.equal(refund.body.member.balance, 60)
  const refundAgain = await api('POST', 'members/u1/purchases/o-1/reverse')
  assert.equal(refundAgain.body.replayed, true)
  assert.equal(refundAgain.body.member.balance, 60, 'reversing twice takes back once')
  assert.equal((await api('POST', 'members/u1/purchases/o-9/reverse')).status, 404)
  assert.equal((await api('POST', 'members/u2/purchases/o-2/reverse')).status, 404, 'another member\'s order')

  const history = (await api('GET', 'members/u1')).body.history
  assert.deepEqual(history.map((h: any) => h.kind), ['void', 'earn', 'earn'])

  // Categories: once the merchant has them, every purchase names one.
  const acc = createCategory(db, merchantById(db, phones.id), { name: 'Accessories', earn: 'rate', points_per_jod: 20 })
  assert.equal((await api('POST', 'members/u1/purchases', { orderId: 'o-3', amountFils: 1000 })).status, 400)
  assert.equal((await api('POST', 'members/u1/purchases', { orderId: 'o-3', amountFils: 1000, categoryId: acc.id })).body.units, 20)
})

test('integration: rewards are redeemed by request ID, given by the other system, and can be given back', async () => {
  const { app, db, phones } = setup()
  const merchant = merchantById(db, phones.id)
  const extra = createReward(db, merchant, { name: 'Screen protector', cost: 50 })
  const api = client(app, createApiKey(db, phones, 'UniDash').key)
  await api('POST', 'members/u1/purchases', { orderId: 'o-1', amountFils: 12000, member: { name: 'Omar' } })

  const menu = (await api('GET', 'members/u1')).body.member.menu
  assert.deepEqual(menu.map((r: any) => [r.id, r.cost, r.affordable]), [[null, 100, true], [extra.id, 50, true]])

  assert.equal((await api('POST', 'members/u1/redemptions', { rewardId: extra.id })).status, 400, 'a request ID is required')
  const r = await api('POST', 'members/u1/redemptions', { rewardId: extra.id, requestId: 'v-1' })
  assert.equal(r.status, 200)
  assert.equal(r.body.reward.name, 'Screen protector')
  assert.equal(r.body.member.balance, 70)
  const replay = await api('POST', 'members/u1/redemptions', { rewardId: null, requestId: 'v-1' })
  assert.equal(replay.body.replayed, true)
  assert.equal(replay.body.reward.name, 'Screen protector', 'a retry answers with the reward first redeemed')
  assert.equal(replay.body.member.balance, 70)

  assert.equal((await api('POST', 'members/u1/redemptions', { rewardId: null, requestId: 'v-2' })).status, 409, 'not enough for the headline reward')

  const back = await api('POST', 'members/u1/redemptions/v-1/reverse')
  assert.equal(back.body.member.balance, 120)
  assert.equal(back.body.member.rewardsRedeemed, 0)
})

test('integration: deleting a member wipes them, frees the ID, and keeps the visits', async () => {
  const { app, db, cafe } = setup()
  const api = client(app, createApiKey(db, cafe, 'UniDash').key)
  const first = (await api('POST', 'members/u1/purchases', { orderId: 'o-1', member: { name: 'Omar', email: 'omar@uni.test' } })).body.member
  assert.equal((await api('DELETE', 'members/u1')).status, 200)
  assert.equal((await api('GET', 'members/u1')).status, 404)
  const row = db.prepare('SELECT member_name, member_email, external_id, deleted_at FROM cards WHERE serial = ?').get(first.serial) as any
  assert.equal(row.member_email, null)
  assert.equal(row.external_id, null)
  assert.ok(row.deleted_at)

  // They come back later: a new card.
  const again = await api('PUT', 'members/u1', { name: 'Omar' })
  assert.equal(again.status, 201)
  assert.notEqual(again.body.member.serial, first.serial)
})

test('integration: the dashboard makes and removes keys, and the report shows what each system recorded', async () => {
  const { app, db, cafe } = setup()
  const { createAdmin } = await import('../src/admin.ts')
  const { password } = await createAdmin(db, cafe, { email: 'owner@cafe.test' })
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  const { token } = (await (await post('/api/admin/login', { email: 'owner@cafe.test', password })).json()) as any
  await post('/api/admin/password', { current: password, next: 'a long new password' }, token)

  const made = (await (await post('/api/admin/systems', { label: 'UniDash' }, token)).json()) as any
  assert.ok(made.key.startsWith('lk_'))
  const state = (await (await app.request('/api/admin/state', { headers: { Authorization: `Bearer ${token}` } })).json()) as any
  assert.deepEqual(state.systems.map((s: any) => s.label), ['UniDash'])
  assert.equal(state.links.api, 'https://cards.test/api/v1')
  assert.equal(JSON.stringify(state).includes(made.key), false, 'the key is never shown again')

  const api = client(app, made.key)
  await api('POST', 'members/u1/purchases', { orderId: 'o-1', member: { name: 'Omar' } })
  await api('POST', 'members/u1/purchases', { orderId: 'o-2' })
  await api('POST', 'members/u1/purchases/o-2/reverse')
  const r = report(db, merchantById(db, cafe.id), lastDays(cafe, 7))
  assert.deepEqual(r.systems.map((s) => [s.label, s.visits, s.reversed]), [['UniDash', 1, 1]])
  assert.equal(r.unattributed_visits, 0, 'a system\'s visits are not "without a key"')

  const del = await app.request(`/api/admin/systems/${made.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(del.status, 200)
  assert.equal((await api('GET', 'program')).status, 401)
})
