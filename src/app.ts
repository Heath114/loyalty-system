import { Hono } from 'hono'
import type { Config } from './config.ts'
import type { DB } from './db.ts'
import type { Pusher } from './apns.ts'
import { LoyaltyError } from './loyalty.ts'
import { publicRoutes } from './routes/public.ts'
import { staffRoutes } from './routes/staff.ts'
import { walletRoutes } from './routes/wallet.ts'

export interface Deps {
  db: DB
  config: Config
  push: Pusher
}

export function createApp(deps: Deps) {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof LoyaltyError) return c.json({ error: err.message }, err.status)
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400)
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })
  app.get('/health', (c) => c.json({ ok: true }))
  app.route('/wallet', walletRoutes(deps))
  app.route('/', staffRoutes(deps))
  app.route('/', publicRoutes(deps))
  return app
}
