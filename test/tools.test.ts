import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import forge from 'node-forge'
import { checkPassCert, makeKeyAndCsr, publicKeyHash, readPassCert, splitP12 } from '../scripts/apple.ts'
import { backup } from '../scripts/backup.ts'
import { diagnose } from '../scripts/doctor.ts'
import { makeDevCerts } from '../scripts/dev-certs.ts'
import { openDb } from '../src/db.ts'
import { createMerchant } from '../src/loyalty.ts'

const dir = mkdtempSync(join(tmpdir(), 'loyalty-tools-'))
after(() => rmSync(dir, { recursive: true, force: true }))

/** What developer.apple.com does with our CSR: a certificate for its key, naming the Pass Type ID and team. */
function appleIssues(csrPem: string, opts: { passTypeId?: string; teamId?: string; days?: number } = {}) {
  const ca = forge.pki.rsa.generateKeyPair(1024)
  const csr = forge.pki.certificationRequestFromPem(csrPem)
  assert.ok(csr.verify(), 'the CSR is signed by its own key')
  const cert = forge.pki.createCertificate()
  cert.publicKey = csr.publicKey!
  cert.serialNumber = '05'
  cert.validity.notBefore = new Date(Date.now() - 86400e3)
  cert.validity.notAfter = new Date(Date.now() + (opts.days ?? 365) * 86400e3)
  const passTypeId = opts.passTypeId ?? 'pass.com.theoffice.loyalty'
  cert.setSubject([
    { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
    { name: 'commonName', value: `Pass Type ID: ${passTypeId}` },
    { shortName: 'OU', value: opts.teamId ?? 'LZ8RFD29KM' },
  ])
  cert.setIssuer([{ name: 'commonName', value: 'Apple Worldwide Developer Relations Certification Authority' }])
  cert.sign(ca.privateKey, forge.md.sha256.create())
  // pass.cer comes as DER.
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
}

const want = { passTypeId: 'pass.com.theoffice.loyalty', teamId: 'LZ8RFD29KM' }

test('apple: a CSR with our name, and the certificate Apple returns for it checks out', () => {
  const { keyPem, csrPem } = makeKeyAndCsr()
  const csr = forge.pki.certificationRequestFromPem(csrPem)
  assert.equal(csr.subject.getField('O').value, 'Al Hujra Information Technology LLC')
  assert.equal(csr.subject.getField('C').value, 'JO')

  const cert = readPassCert(appleIssues(csrPem))
  assert.equal(cert.passTypeId, 'pass.com.theoffice.loyalty')
  assert.equal(cert.teamId, 'LZ8RFD29KM')
  assert.match(cert.pem, /^-----BEGIN CERTIFICATE-----/)
  assert.deepEqual(checkPassCert(cert, keyPem, want), [])
  assert.equal(publicKeyHash(cert.pem), publicKeyHash(keyPem))

  // The same key makes the same request again (a renewal), never a new key.
  const again = makeKeyAndCsr(keyPem)
  assert.equal(again.keyPem, keyPem)
  assert.equal(publicKeyHash(again.keyPem), publicKeyHash(keyPem))
})

test('apple: a certificate for another key, another identifier or team, or expired, is refused with the reason', () => {
  const { keyPem, csrPem } = makeKeyAndCsr()
  const other = makeKeyAndCsr()
  assert.match(checkPassCert(readPassCert(appleIssues(other.csrPem)), keyPem, want).join(' '), /does not belong to certs\/pass\.key/)
  assert.match(checkPassCert(readPassCert(appleIssues(csrPem, { passTypeId: 'pass.com.other' })), keyPem, want).join(' '), /It is for pass\.com\.other/)
  assert.match(checkPassCert(readPassCert(appleIssues(csrPem, { teamId: 'ABCDE12345' })), keyPem, want).join(' '), /team ABCDE12345/)
  assert.match(checkPassCert(readPassCert(appleIssues(csrPem, { days: 1 })), keyPem, want, new Date(Date.now() + 3 * 86400e3)).join(' '), /expired/)
})

test('apple: a Keychain .p12 splits into the certificate and its key', () => {
  const { keyPem, csrPem } = makeKeyAndCsr()
  const certPem = new X509Certificate(appleIssues(csrPem)).toString()
  const p12 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(keyPem), [forge.pki.certificateFromPem(certPem)], 'secret pw', { algorithm: '3des' })
  const out = splitP12(Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), 'secret pw')
  assert.equal(publicKeyHash(out.keyPem), publicKeyHash(keyPem))
  assert.equal(new X509Certificate(out.certPem).fingerprint256, new X509Certificate(certPem).fingerprint256)
  assert.throws(() => splitP12(Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), 'wrong'))
})

