import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import type { Deps } from '../app.ts'
import {
  admins, changePassword, createAdmin, createStaffKey, disableAdmin, imageSlots, IMAGE_SLOTS, login, logout, MAX_IMAGE_BYTES,
  MIN_PASSWORD, parseLatLng, removeImage, revokeStaff, sessionAdmin, setImage, staffList, updateMerchant, type Admin,
} from '../admin.ts'
import {
  addLocation, adjust, archiveCategory, archiveReward, boosts, cancelBoost, categories, createBoost, createCategory, createReward,
  crossedReward, deleteMember, locations,
  LoyaltyError, MAX_CATEGORIES, MAX_LOCATIONS, MAX_REWARDS, merchantById, removeLocation, rewards, updateCategory, updateReward,
  type Merchant,
} from '../loyalty.ts'
import {
  campaigns, cancelCampaign, createCampaign, createReminder, localToEpoch, MAX_PER_30_DAYS, MAX_PER_DAY, MAX_REMINDERS, MAX_TEXT,
  reminders, removeReminder, SEND_HOURS, setTrigger, triggers, updateReminder, type TriggerKind,
} from '../messages.ts'
import { cardChanged, cardDeleted } from '../notify.ts'
import { merchantImage } from '../pass/build.ts'
import { checkDays, lastDays, member, members, membersCsv, report } from '../reports.ts'

const ADMIN_JS = readFileSync(new URL('./admin.client.js', import.meta.url), 'utf8')
const ADMIN_CSS = readFileSync(new URL('./admin.css', import.meta.url), 'utf8')

type Env = { Variables: { admin: Admin; merchant: Merchant; token: string } }

/** While an admin still has the password we made for them, only these work: set your own first. */
const BEFORE_PASSWORD = new Set(['/api/admin/state', '/api/admin/password', '/api/admin/logout'])

const num = (v: unknown) => (v === '' || v == null ? NaN : Number(v))

