import { serve } from '@hono/node-server'
import { apnsPusher } from './apns.ts'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'

const config = loadConfig()
const db = openDb(config.dbPath)
const app = createApp({ db, config, push: apnsPusher(config) })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`loyalty-system on :${info.port}, public at ${config.publicUrl}`)
})
