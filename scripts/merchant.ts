/**
 * Merchant setup from the command line, until there is a dashboard.
 *
 *   npm run merchant -- create --slug phone-store --name "Phone Store" --program points \
 *       --threshold 500 --points-per-jod 10 --reward "Free screen protector" [--name-ar ...] [--reward-ar ...] \
 *       [--bg "rgb(10,40,80)"] [--fg "rgb(255,255,255)"] [--label "rgb(170,190,220)"]
 *   npm run merchant -- staff-key --slug phone-store --label "Counter 1"
 *   npm run merchant -- image --slug phone-store --name logo@2x.png --file ./logo@2x.png
 *   npm run merchant -- list
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { openDb } from '../src/db.ts'
import { createMerchant, merchantBySlug } from '../src/loyalty.ts'
import { isPng, parseColor } from '../src/pass/png.ts'
import { newStaffKey, sha256 } from '../src/tokens.ts'

const IMAGE_NAMES = /^(icon|logo|strip|thumbnail)(@[23]x)?\.png$/

const [command, ...rest] = process.argv.slice(2)
const { values: a } = parseArgs({
  args: rest,
  options: Object.fromEntries(
    ['slug', 'name', 'name-ar', 'program', 'threshold', 'points-per-jod', 'reward', 'reward-ar', 'bg', 'fg', 'label', 'file'].map(
      (k) => [k, { type: 'string' as const }],
    ),
  ),
})
const db = openDb(process.env.DB_PATH ?? 'data/loyalty.db')

function merchant() {
  const m = merchantBySlug(db, a.slug ?? '')
  if (!m) throw new Error(`No merchant with slug ${a.slug}`)
  return m
}

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
    if (!IMAGE_NAMES.test(a.name ?? '')) throw new Error('Name must be icon, logo, strip or thumbnail, optionally @2x/@3x, .png')
    const png = readFileSync(a.file!)
    if (!isPng(png)) throw new Error(`${a.file} is not a PNG`)
    db.prepare('INSERT INTO merchant_images (merchant_id, name, png) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET png = excluded.png').run(m.id, a.name!, png)
    console.log(`Saved ${a.name} for ${m.name}`)
    break
  }
  case 'list': {
    for (const m of db.prepare('SELECT slug, name, program, reward_threshold FROM merchants').all()) console.log(m)
    break
  }
  default:
    console.log('Commands: create, staff-key, image, list. See the comment at the top of scripts/merchant.ts.')
}
