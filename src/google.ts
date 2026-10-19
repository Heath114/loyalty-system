import { createSign } from 'node:crypto'
import type { Config, GoogleConfig } from './config.ts'
import { rewardsAvailable, type Card, type Location, type Merchant } from './loyalty.ts'
import { formatSerial } from './pass/build.ts'
import { howItWorks, nextReward, rewardText } from './pass/copy.ts'
import { parseColor } from './pass/png.ts'
import { barcodeMessage } from './tokens.ts'

/**
 * The same card in Google Wallet. Google keeps the card on its side: a "class" per merchant (name,
 * logo, colours, branches) and an "object" per card (member, balance, QR). We create them through
 * the Wallet API and keep them current; the customer saves theirs from a signed link.
 * https://developers.google.com/wallet/retail/loyalty-cards
 */

const API = 'https://walletobjects.googleapis.com/walletobjects/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'

export class GoogleError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface GoogleMessage {
  id: number
  en: string
  ar: string | null
}

export interface GoogleWallet {
  classId(m: Merchant): string
  objectId(card: Card): string
  /** Creates or updates the merchant's class: name, logo, colours, reward text, branches. */
  syncClass(m: Merchant, locations: Location[]): Promise<void>
  /** Creates or updates a card's object with its current balance. */
  upsertCard(m: Merchant, card: Card): Promise<void>
  /** Pushes a new balance. notify: also a lock-screen notification. False if the card is not in Google Wallet. */
  updateCard(m: Merchant, card: Card, notify: boolean): Promise<boolean>
  /** Shows a message on the lock screen and on the card. False if the card is not in Google Wallet. */
  sendMessage(m: Merchant, card: Card, message: GoogleMessage, keep: { id: number; text: string }[] | null): Promise<boolean>
  /** The "Save to Google Wallet" link for a card whose object exists. */
  saveUrl(m: Merchant, card: Card): string
}

type Localized = { defaultValue: { language: string; value: string }; translatedValues?: { language: string; value: string }[] }

function localized(en: string, ar: string | null | undefined): Localized {
  return {
    defaultValue: { language: 'en', value: en },
    ...(ar && ar !== en ? { translatedValues: [{ language: 'ar', value: ar }] } : {}),
  }
}

function hex(color: string): string {
  return '#' + parseColor(color).map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** A JWT signed with the service account's RSA key, for the OAuth token exchange and for save links. */
export function signJwt(claims: Record<string, unknown>, privateKey: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}`
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')}`
}

export function classJson(config: Config, g: GoogleConfig, m: Merchant, locations: Location[]): Record<string, unknown> {
  return {
    id: `${g.issuerId}.merchant-${m.slug}`,
    issuerName: m.name,
    localizedIssuerName: localized(m.name, m.name_ar),
    programName: 'Loyalty card',
    localizedProgramName: localized('Loyalty card', 'بطاقة الولاء'),
    programLogo: { sourceUri: { uri: `${config.publicUrl}/m/${m.slug}/logo.png` }, contentDescription: localized(m.name, m.name_ar) },
    hexBackgroundColor: hex(m.bg_color),
    countryCode: 'JO',
    // A new or changed class goes in as UNDER_REVIEW; Google approves it (automatically, for loyalty).
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    accountIdLabel: 'Card number',
    localizedAccountIdLabel: localized('Card number', 'رقم البطاقة'),
    accountNameLabel: 'Member',
    localizedAccountNameLabel: localized('Member', 'العضو'),
    textModulesData: [
      { id: 'reward', header: 'Reward', localizedHeader: localized('Reward', 'المكافأة'), body: rewardText(m, 'en'), localizedBody: localized(rewardText(m, 'en'), rewardText(m, 'ar')) },
      { id: 'how', header: 'How it works', localizedHeader: localized('How it works', 'طريقة الاستخدام'), body: howItWorks(m, 'en'), localizedBody: localized(howItWorks(m, 'en'), howItWorks(m, 'ar')) },
    ],
    // Google notifies near these, within a radius it chooses, for customers who allow location.
    merchantLocations: locations.slice(0, 10).map((l) => ({ latitude: l.latitude, longitude: l.longitude })),
  }
}

/** The parts of a card that change with every stamp or redemption. */
function balanceJson(m: Merchant, card: Card) {
  const t = m.reward_threshold
  return {
    loyaltyPoints:
      m.program === 'stamps'
        ? { label: 'Stamps', localizedLabel: localized('Stamps', 'الطوابع'), balance: { string: `${Math.min(card.balance, t)} / ${t}` } }
        : { label: 'Points', localizedLabel: localized('Points', 'النقاط'), balance: { int: card.balance } },
    secondaryLoyaltyPoints: { label: 'Rewards', localizedLabel: localized('Rewards', 'المكافآت'), balance: { int: rewardsAvailable(m, card) } },
    textModulesData: [
      { id: 'next', header: 'Next reward', localizedHeader: localized('Next reward', 'المكافأة التالية'), body: nextReward(m, card, 'en'), localizedBody: localized(nextReward(m, card, 'en'), nextReward(m, card, 'ar')) },
    ],
  }
}

