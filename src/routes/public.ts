import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import qrcode from 'qrcode-generator'
import type { Deps } from '../app.ts'
import { cardBySerial, enrol, LoyaltyError, merchantById, merchantBySlug, rewardsAvailable, type Merchant } from '../loyalty.ts'
import { buildPass, formatSerial } from '../pass/build.ts'
import { barcodeMessage, checkLinkToken, linkToken } from '../tokens.ts'
import { page } from './layout.ts'

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

function joinForm(m: Merchant, error?: string, values: Record<string, string> = {}) {
  return page(
    `Join ${m.name}`,
    html`
      <p class="muted">${m.name}${m.name_ar ? html` · <span dir="rtl">${m.name_ar}</span>` : ''}</p>
      <h1>Get your loyalty card</h1>
      <p>${m.program === 'stamps'
        ? `Collect ${m.reward_threshold} stamps and get: ${m.reward_text}.`
        : `Earn points every time you pay. At ${m.reward_threshold} points you get: ${m.reward_text}.`}
      </p>
      ${m.reward_text_ar ? html`<p dir="rtl" class="muted">${m.reward_text_ar}</p>` : ''}
      <form class="card" method="post" action="/m/${m.slug}/join">
        ${error ? html`<p class="err">${error}</p>` : ''}
        <label for="name">Your name · الاسم</label>
        <input id="name" name="name" required maxlength="80" autocomplete="name" value="${values.name ?? ''}">
        <label for="phone">Mobile (optional) · رقم الهاتف</label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${values.phone ?? ''}">
        <div class="check">
          <input id="consent" name="consent" type="checkbox" value="1" ${values.consent ? 'checked' : ''}>
          <label for="consent" style="margin:0">Send me offers and reminders on this card · أرسلوا لي العروض والتذكيرات</label>
        </div>
        <button type="submit">Get my card · احصل على بطاقتي</button>
      </form>`,
  )
}

export function publicRoutes({ db, config }: Deps) {
  const app = new Hono()

  function merchantOr404(slug: string): Merchant {
    const m = merchantBySlug(db, slug)
    if (!m) throw new LoyaltyError('Not found', 404)
    return m
  }

  app.get('/m/:slug', (c) => c.html(joinForm(merchantOr404(c.req.param('slug')))))

  /** The QR printed for the counter: it opens the join page. */
  app.get('/m/:slug/qr.svg', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    return c.body(qrSvg(`${config.publicUrl}/m/${m.slug}`), 200, { 'Content-Type': 'image/svg+xml' })
  })

  app.post('/m/:slug/join', async (c) => {
    const m = merchantOr404(c.req.param('slug'))
    const form = await c.req.parseBody()
    const values = { name: String(form.name ?? ''), phone: String(form.phone ?? ''), consent: form.consent ? '1' : '' }
    try {
      const card = enrol(db, m, { name: values.name, phone: values.phone, marketingConsent: !!values.consent })
      return c.redirect(`/c/${card.serial}?t=${linkToken(config.secret, card.serial)}`, 303)
    } catch (e) {
      if (e instanceof LoyaltyError) return c.html(joinForm(m, e.message, values), 400)
      throw e
    }
  })

  /** The customer's card on the web: the Wallet button, and the same QR for phones without Wallet. */
  app.get('/c/:serial', (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = cardBySerial(db, serial)
    if (!card || !checkLinkToken(config.secret, serial, t)) return c.text('Not found', 404)
    const m = merchantById(db, card.merchant_id)
    const ready = rewardsAvailable(m, card)
    return c.html(
      page(
        `${m.name} card`,
        html`
          <p class="muted">${m.name}</p>
          <h1>Hi ${card.member_name}</h1>
          <div class="card">
            <p class="muted">${m.program === 'stamps' ? 'Stamps' : 'Points'}</p>
            <p class="big">${m.program === 'stamps' ? `${Math.min(card.balance, m.reward_threshold)} / ${m.reward_threshold}` : card.balance}</p>
            <p>${ready > 0 ? html`<span class="ok">Your reward is ready: ${m.reward_text}</span>` : `Reward: ${m.reward_text}`}</p>
          </div>
          <a class="btn" href="/c/${serial}/card.pkpass?t=${t}">Add to Apple Wallet</a>
          <div class="card qr">
            <p class="muted">Or show this code at the counter</p>
            ${raw(qrSvg(barcodeMessage(config.secret, serial)))}
            <p class="muted" style="text-align:center">${formatSerial(serial)}</p>
          </div>
          <p class="muted">Keep this page's link: it is your card if you do not use Apple Wallet.</p>`,
      ),
    )
  })

  app.get('/c/:serial/card.pkpass', (c) => {
    const serial = c.req.param('serial')
    const card = cardBySerial(db, serial)
    if (!card || !checkLinkToken(config.secret, serial, c.req.query('t'))) return c.text('Not found', 404)
    const pkpass = buildPass(db, config, merchantById(db, card.merchant_id), card)
    return c.body(pkpass as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Cache-Control': 'no-store',
    })
  })

  return app
}
