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

/**
 * Schema changes after the first version, in order. PRAGMA user_version counts how many have run,
 * so each one runs once per database, on a fresh one straight after SCHEMA.
 */
const MIGRATIONS = [
  // 1: retention messages, branch locations, Google Wallet.
  `
  -- Branches. Wallet shows the card on the lock screen near them (Apple), or notifies (Google).
  -- Both platforms take at most 10.
  CREATE TABLE locations (
    id          INTEGER PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    label       TEXT NOT NULL,
    latitude    REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    text        TEXT,
    text_ar     TEXT
  );
  CREATE INDEX locations_merchant ON locations(merchant_id);

  -- Automatic messages a merchant switches on: birthday, and win-back after N days away.
  CREATE TABLE triggers (
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    kind        TEXT NOT NULL CHECK (kind IN ('birthday', 'winback')),
    enabled     INTEGER NOT NULL DEFAULT 1,
    days        INTEGER,
    text        TEXT NOT NULL,
    text_ar     TEXT,
    PRIMARY KEY (merchant_id, kind)
  );

  -- One-off promotions, sent to every member who agreed to offers.
  CREATE TABLE campaigns (
    id           INTEGER PRIMARY KEY,
    merchant_id  INTEGER NOT NULL REFERENCES merchants(id),
    text         TEXT NOT NULL,
    text_ar      TEXT,
    send_at      INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    cancelled_at INTEGER
  );
  CREATE INDEX campaigns_merchant ON campaigns(merchant_id, send_at);

  -- Every message a card was sent. dedupe_key makes each send happen once ("birthday:2026",
  -- "promo:12"); local_day is the merchant's calendar day, for the one-a-day cap.
  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    card_id     INTEGER NOT NULL REFERENCES cards(id),
    kind        TEXT NOT NULL CHECK (kind IN ('birthday', 'winback', 'promo')),
    campaign_id INTEGER REFERENCES campaigns(id),
    dedupe_key  TEXT NOT NULL,
    text        TEXT NOT NULL,
    local_day   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (card_id, dedupe_key)
  );
  CREATE INDEX messages_card ON messages(card_id, created_at);

  ALTER TABLE merchants ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Amman';
  -- changed_at moves when anything printed on every card changes (locations, images). The scheduler
  -- refreshes the merchant's cards when it is ahead of synced_at, and Google's copy when it is ahead
  -- of google_synced_at.
  ALTER TABLE merchants ADD COLUMN changed_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE merchants ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE merchants ADD COLUMN google_synced_at INTEGER NOT NULL DEFAULT 0;

  -- The phone's language when the card was added. Messages are written into the pass in it.
  ALTER TABLE cards ADD COLUMN lang TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar', 'en'));
  -- "MM-DD", no year: the least we need for a birthday message.
  ALTER TABLE cards ADD COLUMN birthday TEXT;
  -- The newest message, shown on the back of the card.
  ALTER TABLE cards ADD COLUMN last_message_id INTEGER;
  -- Set once the card exists in Google Wallet, so updates only go to cards that are there.
  ALTER TABLE cards ADD COLUMN google_object_at INTEGER;
  `,
]

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  // busy_timeout: the merchant CLI writes to the same file as the running server; wait for its lock.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  const { user_version: done } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  MIGRATIONS.slice(done).forEach((sql, i) =>
    tx(db, () => {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${done + i + 1}`)
    }),
  )
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
