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
  // 2: what was bought. Earn rates per category, and the purchase each reminder hangs off.
  `
  -- A merchant's purchase categories. 'rate' earns points per JOD (points programs only); 'fixed'
  -- earns a set number of stamps or points per purchase, whatever it cost (a phone store's thank-you
  -- for a device, where points on the full price would give away the margin). 0 records the visit
  -- and the purchase without earning anything. Archived, never deleted: the ledger points at them.
  CREATE TABLE categories (
    id             INTEGER PRIMARY KEY,
    merchant_id    INTEGER NOT NULL REFERENCES merchants(id),
    name           TEXT NOT NULL,
    name_ar        TEXT,
    earn           TEXT NOT NULL CHECK (earn IN ('rate', 'fixed')),
    points_per_jod REAL CHECK (points_per_jod IS NULL OR points_per_jod >= 0),
    fixed_units    INTEGER CHECK (fixed_units IS NULL OR fixed_units >= 0),
    sort           INTEGER NOT NULL DEFAULT 0,
    archived_at    INTEGER,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX categories_merchant ON categories(merchant_id);

  ALTER TABLE ledger ADD COLUMN category_id INTEGER REFERENCES categories(id);
  CREATE INDEX ledger_category ON ledger(merchant_id, category_id, created_at);
  `,
  // 3: reminders counted from a purchase ("your warranty ends next month", "six weeks since your colour").
  `
  CREATE TABLE reminders (
    id          INTEGER PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    category_id INTEGER NOT NULL REFERENCES categories(id),
    days        INTEGER NOT NULL CHECK (days BETWEEN 1 AND 1095),
    text        TEXT NOT NULL,
    text_ar     TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE INDEX reminders_merchant ON reminders(merchant_id);

  -- SQLite cannot widen a CHECK, so messages is rebuilt to allow 'reminder' and to say which one.
  CREATE TABLE messages_v3 (
    id          INTEGER PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    card_id     INTEGER NOT NULL REFERENCES cards(id),
    kind        TEXT NOT NULL CHECK (kind IN ('birthday', 'winback', 'promo', 'reminder')),
    campaign_id INTEGER REFERENCES campaigns(id),
    reminder_id INTEGER REFERENCES reminders(id),
    dedupe_key  TEXT NOT NULL,
    text        TEXT NOT NULL,
    local_day   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (card_id, dedupe_key)
  );
  INSERT INTO messages_v3 (id, merchant_id, card_id, kind, campaign_id, dedupe_key, text, local_day, created_at)
    SELECT id, merchant_id, card_id, kind, campaign_id, dedupe_key, text, local_day, created_at FROM messages;
  DROP TABLE messages;
  ALTER TABLE messages_v3 RENAME TO messages;
  CREATE INDEX messages_card ON messages(card_id, created_at);
  CREATE INDEX messages_merchant ON messages(merchant_id, created_at);
  `,
  // 4: reporting, and deleting a member on request.
  `
  -- Set when a member asked to be deleted (Jordan PDPL): their details are wiped, the card is voided
  -- in their wallet and can no longer be scanned. The row stays so visit counts stay true.
  ALTER TABLE cards ADD COLUMN deleted_at INTEGER;
  -- So an owner can see which counter devices are in use, and spot a key nobody uses.
  ALTER TABLE staff ADD COLUMN last_used_at INTEGER;
  CREATE INDEX ledger_merchant_time ON ledger(merchant_id, created_at);
  CREATE INDEX cards_merchant_created ON cards(merchant_id, created_at);
  `,
  // 5: the merchant dashboard: people who run a merchant's program, and their signed-in sessions.
  `
  -- One email runs one merchant. Passwords are scrypt hashes; a password we made (a new admin, a
  -- reset) must be changed at the first sign-in.
  CREATE TABLE admins (
    id                  INTEGER PRIMARY KEY,
    merchant_id         INTEGER NOT NULL REFERENCES merchants(id),
    email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name                TEXT,
    password_hash       TEXT NOT NULL,
    must_change         INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL,
    disabled_at         INTEGER
  );
  CREATE INDEX admins_merchant ON admins(merchant_id);

  -- The token itself is only ever in the admin's browser; we keep its hash.
  CREATE TABLE admin_sessions (
    token_hash   TEXT PRIMARY KEY,
    admin_id     INTEGER NOT NULL REFERENCES admins(id),
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX admin_sessions_admin ON admin_sessions(admin_id);
  `,
  // 6: mistakes and gifts. The ledger is rebuilt (SQLite cannot widen a CHECK) to take undone rows,
  // manual adjustments and bonuses, still append-only: an undo adds a 'void' row and marks the one it
  // takes back, it never deletes. SUM(units) per card stays equal to the card's balance.
  `
  CREATE TABLE ledger_v6 (
    id              INTEGER PRIMARY KEY,
    merchant_id     INTEGER NOT NULL REFERENCES merchants(id),
    card_id         INTEGER NOT NULL REFERENCES cards(id),
    kind            TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'adjust', 'bonus', 'void')),
    units           INTEGER NOT NULL,
    amount_fils     INTEGER,
    category_id     INTEGER REFERENCES categories(id),
    staff_id        INTEGER REFERENCES staff(id),
    admin_id        INTEGER REFERENCES admins(id),
    idempotency_key TEXT,
    -- On an earn or redeem that was undone: when.
    voided_at       INTEGER,
    -- void: the row it takes back. bonus: the friend's card, for a referral bonus.
    ref_id          INTEGER,
    -- adjust: the reason the merchant gave. bonus: 'welcome' or 'referral'.
    note            TEXT,
    created_at      INTEGER NOT NULL,
    UNIQUE (merchant_id, idempotency_key)
  );
  INSERT INTO ledger_v6 (id, merchant_id, card_id, kind, units, amount_fils, category_id, staff_id, idempotency_key, created_at)
    SELECT id, merchant_id, card_id, kind, units, amount_fils, category_id, staff_id, idempotency_key, created_at FROM ledger;
  DROP TABLE ledger;
  ALTER TABLE ledger_v6 RENAME TO ledger;
  CREATE INDEX ledger_card ON ledger(card_id);
  CREATE INDEX ledger_category ON ledger(merchant_id, category_id, created_at);
  CREATE INDEX ledger_merchant_time ON ledger(merchant_id, created_at);
  `,
  // 7: more rewards than the one on the card: "200 points: a case, 1500: earbuds". The merchant's own
  // reward (reward_threshold, reward_text) stays the headline the card counts towards.
  `
  CREATE TABLE rewards (
    id          INTEGER PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES merchants(id),
    name        TEXT NOT NULL,
    name_ar     TEXT,
    cost        INTEGER NOT NULL CHECK (cost > 0),
    sort        INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX rewards_merchant ON rewards(merchant_id);
  ALTER TABLE ledger ADD COLUMN reward_id INTEGER REFERENCES rewards(id);
  `,
]

/** opts.version stops the migrations at that version: only tests use it, to check an upgrade keeps data. */
export function openDb(path: string, opts: { version?: number } = {}): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  // busy_timeout: the merchant CLI writes to the same file as the running server; wait for its lock.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  const { user_version: done } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  MIGRATIONS.slice(done, opts.version ?? MIGRATIONS.length).forEach((sql, i) =>
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
