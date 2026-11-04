import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { tx, type DB } from './db.ts'
import { LoyaltyError, touchMerchant, type Merchant } from './loyalty.ts'
import { isPng, parseColor } from './pass/png.ts'
import { newStaffKey, sha256 } from './tokens.ts'

/**
 * The people who run a merchant's program from the dashboard, how they sign in, and the merchant
 * settings only they may change. Every admin belongs to exactly one merchant, and every session
 * resolves to that merchant, so the dashboard can never reach another merchant's data.
 */

export interface Admin {
  id: number
  merchant_id: number
  email: string
  name: string | null
  password_hash: string
  must_change: number
  created_at: number
  password_changed_at: number
  disabled_at: number | null
}

export const MIN_PASSWORD = 10
const SESSION_DAYS = 30
const DAY_MS = 86_400_000
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

function scryptAsync(password: string, salt: Buffer, keylen: number, o: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { ...o, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64')}:${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split(':')
  if (scheme !== 'scrypt' || !key) return false
  const want = Buffer.from(key, 'base64')
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) })
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Checked against when the email is unknown, so a wrong email takes as long as a wrong password. */
let decoy: Promise<string> | undefined

/** A password we hand out once (new admin, reset): 4 groups of 4 from an alphabet without look-alikes. */
export function temporaryPassword(): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'
  const group = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join('')
  return [group(), group(), group(), group()].join('-')
}

function checkPassword(password: unknown): string {
  const p = String(password ?? '')
  if (p.length < MIN_PASSWORD) throw new LoyaltyError(`Use at least ${MIN_PASSWORD} characters`)
  if (p.length > 200) throw new LoyaltyError('That password is too long')
  return p
}

function checkEmail(email: unknown): string {
  const e = String(email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 200) throw new LoyaltyError('Please check the email address')
  return e
}

export function adminById(db: DB, merchantId: number, id: number): Admin {
  const a = db.prepare('SELECT * FROM admins WHERE id = ? AND merchant_id = ?').get(id, merchantId) as Admin | undefined
  if (!a) throw new LoyaltyError('Admin not found', 404)
  return a
}

export function admins(db: DB, merchantId: number) {
  return db
    .prepare(
      `SELECT a.id, a.email, a.name, a.must_change, a.created_at, a.disabled_at,
         (SELECT MAX(s.last_seen_at) FROM admin_sessions s WHERE s.admin_id = a.id) AS last_seen_at
       FROM admins a WHERE a.merchant_id = ? ORDER BY a.disabled_at IS NOT NULL, a.id`,
    )
    .all(merchantId) as { id: number; email: string; name: string | null; must_change: number; created_at: number; disabled_at: number | null; last_seen_at: number | null }[]
}

/** A new admin with a temporary password, returned once to be passed on; they set their own at first sign-in. */
export async function createAdmin(db: DB, m: Merchant, input: { email: string; name?: string | null }): Promise<{ admin: Admin; password: string }> {
  const email = checkEmail(input.email)
  const name = String(input.name ?? '').trim().slice(0, 80) || null
  if (db.prepare('SELECT 1 FROM admins WHERE email = ?').get(email)) throw new LoyaltyError('That email already has a sign-in', 409)
  const password = temporaryPassword()
  const hash = await hashPassword(password)
  const now = Date.now()
  const { lastInsertRowid } = db
    .prepare('INSERT INTO admins (merchant_id, email, name, password_hash, must_change, created_at, password_changed_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(m.id, email, name, hash, now, now)
  return { admin: adminById(db, m.id, Number(lastInsertRowid)), password }
}

/** A forgotten password: a new temporary one, and every session of that admin ends. */
export async function resetAdminPassword(db: DB, email: string): Promise<{ admin: Admin; password: string }> {
  const a = db.prepare('SELECT * FROM admins WHERE email = ?').get(checkEmail(email)) as Admin | undefined
  if (!a) throw new LoyaltyError('No admin with that email', 404)
  const password = temporaryPassword()
  const hash = await hashPassword(password)
  tx(db, () => {
    db.prepare('UPDATE admins SET password_hash = ?, must_change = 1, password_changed_at = ?, disabled_at = NULL WHERE id = ?').run(hash, Date.now(), a.id)
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(a.id)
  })
  return { admin: a, password }
}

/** Takes an admin's access away: their sessions end at once. An admin cannot remove themselves. */
export function disableAdmin(db: DB, m: Merchant, id: number, by: Admin): void {
  if (id === by.id) throw new LoyaltyError('You cannot remove your own sign-in', 409)
  adminById(db, m.id, id)
  tx(db, () => {
    db.prepare('UPDATE admins SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ? AND merchant_id = ?').run(Date.now(), id, m.id)
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(id)
  })
}

/** Repeated wrong passwords for one email slow down to a stop: 8 failures in 15 minutes locks it for the rest of that window. */
const FAIL_WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 8
const failures = new Map<string, number[]>()

function recentFailures(email: string, now: number): number[] {
  const list = (failures.get(email) ?? []).filter((t) => t > now - FAIL_WINDOW_MS)
  if (list.length) failures.set(email, list)
  else failures.delete(email)
  return list
}

/** For tests: forget the failure counts. */
export function resetLoginThrottle(): void {
  failures.clear()
}

export interface Session {
  token: string
  admin: Admin
  expiresAt: number
}

function newSession(db: DB, admin: Admin, now = Date.now()): Session {
  const token = 'as_' + randomBytes(32).toString('base64url')
  const expiresAt = now + SESSION_DAYS * DAY_MS
  db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token), admin.id, now, expiresAt, now,
  )
  return { token, admin, expiresAt }
}

