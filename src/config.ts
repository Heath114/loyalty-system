import { readFileSync, existsSync } from 'node:fs'

/** Everything the server reads from the environment, resolved once at startup. */
export interface Config {
  /** Public base URL, e.g. https://cards.example.com. Wallet only talks to HTTPS. */
  publicUrl: string
  port: number
  dbPath: string
  /** Signs barcode and link tokens. Rotating it invalidates every printed QR. */
  secret: string
  pass: PassConfig
  apns: { host: string }
  /** Set once Apple grants the NFC pass entitlement. Base64 of the merchant's compressed P-256 public key. */
  nfcEncryptionPublicKey: string | null
}

export interface PassConfig {
  teamIdentifier: string
  passTypeIdentifier: string
  /** PEM: the Pass Type ID certificate from developer.apple.com. */
  certPem: string
  /** PEM: its private key. */
  keyPem: string
  keyPassphrase?: string
  /** PEM: Apple WWDR intermediate (G4) that issued the pass certificate. */
  wwdrPem: string
}

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing environment variable ${name}`)
  return v
}

function pem(nameInline: string, namePath: string): string {
  const inline = process.env[nameInline]
  if (inline) return inline.replace(/\\n/g, '\n')
  const path = need(namePath)
  if (!existsSync(path)) throw new Error(`${namePath} points at ${path}, which does not exist`)
  return readFileSync(path, 'utf8')
}

export function loadConfig(): Config {
  return {
    publicUrl: need('PUBLIC_URL').replace(/\/$/, ''),
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? 'data/loyalty.db',
    secret: need('APP_SECRET'),
    pass: {
      teamIdentifier: need('APPLE_TEAM_ID'),
      passTypeIdentifier: need('PASS_TYPE_ID'),
      certPem: pem('PASS_CERT_PEM', 'PASS_CERT_PATH'),
      keyPem: pem('PASS_KEY_PEM', 'PASS_KEY_PATH'),
      keyPassphrase: process.env.PASS_KEY_PASSPHRASE || undefined,
      wwdrPem: pem('WWDR_CERT_PEM', 'WWDR_CERT_PATH'),
    },
    apns: { host: process.env.APNS_HOST ?? 'https://api.push.apple.com' },
    nfcEncryptionPublicKey: process.env.NFC_ENCRYPTION_PUBLIC_KEY || null,
  }
}
