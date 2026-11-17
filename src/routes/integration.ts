import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Deps } from '../app.ts'
import {
  apiKeyFor, inWallet, member, memberRefs, recordPurchase, redeemReward, reverseRedemption, reversePurchase, upsertMember, type MemberInput,
} from '../integration.ts'
import {
  categories, deleteMember, history, LoyaltyError, merchantById, rewardMenu, rewardsAvailable, runningBoosts, type Card, type Merchant,
} from '../loyalty.ts'
import { cardChanged, cardDeleted } from '../notify.ts'
import { linkToken } from '../tokens.ts'

type Env = { Variables: { merchant: Merchant; apiKeyId: number } }

/**
 * The API a connected system calls (docs/INTEGRATION.md): members by the system's own ID, purchases by
 * its order ID, rewards it gives itself. Every answer carries the member as the card shows them.
 */
export function integrationRoutes(deps: Deps) {
  const { db, config } = deps
  const app = new Hono<Env>()

  app.use('/api/v1/*', createMiddleware<Env>(async (c, next) => {
    const row = apiKeyFor(db, c.req.header('Authorization')?.replace(/^Bearer\s+/i, ''))
    if (!row) return c.json({ error: 'API key not recognised' }, 401)
    c.set('merchant', merchantById(db, row.merchant_id))
    c.set('apiKeyId', row.id)
    c.header('Cache-Control', 'no-store')
    await next()
  }))

  /** The wallets show the change without holding up the answer. */
  function pushUpdate(serial: string, rewardReady = false) {
    cardChanged(db, deps, serial, { rewardReady }).catch((e) => console.error('push failed', e))
  }

  function view(m: Merchant, card: Card) {
    const t = linkToken(config.secret, card.serial)
    const base = `${config.publicUrl}/c/${card.serial}`
    const toNext = m.reward_threshold - (card.balance % m.reward_threshold)
    return {
      ref: card.external_id,
      serial: card.serial,
      name: card.member_name,
      program: m.program,
      balance: card.balance,
      threshold: m.reward_threshold,
      rewardsAvailable: rewardsAvailable(m, card),
      /** Stamps or points still to go to the next headline reward. */
      toNextReward: toNext,
      lifetimeEarned: card.lifetime_earned,
      rewardsRedeemed: card.rewards_redeemed,
      marketingConsent: !!card.marketing_consent,
      lang: card.lang,
      /** Every reward, the headline one first (id null), with whether the member can have it now. */
      menu: rewardMenu(db, m, card),
      inWallet: inWallet(db, card),
      /**
       * card: the member's card page (balance, history, both wallet buttons). apple: the .pkpass itself,
       * for an "Add to Apple Wallet" button. google: Google's save page, null until Google Wallet is set up.
       * They carry a token: hand them to this member only.
       */
      links: { card: `${base}?t=${t}`, apple: `${base}/card.pkpass?t=${t}`, google: deps.google ? `${base}/google?t=${t}` : null },
      createdAt: card.created_at,
    }
  }

  app.get('/api/v1/program', (c) => {
    const m = c.get('merchant')
    return c.json({
      merchant: {
        slug: m.slug, name: m.name, name_ar: m.name_ar, program: m.program, threshold: m.reward_threshold, points_per_jod: m.points_per_jod,
        reward: m.reward_text, reward_ar: m.reward_text_ar, welcome_units: m.welcome_units, timezone: m.timezone,
      },
      /** Once there is one, every purchase names its category. */
      categories: categories(db, m.id).map((x) => ({
        id: x.id, name: x.name, name_ar: x.name_ar, earn: x.earn, points_per_jod: x.points_per_jod, fixed_units: x.fixed_units,
      })),
      rewards: rewardMenu(db, m).map(({ affordable: _, ...r }) => r),
      boosts: runningBoosts(db, m.id),
      google: !!deps.google,
    })
  })

  app.get('/api/v1/members', (c) => {
    const refs = memberRefs(db, c.get('merchant').id, { after: c.req.query('after'), limit: Number(c.req.query('limit')) })
    return c.json({ refs, next: refs.length ? refs[refs.length - 1] : null })
  })

  app.put('/api/v1/members/:ref', async (c) => {
    const m = c.get('merchant')
    const r = upsertMember(db, m, c.req.param('ref'), await c.req.json<MemberInput>())
    if (r.changed) pushUpdate(r.card.serial)
    return c.json({ member: view(m, r.card), created: r.created }, r.created ? 201 : 200)
  })

  app.get('/api/v1/members/:ref', (c) => {
    const m = c.get('merchant')
    const card = member(db, m, c.req.param('ref'))
    return c.json({ member: view(m, card), history: history(db, card, Math.min(Number(c.req.query('history')) || 10, 50)) })
  })

  /** The member asked to be deleted: their details go, the card is voided in their wallet. Their visits stay in the numbers. */
  app.delete('/api/v1/members/:ref', (c) => {
    const m = c.get('merchant')
    const card = deleteMember(db, m, member(db, m, c.req.param('ref')).serial)
    cardDeleted(db, deps, card).catch((e) => console.error('voiding a deleted card failed', e))
    return c.json({ ok: true })
  })

  app.post('/api/v1/members/:ref/purchases', async (c) => {
    const m = c.get('merchant')
    const body = await c.req.json<{ orderId?: string; amountFils?: number | null; categoryId?: number | null; member?: MemberInput }>()
    const r = recordPurchase(db, m, c.req.param('ref'), {
      orderId: String(body.orderId ?? ''), amountFils: body.amountFils, categoryId: body.categoryId, member: body.member,
    }, c.get('apiKeyId'))
    if (!r.replayed) pushUpdate(r.card.serial, r.rewardReady)
    return c.json({ member: view(m, r.card), units: r.units, enrolled: r.enrolled, rewardReady: r.rewardReady, replayed: r.replayed }, r.enrolled ? 201 : 200)
  })

  app.post('/api/v1/members/:ref/purchases/:orderId/reverse', (c) => {
    const m = c.get('merchant')
    const r = reversePurchase(db, m, c.req.param('ref'), c.req.param('orderId'), c.get('apiKeyId'))
    if (!r.replayed) pushUpdate(r.card.serial)
    return c.json({ member: view(m, r.card), units: r.units, replayed: r.replayed })
  })

  app.post('/api/v1/members/:ref/redemptions', async (c) => {
    const m = c.get('merchant')
    const body = await c.req.json<{ rewardId?: number | null; requestId?: string }>()
    const r = redeemReward(db, m, c.req.param('ref'), { rewardId: body.rewardId ?? null, requestId: String(body.requestId ?? '') }, c.get('apiKeyId'))
    if (!r.replayed) pushUpdate(r.card.serial)
    return c.json({ member: view(m, r.card), reward: r.reward, units: r.units, replayed: r.replayed })
  })

  app.post('/api/v1/members/:ref/redemptions/:requestId/reverse', (c) => {
    const m = c.get('merchant')
    const r = reverseRedemption(db, m, c.req.param('ref'), c.req.param('requestId'), c.get('apiKeyId'))
    if (!r.replayed) pushUpdate(r.card.serial)
    return c.json({ member: view(m, r.card), units: r.units, replayed: r.replayed })
  })

  app.all('/api/v1/*', () => {
    throw new LoyaltyError('Not found', 404)
  })

  return app
}