export async function login(db: DB, emailInput: unknown, password: unknown): Promise<Session> {
  const now = Date.now()
  const email = String(emailInput ?? '').trim().toLowerCase()
  if (recentFailures(email, now).length >= MAX_FAILURES) throw new LoyaltyError('Too many attempts. Try again in 15 minutes.', 429)
  const a = db.prepare('SELECT * FROM admins WHERE email = ? AND disabled_at IS NULL').get(email) as Admin | undefined
  decoy ??= hashPassword(randomBytes(16).toString('hex'))
  const ok = await verifyPassword(String(password ?? ''), a?.password_hash ?? (await decoy))
  if (!a || !ok) {
    failures.set(email, [...recentFailures(email, now), now])
    throw new LoyaltyError('Email or password is not right', 401)
  }
  failures.delete(email)
  // Expired sessions are swept here rather than by a timer: sign-ins are rare enough.
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now)
  return newSession(db, a, now)
}

/**
 * The admin a bearer token belongs to, or undefined. Sessions slide: each use (at most once a minute)
 * pushes the expiry 30 days out.
 */
export function sessionAdmin(db: DB, token: string | undefined): Admin | undefined {
  if (!token) return undefined
  const now = Date.now()
  const hash = sha256(token)
  const row = db
    .prepare(
      `SELECT a.*, s.last_seen_at AS session_seen FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND a.disabled_at IS NULL`,
    )
    .get(hash, now) as (Admin & { session_seen: number }) | undefined
  if (!row) return undefined
  if (row.session_seen < now - 60_000) {
    db.prepare('UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now, now + SESSION_DAYS * DAY_MS, hash)
  }
  const { session_seen: _, ...admin } = row
  return admin
}

export function logout(db: DB, token: string): void {
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token))
}

/** Changes the admin's own password. Every other session of theirs ends; this one stays. */
export async function changePassword(db: DB, admin: Admin, token: string, current: unknown, next: unknown): Promise<void> {
  if (!(await verifyPassword(String(current ?? ''), admin.password_hash))) throw new LoyaltyError('Your current password is not right', 403)
  const password = checkPassword(next)
  if (password === String(current)) throw new LoyaltyError('Choose a new password, not the one you have')
  const hash = await hashPassword(password)
  tx(db, () => {
    db.prepare('UPDATE admins SET password_hash = ?, must_change = 0, password_changed_at = ? WHERE id = ?').run(hash, Date.now(), admin.id)
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?').run(admin.id, sha256(token))
  })
}

// ---------------------------------------------------------------------------------------------
// Merchant settings

export interface MerchantInput {
  name?: string
  name_ar?: string | null
  program?: 'stamps' | 'points'
  reward_threshold?: number
  points_per_jod?: number
  reward_text?: string
  reward_text_ar?: string | null
  bg_color?: string
  fg_color?: string
  label_color?: string
  timezone?: string
}

function text(v: unknown, what: string, max: number, required: boolean): string | null {
  const t = String(v ?? '').trim()
  if (!t) {
    if (required) throw new LoyaltyError(`Write the ${what}`)
    return null
  }
  if (t.length > max) throw new LoyaltyError(`Keep the ${what} under ${max} characters`)
  return t
}

