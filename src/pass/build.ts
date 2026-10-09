import type { Config } from '../config.ts'
import type { DB } from '../db.ts'
import { rewardsAvailable, type Card, type Merchant } from '../loyalty.ts'
import { barcodeMessage } from '../tokens.ts'
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
  const left = merchant.reward_threshold - (card.balance % merchant.reward_threshold)
  const ready = rewardsAvailable(merchant, card)
  const unitEn = merchant.program === 'stamps' ? (left === 1 ? 'stamp' : 'stamps') : 'points'
  const unitAr = merchant.program === 'stamps' ? 'طوابع' : 'نقاط'
  return {
    en: {
      BALANCE: merchant.program === 'stamps' ? 'STAMPS' : 'POINTS',
      CHANGE_BALANCE: merchant.program === 'stamps' ? 'Your card: %@' : 'Your balance: %@ points',
      MEMBER: 'MEMBER',
      REWARDS: 'REWARDS',
      NEXT: 'NEXT REWARD',
      NEXT_VALUE: ready > 0 ? 'Ready to redeem' : `${left} ${unitEn} to go`,
      REWARD: 'REWARD',
      REWARD_TEXT: merchant.reward_text,
      HOW: 'HOW IT WORKS',
      HOW_TEXT:
        merchant.program === 'stamps'
          ? `Show this card at the counter on every visit for a stamp. Collect ${merchant.reward_threshold} stamps and get: ${merchant.reward_text}.`
          : `Show this card at the counter when you pay. Every JOD earns ${merchant.points_per_jod} points. At ${merchant.reward_threshold} points you get: ${merchant.reward_text}.`,
      CARD_NO: 'CARD NUMBER',
    },
    ar: {
      BALANCE: merchant.program === 'stamps' ? 'الطوابع' : 'النقاط',
      CHANGE_BALANCE: merchant.program === 'stamps' ? 'بطاقتك: %@' : 'رصيدك: %@ نقطة',
      MEMBER: 'العضو',
      REWARDS: 'المكافآت',
      NEXT: 'المكافأة التالية',
      NEXT_VALUE: ready > 0 ? 'جاهزة للاستلام' : `بقي ${left} ${unitAr}`,
      REWARD: 'المكافأة',
      REWARD_TEXT: merchant.reward_text_ar ?? merchant.reward_text,
      HOW: 'طريقة الاستخدام',
      HOW_TEXT:
        merchant.program === 'stamps'
          ? `أبرز هذه البطاقة عند الكاونتر في كل زيارة لتحصل على طابع. اجمع ${merchant.reward_threshold} طوابع واحصل على: ${merchant.reward_text_ar ?? merchant.reward_text}.`
          : `أبرز هذه البطاقة عند الدفع. كل دينار يمنحك ${merchant.points_per_jod} نقطة، وعند ${merchant.reward_threshold} نقطة تحصل على: ${merchant.reward_text_ar ?? merchant.reward_text}.`,
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

export function passJson(config: Config, merchant: Merchant, card: Card): Record<string, unknown> {
  const message = barcodeMessage(config.secret, card.serial)
  // A full stamp card stays full until it is redeemed, so the notification for the last stamp reads "10 / 10".
  const t = merchant.reward_threshold
  const balanceValue = merchant.program === 'stamps' ? `${Math.min(card.balance, t)} / ${t}` : card.balance
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
      headerFields: [{ key: 'rewards', label: 'REWARDS', value: rewardsAvailable(merchant, card) }],
      primaryFields: [{ key: 'balance', label: 'BALANCE', value: balanceValue, changeMessage: 'CHANGE_BALANCE' }],
      secondaryFields: [
        { key: 'member', label: 'MEMBER', value: card.member_name },
        { key: 'next', label: 'NEXT', value: 'NEXT_VALUE' },
      ],
      backFields: [
        { key: 'reward', label: 'REWARD', value: 'REWARD_TEXT' },
        { key: 'how', label: 'HOW', value: 'HOW_TEXT' },
        { key: 'serial', label: 'CARD_NO', value: formatSerial(card.serial) },
      ],
    },
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

function images(db: DB, merchant: Merchant): PassFiles {
  const rows = db.prepare('SELECT name, png FROM merchant_images WHERE merchant_id = ?').all(merchant.id) as {
    name: string
    png: Uint8Array
  }[]
  const out: PassFiles = {}
  for (const r of rows) if (isPng(r.png)) out[r.name] = r.png
  // icon.png is required: without it the pass will not install.
  for (const [name, size] of Object.entries(IMAGE_SIZES)) out[name] ??= solidPng(size, merchant.bg_color)
  return out
}

export function buildPass(db: DB, config: Config, merchant: Merchant, card: Card): Uint8Array {
  const s = strings(merchant, card)
  return packPass(config.pass, {
    'pass.json': Buffer.from(JSON.stringify(passJson(config, merchant, card))),
    'en.lproj/pass.strings': stringsFile(s.en),
    'ar.lproj/pass.strings': stringsFile(s.ar),
    ...images(db, merchant),
  })
}
