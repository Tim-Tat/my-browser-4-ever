const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email_index TEXT NOT NULL UNIQUE,
  email TEXT,
  mode TEXT NOT NULL,
  kdf_salt TEXT NOT NULL,
  server_salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  recovery_wrapped_dek TEXT,
  recovery_proof_hash TEXT,
  escrow TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS records (
  account_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  blob TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, collection, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records(account_id, seq);
CREATE TABLE IF NOT EXISTS recovery_codes (
  account_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, hash)
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ready_at INTEGER,
  artifact TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS exports_account ON exports(account_id);
`;

function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Löscht ein Konto mit allen zugehörigen Daten.
function deleteAccount(db, accountId) {
  db.exec('BEGIN');
  try {
    for (const table of ['sessions', 'records', 'recovery_codes', 'tokens', 'exports']) {
      db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(accountId);
    }
    db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, deleteAccount };
