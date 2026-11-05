const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const k = require('../account/keys');

const scrypt = promisify(crypto.scrypt);

const VERSION = 1;
// OWASP-Empfehlung für scrypt: N = 2^17, r = 8, p = 1 (128 MiB Arbeitsspeicher).
const DEFAULT_KDF = { name: 'scrypt', N: 131072, r: 8, p: 1 };
const MIN_MASTER_LENGTH = 12;
const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60];
const MAX_ITEMS = 5000;
const HISTORY_LIMIT = 5;
const AAD_MASTER = 'aven-vault/vk/master';
const AAD_RECOVERY = 'aven-vault/vk/recovery';
const AAD_NEVER = 'aven-vault/never-save';

class VaultError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const itemAad = (id) => `aven-vault/item/${id}`;
const zero = (buf) => { if (Buffer.isBuffer(buf)) buf.fill(0); };

function backoffMs(failed) {
  return failed < 4 ? 0 : Math.min(900, 2 ** (failed - 3)) * 1000;
}

// Lokaler Passwort-Tresor.
//
// Schlüssel: Aus dem Meisterpasswort entsteht per scrypt der Meisterschlüssel. Er verpackt den
// zufälligen Tresorschlüssel (VK). Ist ein `deviceWrap` verfügbar (Windows DPAPI), wird der VK
// zusätzlich an das Windows-Konto gebunden: Zum Öffnen braucht es dann beide. Ein zufälliger
// Wiederherstellungsschlüssel verpackt den VK unabhängig davon ein zweites Mal.
// Jeder Eintrag ist einzeln mit AES-256-GCM verschlüsselt; nur ID und Zeitstempel liegen im Klartext.
class Vault {
  constructor(file, { deviceWrap = null, kdf = DEFAULT_KDF, now = Date.now, onLock = null, autoLockMs = null } = {}) {
    this.file = file;
    this.deviceWrap = deviceWrap;
    this.kdf = kdf;
    this.now = now;
    this.onLock = onLock;
    this.autoLockMs = autoLockMs; // nur für Tests: überschreibt die eingestellte Frist
    this.vk = null;
    this.items = new Map();
    this.neverSave = new Set();
    this.timer = null;
    this.epoch = 0; // zählt jede Sperre und Löschung; laufende Entsperrvorgänge prüfen sie danach
  }

  // Verwirft Ergebnisse eines asynchronen Vorgangs, wenn der Tresor währenddessen gesperrt oder
  // gelöscht wurde (Systemsperre, Ruhezustand, Notfall). Sonst würde er den Schlüssel wieder setzen
  // oder die gelöschte Tresordatei neu anlegen.
  ensureCurrent(epoch, ...secrets) {
    if (this.epoch === epoch) return;
    for (const s of secrets) zero(s);
    throw new VaultError('locked');
  }

  // ---------- Datei ----------

  exists() {
    return fs.existsSync(this.file);
  }

  read() {
    try {
      const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (doc.v !== VERSION) throw new VaultError('unsupported_version');
      return doc;
    } catch (err) {
      if (err instanceof VaultError) throw err;
      if (!this.exists()) throw new VaultError('no_vault');
      throw new VaultError('vault_corrupt');
    }
  }

  write(doc) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (this.exists()) fs.copyFileSync(this.file, `${this.file}.bak`);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  // ---------- Zustand ----------

  get unlocked() {
    return !!this.vk;
  }

  status() {
    if (!this.exists()) return { exists: false, unlocked: false };
    let doc;
    try { doc = this.read(); } catch (err) { return { exists: true, unlocked: false, error: err.code }; }
    return {
      exists: true, unlocked: this.unlocked, count: this.unlocked ? this.items.size : null,
      failedAttempts: doc.security.failed, lockedUntil: doc.security.lockedUntil,
      deviceBound: doc.deviceBound, autoLockMinutes: doc.settings.autoLockMinutes, createdAt: doc.createdAt,
    };
  }

