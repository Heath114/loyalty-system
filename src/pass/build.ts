import type { Config } from '../config.ts'
import type { DB } from '../db.ts'
import { locations as merchantLocations, rewardsAvailable, type Card, type Location, type Merchant } from '../loyalty.ts'
import { barcodeMessage } from '../tokens.ts'
import { howItWorks, nearby, nextReward, rewardText, welcome } from './copy.ts'
import { packPass, type PassFiles } from './pkpass.ts'
import { isPng, solidPng } from './png.ts'

/** Groups a serial for reading out loud: 4 groups of 4. */
export function formatSerial(serial: string): string {
  return serial.match(/.{1,4}/g)!.join(' ')
}

/**
 * Field labels and values go through pass.strings, so the card reads in English or Arabic depending
 * on the phone's language. Per-card values (the reward text, progress) are written into the strings
 * file of that card's pass.
 */
function strings(merchant: Merchant, card: Card): { en: Record<string, string>; ar: Record<string, string> } {
  const stamps = merchant.program === 'stamps'
  return {
    en: {
      BALANCE: stamps ? 'STAMPS' : 'POINTS',
      CHANGE_BALANCE: stamps ? 'Your card: %@' : 'Your balance: %@ points',
      CHANGE_BALANCE_READY: stamps ? 'Your card: %@. Your reward is ready!' : 'Your balance: %@ points. Your reward is ready!',
      MEMBER: 'MEMBER',
      REWARDS: 'REWARDS',
      NEXT: 'NEXT REWARD',
      NEXT_VALUE: nextReward(merchant, card, 'en'),
      NEWS: 'NEWS',
      REWARD: 'REWARD',
      REWARD_TEXT: rewardText(merchant, 'en'),
      HOW: 'HOW IT WORKS',
      HOW_TEXT: howItWorks(merchant, 'en'),
      CARD_NO: 'CARD NUMBER',
    },
    ar: {
      BALANCE: stamps ? 'الطوابع' : 'النقاط',
      CHANGE_BALANCE: stamps ? 'بطاقتك: %@' : 'رصيدك: %@ نقطة',
      CHANGE_BALANCE_READY: stamps ? 'بطاقتك: %@. مكافأتك جاهزة!' : 'رصيدك: %@ نقطة. مكافأتك جاهزة!',
      MEMBER: 'العضو',
      REWARDS: 'المكافآت',
      NEXT: 'المكافأة التالية',
      NEXT_VALUE: nextReward(merchant, card, 'ar'),
      NEWS: 'آخر الأخبار',
      REWARD: 'المكافأة',
      REWARD_TEXT: rewardText(merchant, 'ar'),
      HOW: 'طريقة الاستخدام',
      HOW_TEXT: howItWorks(merchant, 'ar'),
      CARD_NO: 'رقم البطاقة',
    },
  }
}

/** Apple's .strings format, written as UTF-16 with a byte order mark, the encoding Wallet documents. */
function stringsFile(entries: Record<string, string>): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  const text = Object.entries(entries).map(([k, v]) => `"${esc(k)}" = "${esc(v)}";`).join('\n') + '\n'
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
}

export interface PassExtras {
  /** The newest message sent to this card, already in the card's language. */
  message?: string | null
  locations?: Location[]
}

