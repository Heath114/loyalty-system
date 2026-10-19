import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import qrcode from 'qrcode-generator'
import type { Deps } from '../app.ts'
import {
  cardBySerial, enrol, langFrom, LoyaltyError, merchantById, merchantBySlug, parseBirthday, rewardsAvailable, type Card, type Merchant,
} from '../loyalty.ts'
import { syncGoogleClass } from '../notify.ts'
import { buildPass, formatSerial, latestMessage, merchantImage } from '../pass/build.ts'
import { solidPng } from '../pass/png.ts'
import { barcodeMessage, checkLinkToken, linkToken } from '../tokens.ts'
import { page } from './layout.ts'

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

const MONTHS = [
  'January · كانون الثاني', 'February · شباط', 'March · آذار', 'April · نيسان', 'May · أيار', 'June · حزيران',
  'July · تموز', 'August · آب', 'September · أيلول', 'October · تشرين الأول', 'November · تشرين الثاني', 'December · كانون الأول',
]

function joinForm(m: Merchant, error?: string, values: Record<string, string> = {}) {
  const option = (value: number, label: string, selected: string | undefined) =>
    html`<option value="${value}" ${String(value) === selected ? 'selected' : ''}>${label}</option>`
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
        <label for="bday">Birthday, for a birthday treat (optional) · تاريخ ميلادك لهدية في يومه (اختياري)</label>
        <div class="row">
          <select id="bday" name="bday_day" aria-label="Day">
            <option value="">Day · اليوم</option>
            ${Array.from({ length: 31 }, (_, i) => option(i + 1, String(i + 1), values.bday_day))}
          </select>
          <select name="bday_month" aria-label="Month">
            <option value="">Month · الشهر</option>
            ${MONTHS.map((label, i) => option(i + 1, label, values.bday_month))}
          </select>
        </div>
        <div class="check">
          <input id="consent" name="consent" type="checkbox" value="1" ${values.consent ? 'checked' : ''}>
          <label for="consent" style="margin:0">Send me offers and reminders on this card · أرسلوا لي العروض والتذكيرات</label>
        </div>
        <button type="submit">Get my card · احصل على بطاقتي</button>
      </form>`,
  )
}

export function publicRoutes({ db, config, google }: Deps) {
  const app = new Hono()

  function merchantOr404(slug: string): Merchant {
    const m = merchantBySlug(db, slug)
    if (!m) throw new LoyaltyError('Not found', 404)
    return m
  }

  /** The card a customer link points at, or undefined when the link's token does not match. */
  function linkedCard(serial: string, token: string | undefined): Card | undefined {
    const card = cardBySerial(db, serial)
    return card && checkLinkToken(config.secret, serial, token) ? card : undefined
  }

  app.get('/m/:slug', (c) => c.html(joinForm(merchantOr404(c.req.param('slug')))))

  /** The QR printed for the counter: it opens the join page. */
  app.get('/m/:slug/qr.svg', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    return c.body(qrSvg(`${config.publicUrl}/m/${m.slug}`), 200, { 'Content-Type': 'image/svg+xml' })
  })

  /** The square logo Google Wallet shows (Google fetches it from here). Falls back to the Apple icon, then a plain square. */
  app.get('/m/:slug/logo.png', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    let png: Uint8Array | undefined
    for (const name of ['square.png', 'icon@3x.png', 'icon@2x.png', 'icon.png']) if ((png = merchantImage(db, m.id, name))) break
    return c.body((png ?? solidPng(660, m.bg_color)) as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    })
  })

  app.post('/m/:slug/join', async (c) => {
    const m = merchantOr404(c.req.param('slug'))
    const form = await c.req.parseBody()
    const values = {
      name: String(form.name ?? ''), phone: String(form.phone ?? ''), consent: form.consent ? '1' : '',
      bday_day: String(form.bday_day ?? ''), bday_month: String(form.bday_month ?? ''),
    }
    try {
      const card = enrol(db, m, {
        name: values.name,
        phone: values.phone,
        birthday: parseBirthday(values.bday_day, values.bday_month) ?? undefined,
        marketingConsent: !!values.consent,
        lang: langFrom(c.req.header('Accept-Language')),
      })
      return c.redirect(`/c/${card.serial}?t=${linkToken(config.secret, card.serial)}`, 303)
    } catch (e) {
      if (e instanceof LoyaltyError) return c.html(joinForm(m, e.message, values), 400)
      throw e
    }
  })

  /** The customer's card on the web: the wallet buttons, and the same QR for phones without a wallet. */
  app.get('/c/:serial', (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = linkedCard(serial, t)
    if (!card) return c.text('Not found', 404)
    const m = merchantById(db, card.merchant_id)
    const ready = rewardsAvailable(m, card)
    const news = latestMessage(db, card)
    const appleButton = html`<a class="btn" href="/c/${serial}/card.pkpass?t=${t}">Add to Apple Wallet</a>`
    const googleButton = google ? html`<a class="btn" href="/c/${serial}/google?t=${t}">Add to Google Wallet</a>` : ''
    const android = /Android/i.test(c.req.header('User-Agent') ?? '')
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
          ${news ? html`<div class="card"><p class="muted">Latest · آخر الأخبار</p><p dir="auto">${news}</p></div>` : ''}
          ${android ? html`${googleButton}${appleButton}` : html`${appleButton}${googleButton}`}
          <div class="card qr">
            <p class="muted">Or show this code at the counter</p>
            ${raw(qrSvg(barcodeMessage(config.secret, serial)))}
            <p class="muted" style="text-align:center">${formatSerial(serial)}</p>
          </div>
          <p class="muted">Keep this page's link: it is your card if you do not use a wallet app.</p>`,
      ),
    )
  })

  app.get('/c/:serial/card.pkpass', (c) => {
    const serial = c.req.param('serial')
    const card = linkedCard(serial, c.req.query('t'))
    if (!card) return c.text('Not found', 404)
    // Saved from Safari on the phone itself, so this is the language its Wallet shows.
    const lang = langFrom(c.req.header('Accept-Language'))
    if (lang !== card.lang) {
      db.prepare('UPDATE cards SET lang = ? WHERE id = ?').run(lang, card.id)
      card.lang = lang
    }
    const pkpass = buildPass(db, config, merchantById(db, card.merchant_id), card)
    return c.body(pkpass as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Cache-Control': 'no-store',
    })
  })

  /** Creates the card in Google Wallet with its current balance, then hands over to Google's save page. */
  app.get('/c/:serial/google', async (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = linkedCard(serial, t)
    if (!google || !card) return c.text('Not found', 404)
    const m = merchantById(db, card.merchant_id)
    try {
      await syncGoogleClass(db, google, m)
      await google.upsertCard(m, card)
    } catch (e) {
      console.warn(`Google Wallet save for ${serial}: ${(e as Error).message}`)
      return c.html(
        page('Try again', html`
          <h1>Google Wallet is not answering</h1>
          <p>Please try again in a minute. Your card still works: <a href="/c/${serial}?t=${t}">show it at the counter</a>.</p>`),
        503,
      )
    }
    db.prepare('UPDATE cards SET google_object_at = COALESCE(google_object_at, ?) WHERE id = ?').run(Date.now(), card.id)
    return c.redirect(google.saveUrl(m, card), 302)
  })

  return app
}
