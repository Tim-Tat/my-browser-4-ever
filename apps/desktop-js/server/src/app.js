const http = require('http');
const crypto = require('crypto');
const { openDb, deleteAccount } = require('./db');
const { createMailer } = require('./mailer');
const c = require('./crypto');
const totp = require('./totp');
const { DAY } = require('./config');

const VERSION = '0.0.1-alpha';
const COLLECTIONS = new Set(['spaces', 'tabs', 'archive', 'history', 'bookmarks', 'settings']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 4 * 1024 * 1024;
const MAX_BLOB = 256 * 1024;
const SESSION_TTL = 90 * DAY;
const HEARTBEAT_MS = DAY;
const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const DUMMY_SALT = Buffer.alloc(16, 7).toString('base64');
const DUMMY_VERIFIER = Buffer.alloc(32, 9).toString('base64');

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

function createLimiter() {
  const hits = new Map();
  return {
    // Gibt die Wartezeit in ms zurück, wenn das Limit erreicht ist, sonst 0.
    hit(key, max, windowMs, now = Date.now()) {
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return windowMs - (now - list[0]);
      }
      list.push(now);
      hits.set(key, list);
      return 0;
    },
    sweep(now = Date.now(), maxAge = DAY) {
      for (const [key, list] of hits) if (!list.length || now - list[list.length - 1] > maxAge) hits.delete(key);
    },
  };
}