function devEnv() {
  const c = makeDevCerts()
  const write = (name: string, text: string) => {
    const p = join(dir, `${Math.random().toString(36).slice(2)}-${name}`)
    writeFileSync(p, text, { mode: 0o600 })
    return p
  }
  return {
    c,
    write,
    env: {
      PUBLIC_URL: 'https://cards.example.com', APP_SECRET: 'x'.repeat(40), PASS_TYPE_ID: c.passTypeIdentifier, APPLE_TEAM_ID: c.teamIdentifier,
      PASS_CERT_PATH: write('pass.pem', c.certPem), PASS_KEY_PATH: write('pass.key', c.keyPem), WWDR_CERT_PATH: write('wwdr.pem', c.wwdrPem),
      DB_PATH: join(dir, 'doctor', 'loyalty.db'),
    } as Record<string, string | undefined>,
  }
}

test('doctor: a complete setup has nothing to fix, and signs a card', () => {
  const { env } = devEnv()
  const r = diagnose(env)
  assert.deepEqual(r.filter((x) => x.level === 'fail'), [])
  assert.ok(r.some((x) => /A test card builds and signs/.test(x.text)))
  assert.ok(r.some((x) => x.level === 'warn' && /stand-in development certificates/.test(x.text)))
})

test('doctor: says what is wrong, in words', () => {
  const { env, write } = devEnv()
  const fails = (e: Record<string, string | undefined>) => diagnose(e).filter((x) => x.level === 'fail').map((x) => x.text).join('\n')

  assert.match(fails({ ...env, PASS_KEY_PATH: write('other.key', makeDevCerts().keyPem) }), /does not belong to certs\/pass\.key/)
  assert.match(fails({ ...env, PASS_TYPE_ID: 'pass.com.other' }), /PASS_TYPE_ID is pass\.com\.other/)
  assert.match(fails({ ...env, WWDR_CERT_PATH: write('wwdr2.pem', makeDevCerts().wwdrPem) }), /not the one that issued/)
  assert.match(fails({ ...env, PASS_CERT_PATH: join(dir, 'missing.pem') }), /does not exist/)
  assert.match(fails({ ...env, APP_SECRET: '' }), /APP_SECRET is empty/)
  assert.match(fails({ ...env, PUBLIC_URL: 'https://cards.example.com/path' }), /no path/)
  assert.match(fails({ ...env, GOOGLE_ISSUER_ID: '3388000000023224499', GOOGLE_SERVICE_ACCOUNT_PATH: write('g.json', '{"type":"user"}') }), /not a service account key/)
  assert.match(fails({ ...env, RESEND_API_KEY: 're_x', MAIL_FROM: '' }), /MAIL_FROM/)
  assert.ok(diagnose({ ...env, PUBLIC_URL: 'http://192.168.1.5:8787' }).some((x) => x.level === 'warn' && /never sends them updates/.test(x.text)))
})

test('backup: a consistent copy, the newest kept, nothing else in the folder touched', () => {
  const dbPath = join(dir, 'live.db')
  const db = openDb(dbPath)
  createMerchant(db, { slug: 'cafe', name: 'Cafe', program: 'stamps', reward_threshold: 5, reward_text: 'Coffee' })
  const out = join(dir, 'backups')
  writeFileSync(join(dir, 'keep-me.txt'), 'x')
  const t = Date.parse('2026-11-17T10:00:00Z')
  const made = [0, 1, 2].map((i) => backup(dbPath, out, 2, new Date(t + i * 1000)))
  assert.equal(made[2].removed.length, 1)
  assert.deepEqual(readdirSync(out).sort(), ['loyalty-20261117-100001-000.db', 'loyalty-20261117-100002-000.db'])
  const copy = openDb(made[2].file)
  assert.equal((copy.prepare('SELECT slug FROM merchants').get() as { slug: string }).slug, 'cafe')
  assert.ok(existsSync(join(dir, 'keep-me.txt')))
  db.close()
  copy.close()
})