export function objectJson(config: Config, g: GoogleConfig, m: Merchant, card: Card): Record<string, unknown> {
  return {
    id: `${g.issuerId}.card-${card.serial}`,
    classId: `${g.issuerId}.merchant-${m.slug}`,
    state: 'ACTIVE',
    accountId: formatSerial(card.serial),
    accountName: card.member_name,
    // The same signed message as the Apple card's QR, so the staff page scans both the same way.
    barcode: { type: 'QR_CODE', value: barcodeMessage(config.secret, card.serial), alternateText: formatSerial(card.serial) },
    ...balanceJson(m, card),
  }
}

/** Google's answer when a card has hit its 3 notifications a day. */
function quotaExceeded(status: number, body: unknown): boolean {
  return status === 429 || /quota/i.test(JSON.stringify(body ?? ''))
}

export function googleWallet(config: Config, f: typeof fetch = fetch): GoogleWallet {
  const g = config.google
  if (!g) throw new Error('Google Wallet is not configured')
  let token: { value: string; expires: number } | undefined

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value
    const now = Math.floor(Date.now() / 1000)
    const assertion = signJwt({ iss: g!.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, g!.privateKey)
    const res = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    })
    if (!res.ok) throw new GoogleError(res.status, `Google sign-in failed: ${res.status} ${await res.text()}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 }
    return token.value
  }

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await f(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : null } catch {}
    return { status: res.status, body: parsed }
  }

  const ok = (status: number) => status >= 200 && status < 300
  const fail = (what: string, r: { status: number; body: any }) =>
    new GoogleError(r.status, `Google Wallet ${what}: ${r.status} ${r.body?.error?.message ?? ''}`.trim())

  /** PATCH, and insert when it does not exist yet. */
  async function upsert(kind: 'loyaltyClass' | 'loyaltyObject', id: string, body: Record<string, unknown>) {
    const r = await call('PATCH', `/${kind}/${encodeURIComponent(id)}`, body)
    if (ok(r.status)) return
    if (r.status !== 404) throw fail(`${kind} update`, r)
    const ins = await call('POST', `/${kind}`, body)
    // 409: created in the meantime by a parallel request, which is what we wanted.
    if (!ok(ins.status) && ins.status !== 409) throw fail(`${kind} insert`, ins)
  }

  const classId = (m: Merchant) => `${g.issuerId}.merchant-${m.slug}`
  const objectId = (card: Card) => `${g.issuerId}.card-${card.serial}`
  const objectPath = (card: Card) => `/loyaltyObject/${encodeURIComponent(objectId(card))}`

  return {
    classId,
    objectId,

    syncClass: (m, locations) => upsert('loyaltyClass', classId(m), classJson(config, g, m, locations)),

    upsertCard: (m, card) => upsert('loyaltyObject', objectId(card), objectJson(config, g, m, card)),

    async updateCard(m, card, notify) {
      const body = balanceJson(m, card)
      let r = await call('PATCH', objectPath(card), notify ? { ...body, notifyPreference: 'NOTIFY_ON_UPDATE' } : body)
      // Out of notifications for today: still update the card, silently.
      if (notify && quotaExceeded(r.status, r.body)) r = await call('PATCH', objectPath(card), body)
      if (r.status === 404) return false
      if (!ok(r.status)) throw fail('card update', r)
      return true
    },

    async sendMessage(m, card, message, keep) {
      // A card holds at most 10 messages. When it may be near that, first cut it back to the newest few.
      if (keep) {
        const trimmed = keep.map((k) => ({ id: `m${k.id}`, header: m.name, body: k.text, messageType: 'TEXT' }))
        const r = await call('PATCH', objectPath(card), { messages: trimmed })
        if (r.status === 404) return false
        if (!ok(r.status)) throw fail('message cleanup', r)
      }
      const msg = {
        id: `m${message.id}`,
        header: m.name,
        localizedHeader: localized(m.name, m.name_ar),
        body: message.en,
        localizedBody: localized(message.en, message.ar),
        messageType: 'TEXT_AND_NOTIFY',
      }
      let r = await call('POST', `${objectPath(card)}/addMessage`, { message: msg })
      // Out of notifications for today: the message still goes on the card, without the alert.
      if (quotaExceeded(r.status, r.body)) r = await call('POST', `${objectPath(card)}/addMessage`, { message: { ...msg, messageType: 'TEXT' } })
      if (r.status === 404) return false
      if (!ok(r.status)) throw fail('message', r)
      return true
    },

    saveUrl(m, card) {
      const jwt = signJwt(
        {
          iss: g.clientEmail,
          aud: 'google',
          typ: 'savetowallet',
          iat: Math.floor(Date.now() / 1000),
          origins: [config.publicUrl],
          // The object already exists (upsertCard), so the link only has to name it.
          payload: { loyaltyObjects: [{ id: objectId(card), classId: classId(m) }] },
        },
        g.privateKey,
      )
      return `https://pay.google.com/gp/v/save/${jwt}`
    },
  }
}