  requireUnlocked() {
    if (!this.vk) throw new VaultError('locked');
    this.touch();
  }

  // Sperrt nach Inaktivität. Jede Aktion setzt die Uhr zurück.
  touch() {
    clearTimeout(this.timer);
    if (!this.vk) return;
    let minutes = 5;
    try { minutes = this.read().settings.autoLockMinutes; } catch { /* Standardwert */ }
    this.timer = setTimeout(() => this.lock('idle'), (this.autoLockMs ?? minutes * 60000));
    this.timer.unref?.();
  }

  setAutoLockMinutes(minutes) {
    if (!AUTO_LOCK_CHOICES.includes(minutes)) throw new VaultError('invalid_setting');
    const doc = this.read();
    doc.settings.autoLockMinutes = minutes;
    this.write(doc);
    if (this.vk) this.touch();
  }

  lock(reason = 'manual') {
    this.epoch += 1;
    clearTimeout(this.timer);
    this.timer = null;
    const was = !!this.vk;
    zero(this.vk);
    this.vk = null;
    this.items.clear();
    this.neverSave.clear();
    if (was && this.onLock) this.onLock(reason);
  }

  // ---------- Schlüssel ----------

  async deriveMaster(password, kdf) {
    if (kdf.name !== 'scrypt') throw new VaultError('unsupported_kdf');
    const salt = Buffer.from(kdf.salt, 'base64');
    return scrypt(String(password).normalize('NFKC'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 + (1 << 20) });
  }

  async wrapMaster(doc, vk, masterPassword) {
    const kdf = { ...this.kdf, salt: k.b64(crypto.randomBytes(16)) };
    const masterKey = await this.deriveMaster(masterPassword, kdf);
    const bound = !!(this.deviceWrap && this.deviceWrap.isAvailable());
    const inner = bound ? this.deviceWrap.encrypt(vk) : vk;
    doc.kdf = kdf;
    doc.deviceBound = bound;
    doc.wrapped.master = k.encrypt(masterKey, inner, AAD_MASTER);
    zero(masterKey);
  }

  async openWithMaster(doc, masterPassword) {
    const masterKey = await this.deriveMaster(masterPassword, doc.kdf);
    try {
      const inner = k.decrypt(masterKey, doc.wrapped.master, AAD_MASTER);
      if (!doc.deviceBound) return inner;
      if (!this.deviceWrap) throw new VaultError('device_key_unavailable');
      try {
        return this.deviceWrap.decrypt(inner);
      } catch {
        throw new VaultError('device_key_unavailable');
      }
    } catch (err) {
      if (err instanceof VaultError) throw err;
      return null; // falsches Passwort
    } finally {
      zero(masterKey);
    }
  }

  checkLockout(doc) {
    const wait = doc.security.lockedUntil - this.now();
    if (wait > 0) throw new VaultError('too_many_attempts', { retryAfterMs: wait });
  }

  registerFailure(doc) {
    doc.security.failed += 1;
    const wait = backoffMs(doc.security.failed);
    doc.security.lockedUntil = wait ? this.now() + wait : 0;
    this.write(doc);
    return wait;
  }

  // Übernimmt den Tresorschlüssel erst, wenn alle Einträge geprüft sind. Bei einem Fehler bleibt nichts im Speicher.
  activate(vk, doc) {
    this.lock('relock');
    this.vk = vk;
    try {
      this.loadContents(doc);
    } catch (err) {
      this.lock('failed');
      throw err;
    }
    this.touch();
  }

  loadContents(doc) {
    this.items.clear();
    for (const rec of doc.items) {
      try {
        this.items.set(rec.id, JSON.parse(k.decrypt(this.vk, rec.blob, itemAad(rec.id)).toString('utf8')));
      } catch {
        throw new VaultError('vault_tampered');
      }
    }
    this.neverSave = new Set();
    if (doc.neverSave) {
      try {
        this.neverSave = new Set(JSON.parse(k.decrypt(this.vk, doc.neverSave, AAD_NEVER).toString('utf8')));
      } catch {
        throw new VaultError('vault_tampered');
      }
    }
  }

