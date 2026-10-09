import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U

/** A card serial: 16 base32 characters, 80 bits of randomness, easy to read out loud. */
export function newSerial(): string {
  const bytes = randomBytes(16)
  let s = ''
  for (let i = 0; i < 16; i++) s += ALPHABET[bytes[i] & 31]
  return s
}

/** Apple's authenticationToken for the pass web service. Must be at least 16 characters. */
export function newAuthToken(): string {
  return randomBytes(24).toString('base64url')
}

export function newStaffKey(): string {
  return 'sk_' + randomBytes(24).toString('base64url')
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function mac(secret: string, purpose: string, serial: string, length: number): string {
  return createHmac('sha256', secret).update(`${purpose}:${serial}`).digest('base64url').slice(0, length)
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * What the card's QR (and later its NFC payload) carries: "L1.<serial>.<mac>". 36 characters, well
 * under the 64 bytes an NFC pass message allows. The mac means a serial alone, read off a screen or
 * guessed, cannot be turned into a scannable card.
 */
export function barcodeMessage(secret: string, serial: string): string {
  return `L1.${serial}.${mac(secret, 'barcode', serial, 16)}`
}

/** Returns the serial if the scanned message is genuine, otherwise null. */
export function parseBarcode(secret: string, message: string): string | null {
  const m = /^L1\.([0-9A-Z]{16})\.([A-Za-z0-9_-]{16})$/.exec(message.trim())
  if (!m) return null
  return safeEqual(m[2], mac(secret, 'barcode', m[1], 16)) ? m[1] : null
}

/** Token in the customer's card link, so a serial alone does not open someone else's card page. */
export function linkToken(secret: string, serial: string): string {
  return mac(secret, 'link', serial, 22)
}

export function checkLinkToken(secret: string, serial: string, token: string | undefined): boolean {
  return !!token && safeEqual(token, linkToken(secret, serial))
}

export { safeEqual }
