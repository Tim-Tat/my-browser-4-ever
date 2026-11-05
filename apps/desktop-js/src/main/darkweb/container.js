const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const k = require('../account/keys');
const { VaultError, backoffMs, DEFAULT_KDF } = require('../vault/vault');

const scrypt = promisify(crypto.scrypt);
const VERSION = 1;
const AAD_KEY = 'aven-darkweb/key';
const AAD_DATA = 'aven-darkweb/data';
const MIN_PASSPHRASE = 12;
const zero = (buf) => { if (Buffer.isBuffer(buf)) buf.fill(0); };

// Verschlüsselter Container für die wenigen Daten des Darkweb-Modus (zum Beispiel Lesezeichen).
// Der Datenschlüssel wird zuerst mit dem Windows-Konto (Hülle A) und das Ergebnis dann mit der
// Passphrase (Hülle B) verpackt. Zum Öffnen braucht es beide. Es gibt bewusst keine Wiederherstellung:
// Wer die Passphrase verliert, verliert die Daten.
class Container {
  constructor(file, { deviceWrap = null, kdf = DEFAULT_KDF, now = Date.now } = {}) {
    this.file = file;
    this.deviceWrap = deviceWrap;
    this.kdf = kdf;
    this.now = now;
    this.key = null;
    this.data = null;
  }

  exists() {
    return fs.existsSync(this.file);
  }

  get unlocked() {
    return !!this.key;
  }

  read() {
    try {
      const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (doc.v !== VERSION) throw new VaultError('unsupported_version');
      return doc;
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultError(this.exists() ? 'container_corrupt' : 'no_container');
    }
  }

  write(doc) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  async derive(passphrase, kdf) {
    return scrypt(String(passphrase).normalize('NFKC'), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 + (1 << 20) });
  }

  async wrap(doc, dek, passphrase) {
    const kdf = { ...this.kdf, salt: k.b64(crypto.randomBytes(16)) };
    const bound = !!(this.deviceWrap && this.deviceWrap.isAvailable());
    const inner = bound ? this.deviceWrap.encrypt(dek) : dek; // Hülle A
    const passKey = await this.derive(passphrase, kdf);
    doc.kdf = kdf;
    doc.deviceBound = bound;
    doc.wrappedKey = k.encrypt(passKey, inner, AAD_KEY); // Hülle B
    zero(passKey);
  }

  async create(passphrase, initial = {}) {
    if (this.exists()) throw new VaultError('exists');
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new VaultError('passphrase_too_short');
    const dek = crypto.randomBytes(32);
    const doc = { v: VERSION, createdAt: this.now(), security: { failed: 0, lockedUntil: 0 }, blob: null };
    await this.wrap(doc, dek, passphrase);
    doc.blob = k.encrypt(dek, Buffer.from(JSON.stringify(initial)), AAD_DATA);
    this.write(doc);
    this.key = dek;
    this.data = initial;
  }

  async unlock(passphrase) {
    const doc = this.read();
    const wait = doc.security.lockedUntil - this.now();
    if (wait > 0) throw new VaultError('too_many_attempts', { retryAfterMs: wait });
    const passKey = await this.derive(passphrase, doc.kdf);
    let dek = null;
    try {
      const inner = k.decrypt(passKey, doc.wrappedKey, AAD_KEY);
      if (doc.deviceBound) {
        if (!this.deviceWrap) throw new VaultError('device_key_unavailable');
        try { dek = this.deviceWrap.decrypt(inner); } catch { throw new VaultError('device_key_unavailable'); }
      } else dek = inner;
    } catch (err) {
      if (err instanceof VaultError) throw err;
    } finally {
      zero(passKey);
    }
    if (!dek) {
      doc.security.failed += 1;
      const delay = backoffMs(doc.security.failed);
      doc.security.lockedUntil = delay ? this.now() + delay : 0;
      this.write(doc);
      throw new VaultError('wrong_password', { retryAfterMs: delay });
    }
    try {
      this.data = JSON.parse(k.decrypt(dek, doc.blob, AAD_DATA).toString('utf8'));
    } catch {
      zero(dek);
      throw new VaultError('container_tampered');
    }
    doc.security = { failed: 0, lockedUntil: 0 };
    this.write(doc);
    this.key = dek;
  }

  save(data) {
    if (!this.key) throw new VaultError('locked');
    const doc = this.read();
    doc.blob = k.encrypt(this.key, Buffer.from(JSON.stringify(data)), AAD_DATA);
    this.write(doc);
    this.data = data;
  }

  lock() {
    zero(this.key);
    this.key = null;
    this.data = null;
  }

  destroy() {
    this.lock();
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { Container };
