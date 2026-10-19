/**
 * Merchant setup from the command line, until there is a dashboard.
 *
 *   npm run merchant -- create --slug phone-store --name "Phone Store" --program points \
 *       --threshold 500 --points-per-jod 10 --reward "Free screen protector" [--name-ar ...] [--reward-ar ...] \
 *       [--bg "rgb(10,40,80)"] [--fg "rgb(255,255,255)"] [--label "rgb(170,190,220)"]
 *   npm run merchant -- staff-key --slug phone-store --label "Counter 1"
 *   npm run merchant -- image --slug phone-store --name logo@2x.png --file ./logo@2x.png
 *   npm run merchant -- list
 *   npm run merchant -- show --slug phone-store
 *
 * Messages ({name} becomes the member's first name; the server sends them, 10:00 to 21:00 local time):
 *   npm run merchant -- trigger --slug cafe --kind birthday --text "Happy birthday {name}! Your coffee is on us today." \
 *       [--text-ar "..."] [--off]
 *   npm run merchant -- trigger --slug cafe --kind winback --days 30 --text "We miss you, {name}. 20% off this week." [--text-ar ...]
 *   npm run merchant -- promo --slug cafe --text "Two for one on Friday" [--text-ar ...] [--at "2026-10-23 10:00"]
 *   npm run merchant -- promo-cancel --slug cafe --id 4
 *
 * Branches (the card shows up on the lock screen nearby):
 *   npm run merchant -- location --slug cafe --label "Abdoun" --lat 31.9539 --lng 35.8836 [--text "..."] [--text-ar "..."]
 *   npm run merchant -- location-remove --slug cafe --id 2
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { openDb } from '../src/db.ts'
import { addLocation, createMerchant, locations, merchantBySlug, removeLocation, touchMerchant } from '../src/loyalty.ts'
import { campaigns, cancelCampaign, createCampaign, localToEpoch, setTrigger, triggers, type TriggerKind } from '../src/messages.ts'
import { isPng, parseColor } from '../src/pass/png.ts'
import { newStaffKey, sha256 } from '../src/tokens.ts'

// square.png: the Google Wallet logo, at least 660×660.
const IMAGE_NAMES = /^((icon|logo|strip|thumbnail)(@[23]x)?|square)\.png$/

const STRING_OPTIONS = [
  'slug', 'name', 'name-ar', 'program', 'threshold', 'points-per-jod', 'reward', 'reward-ar', 'bg', 'fg', 'label', 'file',
  'kind', 'text', 'text-ar', 'days', 'at', 'id', 'lat', 'lng',
] as const
const [command, ...rest] = process.argv.slice(2)
const { values: a } = parseArgs({
  args: rest,
  options: {
    ...(Object.fromEntries(STRING_OPTIONS.map((k) => [k, { type: 'string' }])) as Record<(typeof STRING_OPTIONS)[number], { type: 'string' }>),
    off: { type: 'boolean' },
  },
})
const db = openDb(process.env.DB_PATH ?? 'data/loyalty.db')

function merchant() {
  const m = merchantBySlug(db, a.slug ?? '')
  if (!m) throw new Error(`No merchant with slug ${a.slug}`)
  return m
}

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

switch (command) {
  case 'create': {
    for (const c of [a.bg, a.fg, a.label]) if (c) parseColor(c)
    const m = createMerchant(db, {
      slug: a.slug!, name: a.name!, name_ar: a['name-ar'], program: a.program as 'stamps' | 'points',
      reward_threshold: Number(a.threshold), points_per_jod: a['points-per-jod'] ? Number(a['points-per-jod']) : undefined,
      reward_text: a.reward!, reward_text_ar: a['reward-ar'], bg_color: a.bg, fg_color: a.fg, label_color: a.label,
    })
    console.log(`Created ${m.name}. Join page: /m/${m.slug}  Counter QR: /m/${m.slug}/qr.svg`)
    break
  }
  case 'staff-key': {
    const m = merchant()
    const key = newStaffKey()
    db.prepare('INSERT INTO staff (merchant_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)').run(m.id, a.label ?? 'Staff', sha256(key), Date.now())
    console.log(`Staff key for ${m.name} (${a.label ?? 'Staff'}). Shown once, store it now:\n${key}`)
    break
  }
  case 'image': {
    const m = merchant()
    if (!IMAGE_NAMES.test(a.name ?? '')) throw new Error('Name must be icon, logo, strip or thumbnail, optionally @2x/@3x, or square, .png')
    const png = readFileSync(a.file!)
    if (!isPng(png)) throw new Error(`${a.file} is not a PNG`)
    db.prepare('INSERT INTO merchant_images (merchant_id, name, png) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET png = excluded.png').run(m.id, a.name!, png)
    touchMerchant(db, m.id)
    console.log(`Saved ${a.name} for ${m.name}. Cards already in wallets refresh within a few minutes.`)
    break
  }
  case 'list': {
    for (const m of db.prepare('SELECT slug, name, program, reward_threshold FROM merchants').all()) console.log(m)
    break
  }
  case 'show': {
    const m = merchant()
    const members = db
      .prepare('SELECT COUNT(*) AS members, COALESCE(SUM(marketing_consent), 0) AS offers, COUNT(birthday) AS birthdays FROM cards WHERE merchant_id = ?')
      .get(m.id) as { members: number; offers: number; birthdays: number }
    console.log(`${m.name} (${m.slug}), ${m.program}, reward at ${m.reward_threshold}: ${m.reward_text}. Time zone ${m.timezone}.`)
    console.log(`${members.members} members, ${members.offers} agreed to offers, ${members.birthdays} gave a birthday.`)
    console.log('\nAutomatic messages:')
    console.table(triggers(db, m.id).map(({ kind, enabled, days, text }) => ({ kind, on: !!enabled, days, text })))
    console.log('\nPromotions:')
    console.table(campaigns(db, m.id).map((c) => ({ id: c.id, send_at: when(c.send_at), cancelled: !!c.cancelled_at, sent: c.sent, text: c.text })))
    console.log('\nBranches:')
    console.table(locations(db, m.id).map(({ id, label, latitude, longitude }) => ({ id, label, latitude, longitude })))
    break
  }
  case 'trigger': {
    const m = merchant()
    const t = setTrigger(db, m, {
      kind: a.kind as TriggerKind, text: a.text!, text_ar: a['text-ar'], days: a.days ? Number(a.days) : null, enabled: !a.off,
    })
    console.log(`${t.kind} message ${t.enabled ? 'on' : 'off'} for ${m.name}:`, t)
    break
  }
  case 'promo': {
    const m = merchant()
    const c = createCampaign(db, m, { text: a.text!, text_ar: a['text-ar'], sendAt: a.at ? localToEpoch(m.timezone, a.at) : undefined })
    console.log(`Promotion ${c.id} for ${m.name}, going out from ${when(c.send_at)} to members who agreed to offers (10:00 to 21:00 ${m.timezone}).`)
    break
  }
  case 'promo-cancel': {
    const m = merchant()
    cancelCampaign(db, m, Number(a.id))
    console.log(`Promotion ${a.id} cancelled. Cards it already reached keep it.`)
    break
  }
  case 'location': {
    const m = merchant()
    const l = addLocation(db, m, { label: a.label!, latitude: Number(a.lat), longitude: Number(a.lng), text: a.text, text_ar: a['text-ar'] })
    console.log(`Branch ${l.id} added for ${m.name}. Cards already in wallets refresh within a few minutes.`)
    break
  }
  case 'location-remove': {
    const m = merchant()
    removeLocation(db, m, Number(a.id))
    console.log(`Branch ${a.id} removed.`)
    break
  }
  default:
    console.log('Commands: create, staff-key, image, list, show, trigger, promo, promo-cancel, location, location-remove.')
    console.log('See the comment at the top of scripts/merchant.ts.')
}
