import { generateKeyPairSync } from 'node:crypto'
import type { PushResult } from '../src/apns.ts'
import { createApp } from '../src/app.ts'
import type { Config, GoogleConfig } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { googleWallet } from '../src/google.ts'
import { createMerchant, type NewMerchant } from '../src/loyalty.ts'
import { newStaffKey, sha256 } from '../src/tokens.ts'
import { makeDevCerts } from '../scripts/dev-certs.ts'

let certs: ReturnType<typeof makeDevCerts> | undefined
let googleKeys: { config: GoogleConfig; publicKey: string } | undefined

/** A stand-in Google service account: a real RSA key, so signatures can be checked. */
export function testGoogleKeys() {
  if (!googleKeys) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    googleKeys = { config: { issuerId: '3388000000012345678', clientEmail: 'cards@test.iam.gserviceaccount.com', privateKey }, publicKey }
  }
  return googleKeys
}

export function testConfig(over: Partial<Config> = {}): Config {
  certs ??= makeDevCerts()
  return {
    publicUrl: 'https://cards.test',
    port: 0,
    dbPath: ':memory:',
    secret: 'test-secret',
    pass: {
      teamIdentifier: certs.teamIdentifier,
      passTypeIdentifier: certs.passTypeIdentifier,
      certPem: certs.certPem,
      keyPem: certs.keyPem,
      wwdrPem: certs.wwdrPem,
    },
    apns: { host: 'https://apns.invalid' },
    nfcEncryptionPublicKey: null,
    google: null,
    ...over,
  }
}

/**
 * Google's Wallet API, in memory: classes, objects, messages, and the 3-notifications-a-day limit,
 * with every call recorded.
 */
export function fakeGoogle() {
  const state = {
    classes: new Map<string, any>(),
    objects: new Map<string, any>(),
    calls: [] as { method: string; path: string; body: any }[],
    /** What lock screens would have shown: "<object id>: <text>". */
    notifications: [] as string[],
    /** Notifications left today per object; Google allows 3. */
    quota: new Map<string, number>(),
    /** Every API call fails, like an outage. */
    down: false,
    fetch: undefined as unknown as typeof fetch,
  }
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const notify = (id: string, text: string) => {
    const left = state.quota.get(id) ?? 3
    if (left <= 0) return false
    state.quota.set(id, left - 1)
    state.notifications.push(`${id}: ${text}`)
    return true
  }
  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.host === 'oauth2.googleapis.com') return reply(200, { access_token: 'test-token', expires_in: 3600 })
    if (state.down) return reply(503, { error: { message: 'Service unavailable' } })
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    state.calls.push({ method, path: url.pathname, body })
    const m = /^\/walletobjects\/v1\/(loyaltyClass|loyaltyObject)(?:\/([^/]+))?(\/addMessage)?$/.exec(url.pathname)
    if (!m) return reply(404)
    const store = m[1] === 'loyaltyClass' ? state.classes : state.objects
    const id = m[2] ? decodeURIComponent(m[2]) : undefined
    if (!id && method === 'POST') {
      if (store.has(body.id)) return reply(409, { error: { message: 'exists' } })
      if (m[1] === 'loyaltyObject' && !state.classes.has(body.classId)) return reply(400, { error: { message: 'class does not exist' } })
      store.set(body.id, body)
      return reply(200, body)
    }
    const current = id ? store.get(id) : undefined
    if (!current) return reply(404, { error: { message: 'not found' } })
    if (m[3]) {
      const msg = body.message
      if (msg.messageType === 'TEXT_AND_NOTIFY' && !notify(id!, msg.body)) return reply(429, { error: { message: 'QuotaExceededException' } })
      const messages = [...(current.messages ?? []), msg]
      if (messages.length > 10) return reply(400, { error: { message: 'Too many messages' } })
      current.messages = messages
      return reply(200, { resource: current })
    }
    if (method === 'PATCH') {
      const { notifyPreference, ...fields } = body
      if (notifyPreference === 'NOTIFY_ON_UPDATE' && !notify(id!, JSON.stringify(fields.loyaltyPoints?.balance))) {
        return reply(429, { error: { message: 'QuotaExceededException' } })
      }
      store.set(id!, { ...current, ...fields })
      return reply(200, store.get(id!))
    }
    return reply(200, current)
  }) as typeof fetch
  return state
}

export type FakeGoogle = ReturnType<typeof fakeGoogle>

export const STAMPS: NewMerchant = {
  slug: 'cafe', name: 'Cafe', program: 'stamps', reward_threshold: 3, reward_text: 'Free coffee', reward_text_ar: 'قهوة مجانية',
}
export const POINTS: NewMerchant = {
  slug: 'phones', name: 'Phone Store', program: 'points', reward_threshold: 100, points_per_jod: 10, reward_text: 'Free case',
}

export function setup(over: Partial<Config> = {}, opts: { google?: FakeGoogle } = {}) {
  const config = testConfig(opts.google ? { google: testGoogleKeys().config, ...over } : over)
  const db = openDb(':memory:')
  const pushed: string[][] = []
  const push = async (tokens: string[]): Promise<PushResult[]> => {
    pushed.push(tokens)
    return tokens.map((token) => ({ token, status: 200 }))
  }
  const google = opts.google ? googleWallet(config, opts.google.fetch) : null
  const deps = { db, config, push, google }
  const app = createApp(deps)
  const cafe = createMerchant(db, STAMPS)
  const phones = createMerchant(db, POINTS)
  const staffKey = (merchantId: number) => {
    const key = newStaffKey()
    db.prepare('INSERT INTO staff (merchant_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)').run(merchantId, 't', sha256(key), Date.now())
    return key
  }
  return { config, db, app, deps, pushed, cafe, phones, staffKey }
}

/** Lets fire-and-forget pushes settle, including the few round trips a Google update takes. */
export async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}
