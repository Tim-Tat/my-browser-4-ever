const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/main/vault/vault');
const { Container } = require('../src/main/darkweb/container');

const FAST_KDF = { name: 'scrypt', N: 1024, r: 8, p: 1 };
const PASS = 'eine-lange-passphrase-123';
const MASTER = 'ein-sehr-langes-meisterpasswort';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aven-race-'));

test('Onion-Container: Sperre während des Entsperrens wird nicht rückgängig gemacht', async () => {
  const dir = tmp();
  try {
    const c = new Container(path.join(dir, 'c.json'), { kdf: FAST_KDF });
    await c.create(PASS, { bookmarks: [] });
    c.lock();
    const pending = c.unlock(PASS);
    c.lock(); // Fenster wird geschlossen oder Notfall, während die Schlüsselableitung läuft
    await assert.rejects(pending, { code: 'locked' });
    assert.strictEqual(c.unlocked, false);
    assert.strictEqual(c.data, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Onion-Container: Erstellen während einer Sperre legt keine Datei an und entsperrt nichts', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'c.json');
    const c = new Container(file, { kdf: FAST_KDF });
    const pending = c.create(PASS);
    c.lock();
    await assert.rejects(pending, { code: 'locked' });
    assert.strictEqual(fs.existsSync(file), false);
    assert.strictEqual(c.unlocked, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Tresor: Passwortwechsel überschreibt keinen währenddessen erzeugten Wiederherstellungsschlüssel', async () => {
  const dir = tmp();
  try {
    const vault = new Vault(path.join(dir, 'v.json'), { kdf: FAST_KDF });
    await vault.create(MASTER);

    const change = vault.changeMaster(MASTER, 'ein-neues-sehr-langes-passwort'); // Ableitung läuft
    const rotated = await vault.rotateRecoveryKey(); // neuer Schlüssel in der Zwischenzeit
    await change;

    vault.lock();
    await vault.unlockWithRecovery(rotated.recoveryKey, 'noch-ein-langes-passwort-1');
    assert.strictEqual(vault.unlocked, true, 'der neue Wiederherstellungsschlüssel gilt weiter');
    vault.lock();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
