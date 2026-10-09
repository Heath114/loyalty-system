import { Hono } from 'hono'
import type { Deps } from '../app.ts'
import { cardBySerial, merchantById, type Card } from '../loyalty.ts'
import { buildPass } from '../pass/build.ts'
import { safeEqual } from '../tokens.ts'

/**
 * Apple's PassKit web service, mounted at <webServiceURL> = PUBLIC_URL/wallet. Wallet calls it to
 * register a device for updates, ask which passes changed, and fetch the latest pass.
 * https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
 */
export function walletRoutes({ db, config }: Deps) {
  const app = new Hono()
  const ptid = config.pass.passTypeIdentifier

  function authorised(card: Card | undefined, header: string | undefined): card is Card {
    const token = header?.startsWith('ApplePass ') ? header.slice(10) : undefined
    return !!card && !!token && safeEqual(token, card.auth_token)
  }

  app.post('/v1/devices/:device/registrations/:ptid/:serial', async (c) => {
    const card = cardBySerial(db, c.req.param('serial'))
    if (c.req.param('ptid') !== ptid || !authorised(card, c.req.header('Authorization'))) return c.body(null, 401)
    const body = await c.req.json<{ pushToken?: string }>().catch(() => ({}) as { pushToken?: string })
    if (!body.pushToken || !/^[0-9a-fA-F]{32,200}$/.test(body.pushToken)) return c.body(null, 400)
    const device = c.req.param('device')
    const before = db.prepare('SELECT push_token FROM pass_registrations WHERE device_library_id = ? AND serial = ?').get(device, card.serial)
    db.prepare(
      `INSERT INTO pass_registrations (device_library_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (device_library_id, serial) DO UPDATE SET push_token = excluded.push_token`,
    ).run(device, card.serial, body.pushToken, Date.now())
    return c.body(null, before ? 200 : 201)
  })

  app.delete('/v1/devices/:device/registrations/:ptid/:serial', (c) => {
    const card = cardBySerial(db, c.req.param('serial'))
    if (c.req.param('ptid') !== ptid || !authorised(card, c.req.header('Authorization'))) return c.body(null, 401)
    db.prepare('DELETE FROM pass_registrations WHERE device_library_id = ? AND serial = ?').run(c.req.param('device'), card.serial)
    return c.body(null, 200)
  })

  // No Authorization header on this one, by Apple's design: the device library ID is the secret.
  app.get('/v1/devices/:device/registrations/:ptid', (c) => {
    if (c.req.param('ptid') !== ptid) return c.body(null, 404)
    const since = Number(c.req.query('passesUpdatedSince') ?? 0) || 0
    const rows = db
      .prepare(
        `SELECT c.serial, c.updated_at FROM pass_registrations r JOIN cards c ON c.serial = r.serial
         WHERE r.device_library_id = ? AND c.updated_at > ?`,
      )
      .all(c.req.param('device'), since) as { serial: string; updated_at: number }[]
    if (rows.length === 0) return c.body(null, 204)
    return c.json({
      serialNumbers: rows.map((r) => r.serial),
      lastUpdated: String(Math.max(...rows.map((r) => r.updated_at))),
    })
  })

  app.get('/v1/passes/:ptid/:serial', (c) => {
    const card = cardBySerial(db, c.req.param('serial'))
    if (c.req.param('ptid') !== ptid || !authorised(card, c.req.header('Authorization'))) return c.body(null, 401)
    const lastModified = new Date(Math.floor(card.updated_at / 1000) * 1000)
    const since = Date.parse(c.req.header('If-Modified-Since') ?? '')
    if (!Number.isNaN(since) && since >= lastModified.getTime()) return c.body(null, 304)
    const pkpass = buildPass(db, config, merchantById(db, card.merchant_id), card)
    return c.body(pkpass as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': lastModified.toUTCString(),
      'Cache-Control': 'no-store',
    })
  })

  app.post('/v1/log', async (c) => {
    const body = await c.req.json<{ logs?: string[] }>().catch(() => ({}) as { logs?: string[] })
    for (const line of body.logs ?? []) console.warn(`[wallet] ${String(line).slice(0, 500)}`)
    return c.body(null, 200)
  })

  return app
}
