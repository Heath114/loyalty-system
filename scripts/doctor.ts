/**
 * Checks a server's setup before a phone ever sees it: every value in .env, the certificates and
 * whether they belong together, and that a card actually signs. One line per check, in plain words.
 *
 *   npm run doctor               everything that can be checked on this machine
 *   npm run doctor -- --online   also: PUBLIC_URL answers over the internet, Google accepts our key
 *
 * Exits with 1 when something must be fixed, so a deploy script can stop on it.
 */
import { X509Certificate } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadConfig } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { signJwt } from '../src/google.ts'
import { createMerchant, enrol } from '../src/loyalty.ts'
import { buildPass } from '../src/pass/build.ts'
import { checkPassCert, readPassCert, WWDR_G4_SHA256 } from './apple.ts'

export type Level = 'ok' | 'warn' | 'fail'
export interface Result {
  level: Level
  text: string
}

type Env = Record<string, string | undefined>

function readPem(env: Env, inline: string, path: string): { pem: string; where: string } | { error: string } {
  if (env[inline]) return { pem: env[inline]!.replace(/\\n/g, '\n'), where: inline }
  const p = env[path]
  if (!p) return { error: `${path} is empty` }
  if (!existsSync(p)) return { error: `${path} points at ${p}, which does not exist` }
  return { pem: readFileSync(p, 'utf8'), where: p }
}

