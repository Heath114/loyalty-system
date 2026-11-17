import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createApp } from '../src/app.ts'
import { loadBadges } from '../src/badges.ts'
import { enrol } from '../src/loyalty.ts'
import { linkToken } from '../src/tokens.ts'
import { setup } from './helpers.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="110" height="34"><rect width="110" height="34"/></svg>'

test('badges: the official button when its file is there, the text button otherwise', async () => {
  const s = setup()
  const card = enrol(s.db, s.cafe, { name: 'Lina', marketingConsent: false })
  const url = `/c/${card.serial}?t=${linkToken(s.config.secret, card.serial)}`

  const plain = await (await s.app.request(`${url}&lang=en`)).text()
  assert.match(plain, /<a class="btn" href="\/c\/[0-9A-Z]+\/card\.pkpass\?t=[^"]+">Add to Apple Wallet<\/a>/)

  const app = createApp({ ...s.deps, badges: new Map([['apple-en.svg', SVG]]) })
  const en = await (await app.request(`${url}&lang=en`)).text()
  assert.match(en, /<a class="walletbadge" href="\/c\/[0-9A-Z]+\/card\.pkpass\?t=[^"]+"><img src="\/badges\/apple-en\.svg" alt="Add to Apple Wallet"><\/a>/)
  const ar = await (await app.request(`${url}&lang=ar`)).text()
  assert.match(ar, /<a class="btn"[^>]*>أضف إلى Apple Wallet<\/a>/, 'no Arabic file: the Arabic text button')

  const r = await app.request('/badges/apple-en.svg')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('Content-Type'), 'image/svg+xml')
  assert.match(r.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/)
  assert.equal((await app.request('/badges/google-en.svg')).status, 404)
  assert.equal((await app.request('/badges/..%2Fpackage.json')).status, 404)
})

test('badges: only the four known files, and only real SVGs, are picked up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'badges-'))
  try {
    writeFileSync(join(dir, 'apple-en.svg'), SVG)
    writeFileSync(join(dir, 'google-ar.svg'), 'not an svg')
    writeFileSync(join(dir, 'other.svg'), SVG)
    const b = loadBadges(pathToFileURL(dir + '/'))
    assert.deepEqual([...b.keys()], ['apple-en.svg'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
