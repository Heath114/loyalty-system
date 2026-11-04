import { Hono, type Context } from 'hono'
import { html, raw } from 'hono/html'
import qrcode from 'qrcode-generator'
import type { Deps } from '../app.ts'
import {
  cardByInvite, cardBySerial, categories, deleteMember, enrol, history, langFrom, LoyaltyError, merchantById, merchantBySlug, parseBirthday,
  rewardMenu, rewardsAvailable, runningBoosts, type Card, type HistoryRow, type Lang, type Merchant,
} from '../loyalty.ts'
import { cardDeleted, syncGoogleClass } from '../notify.ts'
import { buildPass, formatSerial, latestMessage, merchantImage } from '../pass/build.ts'
import { solidPng } from '../pass/png.ts'
import { inviteLink } from '../referrals.ts'
import { barcodeMessage, checkLinkToken, linkToken } from '../tokens.ts'
import { errorText, MONTHS, pick, privacyNotice, unitWord, w } from './customer-copy.ts'
import { page } from './layout.ts'

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

/** ?lang= when the customer switched, otherwise the phone's language. */
function pageLang(c: Context, fromForm?: string): Lang {
  const asked = fromForm ?? c.req.query('lang')
  if (asked === 'ar' || asked === 'en') return asked
  return langFrom(c.req.header('Accept-Language'))
}

/** The same page in the other language. path: where to go instead, for a page shown in answer to a form. */
function switchLink(c: Context, lang: Lang, path?: string) {
  const url = new URL(path ?? c.req.url, 'http://x')
  url.searchParams.set('lang', lang === 'ar' ? 'en' : 'ar')
  return html`<div class="langbar"><a href="${url.pathname + url.search}" hreflang="${lang === 'ar' ? 'en' : 'ar'}">${w(lang, 'switchLang')}</a></div>`
}

function balanceText(lang: Lang, m: Merchant, card: Card): string {
  if (m.program === 'stamps') return `${Math.min(card.balance, m.reward_threshold)} / ${m.reward_threshold}`
  return `${card.balance} ${w(lang, 'pointsUnit')}`
}

function dateText(lang: Lang, m: Merchant, at: number, withTime = false): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', {
    day: 'numeric', month: 'short', ...(withTime ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
    timeZone: m.timezone,
  }).format(new Date(at))
}

