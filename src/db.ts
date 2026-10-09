import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DB = DatabaseSync

/**
 * Every row that belongs to a merchant carries merchant_id, and every query that reads one is
 * scoped by it. One merchant can never read another's customers: that is the property the
 * product is sold on (docs/STUDY.md section 5).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  name_ar          TEXT,
  program          TEXT NOT NULL CHECK (program IN ('stamps', 'points')),
  reward_threshold INTEGER NOT NULL CHECK (reward_threshold > 0),
  points_per_jod   REAL NOT NULL DEFAULT 1 CHECK (points_per_jod > 0),
  reward_text      TEXT NOT NULL,
  reward_text_ar   TEXT,
  bg_color         TEXT NOT NULL DEFAULT 'rgb(17,17,17)',
  fg_color         TEXT NOT NULL DEFAULT 'rgb(255,255,255)',
  label_color      TEXT NOT NULL DEFAULT 'rgb(180,180,180)',
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_images (
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  name        TEXT NOT NULL,
  png         BLOB NOT NULL,
  PRIMARY KEY (merchant_id, name)
);

CREATE TABLE IF NOT EXISTS staff (
  id          INTEGER PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  label       TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE IF NOT EXISTS cards (
  id                INTEGER PRIMARY KEY,
  merchant_id       INTEGER NOT NULL REFERENCES merchants(id),
  serial            TEXT NOT NULL UNIQUE,
  auth_token        TEXT NOT NULL,
  member_name       TEXT NOT NULL,
  member_phone      TEXT,
  member_email      TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  balance           INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned   INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed  INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_merchant ON cards(merchant_id);

-- Append-only. The card's balance is a cache of SUM(units) for that card.
CREATE TABLE IF NOT EXISTS ledger (
  id              INTEGER PRIMARY KEY,
  merchant_id     INTEGER NOT NULL REFERENCES merchants(id),
  card_id         INTEGER NOT NULL REFERENCES cards(id),
  kind            TEXT NOT NULL CHECK (kind IN ('earn', 'redeem')),
  units           INTEGER NOT NULL,
  amount_fils     INTEGER,
  staff_id        INTEGER REFERENCES staff(id),
  idempotency_key TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE (merchant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ledger_card ON ledger(card_id);

-- Apple Wallet devices that hold a card and want push updates.
CREATE TABLE IF NOT EXISTS pass_registrations (
  device_library_id TEXT NOT NULL,
  serial            TEXT NOT NULL REFERENCES cards(serial),
  push_token        TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  PRIMARY KEY (device_library_id, serial)
);
CREATE INDEX IF NOT EXISTS pass_registrations_serial ON pass_registrations(serial);
`

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  return db
}

/** Runs fn inside a transaction, rolling back if it throws. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