function createApp(config, { mailer: injectedMailer, now: clock = Date.now } = {}) {
  if (!config.searchKey || config.searchKey.length < 32) throw new Error('AVEN_SEARCH_KEY fehlt oder ist zu kurz (mindestens 32 Bytes, Base64). Mit "node index.js gen-keys" erzeugen.');
  if (config.escrowKey && config.escrowKey.length !== 32) throw new Error('AVEN_ESCROW_KEY muss genau 32 Bytes (Base64) lang sein.');
  const db = openDb(config.dbPath);
  const mailer = injectedMailer || createMailer(config.mail);
  const limiter = createLimiter();
  const normalAvailable = !!config.escrowKey;
  const ipSalt = crypto.randomBytes(16);
  const stats = { requests: 0, errors: 0 };

  const q = (sql) => db.prepare(sql);
  const accountById = (id) => q('SELECT * FROM accounts WHERE id = ?').get(id);
  const accountByEmail = (email) => q('SELECT * FROM accounts WHERE email_index = ?').get(c.emailIndex(config.searchKey, email));

  const clientKey = (req) => {
    let ip = req.socket.remoteAddress || '';
    if (config.trustProxy && req.headers['x-forwarded-for']) ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return crypto.createHash('sha256').update(ipSalt).update(ip).digest('hex').slice(0, 16);
  };

  function limit(name, key, max, windowMs) {
    const wait = limiter.hit(`${name}:${key}`, max, windowMs, clock());
    if (wait) fail(429, 'rate_limited', { retryAfterMs: wait });
  }

  const validEmail = (email) => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const validKey = (value, bytes) => typeof value === 'string' && c.unb64(value).length === bytes;
  const validBlob = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;

  function daysUntilDeletion(account) {
    const days = account.mode === 'ultra' ? config.inactivityDaysUltra : config.inactivityDaysNormal;
    if (!days) return null;
    return Math.max(0, Math.ceil((account.last_active_at + days * DAY - clock()) / DAY));
  }

  function newSession(account, deviceName) {
    const token = c.randomToken(32);
    const t = clock();
    q('INSERT INTO sessions (id, account_id, device_name, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)')
      .run(c.sha256(token), account.id, String(deviceName || 'Gerät').slice(0, 60), t, t, t + SESSION_TTL);
    return token;
  }

  const revokeSessions = (accountId, exceptHash) =>
    q('DELETE FROM sessions WHERE account_id = ? AND id != ?').run(accountId, exceptHash || '');

  function authenticate(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) fail(401, 'unauthorized');
    const hash = c.sha256(header.slice(7));
    const session = q('SELECT * FROM sessions WHERE id = ?').get(hash);
    if (!session || session.expires_at < clock()) fail(401, 'unauthorized');
    const account = accountById(session.account_id);
    if (!account) fail(401, 'unauthorized');
    q('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(clock(), clock() + SESSION_TTL, hash);
    return { account, session };
  }

  const requireAuthKey = (account, authKey) => {
    if (!validKey(authKey, 32) || !c.verifyVerifier(authKey, account.server_salt, account.verifier)) fail(403, 'step_up_failed');
  };

  function checkSecondFactor(account, { totp: code, recoveryCode }) {
    if (!account.totp_enabled) return;
    if (code && totp.verifyTotp(account.totp_secret, code, clock())) return;
    if (recoveryCode) {
      const hash = c.sha256(String(recoveryCode).trim().toLowerCase());
      const row = q('SELECT * FROM recovery_codes WHERE account_id = ? AND hash = ? AND used = 0').get(account.id, hash);
      if (row) {
        q('UPDATE recovery_codes SET used = 1 WHERE account_id = ? AND hash = ?').run(account.id, hash);
        return;
      }
    }
    fail(401, code || recoveryCode ? 'second_factor_invalid' : 'second_factor_required');
  }

  const storedBytes = (accountId) =>
    q("SELECT COALESCE(SUM(LENGTH(blob)),0) AS n FROM records WHERE account_id = ? AND deleted = 0").get(accountId).n;

  // ---------- Routen ----------

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler, ...opts });

  route('GET', '/v1/health', () => ({ ok: true, version: VERSION, registration: config.allowRegistration, normalModeAvailable: normalAvailable }));

  route('POST', '/v1/prelogin', ({ body, ip }) => {
    limit('prelogin', ip, 30, 60000);
    if (!validEmail(body.email)) fail(400, 'invalid_email');
    const account = accountByEmail(body.email);
    const salt = account ? account.kdf_salt : c.fakeSalt(config.searchKey, c.emailIndex(config.searchKey, body.email));
    return { kdfSalt: salt, kdf: KDF };
  });

  route('POST', '/v1/register', ({ body, ip }) => {
    limit('register', ip, 5, 3600000);
    if (!config.allowRegistration) fail(403, 'registration_closed');
    if (!validEmail(body.email)) fail(400, 'invalid_email');
    if (!['normal', 'ultra'].includes(body.mode)) fail(400, 'invalid_mode');
    if (!validKey(body.authKey, 32) || !validKey(body.kdfSalt, 16) || !validBlob(body.wrappedDek)) fail(400, 'invalid_keys');
    let escrow = null;
    let recoveryProofHash = null;
    if (body.mode === 'normal') {
      if (!normalAvailable) fail(503, 'normal_mode_unavailable');
      if (!validKey(body.dek, 32)) fail(400, 'invalid_keys');
      escrow = c.aesEncrypt(config.escrowKey, c.unb64(body.dek), 'escrow');
    } else {
      if (!validBlob(body.recoveryWrappedDek) || !/^[0-9a-f]{64}$/.test(body.recoveryProofHash || '')) fail(400, 'invalid_keys');
      recoveryProofHash = body.recoveryProofHash;
    }
    const index = c.emailIndex(config.searchKey, body.email);
    if (q('SELECT 1 FROM accounts WHERE email_index = ?').get(index)) fail(409, 'exists');
    const serverSalt = c.b64(crypto.randomBytes(16));
    const account = { id: crypto.randomUUID(), t: clock() };
    q(`INSERT INTO accounts (id, email_index, email, mode, kdf_salt, server_salt, verifier, wrapped_dek, recovery_wrapped_dek, recovery_proof_hash, escrow, created_at, last_active_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      account.id, index, body.mode === 'normal' ? c.normalizeEmail(body.email) : null, body.mode, body.kdfSalt, serverSalt,
      c.hashVerifier(body.authKey, serverSalt), body.wrappedDek, body.recoveryWrappedDek || null, recoveryProofHash, escrow, account.t, account.t);
    const token = newSession({ id: account.id }, body.deviceName);
    return { _http: 201, body: { token, accountId: account.id, mode: body.mode } };
  });

  route('POST', '/v1/login', ({ body, ip }) => {
    limit('login', ip, 20, 600000);
    if (!validEmail(body.email) || !validKey(body.authKey, 32)) fail(400, 'invalid_request');
    const account = accountByEmail(body.email);
    if (!account) {
      c.verifyVerifier(body.authKey, DUMMY_SALT, DUMMY_VERIFIER); // gleiche Rechenzeit wie bei echten Konten
      fail(401, 'invalid_credentials');
    }
    if (account.locked_until > clock()) fail(429, 'account_locked', { retryAfterMs: account.locked_until - clock() });
    if (!c.verifyVerifier(body.authKey, account.server_salt, account.verifier)) {
      const failed = account.failed_logins + 1;
      q('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failed >= 10 ? 0 : failed, failed >= 10 ? clock() + 15 * 60000 : 0, account.id);
      fail(401, 'invalid_credentials');
    }
    checkSecondFactor(account, body);
    q('UPDATE accounts SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(account.id);
    const token = newSession(account, body.deviceName);
    return {
      token, accountId: account.id, mode: account.mode, kdfSalt: account.kdf_salt,
      wrappedDek: account.wrapped_dek, recoveryWrappedDek: account.recovery_wrapped_dek,
    };
  });

  route('POST', '/v1/logout', ({ session }) => {
    q('DELETE FROM sessions WHERE id = ?').run(session.id);
    return { ok: true };
  }, { auth: true });

  route('GET', '/v1/account', ({ account }) => ({
    id: account.id, mode: account.mode, createdAt: account.created_at, lastActiveAt: account.last_active_at,
    daysUntilDeletion: daysUntilDeletion(account), totpEnabled: !!account.totp_enabled, seq: account.seq,
    quotaUsed: storedBytes(account.id), quota: config.quotaBytes,
  }), { auth: true });

  route('POST', '/v1/heartbeat', ({ account }) => {
    const t = clock();
    if (t - account.last_active_at >= HEARTBEAT_MS) {
      q('UPDATE accounts SET last_active_at = ? WHERE id = ?').run(t, account.id);
      account.last_active_at = t;
    }
    return { daysUntilDeletion: daysUntilDeletion(account) };
  }, { auth: true });

  route('GET', '/v1/devices', ({ account, session }) => ({
    devices: q('SELECT id, device_name, created_at, last_seen_at FROM sessions WHERE account_id = ? ORDER BY created_at').all(account.id)
      .map((s) => ({ id: s.id.slice(0, 16), name: s.device_name, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === session.id })),
  }), { auth: true });

  route('DELETE', '/v1/devices/([0-9a-f]{16})', ({ account, params }) => {
    const row = q('SELECT id FROM sessions WHERE account_id = ? AND id LIKE ?').get(account.id, `${params[0]}%`);
    if (!row) fail(404, 'not_found');
    q('DELETE FROM sessions WHERE id = ?').run(row.id);
    return { ok: true };
  }, { auth: true });

  route('GET', '/v1/sync', ({ account, query }) => {
    const since = Math.max(0, Number(query.get('since')) || 0);
    const limitN = Math.min(500, Math.max(1, Number(query.get('limit')) || 500));
    const rows = q('SELECT collection, id, blob, updated_at, deleted, seq FROM records WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(account.id, since, limitN + 1);
    const more = rows.length > limitN;
    const records = rows.slice(0, limitN).map((r) => ({ collection: r.collection, id: r.id, blob: r.blob, updatedAt: r.updated_at, deleted: !!r.deleted, seq: r.seq }));
    return { records, seq: records.length ? records[records.length - 1].seq : since, more, serverSeq: account.seq };
  }, { auth: true });

  route('PUT', '/v1/sync', ({ account, body }) => {
    if (!Array.isArray(body.records) || body.records.length > 500) fail(400, 'invalid_records');
    let used = storedBytes(account.id);
    let seq = account.seq;
    const rejected = [];
    let accepted = 0;
    db.exec('BEGIN');
    try {
      for (const r of body.records) {
        if (!r || !COLLECTIONS.has(r.collection) || !ID_RE.test(r.id) || !Number.isFinite(r.updatedAt)) fail(400, 'invalid_records');
        const deleted = !!r.deleted;
        if (!deleted && (typeof r.blob !== 'string' || r.blob.length > MAX_BLOB)) fail(400, 'invalid_records');
        const existing = q('SELECT updated_at, blob, deleted FROM records WHERE account_id = ? AND collection = ? AND id = ?').get(account.id, r.collection, r.id);
        if (existing && existing.updated_at > r.updatedAt) {
          rejected.push({ collection: r.collection, id: r.id });
          continue;
        }
        const size = deleted ? 0 : r.blob.length;
        const oldSize = existing && !existing.deleted ? existing.blob.length : 0;
        if (used - oldSize + size > config.quotaBytes) fail(413, 'quota_exceeded');
        used += size - oldSize;
        seq += 1;
        q(`INSERT INTO records (account_id, collection, id, seq, blob, updated_at, deleted) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(account_id, collection, id) DO UPDATE SET seq = excluded.seq, blob = excluded.blob, updated_at = excluded.updated_at, deleted = excluded.deleted`)
          .run(account.id, r.collection, r.id, seq, deleted ? null : r.blob, r.updatedAt, deleted ? 1 : 0);
        accepted += 1;
      }
      q('UPDATE accounts SET seq = ? WHERE id = ?').run(seq, account.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { seq, accepted, rejected };
  }, { auth: true });

  route('POST', '/v1/totp/setup', ({ account, body }) => {
    requireAuthKey(account, body.authKey);
    // Ein aktiver zweiter Faktor wird nie still ersetzt: erst mit /v1/totp/disable (verlangt den
    // aktuellen Faktor) abschalten, dann neu einrichten.
    if (account.totp_enabled) fail(409, 'totp_already_enabled');
    const secret = totp.newSecret();
    q('UPDATE accounts SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, account.id);
    return { secret, uri: totp.otpauthUri(secret, 'Konto') };
  }, { auth: true });

  route('POST', '/v1/totp/enable', ({ account, body }) => {
    if (!account.totp_secret || !totp.verifyTotp(account.totp_secret, body.code, clock())) fail(400, 'invalid_code');
    const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex'));
    q('DELETE FROM recovery_codes WHERE account_id = ?').run(account.id);
    for (const code of codes) q('INSERT INTO recovery_codes (account_id, hash) VALUES (?,?)').run(account.id, c.sha256(code));
    q('UPDATE accounts SET totp_enabled = 1 WHERE id = ?').run(account.id);
    return { recoveryCodes: codes };
  }, { auth: true });

  route('POST', '/v1/totp/disable', ({ account, body }) => {
    requireAuthKey(account, body.authKey);
    checkSecondFactor(account, body);
    q('UPDATE accounts SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(account.id);
    q('DELETE FROM recovery_codes WHERE account_id = ?').run(account.id);
    return { ok: true };
  }, { auth: true });

  route('POST', '/v1/password', ({ account, session, body }) => {
    requireAuthKey(account, body.authKey);
    if (!validKey(body.newAuthKey, 32) || !validKey(body.newKdfSalt, 16) || !validBlob(body.newWrappedDek)) fail(400, 'invalid_keys');
    const serverSalt = c.b64(crypto.randomBytes(16));
    q('UPDATE accounts SET verifier = ?, server_salt = ?, kdf_salt = ?, wrapped_dek = ? WHERE id = ?')
      .run(c.hashVerifier(body.newAuthKey, serverSalt), serverSalt, body.newKdfSalt, body.newWrappedDek, account.id);
    revokeSessions(account.id, session.id);
    return { ok: true };
  }, { auth: true });

  route('POST', '/v1/mode', ({ account, body }) => {
    requireAuthKey(account, body.authKey);
    if (!['normal', 'ultra'].includes(body.mode)) fail(400, 'invalid_mode');
    if (body.mode === account.mode) return { mode: account.mode };
    if (body.mode === 'ultra') {
      if (!validBlob(body.recoveryWrappedDek) || !/^[0-9a-f]{64}$/.test(body.recoveryProofHash || '')) fail(400, 'invalid_keys');
      q('UPDATE accounts SET mode = ?, escrow = NULL, email = NULL, recovery_wrapped_dek = ?, recovery_proof_hash = ? WHERE id = ?')
        .run('ultra', body.recoveryWrappedDek, body.recoveryProofHash, account.id);
    } else {
      if (!normalAvailable) fail(503, 'normal_mode_unavailable');
      if (!validKey(body.dek, 32) || !validEmail(body.email) || c.emailIndex(config.searchKey, body.email) !== account.email_index) fail(400, 'invalid_keys');
      q('UPDATE accounts SET mode = ?, escrow = ?, email = ? WHERE id = ?')
        .run('normal', c.aesEncrypt(config.escrowKey, c.unb64(body.dek), 'escrow'), c.normalizeEmail(body.email), account.id);
    }
    return { mode: body.mode };
  }, { auth: true });

  route('POST', '/v1/recover/request', async ({ body, ip }) => {
    limit('recover', ip, 5, 3600000);
    if (!validEmail(body.email)) fail(400, 'invalid_email');
    const account = accountByEmail(body.email);
    if (account) {
      limit('recover-acct', account.id, 3, 3600000);
      const token = crypto.randomBytes(6).toString('hex');
      q('DELETE FROM tokens WHERE account_id = ? AND kind = ?').run(account.id, 'recover');
      q('INSERT INTO tokens (hash, account_id, kind, expires_at) VALUES (?,?,?,?)').run(c.sha256(`${token}:${account.id}`), account.id, 'recover', clock() + 30 * 60000);
      const lines = account.mode === 'ultra'
        ? 'Mit diesem Code kannst du dein Aven-Konto zurücksetzen. Ohne deinen Wiederherstellungsschlüssel bleiben alte Sync-Daten unlesbar.'
        : 'Mit diesem Code kannst du dein Aven-Konto und deine Sync-Daten wiederherstellen.';
      await mailer.send(c.normalizeEmail(body.email), 'Aven: Code zum Zurücksetzen', `${lines}\n\nCode: ${token}\nGültig für 30 Minuten. Wenn du das nicht angefordert hast, ignoriere diese Nachricht.\n`);
    }
    return { _http: 202, body: { ok: true } }; // gleiche Antwort für unbekannte Adressen
  });

  route('POST', '/v1/recover/verify', ({ body, ip }) => {
    limit('verify', ip, 10, 900000);
    if (!validEmail(body.email)) fail(400, 'invalid_email');
    const account = accountByEmail(body.email);
    if (!account) fail(400, 'invalid_token');
    limit('verify-acct', account.id, 5, 900000);
    const row = q('SELECT * FROM tokens WHERE hash = ? AND kind = ? AND expires_at > ?').get(c.sha256(`${String(body.token || '').trim().toLowerCase()}:${account.id}`), 'recover', clock());
    if (!row) fail(400, 'invalid_token');
    checkSecondFactor(account, body.secondFactor || {});
    q('DELETE FROM tokens WHERE hash = ?').run(row.hash);
    const ticket = c.randomToken(24);
    q('INSERT INTO tokens (hash, account_id, kind, expires_at) VALUES (?,?,?,?)').run(c.sha256(ticket), account.id, 'ticket', clock() + 10 * 60000);
    if (account.mode === 'normal') {
      const dek = c.aesDecrypt(config.escrowKey, account.escrow, 'escrow');
      return { ticket, mode: 'normal', dek: c.b64(dek) };
    }
    return { ticket, mode: 'ultra', recoveryWrappedDek: account.recovery_wrapped_dek, destructiveResetAvailable: true };
  });

  route('POST', '/v1/recover/finish', ({ body }) => {
    const row = q('SELECT * FROM tokens WHERE hash = ? AND kind = ? AND expires_at > ?').get(c.sha256(String(body.ticket || '')), 'ticket', clock());
    if (!row) fail(400, 'invalid_ticket');
    const account = accountById(row.account_id);
    if (!account) fail(400, 'invalid_ticket');
    if (!validKey(body.newAuthKey, 32) || !validKey(body.newKdfSalt, 16) || !validBlob(body.newWrappedDek)) fail(400, 'invalid_keys');
    const serverSalt = c.b64(crypto.randomBytes(16));
    const verifier = c.hashVerifier(body.newAuthKey, serverSalt);
    if (account.mode === 'ultra') {
      if (body.reset) {
        if (!validBlob(body.newRecoveryWrappedDek) || !/^[0-9a-f]{64}$/.test(body.newRecoveryProofHash || '')) fail(400, 'invalid_keys');
        q('DELETE FROM records WHERE account_id = ?').run(account.id);
        q('UPDATE accounts SET recovery_wrapped_dek = ?, recovery_proof_hash = ? WHERE id = ?').run(body.newRecoveryWrappedDek, body.newRecoveryProofHash, account.id);
      } else {
        // Ohne Wiederherstellungsschlüssel darf nur der destruktive Reset laufen.
        const proofHash = c.sha256(c.unb64(body.recoveryProof));
        if (!body.recoveryProof || !account.recovery_proof_hash || !c.safeEqual(proofHash, account.recovery_proof_hash)) fail(403, 'recovery_proof_required');
      }
    }
    q('UPDATE accounts SET verifier = ?, server_salt = ?, kdf_salt = ?, wrapped_dek = ?, failed_logins = 0, locked_until = 0 WHERE id = ?')
      .run(verifier, serverSalt, body.newKdfSalt, body.newWrappedDek, account.id);
    q('DELETE FROM tokens WHERE hash = ?').run(row.hash);
    revokeSessions(account.id);
    return { ok: true, reset: !!body.reset };
  });

  route('POST', '/v1/export', ({ account, body }) => {
    requireAuthKey(account, body.authKey);
    const active = q("SELECT id FROM exports WHERE account_id = ? AND status IN ('queued','processing')").get(account.id);
    if (active) return { id: active.id, status: 'queued' };
    const last = q('SELECT created_at FROM exports WHERE account_id = ? ORDER BY created_at DESC LIMIT 1').get(account.id);
    if (last && clock() - last.created_at < config.exportMinIntervalMs) fail(429, 'export_rate_limited', { retryAfterMs: config.exportMinIntervalMs - (clock() - last.created_at) });
    const id = crypto.randomUUID();
    q('INSERT INTO exports (id, account_id, status, created_at) VALUES (?,?,?,?)').run(id, account.id, 'queued', clock());
    return { _http: 202, body: { id, status: 'queued' } };
  }, { auth: true });

  route('GET', '/v1/export/([0-9a-f-]{36})', ({ account, params }) => {
    const job = q('SELECT id, status, created_at, ready_at, error FROM exports WHERE id = ? AND account_id = ?').get(params[0], account.id);
    if (!job) fail(404, 'not_found');
    return { id: job.id, status: job.status, createdAt: job.created_at, readyAt: job.ready_at, error: job.error };
  }, { auth: true });

  route('GET', '/v1/export/([0-9a-f-]{36})/download', ({ account, params }) => {
    const job = q('SELECT * FROM exports WHERE id = ? AND account_id = ?').get(params[0], account.id);
    if (!job) fail(404, 'not_found');
    if (job.status !== 'ready' || !job.artifact) fail(409, 'not_ready');
    return { raw: job.artifact };
  }, { auth: true });

  route('DELETE', '/v1/account', ({ account, body }) => {
    requireAuthKey(account, body.authKey);
    deleteAccount(db, account.id);
    return { deleted: true };
  }, { auth: true });

  // Notfall-Löschung: braucht nur die Gerätesitzung, damit der Notfallknopf ohne Passwort funktioniert.
  route('DELETE', '/v1/account/emergency', ({ account, ip }) => {
    limit('emergency', ip, 5, 3600000);
    deleteAccount(db, account.id);
    return { deleted: true };
  }, { auth: true });

  // ---------- Hintergrundarbeit ----------

  async function processExports() {
    const job = q("SELECT * FROM exports WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
    if (!job) return false;
    q("UPDATE exports SET status = 'processing' WHERE id = ?").run(job.id);
    try {
      const account = accountById(job.account_id);
      if (!account) throw new Error('Konto nicht mehr vorhanden');
      const records = [];
      let since = 0;
      for (;;) {
        const rows = q('SELECT collection, id, blob, updated_at, deleted FROM records WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT 200').all(account.id, since);
        if (!rows.length) break;
        since = q('SELECT MAX(seq) AS s FROM records WHERE account_id = ? AND collection = ? AND id = ?').get(account.id, rows.at(-1).collection, rows.at(-1).id).s;
        for (const r of rows) records.push({ collection: r.collection, id: r.id, blob: r.blob, updatedAt: r.updated_at, deleted: !!r.deleted });
        await new Promise((res) => setImmediate(res)); // niedrige Priorität: Anfragen vorlassen
      }
      const artifact = JSON.stringify({
        format: 'aven-cloud-export', schemaVersion: 1, exportedAt: new Date(clock()).toISOString(),
        account: { id: account.id, mode: account.mode, createdAt: account.created_at },
        wrappedDek: account.wrapped_dek, recoveryWrappedDek: account.recovery_wrapped_dek, kdfSalt: account.kdf_salt, records,
      });
      q("UPDATE exports SET status = 'ready', ready_at = ?, artifact = ? WHERE id = ?").run(clock(), artifact, job.id);
    } catch (err) {
      q("UPDATE exports SET status = 'failed', error = ? WHERE id = ?").run(String(err.message).slice(0, 200), job.id);
    }
    return true;
  }

  // Räumt abgelaufene Exporte, Tokens, Sitzungen und inaktive Konten auf.
  function maintenance() {
    const t = clock();
    q("UPDATE exports SET artifact = NULL, status = 'expired' WHERE status = 'ready' AND ready_at < ?").run(t - config.exportTtlMs);
    q('DELETE FROM tokens WHERE expires_at < ?').run(t);
    q('DELETE FROM sessions WHERE expires_at < ?').run(t);
    let deleted = 0;
    for (const [mode, days] of [['ultra', config.inactivityDaysUltra], ['normal', config.inactivityDaysNormal]]) {
      if (!days) continue;
      for (const row of q('SELECT id FROM accounts WHERE mode = ? AND last_active_at < ?').all(mode, t - days * DAY)) {
        deleteAccount(db, row.id);
        deleted += 1;
      }
    }
    limiter.sweep(t);
    return { deleted };
  }

  // ---------- HTTP ----------

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'too_large')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(new HttpError(400, 'invalid_json'));
        }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, payload, raw) {
    const body = raw ?? JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    stats.requests += 1;
    try {
      const url = new URL(req.url, 'http://localhost');
      const match = routes.map((r) => ({ r, m: r.method === req.method ? r.pattern.exec(url.pathname) : null })).find((x) => x.m);
      if (!match) {
        if (routes.some((r) => r.pattern.test(url.pathname))) fail(405, 'method_not_allowed');
        fail(404, 'not_found');
      }
      const ctx = { req, ip: clientKey(req), query: url.searchParams, params: match.m.slice(1), body: {} };
      if (req.method !== 'GET' && req.method !== 'HEAD') ctx.body = await readBody(req);
      if (match.r.auth) Object.assign(ctx, authenticate(req));
      const result = await match.r.handler(ctx);
      if (result && result.raw) return send(res, 200, null, result.raw);
      if (result && result._http) return send(res, result._http, result.body);
      send(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) stats.errors += 1;
        return send(res, err.status, { error: err.code, ...err.extra });
      }
      stats.errors += 1;
      console.error('Interner Fehler:', err.message); // nie Anfrageinhalt, IP oder Adresse protokollieren
      send(res, 500, { error: 'internal' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  return {
    server, db, mailer, stats, processExports, maintenance,
    close() { server.close(); db.close(); },
  };
}

module.exports = { createApp, HttpError };