export function publicRoutes(deps: Deps) {
  const { db, config, google } = deps
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

  function notFound(c: Context) {
    const lang = pageLang(c)
    return c.html(page('Not found', html`<h1>${w(lang, 'notFound')}</h1>`, { lang }), 404)
  }

  function joinForm(c: Context, m: Merchant, lang: Lang, error?: string, values: Record<string, string> = {}) {
    const option = (value: number, label: string, selected: string | undefined) =>
      html`<option value="${value}" ${String(value) === selected ? 'selected' : ''}>${label}</option>`
    const reward = pick(lang, m.reward_text, m.reward_text_ar)
    const inviter = values.ref && m.referral_units > 0 ? cardByInvite(db, m.id, values.ref) : undefined
    return page(
      pick(lang, m.name, m.name_ar),
      html`
        ${switchLink(c, lang, `/m/${m.slug}${values.ref ? `?ref=${encodeURIComponent(values.ref)}` : ''}`)}
        <p class="muted">${pick(lang, m.name, m.name_ar)}</p>
        <h1>${w(lang, 'getCard')}</h1>
        <p>${m.program === 'stamps' ? w(lang, 'collectStamps', { t: m.reward_threshold, r: reward }) : w(lang, 'earnPoints', { t: m.reward_threshold, r: reward })}</p>
        ${m.welcome_units > 0 ? html`<p class="banner">${w(lang, 'welcomeGift', { n: m.welcome_units, u: unitWord(lang, m, m.welcome_units) })}</p>` : ''}
        ${inviter ? html`<p class="banner">${w(lang, 'invited', { n: m.referral_units, u: unitWord(lang, m, m.referral_units) })}</p>` : ''}
        <form class="card" method="post" action="/m/${m.slug}/join">
          <input type="hidden" name="lang" value="${lang}">
          ${values.ref ? html`<input type="hidden" name="ref" value="${values.ref}">` : ''}
          ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
          <label for="name">${w(lang, 'name')}</label>
          <input id="name" name="name" required maxlength="80" autocomplete="name" value="${values.name ?? ''}">
          <label for="phone">${w(lang, 'phone')}</label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" dir="ltr" value="${values.phone ?? ''}">
          <label for="bday">${w(lang, 'birthday')}</label>
          <div class="row">
            <select id="bday" name="bday_day" aria-label="${w(lang, 'day')}">
              <option value="">${w(lang, 'day')}</option>
              ${Array.from({ length: 31 }, (_, i) => option(i + 1, String(i + 1), values.bday_day))}
            </select>
            <select name="bday_month" aria-label="${w(lang, 'month')}">
              <option value="">${w(lang, 'month')}</option>
              ${MONTHS[lang].map((label, i) => option(i + 1, label, values.bday_month))}
            </select>
          </div>
          <div class="check">
            <input id="consent" name="consent" type="checkbox" value="1" ${values.consent ? 'checked' : ''}>
            <label for="consent" style="margin:0">${w(lang, 'consent')}</label>
          </div>
          <button type="submit">${w(lang, 'join')}</button>
          <p class="muted" style="font-size:13px">${w(lang, 'agree')} <a href="/m/${m.slug}/privacy?lang=${lang}">${w(lang, 'privacyLink')}</a>.</p>
        </form>`,
      { lang },
    )
  }

  // ?ref= is a member's invite code; it rides along in the form and is checked when the card is made.
  app.get('/m/:slug', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    return c.html(joinForm(c, m, pageLang(c), undefined, { ref: (c.req.query('ref') ?? '').slice(0, 20) }))
  })

  app.post('/m/:slug/join', async (c) => {
    const m = merchantOr404(c.req.param('slug'))
    const form = await c.req.parseBody()
    const lang = pageLang(c, String(form.lang ?? ''))
    const values = {
      name: String(form.name ?? ''), phone: String(form.phone ?? ''), consent: form.consent ? '1' : '',
      bday_day: String(form.bday_day ?? ''), bday_month: String(form.bday_month ?? ''), ref: String(form.ref ?? '').slice(0, 20),
    }
    try {
      const card = enrol(db, m, {
        name: values.name,
        phone: values.phone,
        birthday: parseBirthday(values.bday_day, values.bday_month) ?? undefined,
        marketingConsent: !!values.consent,
        // The wallet card's language is the phone's; the page's may have been switched.
        lang: langFrom(c.req.header('Accept-Language')),
        inviteCode: values.ref || undefined,
      })
      return c.redirect(`/c/${card.serial}?t=${linkToken(config.secret, card.serial)}&lang=${lang}`, 303)
    } catch (e) {
      if (e instanceof LoyaltyError) return c.html(joinForm(c, m, lang, errorText(lang, e.message), values), 400)
      throw e
    }
  })

  app.get('/m/:slug/privacy', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    const lang = pageLang(c)
    const notice = privacyNotice(lang, m)
    return c.html(page(notice.title, html`
      ${switchLink(c, lang)}
      <h1>${notice.title}</h1>
      ${notice.sections.map(([h, p]) => html`<h2 style="font-size:17px;margin:20px 0 4px">${h}</h2><p>${p}</p>`)}
      <p class="foot"><a href="/m/${m.slug}?lang=${lang}">${w(lang, 'getCard')}</a></p>`, { lang }))
  })

  /** The QR printed for the counter: it opens the join page. */
  app.get('/m/:slug/qr.svg', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    return c.body(qrSvg(`${config.publicUrl}/m/${m.slug}`), 200, { 'Content-Type': 'image/svg+xml' })
  })

  /** A page to print for the counter: the merchant's name, the reward, and the join QR, in both languages. */
  app.get('/m/:slug/poster', (c) => {
    const m = merchantOr404(c.req.param('slug'))
    const reward = m.program === 'stamps'
      ? { en: `Collect ${m.reward_threshold} stamps, get ${m.reward_text}`, ar: `اجمع ${m.reward_threshold} طوابع واحصل على ${m.reward_text_ar ?? m.reward_text}` }
      : { en: `Earn points every visit. At ${m.reward_threshold}: ${m.reward_text}`, ar: `اكسب النقاط في كل زيارة. عند ${m.reward_threshold} نقطة: ${m.reward_text_ar ?? m.reward_text}` }
    return c.html(html`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.name} · QR</title>
<style>
@page{size:A5;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#111;font:16px/1.4 -apple-system,system-ui,Tahoma,"Segoe UI",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:148mm;min-height:210mm;margin:0 auto;display:flex;flex-direction:column;text-align:center}
.band{background:${m.bg_color};color:${m.fg_color};padding:12mm 10mm 9mm}
.band h1{margin:0;font-size:28px;line-height:1.2}
.band p{margin:4px 0 0;opacity:.85}
.body{flex:1;padding:8mm 12mm;display:flex;flex-direction:column;align-items:center;gap:5mm}
.ar{font-size:24px;font-weight:700;margin:0}
.en{font-size:18px;font-weight:600;margin:0;direction:ltr}
.qr{width:88mm;max-width:100%}
.qr svg{width:100%;height:auto;display:block}
.reward{font-size:15px;margin:0}
.foot{font-size:12px;color:#555;padding:0 12mm 9mm}
.print{position:fixed;inset-inline-start:12px;top:12px;font:600 14px system-ui;padding:10px 14px;border-radius:10px;border:0;background:#111;color:#fff;cursor:pointer}
@media print{.print{display:none}}
</style>
</head>
<body>
<button class="print" onclick="window.print()">Print · طباعة</button>
<div class="sheet">
  <div class="band"><h1>${m.name_ar ?? m.name}</h1>${m.name_ar ? html`<p dir="ltr">${m.name}</p>` : ''}</div>
  <div class="body">
    <p class="ar">امسح الرمز واحصل على بطاقة الولاء</p>
    <p class="en">Scan to get your loyalty card</p>
    <div class="qr">${raw(qrSvg(`${config.publicUrl}/m/${m.slug}`))}</div>
    <p class="reward">${reward.ar}</p>
    <p class="reward" dir="ltr">${reward.en}</p>
  </div>
  <div class="foot">
    <p>لا حاجة إلى تطبيق: تُحفظ البطاقة في Apple Wallet أو Google Wallet.</p>
    <p dir="ltr">No app needed: the card goes in Apple Wallet or Google Wallet.</p>
  </div>
</div>
</body>
</html>`)
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

  function historyLine(lang: Lang, m: Merchant, h: HistoryRow): { what: string; units: number; at: number; undone: boolean } | null {
    const undone = h.voided_at != null
    switch (h.kind) {
      case 'earn': return { what: h.category ? pick(lang, h.category, h.category_ar) : w(lang, 'hVisit'), units: h.units, at: h.created_at, undone }
      case 'redeem': return { what: `${w(lang, 'hReward')}: ${h.reward ? pick(lang, h.reward, h.reward_ar) : pick(lang, m.reward_text, m.reward_text_ar)}`, units: h.units, at: h.created_at, undone }
      case 'bonus': return { what: h.note === 'referral' ? w(lang, 'hReferral') : w(lang, 'hWelcome'), units: h.units, at: h.created_at, undone }
      // The merchant's reason is for the merchant; the customer sees that the shop corrected it.
      case 'adjust': return { what: w(lang, 'hAdjust'), units: h.units, at: h.created_at, undone }
      default: return null
    }
  }

  /** The customer's card on the web: wallet buttons, the counter QR, rewards, friends, history, and their own controls. */
  app.get('/c/:serial', (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = linkedCard(serial, t)
    if (!card) return notFound(c)
    const lang = pageLang(c)
    const q = `t=${t}&lang=${lang}`
    const m = merchantById(db, card.merchant_id)
    const ready = rewardsAvailable(m, card)
    const reward = pick(lang, m.reward_text, m.reward_text_ar)
    const news = latestMessage(db, card)
    const left = m.reward_threshold - (card.balance % m.reward_threshold)
    const menu = rewardMenu(db, m, card)
    const cats = categories(db, m.id)
    const boostLines = runningBoosts(db, m.id).map((b) => {
      const cat = b.category_id ? cats.find((x) => x.id === b.category_id) : undefined
      const vars = { l: pick(lang, b.label, b.label_ar), x: b.multiplier, until: dateText(lang, m, b.ends_at, true) }
      return cat ? w(lang, 'boostCategory', { ...vars, c: pick(lang, cat.name, cat.name_ar) }) : w(lang, 'boostNow', vars)
    })
    const lines = history(db, card, 15).map((h) => historyLine(lang, m, h)).filter((x) => x !== null)
    const appleButton = html`<a class="btn" href="/c/${serial}/card.pkpass?t=${t}">${w(lang, 'addApple')}</a>`
    const googleButton = google ? html`<a class="btn" href="/c/${serial}/google?t=${t}">${w(lang, 'addGoogle')}</a>` : ''
    const android = /Android/i.test(c.req.header('User-Agent') ?? '')
    const link = m.referral_units > 0 ? inviteLink(config.publicUrl, m, db, card) : null
    return c.html(
      page(
        pick(lang, m.name, m.name_ar),
        html`
          ${switchLink(c, lang)}
          <p class="muted">${pick(lang, m.name, m.name_ar)}</p>
          <h1>${w(lang, 'hi', { name: card.member_name })}</h1>
          ${boostLines.map((b) => html`<p class="banner">${b}</p>`)}
          <div class="card">
            <p class="muted">${m.program === 'stamps' ? w(lang, 'stamps') : w(lang, 'points')}</p>
            <p class="big" dir="ltr" style="text-align:start">${m.program === 'stamps' ? `${Math.min(card.balance, m.reward_threshold)} / ${m.reward_threshold}` : card.balance}</p>
            <p>${ready > 0
              ? html`<span class="ok">${w(lang, 'rewardReady', { r: reward })}</span>`
              : html`${w(lang, 'rewardLine', { r: reward })} · <span class="muted">${w(lang, 'toGo', { n: left, u: unitWord(lang, m, left) })}</span>`}</p>
          </div>
          ${news ? html`<div class="card"><p class="muted">${w(lang, 'latest')}</p><p dir="auto">${news}</p></div>` : ''}
          ${android ? html`${googleButton}${appleButton}` : html`${appleButton}${googleButton}`}
          <div class="card qr">
            <p class="muted">${w(lang, 'showCode')}</p>
            ${raw(qrSvg(barcodeMessage(config.secret, serial)))}
            <p class="muted" style="text-align:center" dir="ltr">${formatSerial(serial)}</p>
          </div>
          ${menu.length > 1 ? html`<div class="card"><h2 style="font-size:17px;margin:0">${w(lang, 'moreRewards')}</h2><ul class="list">
            ${menu.map((r) => html`<li><span>${pick(lang, r.name, r.name_ar)}${r.affordable ? html` <span class="ok">· ${w(lang, 'canHave')}</span>` : ''}</span>
              <span class="muted" style="white-space:nowrap">${r.cost} ${unitWord(lang, m, r.cost)}</span></li>`)}
          </ul></div>` : ''}
          ${link ? html`<div class="card"><h2 style="font-size:17px;margin:0">${w(lang, 'invite')}</h2>
            <p>${w(lang, 'inviteText', { n: m.referral_units, u: unitWord(lang, m, m.referral_units) })}</p>
            <div class="linkbox">${link}</div>
            <button type="button" id="share" data-url="${link}" data-done="${w(lang, 'copied')}">${w(lang, 'share')}</button>
            <script>document.getElementById('share').onclick=function(){var b=this,u=b.dataset.url;if(navigator.share){navigator.share({url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){b.textContent=b.dataset.done})}}</script>
          </div>` : ''}
          ${lines.length ? html`<div class="card"><h2 style="font-size:17px;margin:0 0 4px">${w(lang, 'history')}</h2><table>
            ${lines.map((l) => html`<tr${l.undone ? raw(' class="muted"') : ''}><td>${l.what}${l.undone ? html` (${w(lang, 'hUndone')})` : ''}<br><span class="muted" style="font-size:13px">${dateText(lang, m, l.at)}</span></td>
              <td class="num" dir="ltr">${l.undone ? html`<s>${l.units > 0 ? '+' : ''}${l.units}</s>` : `${l.units > 0 ? '+' : ''}${l.units}`}</td></tr>`)}
          </table></div>` : ''}
          <div class="card">
            <h2 style="font-size:17px;margin:0">${w(lang, 'offersTitle')}</h2>
            <p>${card.marketing_consent ? w(lang, 'offersOn') : w(lang, 'offersOff')}</p>
            <form method="post" action="/c/${serial}/offers?${q}">
              <input type="hidden" name="on" value="${card.marketing_consent ? '0' : '1'}">
              <button type="submit" class="btn secondary">${card.marketing_consent ? w(lang, 'turnOff') : w(lang, 'turnOn')}</button>
            </form>
          </div>
          <p class="muted">${w(lang, 'keepLink')}</p>
          <p class="foot"><a href="/m/${m.slug}/privacy?lang=${lang}">${w(lang, 'privacy')}</a><a href="/c/${serial}/delete?${q}">${w(lang, 'deleteMine')}</a></p>`,
        { lang },
      ),
    )
  })

  /** The customer switches offers and reminders on or off themselves. */
  app.post('/c/:serial/offers', async (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = linkedCard(serial, t)
    if (!card) return notFound(c)
    const form = await c.req.parseBody()
    db.prepare('UPDATE cards SET marketing_consent = ? WHERE id = ?').run(form.on === '1' ? 1 : 0, card.id)
    return c.redirect(`/c/${serial}?t=${t}&lang=${pageLang(c)}`, 303)
  })

  app.get('/c/:serial/delete', (c) => {
    const serial = c.req.param('serial')
    const t = c.req.query('t')
    const card = linkedCard(serial, t)
    if (!card) return notFound(c)
    const lang = pageLang(c)
    const m = merchantById(db, card.merchant_id)
    return c.html(page(w(lang, 'deleteTitle'), html`
      <h1>${w(lang, 'deleteTitle')}</h1>
      <p>${w(lang, 'deleteText', { b: balanceText(lang, m, card) })}</p>
      <form method="post" action="/c/${serial}/delete?t=${t}&lang=${lang}"><button type="submit" class="btn danger">${w(lang, 'deleteConfirm')}</button></form>
      <a class="btn secondary" href="/c/${serial}?t=${t}&lang=${lang}">${w(lang, 'keep')}</a>`, { lang }))
  })

  /** The customer deletes their own card (Jordan PDPL): details wiped, card voided in their wallet. */
  app.post('/c/:serial/delete', async (c) => {
    const serial = c.req.param('serial')
    const card = linkedCard(serial, c.req.query('t'))
    if (!card) return notFound(c)
    const lang = pageLang(c)
    const gone = deleteMember(db, merchantById(db, card.merchant_id), serial)
    cardDeleted(db, deps, gone).catch((e) => console.error('voiding a deleted card failed', e))
    return c.html(page(w(lang, 'deletedTitle'), html`<h1>${w(lang, 'deletedTitle')}</h1><p>${w(lang, 'deletedText')}</p>`, { lang }))
  })

  app.get('/c/:serial/card.pkpass', (c) => {
    const serial = c.req.param('serial')
    const card = linkedCard(serial, c.req.query('t'))
    if (!card) return notFound(c)
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
    if (!google || !card) return notFound(c)
    const m = merchantById(db, card.merchant_id)
    const lang = pageLang(c)
    try {
      await syncGoogleClass(db, google, m)
      await google.upsertCard(m, card)
    } catch (e) {
      console.warn(`Google Wallet save for ${serial}: ${(e as Error).message}`)
      return c.html(
        page(w(lang, 'tryAgain'), html`
          <h1>${w(lang, 'googleDown')}</h1>
          <p>${w(lang, 'googleDownText')} <a href="/c/${serial}?t=${t}">${w(lang, 'showAtCounter')}</a>.</p>`, { lang }),
        503,
      )
    }
    db.prepare('UPDATE cards SET google_object_at = COALESCE(google_object_at, ?) WHERE id = ?').run(Date.now(), card.id)
    return c.redirect(google.saveUrl(m, card), 302)
  })

  return app
}
