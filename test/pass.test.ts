import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import { earn, enrol } from '../src/loyalty.ts'
import { buildPass, passJson } from '../src/pass/build.ts'
import { parseBarcode } from '../src/tokens.ts'
import { setup } from './helpers.ts'

function hasOpenssl() {
  try { execFileSync('openssl', ['version']); return true } catch { return false }
}

test('pkpass: manifest covers every file and the signature verifies against the WWDR chain', () => {
  const { db, config, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const files = unzipSync(buildPass(db, config, cafe, card))
  for (const f of ['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'en.lproj/pass.strings', 'ar.lproj/pass.strings']) {
    assert.ok(files[f], `${f} present`)
  }
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString())
  const signed = Object.keys(files).filter((f) => f !== 'manifest.json' && f !== 'signature').sort()
  assert.deepEqual(Object.keys(manifest).sort(), signed)
  for (const f of signed) assert.equal(manifest[f], createHash('sha1').update(files[f]).digest('hex'), `${f} hash`)

  if (!hasOpenssl()) return
  const dir = mkdtempSync(join(tmpdir(), 'pkpass-'))
  writeFileSync(join(dir, 'manifest.json'), files['manifest.json'])
  writeFileSync(join(dir, 'signature'), files.signature)
  writeFileSync(join(dir, 'wwdr.pem'), config.pass.wwdrPem)
  // -purpose any: the stand-in pass cert has no extended key usage. Apple's real one does.
  execFileSync('openssl', ['smime', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'signature'),
    '-content', join(dir, 'manifest.json'), '-CAfile', join(dir, 'wwdr.pem'), '-purpose', 'any', '-out', '/dev/null'], { stdio: 'pipe' })
})

test('pass.json: identifiers, scannable QR, web service only over HTTPS', () => {
  const { db, config, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const json = passJson(config, cafe, card) as any
  assert.equal(json.passTypeIdentifier, config.pass.passTypeIdentifier)
  assert.equal(json.serialNumber, card.serial)
  assert.equal(json.barcodes[0].format, 'PKBarcodeFormatQR')
  assert.equal(parseBarcode(config.secret, json.barcodes[0].message), card.serial)
  assert.equal(json.webServiceURL, 'https://cards.test/wallet')
  assert.equal(json.authenticationToken, card.auth_token)
  assert.equal(json.nfc, undefined, 'no NFC until the entitlement is granted')
  assert.ok(json.storeCard.primaryFields[0].changeMessage)

  const local = passJson({ ...config, publicUrl: 'http://localhost:8787' }, cafe, card) as any
  assert.equal(local.webServiceURL, undefined)
})

test('pass.json: NFC payload carries the same message as the QR when switched on', () => {
  const { db, config, cafe } = setup({ nfcEncryptionPublicKey: 'MDkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDIgAC' })
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const json = passJson(config, cafe, card) as any
  assert.equal(json.nfc.message, json.barcodes[0].message)
  assert.equal(json.nfc.encryptionPublicKey, config.nfcEncryptionPublicKey)
})

test('stamp card stays full until redeemed, so the last stamp reads 3 / 3', () => {
  const { db, config, cafe } = setup()
  let card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  for (let i = 0; i < 4; i++) card = earn(db, cafe, card.serial, {}).card
  const json = passJson(config, cafe, card) as any
  assert.equal(json.storeCard.primaryFields[0].value, '3 / 3')
  assert.equal(json.storeCard.headerFields[0].value, 1)
})

test('pass.strings: UTF-16 with BOM, Arabic present', () => {
  const { db, config, cafe } = setup()
  const card = enrol(db, cafe, { name: 'Lina', marketingConsent: true })
  const files = unzipSync(buildPass(db, config, cafe, card))
  const ar = files['ar.lproj/pass.strings']
  assert.deepEqual([...ar.slice(0, 2)], [0xff, 0xfe])
  const text = Buffer.from(ar.slice(2)).toString('utf16le')
  assert.match(text, /"REWARD_TEXT" = "قهوة مجانية";/)
  assert.match(text, /"CHANGE_BALANCE" = ".*%@.*";/)
})
