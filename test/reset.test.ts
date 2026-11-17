import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createAdmin, MAX_RESETS_PER_HOUR, requestPasswordReset, resetLoginThrottle } from '../src/admin.ts'
import type { Mail, Mailer } from '../src/mail.ts'
import { resendMailer, resetEmail } from '../src/mail.ts'
import { createApp } from '../src/app.ts'
import { setup, settle } from './helpers.ts'

beforeEach(() => resetLoginThrottle())

/** The app with a mailer that keeps what it would have sent. */
function withMail() {
  const s = setup()
  const sent: Mail[] = []
  const mail: Mailer = { send: async (m) => void sent.push(m) }
  const app = createApp({ ...s.deps, mail })
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  return { ...s, app, sent, post }
}

const tokenIn = (m: Mail) => /#reset=(rt_[A-Za-z0-9_-]+)/.exec(m.text)![1]

test('reset: a link by email sets a new password, signs in, and ends every other session', async () => {
  const { app, db, cafe, sent, post } = withMail()
  const { password } = await createAdmin(db, cafe, { email: 'owner@cafe.test' })
  const old = (await (await post('/api/admin/login', { email: 'owner@cafe.test', password })).json()) as any

  const page = await (await app.request('/admin')).text()
  assert.match(page, /data-reset="1"/)

  assert.equal((await post('/api/admin/forgot', { email: 'Owner@Cafe.test', lang: 'ar' })).status, 200)
  await settle()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'owner@cafe.test')
  assert.match(sent[0].text, /^طلب أحدهم/, 'Arabic first when asked in Arabic')
  assert.match(sent[0].text, /https:\/\/cards\.test\/admin#reset=rt_/)
  const token = tokenIn(sent[0])
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM admin_resets WHERE token_hash = ?').get(token) as { n: number }).n, 0, 'only the hash is stored')

  assert.equal((await post('/api/admin/reset', { token, password: 'short' })).status, 400)
  const r = await post('/api/admin/reset', { token, password: 'my brand new password' })
  assert.equal(r.status, 200)
  const { token: session } = (await r.json()) as any
  const state = (await (await app.request('/api/admin/state', { headers: { Authorization: `Bearer ${session}` } })).json()) as any
  assert.equal(state.admin.must_change, false, 'they chose it themselves')
  assert.equal((await app.request('/api/admin/state', { headers: { Authorization: `Bearer ${old.token}` } })).status, 401, 'the old session ended')

  assert.equal((await post('/api/admin/reset', { token, password: 'another new password' })).status, 400, 'a link works once')
  assert.equal((await post('/api/admin/login', { email: 'owner@cafe.test', password: 'my brand new password' })).status, 200)
  assert.equal((await post('/api/admin/login', { email: 'owner@cafe.test', password })).status, 401)
})

test('reset: unknown and removed emails get the same answer and no email; links expire and are capped', async () => {
  const { db, cafe, sent, post } = withMail()
  assert.equal((await post('/api/admin/forgot', { email: 'nobody@cafe.test' })).status, 200)
  assert.equal((await post('/api/admin/forgot', { email: 'not an email' })).status, 400)
  await settle()
  assert.equal(sent.length, 0)

  await createAdmin(db, cafe, { email: 'owner@cafe.test' })
  const now = Date.now()
  const first = requestPasswordReset(db, 'owner@cafe.test', now - 2 * 3_600_000)!
  // Older than an hour: expired.
  assert.equal((await post('/api/admin/reset', { token: first.token, password: 'a long new password' })).status, 400)

  for (let i = 0; i < MAX_RESETS_PER_HOUR; i++) assert.ok(requestPasswordReset(db, 'owner@cafe.test', now))
  assert.equal(requestPasswordReset(db, 'owner@cafe.test', now), null, 'at most 3 an hour')

  const a = db.prepare('SELECT id FROM admins WHERE email = ?').get('owner@cafe.test') as { id: number }
  db.prepare('UPDATE admins SET disabled_at = ? WHERE id = ?').run(now, a.id)
  db.prepare('DELETE FROM admin_resets').run()
  assert.equal(requestPasswordReset(db, 'owner@cafe.test', now), null, 'a removed sign-in gets no link')
})

test('reset: a new link ends the older one', async () => {
  const { db, cafe, post } = withMail()
  await createAdmin(db, cafe, { email: 'owner@cafe.test' })
  const one = requestPasswordReset(db, 'owner@cafe.test')!
  const two = requestPasswordReset(db, 'owner@cafe.test')!
  assert.equal((await post('/api/admin/reset', { token: one.token, password: 'a long new password' })).status, 400)
  assert.equal((await post('/api/admin/reset', { token: two.token, password: 'a long new password' })).status, 200)
})

test('reset: without email set up, the dashboard says to ask us', async () => {
  const { app } = setup()
  assert.match(await (await app.request('/admin')).text(), /data-reset="0"/)
  const r = await app.request('/api/admin/forgot', { method: 'POST', body: JSON.stringify({ email: 'owner@cafe.test' }), headers: { 'Content-Type': 'application/json' } })
  assert.equal(r.status, 404)
})

test('reset: Resend gets the email as its API expects, and a refusal is an error', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  let status = 200
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(status === 200 ? '{"id":"x"}' : '{"message":"domain not verified"}', { status })
  }) as unknown as typeof fetch
  const mailer = resendMailer({ resendApiKey: 're_test', from: 'Loyalty <cards@example.com>' }, fetchFn)
  await mailer.send(resetEmail('https://cards.test', 'owner@cafe.test', 'rt_abc', 'en'))
  assert.equal(calls[0].url, 'https://api.resend.com/emails')
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer re_test')
  const body = JSON.parse(String(calls[0].init.body))
  assert.deepEqual(body.to, ['owner@cafe.test'])
  assert.equal(body.from, 'Loyalty <cards@example.com>')
  assert.match(body.text, /^Someone asked/)
  status = 403
  await assert.rejects(mailer.send(resetEmail('https://cards.test', 'a@b.test', 'rt_abc', 'en')), /403/)
})
