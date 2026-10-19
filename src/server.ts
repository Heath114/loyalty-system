import { serve } from '@hono/node-server'
import { apnsPusher } from './apns.ts'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { googleWallet } from './google.ts'
import { startScheduler } from './scheduler.ts'

const config = loadConfig()
const db = openDb(config.dbPath)
const deps = { db, config, push: apnsPusher(config), google: config.google ? googleWallet(config) : null }
const app = createApp(deps)
startScheduler(db, deps)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`loyalty-system on :${info.port}, public at ${config.publicUrl}, Google Wallet ${deps.google ? 'on' : 'off'}`)
})
