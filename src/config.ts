import { readFileSync, existsSync } from 'node:fs'

/** Everything the server reads from the environment, resolved once at startup. */
export interface Config {
  /** Public base URL, e.g. https://cards.example.com. Wallet only talks to HTTPS. */
  publicUrl: string
  port: number
  /** Where to listen: every interface by default; 127.0.0.1 behind Caddy (deploy/README.md). */
  host: string | undefined
  dbPath: string
  /** Signs barcode and link tokens. Rotating it invalidates every printed QR. */
  secret: string
  pass: PassConfig
  apns: { host: string }
  /** Set once Apple grants the NFC pass entitlement. Base64 of the merchant's compressed P-256 public key. */
  nfcEncryptionPublicKey: string | null
  /** Google Wallet, once we have an issuer account (docs/GOOGLE_SETUP.md). Null: Apple only. */
  google: GoogleConfig | null
  /** Email for "forgot my password" links. Null: we reset from the command line. */
  mail: MailConfig | null
}

export interface MailConfig {
  resendApiKey: string
  /** "Loyalty <cards@example.com>", on a domain verified with Resend. */
  from: string
}

export interface GoogleConfig {
  /** From the Google Pay & Wallet Console. */
  issuerId: string
  /** The service account that calls the Wallet API and signs "Save to Google Wallet" links. */
  clientEmail: string
  privateKey: string
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

type Env = Record<string, string | undefined>

function need(env: Env, name: string): string {
  const v = env[name]
  if (!v) throw new Error(`Missing environment variable ${name}`)
  return v
}

function pem(env: Env, nameInline: string, namePath: string): string {
  const inline = env[nameInline]
  if (inline) return inline.replace(/\\n/g, '\n')
  const path = need(env, namePath)
  if (!existsSync(path)) throw new Error(`${namePath} points at ${path}, which does not exist`)
  return readFileSync(path, 'utf8')
}

/** env: process.env, except for the doctor checking a setup it was handed. */
export function loadConfig(env: Env = process.env): Config {
  return {
    publicUrl: need(env, 'PUBLIC_URL').replace(/\/$/, ''),
    port: Number(env.PORT ?? 8787),
    host: env.HOST || undefined,
    dbPath: env.DB_PATH ?? 'data/loyalty.db',
    secret: need(env, 'APP_SECRET'),
    pass: {
      teamIdentifier: need(env, 'APPLE_TEAM_ID'),
      passTypeIdentifier: need(env, 'PASS_TYPE_ID'),
      certPem: pem(env, 'PASS_CERT_PEM', 'PASS_CERT_PATH'),
      keyPem: pem(env, 'PASS_KEY_PEM', 'PASS_KEY_PATH'),
      keyPassphrase: env.PASS_KEY_PASSPHRASE || undefined,
      wwdrPem: pem(env, 'WWDR_CERT_PEM', 'WWDR_CERT_PATH'),
    },
    apns: { host: env.APNS_HOST ?? 'https://api.push.apple.com' },
    nfcEncryptionPublicKey: env.NFC_ENCRYPTION_PUBLIC_KEY || null,
    google: googleConfig(env),
    mail: mailConfig(env),
  }
}

function mailConfig(env: Env): MailConfig | null {
  const resendApiKey = env.RESEND_API_KEY
  if (!resendApiKey) return null
  return { resendApiKey, from: need(env, 'MAIL_FROM') }
}

/** The service account key file Google hands out, inline (GOOGLE_SERVICE_ACCOUNT_JSON) or as a path. */
function googleConfig(env: Env): GoogleConfig | null {
  const issuerId = env.GOOGLE_ISSUER_ID
  if (!issuerId) return null
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON
  const path = inline ? '' : need(env, 'GOOGLE_SERVICE_ACCOUNT_PATH')
  if (path && !existsSync(path)) throw new Error(`GOOGLE_SERVICE_ACCOUNT_PATH points at ${path}, which does not exist`)
  const key = JSON.parse(inline || readFileSync(path, 'utf8')) as { client_email?: string; private_key?: string }
  if (!key.client_email || !key.private_key) throw new Error('The Google service account key has no client_email or private_key')
  return { issuerId, clientEmail: key.client_email, privateKey: key.private_key }
}