export function passJson(config: Config, merchant: Merchant, card: Card, extras: PassExtras = {}): Record<string, unknown> {
  const message = barcodeMessage(config.secret, card.serial)
  // A full stamp card stays full until it is redeemed, so the notification for the last stamp reads "10 / 10".
  const t = merchant.reward_threshold
  const balanceValue = merchant.program === 'stamps' ? `${Math.min(card.balance, t)} / ${t}` : card.balance
  const ready = rewardsAvailable(merchant, card)
  const json: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: config.pass.passTypeIdentifier,
    teamIdentifier: config.pass.teamIdentifier,
    serialNumber: card.serial,
    organizationName: merchant.name,
    description: `${merchant.name} loyalty card`,
    logoText: merchant.name,
    foregroundColor: merchant.fg_color,
    backgroundColor: merchant.bg_color,
    labelColor: merchant.label_color,
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message, messageEncoding: 'iso-8859-1', altText: formatSerial(card.serial) }],
    storeCard: {
      headerFields: [{ key: 'rewards', label: 'REWARDS', value: ready }],
      primaryFields: [
        { key: 'balance', label: 'BALANCE', value: balanceValue, changeMessage: ready > 0 ? 'CHANGE_BALANCE_READY' : 'CHANGE_BALANCE' },
      ],
      secondaryFields: [
        { key: 'member', label: 'MEMBER', value: card.member_name },
        { key: 'next', label: 'NEXT', value: 'NEXT_VALUE' },
      ],
      backFields: [
        // Merchant messages (birthday, offers, "we miss you") land here. Wallet shows a lock-screen
        // notification whenever a field with a changeMessage gets a new value, and "%@" is that value,
        // so the notification reads exactly the message. The text is written in the card's language
        // rather than through pass.strings, so what the lock screen shows never depends on a lookup.
        // The field is there from the first version of the pass, so the first message is a change too.
        { key: 'news', label: 'NEWS', value: extras.message ?? welcome(merchant, card.lang), changeMessage: '%@' },
        { key: 'reward', label: 'REWARD', value: 'REWARD_TEXT' },
        { key: 'how', label: 'HOW', value: 'HOW_TEXT' },
        { key: 'serial', label: 'CARD_NO', value: formatSerial(card.serial) },
      ],
    },
  }
  // Near a branch, Wallet offers the card on the lock screen with this text. Best effort by Apple's
  // design: the system decides when, and promises no banner (docs/STUDY.md section 4).
  if (extras.locations?.length) {
    json.locations = extras.locations.slice(0, 10).map((l) => ({
      latitude: l.latitude,
      longitude: l.longitude,
      relevantText: nearby(merchant, l, card.lang),
    }))
  }
  // Wallet only registers for updates over HTTPS. Without it the card still works, it just never refreshes.
  if (config.publicUrl.startsWith('https://')) {
    json.webServiceURL = `${config.publicUrl}/wallet`
    json.authenticationToken = card.auth_token
  }
  // Same payload as the QR, delivered over NFC (Apple VAS) once Apple grants the NFC entitlement.
  // Including this key without the entitlement makes the pass fail to install, so it stays off until then.
  if (config.nfcEncryptionPublicKey) {
    json.nfc = { message, encryptionPublicKey: config.nfcEncryptionPublicKey, requiresAuthentication: false }
  }
  return json
}

const IMAGE_SIZES: Record<string, number> = { 'icon.png': 29, 'icon@2x.png': 58, 'icon@3x.png': 87 }

export function merchantImage(db: DB, merchantId: number, name: string): Uint8Array | undefined {
  const row = db.prepare('SELECT png FROM merchant_images WHERE merchant_id = ? AND name = ?').get(merchantId, name) as
    | { png: Uint8Array }
    | undefined
  return row && isPng(row.png) ? row.png : undefined
}

function images(db: DB, merchant: Merchant): PassFiles {
  const rows = db.prepare('SELECT name, png FROM merchant_images WHERE merchant_id = ?').all(merchant.id) as {
    name: string
    png: Uint8Array
  }[]
  const out: PassFiles = {}
  // square.png is the Google Wallet logo; Apple has no use for it.
  for (const r of rows) if (isPng(r.png) && r.name !== 'square.png') out[r.name] = r.png
  // icon.png is required: without it the pass will not install.
  for (const [name, size] of Object.entries(IMAGE_SIZES)) out[name] ??= solidPng(size, merchant.bg_color)
  return out
}

/** Text of the card's newest message, if it has one. */
export function latestMessage(db: DB, card: Card): string | null {
  if (card.last_message_id == null) return null
  const row = db.prepare('SELECT text FROM messages WHERE id = ? AND card_id = ?').get(card.last_message_id, card.id) as
    | { text: string }
    | undefined
  return row?.text ?? null
}

export function buildPass(db: DB, config: Config, merchant: Merchant, card: Card): Uint8Array {
  const s = strings(merchant, card)
  const extras = { message: latestMessage(db, card), locations: merchantLocations(db, merchant.id) }
  return packPass(config.pass, {
    'pass.json': Buffer.from(JSON.stringify(passJson(config, merchant, card, extras))),
    'en.lproj/pass.strings': stringsFile(s.en),
    'ar.lproj/pass.strings': stringsFile(s.ar),
    ...images(db, merchant),
  })
}
