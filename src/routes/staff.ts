import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { raw } from 'hono/html'
import type { Deps } from '../app.ts'
import { earn, history, LoyaltyError, merchantById, merchantCard, redeem, rewardsAvailable, type Card, type Merchant } from '../loyalty.ts'
import { cardChanged } from '../notify.ts'
import { parseBarcode, sha256 } from '../tokens.ts'
import { page } from './layout.ts'

const jsQR = readFileSync(createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js'), 'utf8')
const STAFF_JS = readFileSync(new URL('./staff.client.js', import.meta.url), 'utf8')

type Env = { Variables: { merchant: Merchant; staffId: number } }

function summary(m: Merchant, card: Card) {
  return {
    serial: card.serial,
    name: card.member_name,
    program: m.program,
    balance: card.balance,
    threshold: m.reward_threshold,
    rewardsAvailable: rewardsAvailable(m, card),
    rewardText: m.reward_text,
  }
}

/** A typed serial ("ABCD EFGH ...") or a scanned card QR, resolved to a serial. */
function resolveSerial(secret: string, input: unknown): string {
  const text = String(input ?? '').trim()
  const fromQr = parseBarcode(secret, text)
  if (fromQr) return fromQr
  const typed = text.replace(/[\s-]/g, '').toUpperCase()
  if (/^[0-9A-Z]{16}$/.test(typed)) return typed
  throw new LoyaltyError('That is not one of our cards', 404)
}

export function staffRoutes(deps: Deps) {
  const { db, config } = deps
  const app = new Hono<Env>()

  const staffAuth = createMiddleware<Env>(async (c, next) => {
    const key = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    const row = key
      ? (db.prepare('SELECT id, merchant_id FROM staff WHERE key_hash = ? AND revoked_at IS NULL').get(sha256(key)) as
          | { id: number; merchant_id: number }
          | undefined)
      : undefined
    if (!row) return c.json({ error: 'Staff key not recognised' }, 401)
    c.set('merchant', merchantById(db, row.merchant_id))
    c.set('staffId', row.id)
    await next()
  })

  /** Pushes the new balance to the customer's wallets without holding up the counter. */
  function pushUpdate(serial: string, rewardReady = false) {
    cardChanged(db, deps, serial, { rewardReady }).catch((e) => console.error('push failed', e))
  }

  app.get('/staff', (c) =>
    c.html(
      page(
        'Staff',
        raw(`
          <div id="login">
            <h1>Staff</h1>
            <p class="muted">Paste the staff key you were given. This phone remembers it.</p>
            <div class="card"><label for="key">Staff key</label><input id="key" autocomplete="off"><button id="save">Continue</button><p id="loginErr" class="err"></p></div>
          </div>
          <div id="app" hidden>
            <p class="muted" id="merchantName"></p>
            <h1>Scan a card</h1>
            <div class="card" style="padding:0;overflow:hidden"><video id="video" playsinline muted style="width:100%;display:block;background:#000;min-height:220px"></video></div>
            <label for="manual">Or type the card number</label>
            <input id="manual" placeholder="ABCD EFGH JKMN PQRS" autocapitalize="characters">
            <button id="lookup" class="btn secondary">Find card</button>
            <div id="result" class="card" hidden>
              <p class="muted" id="rName"></p>
              <p class="big" id="rBalance"></p>
              <p id="rReward"></p>
              <div id="amountRow" hidden><label for="amount">Purchase amount (JOD)</label><input id="amount" type="number" inputmode="decimal" step="0.001" min="0"></div>
              <button id="earn">Add</button>
              <button id="redeem" class="btn secondary" hidden>Redeem reward</button>
              <p id="msg"></p>
            </div>
            <button id="logout" class="btn secondary">Sign out of this phone</button>
          </div>
          <script>${jsQR}</script>
          <script>${STAFF_JS}</script>`),
      ),
    ),
  )

  app.use('/api/staff/*', staffAuth)

  app.get('/api/staff/me', (c) => {
    const m = c.get('merchant')
    return c.json({ merchant: { slug: m.slug, name: m.name, program: m.program, threshold: m.reward_threshold } })
  })

  app.post('/api/staff/lookup', async (c) => {
    const body = await c.req.json<{ code?: string }>()
    const m = c.get('merchant')
    const card = merchantCard(db, m.id, resolveSerial(config.secret, body.code))
    return c.json({ card: summary(m, card), history: history(db, card, 5) })
  })

  app.post('/api/staff/earn', async (c) => {
    const body = await c.req.json<{ serial?: string; amountFils?: number; requestId?: string }>()
    const m = c.get('merchant')
    const r = earn(db, m, String(body.serial ?? ''), {
      amountFils: body.amountFils ?? null, staffId: c.get('staffId'), idempotencyKey: body.requestId,
    })
    // A reward has just become ready when this purchase crossed a threshold.
    const t = m.reward_threshold
    if (!r.replayed) pushUpdate(r.card.serial, Math.floor(r.card.balance / t) > Math.floor((r.card.balance - r.units) / t))
    return c.json({ card: summary(m, r.card), units: r.units, replayed: r.replayed })
  })

  app.post('/api/staff/redeem', async (c) => {
    const body = await c.req.json<{ serial?: string; requestId?: string }>()
    const m = c.get('merchant')
    const r = redeem(db, m, String(body.serial ?? ''), { staffId: c.get('staffId'), idempotencyKey: body.requestId })
    if (!r.replayed) pushUpdate(r.card.serial)
    return c.json({ card: summary(m, r.card), units: r.units, replayed: r.replayed })
  })

  return app
}
