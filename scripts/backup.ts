/**
 * A consistent copy of the database while the server runs: SQLite's VACUUM INTO, so a copy is never
 * half-written even mid-purchase. Keeps the newest few and removes older copies made by this script.
 *
 *   npm run backup                          into backups/, keeping the newest 14
 *   npm run backup -- --dir /var/backups/loyalty --keep 30
 *
 * The copy holds members' names and phone numbers: encrypt it before it leaves the server
 * (deploy/README.md, "Backups"). deploy/loyalty-backup.timer runs this every night.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

const NAME = /^loyalty-\d{8}-\d{6}-\d{3}\.db$/

export function backup(dbPath: string, dir: string, keep: number, now = new Date()): { file: string; removed: string[] } {
  mkdirSync(dir, { recursive: true })
  // 20261117-111125-123: sorts by time, and two runs in the same second do not clash.
  const iso = now.toISOString()
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${iso.slice(20, 23)}`
  const file = resolve(join(dir, `loyalty-${stamp}.db`))
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    db.prepare('VACUUM INTO ?').run(file)
  } finally {
    db.close()
  }
  // Only files this script named; anything else in the folder is left alone.
  const ours = readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse()
  const removed = ours.slice(Math.max(keep, 1))
  for (const f of removed) rmSync(join(dir, f))
  return { file, removed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, keep: { type: 'string' } } })
  const r = backup(process.env.DB_PATH ?? 'data/loyalty.db', values.dir ?? 'backups', Number(values.keep ?? 14))
  console.log(`Backed up to ${r.file}${r.removed.length ? `; removed ${r.removed.length} older` : ''}.`)
}
