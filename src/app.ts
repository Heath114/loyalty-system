import { Hono } from 'hono'
import type { Config } from './config.ts'
import type { DB } from './db.ts'
import type { Pusher } from './apns.ts'
import type { GoogleWallet } from './google.ts'
import { LoyaltyError } from './loyalty.ts'
import { adminRoutes } from './routes/admin.ts'
import { publicRoutes } from './routes/public.ts'
import { staffRoutes } from './routes/staff.ts'
import { walletRoutes } from './routes/wallet.ts'

export interface Deps {
  db: DB
  config: Config
  push: Pusher
  /** Null until Google Wallet is set up (docs/GOOGLE_SETUP.md): the card is then Apple only. */
  google: GoogleWallet | null
}

export function createApp(deps: Deps) {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof LoyaltyError) return c.json({ error: err.message }, err.status)
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400)
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })
  // No framing (the staff and dashboard pages hold keys), and card links, which carry a token, never
  // leak in a Referer to another site.
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Frame-Options', 'DENY')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'same-origin')
  })
  app.get('/health', (c) => c.json({ ok: true }))
  app.route('/wallet', walletRoutes(deps))
  app.route('/', adminRoutes(deps))
  app.route('/', staffRoutes(deps))
  app.route('/', publicRoutes(deps))
  return app
}
