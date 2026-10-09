import type { PushResult } from '../src/apns.ts'
import { createApp } from '../src/app.ts'
import type { Config } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { createMerchant, type NewMerchant } from '../src/loyalty.ts'
import { newStaffKey, sha256 } from '../src/tokens.ts'
import { makeDevCerts } from '../scripts/dev-certs.ts'

let certs: ReturnType<typeof makeDevCerts> | undefined

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
    ...over,
  }
}

export const STAMPS: NewMerchant = {
  slug: 'cafe', name: 'Cafe', program: 'stamps', reward_threshold: 3, reward_text: 'Free coffee', reward_text_ar: 'قهوة مجانية',
}
export const POINTS: NewMerchant = {
  slug: 'phones', name: 'Phone Store', program: 'points', reward_threshold: 100, points_per_jod: 10, reward_text: 'Free case',
}

export function setup(over: Partial<Config> = {}) {
  const config = testConfig(over)
  const db = openDb(':memory:')
  const pushed: string[][] = []
  const push = async (tokens: string[]): Promise<PushResult[]> => {
    pushed.push(tokens)
    return tokens.map((token) => ({ token, status: 200 }))
  }
  const app = createApp({ db, config, push })
  const cafe = createMerchant(db, STAMPS)
  const phones = createMerchant(db, POINTS)
  const staffKey = (merchantId: number) => {
    const key = newStaffKey()
    db.prepare('INSERT INTO staff (merchant_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)').run(merchantId, 't', sha256(key), Date.now())
    return key
  }
  return { config, db, app, pushed, cafe, phones, staffKey }
}

/** Lets fire-and-forget pushes settle. */
export const settle = () => new Promise((r) => setImmediate(r))
