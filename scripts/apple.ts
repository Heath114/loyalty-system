/**
 * The Apple side of signing cards, without openssl: the same on a Mac, Windows or Linux.
 *
 *   npm run apple -- csr                   Makes certs/pass.key (once, never overwritten) and the request Apple
 *                                          asks for, certs/pass.csr, with a copy on the Desktop as loyalty-pass.csr.
 *   npm run apple -- cert ~/Downloads/pass.cer
 *                                          Turns the certificate Apple gave back into certs/pass.pem, after checking
 *                                          it belongs to our key and names our Pass Type ID and team.
 *   npm run apple -- p12 ~/Downloads/pass.p12 [--password ...]
 *                                          Only if the certificate was made through Keychain Access instead: splits
 *                                          the exported .p12 into certs/pass.pem and certs/pass.key.
 *   npm run apple -- wwdr                  Downloads Apple's WWDR G4 intermediate to certs/wwdr-g4.pem and checks
 *                                          its fingerprint.
 *
 * docs/MANUAL_STEPS.md step 2 says what to click on developer.apple.com in between.
 */
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import forge from 'node-forge'

export const SUBJECT = { CN: 'loyalty pass', O: 'Al Hujra Information Technology LLC', C: 'JO' }
export const WWDR_G4_URL = 'https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer'
/** SHA-256 of Apple's WWDR G4 certificate, from apple.com/certificateauthority (valid until 2030-12-10). */
export const WWDR_G4_SHA256 = 'EA:47:57:88:55:38:DD:8C:B5:9F:F4:55:6F:67:60:87:D8:3C:85:E7:09:02:C1:22:E4:2C:08:08:B5:BC:E1:4C'
const UID_OID = '0.9.2342.19200300.100.1.1'

/**
 * SHA-256 of the public key in PEM, the same number `openssl pkey -pubout | openssl sha256` prints:
 * a key and a certificate belong together when theirs match.
 */
export function publicKeyHash(keyOrCertPem: string): string {
  const pub = keyOrCertPem.includes('CERTIFICATE') ? new X509Certificate(keyOrCertPem).publicKey : createPublicKey(createPrivateKey(keyOrCertPem))
  return createHash('sha256').update(pub.export({ type: 'spki', format: 'pem' }) as string).digest('hex')
}

/** A new RSA 2048 key, and a certificate signing request for it with our company's name. */
export function makeKeyAndCsr(existingKeyPem?: string): { keyPem: string; csrPem: string } {
  const key = existingKeyPem ? forge.pki.privateKeyFromPem(existingKeyPem) : forge.pki.rsa.generateKeyPair(2048).privateKey
  const rsa = key as forge.pki.rsa.PrivateKey
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = forge.pki.setRsaPublicKey(rsa.n, rsa.e)
  csr.setSubject([
    { name: 'commonName', value: SUBJECT.CN },
    { name: 'organizationName', value: SUBJECT.O },
    { name: 'countryName', value: SUBJECT.C },
  ])
  csr.sign(rsa, forge.md.sha256.create())
  return { keyPem: existingKeyPem ?? forge.pki.privateKeyToPem(rsa), csrPem: forge.pki.certificationRequestToPem(csr) }
}

export interface PassCertInfo {
  pem: string
  passTypeId: string | null
  teamId: string | null
  validTo: Date
  issuer: string
}

/** The certificate Apple hands back (pass.cer, DER) or a PEM of it, read. */
export function readPassCert(data: Buffer): PassCertInfo {
  const x = new X509Certificate(data)
  const forgeCert = forge.pki.certificateFromPem(x.toString())
  const uid = forgeCert.subject.getField({ type: UID_OID }) as { value: string } | null
  const ou = forgeCert.subject.getField('OU') as { value: string } | null
  return { pem: x.toString(), passTypeId: uid?.value ?? null, teamId: ou?.value ?? null, validTo: new Date(x.validTo), issuer: x.issuer }
}

/** Problems with a pass certificate against our key and settings; empty when it is right. */
export function checkPassCert(cert: PassCertInfo, keyPem: string, want: { passTypeId?: string; teamId?: string }, now = new Date()): string[] {
  const problems: string[] = []
  if (publicKeyHash(cert.pem) !== publicKeyHash(keyPem)) {
    problems.push('This certificate does not belong to certs/pass.key: it was made from another CSR. Make it again from the CSR this key made.')
  }
  if (want.passTypeId && cert.passTypeId !== want.passTypeId) problems.push(`It is for ${cert.passTypeId}, but PASS_TYPE_ID is ${want.passTypeId}.`)
  if (want.teamId && cert.teamId !== want.teamId) problems.push(`It belongs to team ${cert.teamId}, but APPLE_TEAM_ID is ${want.teamId}.`)
  if (cert.validTo <= now) problems.push(`It expired on ${cert.validTo.toISOString().slice(0, 10)}.`)
  return problems
}