  // ---------- Anlegen, Öffnen, Wiederherstellen ----------

  async create(masterPassword) {
    if (this.exists()) throw new VaultError('exists');
    if (typeof masterPassword !== 'string' || masterPassword.length < MIN_MASTER_LENGTH) throw new VaultError('master_too_short');
    const vk = crypto.randomBytes(32);
    const recoveryKey = k.newRecoveryKey();
    const doc = {
      v: VERSION, createdAt: this.now(), kdf: null, deviceBound: false,
      wrapped: { master: null, recovery: k.encrypt(recoveryKey, vk, AAD_RECOVERY) },
      settings: { autoLockMinutes: 5 }, security: { failed: 0, lockedUntil: 0 }, items: [], neverSave: null,
    };
    const epoch = this.epoch;
    await this.wrapMaster(doc, vk, masterPassword);
    this.ensureCurrent(epoch, vk, recoveryKey);
    this.write(doc);
    this.activate(vk, doc);
    const text = k.formatRecoveryKey(recoveryKey);
    zero(recoveryKey);
    return { recoveryKey: text };
  }

  async unlock(masterPassword) {
    const epoch = this.epoch;
    const doc = this.read();
    this.checkLockout(doc);
    const vk = await this.openWithMaster(doc, masterPassword);
    this.ensureCurrent(epoch, vk);
    if (!vk) {
      const wait = this.registerFailure(doc);
      throw new VaultError('wrong_password', { retryAfterMs: wait });
    }
    doc.security = { failed: 0, lockedUntil: 0 };
    this.write(doc);
    this.activate(vk, doc);
  }

  // Öffnet mit dem Wiederherstellungsschlüssel und setzt ein neues Meisterpasswort.
  async unlockWithRecovery(recoveryText, newMasterPassword) {
    if (typeof newMasterPassword !== 'string' || newMasterPassword.length < MIN_MASTER_LENGTH) throw new VaultError('master_too_short');
    const epoch = this.epoch;
    const doc = this.read();
    this.checkLockout(doc);
    let vk;
    try {
      const key = k.parseRecoveryKey(recoveryText);
      vk = k.decrypt(key, doc.wrapped.recovery, AAD_RECOVERY);
      zero(key);
    } catch {
      const wait = this.registerFailure(doc);
      throw new VaultError('wrong_recovery_key', { retryAfterMs: wait });
    }
    await this.wrapMaster(doc, vk, newMasterPassword);
    this.ensureCurrent(epoch, vk);
    doc.security = { failed: 0, lockedUntil: 0 };
    this.write(doc);
    this.activate(vk, doc);
  }

  async changeMaster(oldPassword, newPassword) {
    this.requireUnlocked();
    if (typeof newPassword !== 'string' || newPassword.length < MIN_MASTER_LENGTH) throw new VaultError('master_too_short');
    const doc = this.read();
    this.checkLockout(doc);
    const epoch = this.epoch;
    const check = await this.openWithMaster(doc, oldPassword);
    this.ensureCurrent(epoch, check);
    if (!check) {
      const wait = this.registerFailure(this.read()); // auf dem aktuellen Stand, nicht auf dem alten
      throw new VaultError('wrong_password', { retryAfterMs: wait });
    }
    zero(check);
    // Die Ableitung dauert. Währenddessen kann sich der Tresor ändern (z. B. neuer Wiederherstellungs-
    // schlüssel). Darum nur das neue Master-Paket berechnen und danach in den aktuellen Stand einsetzen.
    const next = { wrapped: {} };
    await this.wrapMaster(next, this.vk, newPassword);
    this.ensureCurrent(epoch);
    const fresh = this.read();
    fresh.kdf = next.kdf;
    fresh.deviceBound = next.deviceBound;
    fresh.wrapped.master = next.wrapped.master;
    this.write(fresh);
  }

