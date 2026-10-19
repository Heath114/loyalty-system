import { connect } from 'node:http2'
import type { Config } from './config.ts'
import type { DB } from './db.ts'

export interface PushResult {
  token: string
  status: number
  reason?: string
}

export type Pusher = (pushTokens: string[]) => Promise<PushResult[]>

/**
 * Tells Apple to wake the devices holding a pass. The payload is empty: the device then calls our
 * web service, fetches the new pass and shows the field's changeMessage on the lock screen.
 * Wallet pushes authenticate with the Pass Type ID certificate itself (not an APNs .p8 key) and
 * APNs needs HTTP/2, which is why this runs on Node rather than an edge runtime.
 */
export function apnsPusher(config: Config): Pusher {
  return (tokens) =>
    new Promise((resolve) => {
      if (tokens.length === 0) return resolve([])
      const session = connect(config.apns.host, {
        cert: config.pass.certPem,
        key: config.pass.keyPem,
        passphrase: config.pass.keyPassphrase,
      })
      const results: PushResult[] = []
      const finish = () => {
        if (results.length === tokens.length) {
          session.close()
          resolve(results)
        }
      }
      // A stalled connection must not hang around forever; destroying it reports every token as failed.
      session.setTimeout(10_000, () => session.destroy(new Error('APNs timeout')))
      session.on('error', (err) => {
        for (const token of tokens) if (!results.some((r) => r.token === token)) results.push({ token, status: 0, reason: err.message })
        finish()
      })
      for (const token of tokens) {
        const req = session.request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          'apns-topic': config.pass.passTypeIdentifier,
          'content-type': 'application/json',
        })
        let status = 0
        let body = ''
        req.on('response', (h) => (status = Number(h[':status'])))
        req.on('data', (d) => (body += d))
        req.on('end', () => {
          let reason: string | undefined
          try { reason = body ? JSON.parse(body).reason : undefined } catch { reason = body }
          results.push({ token, status, reason })
          finish()
        })
        req.on('error', (err) => {
          results.push({ token, status: 0, reason: err.message })
          finish()
        })
        req.end('{}')
      }
    })
}

/**
 * Pushes an update to every device holding any of these cards, over one connection, and forgets
 * devices Apple says are gone.
 */
export async function notifyCards(db: DB, push: Pusher, serials: string[]): Promise<PushResult[]> {
  if (serials.length === 0) return []
  const rows = db
    .prepare('SELECT DISTINCT push_token FROM pass_registrations WHERE serial IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(serials)) as { push_token: string }[]
  const results = await push(rows.map((r) => r.push_token))
  for (const r of results) {
    if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
      db.prepare('DELETE FROM pass_registrations WHERE push_token = ?').run(r.token)
    } else if (r.status !== 200) {
      console.warn(`APNs push to ${r.token.slice(0, 8)}… failed: ${r.status} ${r.reason ?? ''}`)
    }
  }
  return results
}