/** Splits a Keychain export: the certificate and its key, unencrypted (the key file stays on this machine, mode 600). */
export function splitP12(data: Buffer, password: string): { certPem: string; keyPem: string } {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(data.toString('binary')), password)
  const bag = (type: string) => (p12.getBags({ bagType: type })[type] ?? [])[0]
  const cert = bag(forge.pki.oids.certBag)?.cert
  const key = (bag(forge.pki.oids.pkcs8ShroudedKeyBag) ?? bag(forge.pki.oids.keyBag))?.key
  if (!cert || !key) throw new Error('The .p12 has no certificate and key in it. Export both from Keychain (the certificate, with its key underneath).')
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(key) }
}

export function fingerprint(der: Buffer): string {
  return new X509Certificate(der).fingerprint256
}

function day(d: Date) {
  return d.toISOString().slice(0, 10)
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values: a, positionals } = parseArgs({ args: rest, options: { password: { type: 'string' } }, allowPositionals: true })
  mkdirSync('certs', { recursive: true })
  const keyPath = 'certs/pass.key'
  const want = { passTypeId: process.env.PASS_TYPE_ID || 'pass.com.theoffice.loyalty', teamId: process.env.APPLE_TEAM_ID || 'LZ8RFD29KM' }

  switch (command) {
    case 'csr': {
      const had = existsSync(keyPath)
      const { keyPem, csrPem } = makeKeyAndCsr(had ? readFileSync(keyPath, 'utf8') : undefined)
      if (!had) writeFileSync(keyPath, keyPem, { mode: 0o600 })
      writeFileSync('certs/pass.csr', csrPem)
      const desktop = join(homedir(), 'Desktop')
      const copy = existsSync(desktop) ? join(desktop, 'loyalty-pass.csr') : null
      if (copy) copyFileSync('certs/pass.csr', copy)
      console.log(had ? `Kept the key already in ${keyPath}.` : `Made a new private key: ${keyPath}. It never leaves this machine.`)
      console.log(`Request for Apple: certs/pass.csr${copy ? `, copied to ${copy}` : ''}.`)
      console.log(`Subject: CN=${SUBJECT.CN}, O=${SUBJECT.O}, C=${SUBJECT.C}. Public key SHA-256 starts ${publicKeyHash(keyPem).slice(0, 16)}.`)
      console.log(`\nNext: developer.apple.com → Identifiers → the Pass Type ID ${want.passTypeId} → Create Certificate → upload that file → Download pass.cer.`)
      break
    }
    case 'cert': {
      const file = positionals[0] ?? join(homedir(), 'Downloads', 'pass.cer')
      if (!existsSync(file)) throw new Error(`${file} does not exist. Download pass.cer from developer.apple.com first.`)
      if (!existsSync(keyPath)) throw new Error(`${keyPath} is missing: the certificate must be paired with the key that made its CSR.`)
      const cert = readPassCert(readFileSync(file))
      const problems = checkPassCert(cert, readFileSync(keyPath, 'utf8'), want)
      console.log(`Certificate for ${cert.passTypeId}, team ${cert.teamId}, valid until ${day(cert.validTo)}.`)
      if (problems.length) {
        for (const p of problems) console.error(`✗ ${p}`)
        process.exitCode = 1
        return
      }
      writeFileSync('certs/pass.pem', cert.pem)
      console.log('✓ It belongs to certs/pass.key. Saved as certs/pass.pem.')
      console.log(`Put ${day(new Date(cert.validTo.getTime() - 30 * 86400e3))} in the calendar: renew a month before it expires (docs/MANUAL_STEPS.md §2).`)
      break
    }
    case 'p12': {
      const file = positionals[0]
      if (!file || !existsSync(file)) throw new Error('Give the .p12 file exported from Keychain: npm run apple -- p12 ~/Desktop/pass.p12 --password ...')
      if (existsSync(keyPath)) throw new Error(`${keyPath} already exists. Move it aside first if this .p12 is meant to replace it.`)
      const { certPem, keyPem } = splitP12(readFileSync(file), a.password ?? '')
      const problems = checkPassCert(readPassCert(Buffer.from(certPem)), keyPem, want)
      if (problems.length) {
        for (const p of problems) console.error(`✗ ${p}`)
        process.exitCode = 1
        return
      }
      writeFileSync(keyPath, keyPem, { mode: 0o600 })
      writeFileSync('certs/pass.pem', certPem)
      console.log('✓ Saved certs/pass.pem and certs/pass.key. Delete the .p12 from the Desktop or Downloads now.')
      break
    }
    case 'wwdr': {
      const r = await fetch(WWDR_G4_URL)
      if (!r.ok) throw new Error(`apple.com answered ${r.status}`)
      const der = Buffer.from(await r.arrayBuffer())
      const fp = fingerprint(der)
      if (fp !== WWDR_G4_SHA256) throw new Error(`Unexpected fingerprint ${fp}: not saved. Check ${WWDR_G4_URL} by hand.`)
      const x = new X509Certificate(der)
      writeFileSync('certs/wwdr-g4.pem', x.toString())
      console.log(`✓ certs/wwdr-g4.pem, Apple WWDR G4, fingerprint checked, valid until ${day(new Date(x.validTo))}.`)
      break
    }
    default:
      console.log('Commands: csr, cert <pass.cer>, p12 <file.p12> [--password ...], wwdr. See the top of scripts/apple.ts.')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`)
    process.exitCode = 1
  })
}
