const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('AVE1');

// Lokale Persistenz. Mit `crypto` (Electron safeStorage, unter Windows DPAPI)
// wird der Inhalt an das Betriebssystemkonto gebunden.
class Store {
  constructor(dir, name, crypto = null) {
    this.file = path.join(dir, name);
    this.crypto = crypto;
    this.timer = null;
    this.pending = null;
  }

  get encrypted() {
    return !!this.crypto && this.crypto.isEncryptionAvailable();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file);
      if (raw.subarray(0, 4).equals(MAGIC)) {
        return JSON.parse(this.crypto.decryptString(raw.subarray(4)));
      }
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }

  save(data) {
    this.pending = data;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    if (this.pending === null) return;
    const json = JSON.stringify(this.pending);
    this.pending = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const body = this.encrypted ? Buffer.concat([MAGIC, this.crypto.encryptString(json)]) : Buffer.from(json);
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Zustand konnte nicht gespeichert werden:', err);
    }
  }

  remove() {
    clearTimeout(this.timer);
    this.pending = null;
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { Store };