export function adminRoutes(deps: Deps) {
  const { db, config } = deps
  const app = new Hono<Env>()

  app.get('/admin', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Loyalty dashboard</title>
<style>${ADMIN_CSS}</style>
</head>
<body>
<div id="root"><p class="boot">Loading…</p></div>
<script>${ADMIN_JS}</script>
</body>
</html>`)
  })

  app.post('/api/admin/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>()
    const s = await login(db, body.email, body.password)
    return c.json({ token: s.token, must_change: !!s.admin.must_change })
  })

  const auth = createMiddleware<Env>(async (c, next) => {
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const admin = sessionAdmin(db, token)
    if (!admin) return c.json({ error: 'Please sign in again' }, 401)
    if (admin.must_change && !BEFORE_PASSWORD.has(c.req.path)) return c.json({ error: 'Set your own password first' }, 403)
    c.set('admin', admin)
    c.set('token', token)
    c.set('merchant', merchantById(db, admin.merchant_id))
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.use('/api/admin/*', async (c, next) => (c.req.path === '/api/admin/login' ? next() : auth(c, next)))

  app.post('/api/admin/logout', (c) => {
    logout(db, c.get('token'))
    return c.json({ ok: true })
  })

  app.post('/api/admin/password', async (c) => {
    const body = await c.req.json<{ current?: string; next?: string }>()
    await changePassword(db, c.get('admin'), c.get('token'), body.current, body.next)
    return c.json({ ok: true })
  })

  /** Everything the settings screens show, in one call. The client fetches it again after each change. */
  app.get('/api/admin/state', (c) => {
    const a = c.get('admin')
    const m = c.get('merchant')
    const base = config.publicUrl
    return c.json({
      admin: { id: a.id, email: a.email, name: a.name, must_change: !!a.must_change },
      merchant: {
        slug: m.slug, name: m.name, name_ar: m.name_ar, program: m.program, reward_threshold: m.reward_threshold,
        points_per_jod: m.points_per_jod, reward_text: m.reward_text, reward_text_ar: m.reward_text_ar, bg_color: m.bg_color,
        fg_color: m.fg_color, label_color: m.label_color, timezone: m.timezone, welcome_units: m.welcome_units, referral_units: m.referral_units,
        contact_phone: m.contact_phone, contact_email: m.contact_email, contact_address: m.contact_address,
        has_purchases: !!db.prepare('SELECT 1 FROM ledger WHERE merchant_id = ? LIMIT 1').get(m.id),
      },
      links: {
        join: `${base}/m/${m.slug}`, qr: `${base}/m/${m.slug}/qr.svg`, poster: `${base}/m/${m.slug}/poster`, staff: `${base}/staff`,
        privacy: `${base}/m/${m.slug}/privacy`,
      },
      google: !!deps.google,
      images: imageSlots(db, m),
      categories: categories(db, m.id),
      rewards: rewards(db, m.id),
      boosts: boosts(db, m.id),
      reminders: reminders(db, m.id),
      triggers: triggers(db, m.id),
      campaigns: campaigns(db, m.id).slice(0, 50),
      locations: locations(db, m.id),
      staff: staffList(db, m.id),
      admins: admins(db, m.id),
      limits: {
        text: MAX_TEXT, per_day: MAX_PER_DAY, per_30_days: MAX_PER_30_DAYS, hours: SEND_HOURS, locations: MAX_LOCATIONS,
        categories: MAX_CATEGORIES, reminders: MAX_REMINDERS, rewards: MAX_REWARDS, password: MIN_PASSWORD, image_bytes: MAX_IMAGE_BYTES,
      },
    })
  })

  app.put('/api/admin/merchant', async (c) => {
    const m = updateMerchant(db, c.get('merchant'), await c.req.json())
    return c.json({ ok: true, slug: m.slug })
  })

  // Images: the raw PNG as the body.
  app.post('/api/admin/images/:slot', bodyLimit({ maxSize: MAX_IMAGE_BYTES + 1024, onError: (c) => c.json({ error: 'Keep the image under 300 KB' }, 413) }), async (c) => {
    const size = setImage(db, c.get('merchant'), c.req.param('slot'), new Uint8Array(await c.req.arrayBuffer()))
    return c.json({ ok: true, ...size })
  })
  app.get('/api/admin/images/:slot', (c) => {
    const spec = IMAGE_SLOTS[c.req.param('slot') as keyof typeof IMAGE_SLOTS]
    const png = spec && merchantImage(db, c.get('merchant').id, spec.file)
    if (!png) return c.json({ error: 'No image' }, 404)
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'image/png' })
  })
  app.delete('/api/admin/images/:slot', (c) => {
    removeImage(db, c.get('merchant'), c.req.param('slot'))
    return c.json({ ok: true })
  })

  app.post('/api/admin/categories', async (c) => c.json({ ok: true, category: createCategory(db, c.get('merchant'), await c.req.json()) }))
  app.put('/api/admin/categories/:id', async (c) =>
    c.json({ ok: true, category: updateCategory(db, c.get('merchant'), num(c.req.param('id')), await c.req.json()) }),
  )
  app.delete('/api/admin/categories/:id', (c) => {
    archiveCategory(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/api/admin/rewards', async (c) => c.json({ ok: true, reward: createReward(db, c.get('merchant'), await c.req.json()) }))
  app.put('/api/admin/rewards/:id', async (c) =>
    c.json({ ok: true, reward: updateReward(db, c.get('merchant'), num(c.req.param('id')), await c.req.json()) }),
  )
  app.delete('/api/admin/rewards/:id', (c) => {
    archiveReward(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  /** A bonus period, from and to "2026-11-07 00:00" in the merchant's time zone. */
  app.post('/api/admin/boosts', async (c) => {
    const body = await c.req.json<{ label?: string; label_ar?: string; multiplier?: number; category_id?: number | null; starts?: string; ends?: string }>()
    const m = c.get('merchant')
    const boost = createBoost(db, m, {
      label: String(body.label ?? ''), label_ar: body.label_ar, multiplier: Number(body.multiplier), category_id: body.category_id ?? null,
      starts_at: body.starts ? localToEpoch(m.timezone, String(body.starts)) : Date.now(),
      ends_at: localToEpoch(m.timezone, String(body.ends ?? '')),
    })
    return c.json({ ok: true, boost })
  })
  app.delete('/api/admin/boosts/:id', (c) => {
    cancelBoost(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.put('/api/admin/triggers/:kind', async (c) => {
    const body = await c.req.json<{ text?: string; text_ar?: string; days?: number; enabled?: boolean }>()
    const t = setTrigger(db, c.get('merchant'), {
      kind: c.req.param('kind') as TriggerKind, text: String(body.text ?? ''), text_ar: body.text_ar, days: body.days, enabled: body.enabled !== false,
    })
    return c.json({ ok: true, trigger: t })
  })

  app.post('/api/admin/reminders', async (c) => c.json({ ok: true, reminder: createReminder(db, c.get('merchant'), await c.req.json()) }))
  app.put('/api/admin/reminders/:id', async (c) =>
    c.json({ ok: true, reminder: updateReminder(db, c.get('merchant'), num(c.req.param('id')), await c.req.json()) }),
  )
  app.delete('/api/admin/reminders/:id', (c) => {
    removeReminder(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  /** A promotion now, or at "2026-11-05 10:00" in the merchant's time zone. */
  app.post('/api/admin/campaigns', async (c) => {
    const body = await c.req.json<{ text?: string; text_ar?: string; at?: string | null }>()
    const m = c.get('merchant')
    const sendAt = body.at ? localToEpoch(m.timezone, String(body.at)) : undefined
    return c.json({ ok: true, campaign: createCampaign(db, m, { text: String(body.text ?? ''), text_ar: body.text_ar, sendAt }) })
  })
  app.delete('/api/admin/campaigns/:id', (c) => {
    cancelCampaign(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/api/admin/locations', async (c) => {
    const body = await c.req.json<{ label?: string; where?: string; text?: string; text_ar?: string }>()
    const at = parseLatLng(String(body.where ?? ''))
    const l = addLocation(db, c.get('merchant'), { label: String(body.label ?? ''), ...at, text: body.text, text_ar: body.text_ar })
    return c.json({ ok: true, location: l })
  })
  app.delete('/api/admin/locations/:id', (c) => {
    removeLocation(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/api/admin/staff', async (c) => {
    const body = await c.req.json<{ label?: string }>()
    return c.json({ ok: true, ...createStaffKey(db, c.get('merchant'), body.label) })
  })
  app.delete('/api/admin/staff/:id', (c) => {
    revokeStaff(db, c.get('merchant'), num(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/api/admin/admins', async (c) => {
    const body = await c.req.json<{ email?: string; name?: string }>()
    const r = await createAdmin(db, c.get('merchant'), { email: String(body.email ?? ''), name: body.name })
    return c.json({ ok: true, email: r.admin.email, password: r.password })
  })
  app.delete('/api/admin/admins/:id', (c) => {
    disableAdmin(db, c.get('merchant'), num(c.req.param('id')), c.get('admin'))
    return c.json({ ok: true })
  })

  app.get('/api/admin/report', (c) => {
    const m = c.get('merchant')
    return c.json(report(db, m, lastDays(m, checkDays(c.req.query('days')))))
  })

  app.get('/api/admin/members', (c) =>
    c.json(members(db, c.get('merchant'), { q: c.req.query('q'), limit: Number(c.req.query('limit')) || 50, offset: Number(c.req.query('offset')) || 0 })),
  )
  app.get('/api/admin/members.csv', (c) => {
    const m = c.get('merchant')
    return c.body(membersCsv(db, m), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${m.slug}-members.csv"`,
    })
  })
  app.get('/api/admin/members/:serial', (c) => c.json(member(db, c.get('merchant'), c.req.param('serial'))))
  /** Stamps or points added or taken away by hand, with the reason. The card updates in the wallet. */
  app.post('/api/admin/members/:serial/adjust', async (c) => {
    const body = await c.req.json<{ units?: number; note?: string }>()
    const m = c.get('merchant')
    const serial = c.req.param('serial').replace(/[\s-]/g, '').toUpperCase()
    const r = adjust(db, m, serial, { units: Number(body.units), note: String(body.note ?? ''), adminId: c.get('admin').id })
    cardChanged(db, deps, r.card.serial, { rewardReady: crossedReward(m, r.card.balance, r.units) }).catch((e) => console.error('push failed', e))
    return c.json({ ok: true, balance: r.card.balance })
  })
  /** A member asked to be deleted. The card is voided in their wallet, without holding up the answer. */
  app.delete('/api/admin/members/:serial', (c) => {
    const serial = c.req.param('serial').replace(/[\s-]/g, '').toUpperCase()
    const card = deleteMember(db, c.get('merchant'), serial)
    cardDeleted(db, deps, card).catch((e) => console.error('voiding a deleted card failed', e))
    return c.json({ ok: true })
  })

  app.all('/api/admin/*', () => {
    throw new LoyaltyError('Not found', 404)
  })

  return app
}
