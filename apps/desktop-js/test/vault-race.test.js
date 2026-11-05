const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/main/vault/vault');

const FAST_KDF = { name: 'scrypt', N: 1024, r: 8, p: 1 };
const MASTER = 'ein-sehr-langes-meisterpasswort';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-vault-race-'));
  const file = path.join(dir, 'vault.json');
  return { dir, file, make: () => new Vault(file, { kdf: FAST_KDF }) };
}

test('Sperre während des Entsperrens: der Vorgang wird verworfen, der Tresor bleibt gesperrt', async () => {
  const ctx = setup();
  try {
    const vault = ctx.make();
    await vault.create(MASTER);
    vault.lock();

    const pending = vault.unlock(MASTER); // Schlüsselableitung läuft
    vault.lock('system'); // Systemsperre kommt dazwischen
    await assert.rejects(pending, { code: 'locked' });
    assert.strictEqual(vault.unlocked, false);

    await vault.unlock(MASTER); // ein neuer Versuch danach funktioniert normal
    assert.strictEqual(vault.unlocked, true);
    vault.lock();
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('Löschen während des Entsperrens: die gelöschte Tresordatei wird nicht neu angelegt', async () => {
  const ctx = setup();
  try {
    const vault = ctx.make();
    await vault.create(MASTER);
    vault.lock();

    const pending = vault.unlock('falsches-passwort-1234'); // würde einen Fehlversuch in die Datei schreiben
    vault.destroy(); // Notfall-Löschung kommt dazwischen
    await assert.rejects(pending, { code: 'locked' });
    assert.strictEqual(fs.existsSync(ctx.file), false, 'Tresordatei bleibt gelöscht');
    assert.strictEqual(vault.unlocked, false);
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});