/** Every check that needs nothing but this machine. */
export function diagnose(env: Env, now = new Date()): Result[] {
  const out: Result[] = []
  const ok = (text: string) => out.push({ level: 'ok', text })
  const warn = (text: string) => out.push({ level: 'warn', text })
  const fail = (text: string) => out.push({ level: 'fail', text })

  // Address
  const url = env.PUBLIC_URL ?? ''
  if (!url) fail('PUBLIC_URL is empty: cards need the address phones reach this server at.')
  else if (/^https:\/\/[^/]+$/.test(url.replace(/\/$/, ''))) ok(`PUBLIC_URL is ${url}.`)
  else if (/^http:\/\//.test(url)) warn(`PUBLIC_URL is ${url}, not HTTPS: cards install and scan, but Wallet never sends them updates or messages.`)
  else fail(`PUBLIC_URL is ${url}: it must be https://host, with no path.`)

  // Secret
  const secret = env.APP_SECRET ?? ''
  if (!secret) fail('APP_SECRET is empty. Make one: openssl rand -base64 32 (and never change it once cards exist).')
  else if (secret.length < 32) warn(`APP_SECRET is only ${secret.length} characters; use 32 or more before real cards exist.`)
  else ok('APP_SECRET is set.')

  // Apple
  const passTypeId = env.PASS_TYPE_ID ?? ''
  const teamId = env.APPLE_TEAM_ID ?? ''
  if (!/^pass\.[A-Za-z0-9.-]+$/.test(passTypeId)) fail(`PASS_TYPE_ID "${passTypeId}" must start with "pass." (ours: pass.com.theoffice.loyalty).`)
  if (!/^[A-Z0-9]{10}$/.test(teamId)) fail(`APPLE_TEAM_ID "${teamId}" must be the 10-character team ID (ours: LZ8RFD29KM).`)
  const devSetup = passTypeId === 'pass.dev.loyalty'
  if (devSetup) warn('These are the stand-in development certificates: cards build, but an iPhone refuses them.')

  const cert = readPem(env, 'PASS_CERT_PEM', 'PASS_CERT_PATH')
  const key = readPem(env, 'PASS_KEY_PEM', 'PASS_KEY_PATH')
  const wwdr = readPem(env, 'WWDR_CERT_PEM', 'WWDR_CERT_PATH')
  for (const [r, what] of [[cert, 'pass certificate'], [key, 'pass key'], [wwdr, 'WWDR certificate']] as const) {
    if ('error' in r) fail(`The ${what}: ${r.error}.`)
  }
  if ('pem' in cert && 'pem' in key) {
    try {
      const info = readPassCert(Buffer.from(cert.pem))
      const keyPem = env.PASS_KEY_PASSPHRASE ? null : key.pem
      const problems = keyPem ? checkPassCert(info, keyPem, { passTypeId, teamId }, now) : []
      for (const p of problems) fail(`Pass certificate: ${p}`)
      if (!problems.length) {
        const days = Math.floor((info.validTo.getTime() - now.getTime()) / 86400e3)
        const text = `Pass certificate for ${info.passTypeId}, team ${info.teamId}, matches the key, valid until ${info.validTo.toISOString().slice(0, 10)}.`
        if (days < 30) warn(`${text} Only ${days} days left: renew it now (docs/MANUAL_STEPS.md §2).`)
        else ok(text)
      }
      if (!devSetup && !/Apple Worldwide Developer Relations/.test(info.issuer)) warn('The pass certificate was not issued by Apple WWDR: an iPhone will refuse it.')
      if ('pem' in wwdr) {
        const w = new X509Certificate(wwdr.pem)
        const x = new X509Certificate(cert.pem)
        // Names can match by accident; the signature cannot.
        if (!x.checkIssued(w) || !x.verify(w.publicKey)) fail('The WWDR certificate is not the one that issued the pass certificate (Apple\'s is G4: npm run apple -- wwdr).')
        else if (!devSetup && w.fingerprint256 !== WWDR_G4_SHA256) warn('The WWDR certificate is not the G4 one we checked; fine only if Apple changed it.')
        else ok('The WWDR certificate issued the pass certificate.')
      }
    } catch (e) {
      fail(`Could not read the pass certificate or key: ${(e as Error).message}`)
    }
  }
  if (env.PASS_KEY_PATH && existsSync(env.PASS_KEY_PATH) && process.platform !== 'win32') {
    if (statSync(env.PASS_KEY_PATH).mode & 0o077) warn(`${env.PASS_KEY_PATH} can be read by other users of this machine: chmod 600 ${env.PASS_KEY_PATH}`)
  }

  // The real thing: a card signs with this setup.
  try {
    const config = loadConfig(env)
    const db = openDb(':memory:')
    const m = createMerchant(db, { slug: 'doctor', name: 'Doctor', program: 'stamps', reward_threshold: 5, reward_text: 'Check' })
    const pkpass = buildPass(db, config, m, enrol(db, m, { name: 'Test', marketingConsent: false }))
    ok(`A test card builds and signs (${Math.round(pkpass.byteLength / 1024)} KB).`)
    if (config.nfcEncryptionPublicKey) ok('NFC is switched on (NFC_ENCRYPTION_PUBLIC_KEY).')
  } catch (e) {
    fail(`A test card does not build: ${(e as Error).message}`)
  }

  // Google
  if (!env.GOOGLE_ISSUER_ID) warn('Google Wallet is off (GOOGLE_ISSUER_ID empty): Android customers keep the card page only.')
  else {
    if (!/^\d{19}$/.test(env.GOOGLE_ISSUER_ID)) warn(`GOOGLE_ISSUER_ID ${env.GOOGLE_ISSUER_ID} does not look like an issuer ID (ours: 3388000000023224499).`)
    try {
      const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON || readFileSync(env.GOOGLE_SERVICE_ACCOUNT_PATH ?? '', 'utf8')
      const k = JSON.parse(raw) as { type?: string; client_email?: string; private_key?: string }
      if (k.type !== 'service_account' || !k.client_email || !k.private_key) fail('The Google key file is not a service account key (type, client_email, private_key).')
      else ok(`Google Wallet on, as ${k.client_email}.`)
    } catch (e) {
      fail(`The Google service account key: ${(e as Error).message}`)
    }
  }

  // Email
  if (!env.RESEND_API_KEY) warn('Reset emails are off (RESEND_API_KEY empty): forgotten passwords are reset from the command line.')
  else if (!/<?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?\s*$/.test(env.MAIL_FROM ?? '')) fail('RESEND_API_KEY is set but MAIL_FROM is not an address ("Loyalty <cards@example.com>").')
  else ok(`Reset emails on, from ${env.MAIL_FROM}.`)

  // Database
  const dbPath = env.DB_PATH ?? 'data/loyalty.db'
  try {
    mkdirSync(dirname(dbPath), { recursive: true })
    accessSync(dirname(dbPath), constants.W_OK)
    ok(`The database goes in ${dbPath}${existsSync(dbPath) ? ' (it exists)' : ''}. Back it up: npm run backup.`)
  } catch {
    fail(`Cannot write to the folder of DB_PATH (${dbPath}).`)
  }
  return out
}

/** What only the internet can answer: does PUBLIC_URL reach this server, does Google accept our key. */
export async function diagnoseOnline(env: Env, f: typeof fetch = fetch): Promise<Result[]> {
  const out: Result[] = []
  const url = (env.PUBLIC_URL ?? '').replace(/\/$/, '')
  try {
    const r = await f(`${url}/health`, { signal: AbortSignal.timeout(10_000) })
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean }
    if (r.ok && body.ok) out.push({ level: 'ok', text: `${url}/health answers: the server is reachable at PUBLIC_URL.` })
    else out.push({ level: 'fail', text: `${url}/health answered ${r.status}: something else is at that address.` })
  } catch (e) {
    out.push({ level: 'fail', text: `${url} does not answer (${(e as Error).message}). Is the server running, and the tunnel or host pointing at it?` })
  }
  if (env.GOOGLE_ISSUER_ID) {
    try {
      const k = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || readFileSync(env.GOOGLE_SERVICE_ACCOUNT_PATH ?? '', 'utf8')) as { client_email: string; private_key: string }
      const now = Math.floor(Date.now() / 1000)
      const tokenUrl = 'https://oauth2.googleapis.com/token'
      const assertion = signJwt({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: tokenUrl, iat: now, exp: now + 600 }, k.private_key)
      const t = await f(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
      if (!t.ok) throw new Error(`Google refused the key (${t.status}): make a new key for the service account`)
      const { access_token } = (await t.json()) as { access_token: string }
      const r = await f(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass?issuerId=${env.GOOGLE_ISSUER_ID}`, { headers: { Authorization: `Bearer ${access_token}` } })
      if (r.ok) out.push({ level: 'ok', text: 'Google accepts the service account on our issuer.' })
      else if (r.status === 403) out.push({ level: 'fail', text: `Google signs the service account in, but it has no access to issuer ${env.GOOGLE_ISSUER_ID}: invite ${k.client_email} as Developer in the Google Pay & Wallet Console (docs/MANUAL_STEPS.md §5, point 6).` })
      else out.push({ level: 'fail', text: `Google Wallet API answered ${r.status}. Is the Google Wallet API enabled on the service account's Cloud project?` })
    } catch (e) {
      out.push({ level: 'fail', text: `Google: ${(e as Error).message}` })
    }
  }
  return out
}

const MARK: Record<Level, string> = { ok: '✓', warn: '!', fail: '✗' }

async function main() {
  const { values } = parseArgs({ options: { online: { type: 'boolean' } } })
  const results = diagnose(process.env)
  if (values.online) results.push(...(await diagnoseOnline(process.env)))
  for (const r of results) console.log(`${MARK[r.level]} ${r.text}`)
  const failed = results.filter((r) => r.level === 'fail').length
  console.log(failed ? `\n${failed} to fix before a phone test.` : '\nReady.' + (values.online ? '' : ' Run with --online once the server is up, for the internet checks.'))
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main()