  // Erzeugt einen neuen Wiederherstellungsschlüssel; der alte wird ungültig.
  async rotateRecoveryKey() {
    this.requireUnlocked();
    const doc = this.read();
    const key = k.newRecoveryKey();
    doc.wrapped.recovery = k.encrypt(key, this.vk, AAD_RECOVERY);
    this.write(doc);
    const text = k.formatRecoveryKey(key);
    zero(key);
    return { recoveryKey: text };
  }

  // ---------- Einträge ----------

  persist() {
    const doc = this.read();
    doc.items = [...this.items.values()].map((item) => ({
      id: item.id, updatedAt: item.updatedAt, blob: k.encrypt(this.vk, Buffer.from(JSON.stringify(item)), itemAad(item.id)),
    }));
    doc.neverSave = this.neverSave.size ? k.encrypt(this.vk, Buffer.from(JSON.stringify([...this.neverSave])), AAD_NEVER) : null;
    this.write(doc);
  }

  static clean(data) {
    const str = (value, max) => String(value ?? '').slice(0, max);
    const url = str(data.url, 2048).trim();
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new VaultError('invalid_url'); }
      if (!/^https?:$/.test(parsed.protocol)) throw new VaultError('invalid_url');
    }
    return { title: str(data.title, 200).trim() || (url ? new URL(url).hostname : 'Ohne Titel'), url, username: str(data.username, 500), password: str(data.password, 2000), notes: str(data.notes, 10000) };
  }

  add(data) {
    this.requireUnlocked();
    if (this.items.size >= MAX_ITEMS) throw new VaultError('vault_full');
    const clean = Vault.clean(data);
    if (!clean.password) throw new VaultError('password_required');
    const t = this.now();
    const item = { id: crypto.randomUUID(), ...clean, createdAt: t, updatedAt: t, passwordChangedAt: t, history: [] };
    this.items.set(item.id, item);
    this.persist();
    return { ...item };
  }

  update(id, patch) {
    this.requireUnlocked();
    const item = this.items.get(id);
    if (!item) throw new VaultError('not_found');
    const clean = Vault.clean({ ...item, ...patch });
    if (!clean.password) throw new VaultError('password_required');
    const t = this.now();
    if (clean.password !== item.password) {
      item.history = [{ password: item.password, changedAt: item.passwordChangedAt }, ...item.history].slice(0, HISTORY_LIMIT);
      item.passwordChangedAt = t;
    }
    Object.assign(item, clean, { updatedAt: t });
    this.persist();
    return { ...item };
  }

  remove(id) {
    this.requireUnlocked();
    if (!this.items.delete(id)) throw new VaultError('not_found');
    this.persist();
  }

  get(id) {
    this.requireUnlocked();
    const item = this.items.get(id);
    if (!item) throw new VaultError('not_found');
    return { ...item, history: item.history.map((h) => ({ ...h })) };
  }

  // Liste ohne Passwörter.
  list() {
    this.requireUnlocked();
    return [...this.items.values()]
      .map(({ id, title, url, username, updatedAt, passwordChangedAt }) => ({ id, title, url, username, updatedAt, passwordChangedAt }))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  }

  // Einträge, die zu dieser Seite passen: gleicher Host (ohne "www."), gleicher Port.
  // Zugangsdaten einer https-Seite werden nie auf einer http-Seite angeboten.
  findForUrl(pageUrl) {
    if (!this.vk) return [];
    let page;
    try { page = new URL(pageUrl); } catch { return []; }
    if (!/^https?:$/.test(page.protocol)) return [];
    const host = (u) => u.hostname.replace(/^www\./, '');
    const matches = [];
    for (const item of this.items.values()) {
      if (!item.url) continue;
      const stored = new URL(item.url);
      if (host(stored) !== host(page) || stored.port !== page.port) continue;
      if (stored.protocol === 'https:' && page.protocol !== 'https:') continue;
      matches.push({ id: item.id, title: item.title, username: item.username });
    }
    return matches;
  }

  // Prüft, ob dieses Paar bereits gespeichert ist oder nur das Passwort abweicht.
  compareWithSaved(pageUrl, username, password) {
    const match = this.findForUrl(pageUrl).map((m) => this.items.get(m.id)).find((i) => i.username === username);
    if (!match) return { kind: 'new' };
    return match.password === password ? { kind: 'same', id: match.id } : { kind: 'changed', id: match.id };
  }

  // ---------- "Nie speichern" ----------

  neverSaveFor(pageUrl) {
    try { return this.neverSave.has(new URL(pageUrl).hostname.replace(/^www\./, '')); } catch { return false; }
  }

  addNeverSave(pageUrl) {
    this.requireUnlocked();
    this.neverSave.add(new URL(pageUrl).hostname.replace(/^www\./, ''));
    this.persist();
  }

  // ---------- Prüfung, Import, Sicherung, Löschen ----------

  audit(estimate) {
    this.requireUnlocked();
    const byPassword = new Map();
    const weak = [];
    const old = [];
    const cutoff = this.now() - 365 * 24 * 3600 * 1000;
    for (const item of this.items.values()) {
      if (!byPassword.has(item.password)) byPassword.set(item.password, []);
      byPassword.get(item.password).push(item.id);
      if (estimate(item.password).bits < 40) weak.push(item.id);
      if (item.passwordChangedAt < cutoff) old.push(item.id);
    }
    return { total: this.items.size, weak, old, reused: [...byPassword.values()].filter((ids) => ids.length > 1) };
  }

  importCsv(text) {
    this.requireUnlocked();
    if (typeof text !== 'string' || text.length > 5_000_000) throw new VaultError('csv_too_large');
    const rows = parseCsv(text);
    if (rows.length < 2) throw new VaultError('csv_unrecognized');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names) => header.findIndex((h) => names.includes(h));
    const idx = {
      url: col(['url', 'login_uri', 'website', 'web site', 'origin']),
      username: col(['username', 'login_username', 'user', 'login', 'email']),
      password: col(['password', 'login_password']),
      title: col(['name', 'title']),
      notes: col(['note', 'notes', 'extra']),
    };
    if (idx.password < 0) throw new VaultError('csv_unrecognized');
    const result = { added: 0, skipped: 0, invalid: 0 };
    for (const row of rows.slice(1)) {
      if (!row.length || (row.length === 1 && !row[0])) continue;
      const get = (i) => (i >= 0 ? row[i] ?? '' : '');
      const data = { url: get(idx.url), username: get(idx.username), password: get(idx.password), title: get(idx.title), notes: get(idx.notes) };
      if (!data.password || this.items.size >= MAX_ITEMS) { result.invalid += 1; continue; }
      let clean;
      try { clean = Vault.clean(data); } catch { result.invalid += 1; continue; }
      const duplicate = [...this.items.values()].some((i) => i.url === clean.url && i.username === clean.username && i.password === clean.password);
      if (duplicate) { result.skipped += 1; continue; }
      const t = this.now();
      const item = { id: crypto.randomUUID(), ...clean, createdAt: t, updatedAt: t, passwordChangedAt: t, history: [] };
      this.items.set(item.id, item);
      result.added += 1;
    }
    if (result.added) this.persist();
    return result;
  }

  // Die Sicherung ist die verschlüsselte Tresordatei; sie lässt sich nur mit Passwort oder Schlüssel öffnen.
  exportBackup(destination) {
    if (!this.exists()) throw new VaultError('no_vault');
    fs.copyFileSync(this.file, destination);
  }

  destroy() {
    this.lock('destroyed');
    for (const f of [this.file, `${this.file}.bak`, `${this.file}.tmp`]) fs.rmSync(f, { force: true });
  }
}

// Kleiner CSV-Leser (RFC 4180): Anführungszeichen, doppelte Anführungszeichen, Zeilenumbrüche in Feldern.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { Vault, VaultError, parseCsv, DEFAULT_KDF, MIN_MASTER_LENGTH, AUTO_LOCK_CHOICES, backoffMs };