function color(v: unknown): string {
  try {
    return `rgb(${parseColor(String(v ?? '').trim()).join(',')})`
  } catch {
    throw new LoyaltyError('Colours are #rrggbb or rgb(r,g,b)')
  }
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Changes what the merchant's cards say and how they earn. Every card in every wallet refreshes. The
 * program type only changes before the first purchase: a balance of 40 stamps does not mean 40 points.
 */
export function updateMerchant(db: DB, m: Merchant, input: MerchantInput): Merchant {
  const v = {
    name: input.name === undefined ? m.name : text(input.name, 'business name', 60, true)!,
    name_ar: input.name_ar === undefined ? m.name_ar : text(input.name_ar, 'Arabic business name', 60, false),
    program: input.program ?? m.program,
    reward_threshold: input.reward_threshold === undefined ? m.reward_threshold : Number(input.reward_threshold),
    points_per_jod: input.points_per_jod === undefined ? m.points_per_jod : Number(input.points_per_jod),
    reward_text: input.reward_text === undefined ? m.reward_text : text(input.reward_text, 'reward', 80, true)!,
    reward_text_ar: input.reward_text_ar === undefined ? m.reward_text_ar : text(input.reward_text_ar, 'Arabic reward', 80, false),
    bg_color: input.bg_color === undefined ? m.bg_color : color(input.bg_color),
    fg_color: input.fg_color === undefined ? m.fg_color : color(input.fg_color),
    label_color: input.label_color === undefined ? m.label_color : color(input.label_color),
    timezone: input.timezone === undefined ? m.timezone : String(input.timezone),
  }
  if (v.program !== 'stamps' && v.program !== 'points') throw new LoyaltyError('The program is stamps or points')
  const most = v.program === 'stamps' ? 50 : 1_000_000
  if (!(Number.isInteger(v.reward_threshold) && v.reward_threshold >= 1 && v.reward_threshold <= most)) {
    throw new LoyaltyError(v.program === 'stamps' ? 'A stamp card holds between 1 and 50 stamps' : 'The reward needs a whole number of points')
  }
  if (!(Number.isFinite(v.points_per_jod) && v.points_per_jod > 0 && v.points_per_jod <= 1000)) {
    throw new LoyaltyError('Points per JOD must be more than 0 and at most 1000')
  }
  if (!validTimeZone(v.timezone)) throw new LoyaltyError('Unknown time zone')
  return tx(db, () => {
    if (v.program !== m.program) {
      const used = db.prepare('SELECT 1 FROM ledger WHERE merchant_id = ? LIMIT 1').get(m.id)
      if (used) throw new LoyaltyError('The program cannot change after the first purchase: balances would change meaning', 409)
      const rates = db.prepare("SELECT 1 FROM categories WHERE merchant_id = ? AND earn = 'rate' AND archived_at IS NULL LIMIT 1").get(m.id)
      if (v.program === 'stamps' && rates) throw new LoyaltyError('Change the categories that earn per JOD first: a stamp card has none', 409)
    }
    db.prepare(
      `UPDATE merchants SET name = ?, name_ar = ?, program = ?, reward_threshold = ?, points_per_jod = ?, reward_text = ?,
         reward_text_ar = ?, bg_color = ?, fg_color = ?, label_color = ?, timezone = ? WHERE id = ?`,
    ).run(
      v.name, v.name_ar, v.program, v.reward_threshold, v.points_per_jod, v.reward_text, v.reward_text_ar, v.bg_color, v.fg_color,
      v.label_color, v.timezone, m.id,
    )
    touchMerchant(db, m.id)
    return db.prepare('SELECT * FROM merchants WHERE id = ?').get(m.id) as unknown as Merchant
  })
}

// ---------------------------------------------------------------------------------------------
// Images

/**
 * What a merchant uploads, and where each goes. Wallet scales a larger image down to the slot, so
 * one upload per slot is enough: the base name is all Apple requires, and Google gets the square.
 */
export const IMAGE_SLOTS = {
  /** Apple: notifications and the lock screen. Square, shown at 29 points; 87 px or more looks sharp. */
  icon: { file: 'icon.png', square: true, min: 58, replaces: ['icon@2x.png', 'icon@3x.png'] },
  /** Apple: top left of the card. Wide, shown up to 160 by 50 points; 480 by 150 px looks sharp. */
  logo: { file: 'logo.png', square: false, min: 50, replaces: ['logo@2x.png', 'logo@3x.png'] },
  /** Google Wallet's logo, shown in a circle. Square, at least 660 px. */
  square: { file: 'square.png', square: true, min: 660, replaces: [] as string[] },
} as const

export type ImageSlot = keyof typeof IMAGE_SLOTS
export const MAX_IMAGE_BYTES = 300 * 1024

export function pngSize(png: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

export function setImage(db: DB, m: Merchant, slot: string, png: Uint8Array): { width: number; height: number } {
  const spec = IMAGE_SLOTS[slot as ImageSlot]
  if (!spec) throw new LoyaltyError('Unknown image', 404)
  if (png.byteLength > MAX_IMAGE_BYTES) throw new LoyaltyError('Keep the image under 300 KB')
  if (!isPng(png) || png.byteLength < 33) throw new LoyaltyError('The image must be a PNG')
  const size = pngSize(png)
  if (size.width > 2000 || size.height > 2000) throw new LoyaltyError('Keep the image under 2000 pixels on each side')
  if (spec.square && size.width !== size.height) throw new LoyaltyError('This image must be square')
  if (Math.min(size.width, size.height) < spec.min) throw new LoyaltyError(`This image needs at least ${spec.min} pixels`)
  tx(db, () => {
    for (const old of spec.replaces) db.prepare('DELETE FROM merchant_images WHERE merchant_id = ? AND name = ?').run(m.id, old)
    db.prepare('INSERT INTO merchant_images (merchant_id, name, png) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET png = excluded.png').run(m.id, spec.file, png)
    touchMerchant(db, m.id)
  })
  return size
}

export function removeImage(db: DB, m: Merchant, slot: string): void {
  const spec = IMAGE_SLOTS[slot as ImageSlot]
  if (!spec) throw new LoyaltyError('Unknown image', 404)
  tx(db, () => {
    for (const name of [spec.file, ...spec.replaces]) db.prepare('DELETE FROM merchant_images WHERE merchant_id = ? AND name = ?').run(m.id, name)
    touchMerchant(db, m.id)
  })
}

/** Which slots have an upload, with its size. */
export function imageSlots(db: DB, m: Merchant): Record<ImageSlot, { width: number; height: number } | null> {
  const out = {} as Record<ImageSlot, { width: number; height: number } | null>
  for (const [slot, spec] of Object.entries(IMAGE_SLOTS) as [ImageSlot, (typeof IMAGE_SLOTS)[ImageSlot]][]) {
    const row = db.prepare('SELECT png FROM merchant_images WHERE merchant_id = ? AND name = ?').get(m.id, spec.file) as { png: Uint8Array } | undefined
    out[slot] = row && isPng(row.png) && row.png.byteLength >= 33 ? pngSize(row.png) : null
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Staff keys and branches typed by hand

/** A key for one counter device. Shown once: only its hash is kept. */
export function createStaffKey(db: DB, m: Merchant, label: unknown): { id: number; key: string } {
  const l = String(label ?? '').trim().slice(0, 60) || 'Counter'
  const key = newStaffKey()
  const { lastInsertRowid } = db.prepare('INSERT INTO staff (merchant_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)').run(m.id, l, sha256(key), Date.now())
  return { id: Number(lastInsertRowid), key }
}

export function staffList(db: DB, merchantId: number) {
  return db
    .prepare('SELECT id, label, created_at, revoked_at, last_used_at FROM staff WHERE merchant_id = ? ORDER BY revoked_at IS NOT NULL, id')
    .all(merchantId) as { id: number; label: string; created_at: number; revoked_at: number | null; last_used_at: number | null }[]
}

export function revokeStaff(db: DB, m: Merchant, id: number): void {
  const { changes } = db.prepare('UPDATE staff SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND merchant_id = ?').run(Date.now(), id, m.id)
  if (!changes) throw new LoyaltyError('Staff key not found', 404)
}

/**
 * "31.9539, 35.8836", or a Google Maps link (".../@31.9539,35.8836,17z" or "?q=31.9539,35.8836"),
 * as a latitude and longitude.
 */
export function parseLatLng(input: string): { latitude: number; longitude: number } {
  const s = String(input ?? '').trim()
  const m = /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s)
    ?? /[?&](?:q|query|ll)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s)
    ?? /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(s)
  if (!m) throw new LoyaltyError('Paste the coordinates (31.9539, 35.8836) or a Google Maps link to the place')
  const latitude = Number(m[1])
  const longitude = Number(m[2])
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new LoyaltyError('Latitude or longitude out of range')
  return { latitude, longitude }
}
