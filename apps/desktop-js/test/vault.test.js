const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, VaultError, parseCsv, backoffMs } = require('../src/main/vault/vault');
const { generatePassword, estimateStrength, pwnedCount } = require('../src/main/vault/tools');

const FAST_KDF = { name: 'scrypt', N: 1024, r: 8, p: 1 };
const MASTER = 'ein-sehr-langes-meisterpasswort';

// Nachbildung von Windows DPAPI: eigener Schlüssel pro "Gerät".
const fakeDevice = (key = crypto.randomBytes(32)) => ({
  isAvailable: () => true,
  encrypt(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()]); },
  decrypt(buf) { const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(buf.length - 16)); return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]); },
});

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-vault-'));
  const file = path.join(dir, 'vault.json');
  const clock = { now: 1_700_000_000_000 };
  const make = (extra = {}) => new Vault(file, { kdf: FAST_KDF, now: () => clock.now, ...options, ...extra });
  return { dir, file, clock, vault: make(), make };
}
const cleanup = (ctx) => { ctx.vault.lock(); fs.rmSync(ctx.dir, { recursive: true, force: true }); };

test('Anlegen, Sperren, Entsperren', async () => {
  const ctx = setup();
  try {
    assert.strictEqual(ctx.vault.status().exists, false);
    const { recoveryKey } = await ctx.vault.create(MASTER);
    assert.match(recoveryKey, /^([A-Z2-7]{4}-){12}[A-Z2-7]{1,4}$/);
    assert.strictEqual(ctx.vault.unlocked, true);
    ctx.vault.lock();
    assert.throws(() => ctx.vault.list(), { code: 'locked' });
    await ctx.vault.unlock(MASTER);
    assert.strictEqual(ctx.vault.unlocked, true);
    await assert.rejects(ctx.vault.create(MASTER), { code: 'exists' });
  } finally { cleanup(ctx); }
});

test('Zu kurzes Meisterpasswort wird abgelehnt', async () => {
  const ctx = setup();
  try {
    await assert.rejects(ctx.vault.create('kurz'), { code: 'master_too_short' });
    assert.strictEqual(ctx.vault.exists(), false);
  } finally { cleanup(ctx); }
});

test('Die Datei enthält keine Klartextdaten', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    ctx.vault.add({ title: 'Bank', url: 'https://bank.example/login', username: 'maria.muster', password: 'S3hrGeheim!Passwort', notes: 'Notiz mit Inhalt' });
    ctx.vault.addNeverSave('https://nie.example/');
    const raw = fs.readFileSync(ctx.file, 'utf8');
    for (const secret of ['bank.example', 'maria.muster', 'S3hrGeheim', 'Notiz mit Inhalt', 'nie.example', MASTER]) assert.ok(!raw.includes(secret), secret);
  } finally { cleanup(ctx); }
});

test('Falsches Passwort und Bremse nach Fehlversuchen', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    ctx.vault.lock();
    for (let i = 0; i < 3; i++) {
      await assert.rejects(ctx.vault.unlock('falsch-falsch-falsch'), { code: 'wrong_password' });
    }
    await assert.rejects(ctx.vault.unlock('falsch-falsch-falsch'), (err) => err.code === 'wrong_password' && err.retryAfterMs === backoffMs(4));
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'too_many_attempts' }, 'auch das richtige Passwort wartet');
    ctx.clock.now += 3000;
    await ctx.vault.unlock(MASTER);
    assert.strictEqual(ctx.vault.status().failedAttempts, 0);
    assert.strictEqual(backoffMs(3), 0);
    assert.strictEqual(backoffMs(30), 900000);
  } finally { cleanup(ctx); }
});

test('Einträge: anlegen, ändern mit Verlauf, löschen, nach Neustart lesbar', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    const item = ctx.vault.add({ title: 'Mail', url: 'https://mail.example', username: 'a', password: 'erstes-passwort' });
    ctx.clock.now += 1000;
    ctx.vault.update(item.id, { password: 'zweites-passwort' });
    ctx.vault.update(item.id, { notes: 'nur Notiz' });
    const full = ctx.vault.get(item.id);
    assert.strictEqual(full.history.length, 1);
    assert.strictEqual(full.history[0].password, 'erstes-passwort');
    assert.strictEqual(full.passwordChangedAt, ctx.clock.now);
    assert.ok(!('password' in ctx.vault.list()[0]), 'die Liste enthält keine Passwörter');

    const other = ctx.make();
    await other.unlock(MASTER);
    assert.strictEqual(other.get(item.id).password, 'zweites-passwort');
    other.remove(item.id);
    assert.throws(() => other.get(item.id), { code: 'not_found' });
    other.lock();
    assert.throws(() => ctx.vault.add({ password: '' }), { code: 'password_required' });
  } finally { cleanup(ctx); }
});

test('Ungültige Adressen und Passwörter werden abgelehnt', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    assert.throws(() => ctx.vault.add({ url: 'javascript:alert(1)', password: 'x' }), { code: 'invalid_url' });
    assert.throws(() => ctx.vault.add({ url: 'kein url', password: 'x' }), { code: 'invalid_url' });
    assert.throws(() => ctx.vault.add({ url: 'https://a.example', password: '' }), { code: 'password_required' });
  } finally { cleanup(ctx); }
});

test('Manipulation an der Datei wird erkannt', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    const item = ctx.vault.add({ title: 'X', url: 'https://x.example', username: 'u', password: 'geheim-geheim' });
    ctx.vault.lock();
    const doc = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
    const bytes = Buffer.from(doc.items[0].blob, 'base64');
    bytes[bytes.length - 20] ^= 1;
    doc.items[0].blob = bytes.toString('base64');
    fs.writeFileSync(ctx.file, JSON.stringify(doc));
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'vault_tampered' });
    assert.strictEqual(ctx.vault.unlocked, false);

    // Ein Eintrag lässt sich nicht unter fremder ID einschleusen.
    const doc2 = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
    doc2.items[0].blob = Buffer.from(bytes).toString('base64');
    doc2.items[0].id = 'andere-id';
    fs.writeFileSync(ctx.file, JSON.stringify(doc2));
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'vault_tampered' });
    assert.ok(item);
  } finally { cleanup(ctx); }
});

test('Gerätebindung: ohne den Windows-Schlüssel bleibt der Tresor zu, auch mit richtigem Passwort', async () => {
  const device = fakeDevice();
  const ctx = setup({ deviceWrap: device });
  try {
    await ctx.vault.create(MASTER);
    assert.strictEqual(ctx.vault.status().deviceBound, true);
    ctx.vault.lock();
    await ctx.vault.unlock(MASTER);
    ctx.vault.lock();
    const stolenCopy = ctx.make({ deviceWrap: fakeDevice() });
    await assert.rejects(stolenCopy.unlock(MASTER), { code: 'device_key_unavailable' });
    const noDevice = ctx.make({ deviceWrap: null });
    await assert.rejects(noDevice.unlock(MASTER), { code: 'device_key_unavailable' });
  } finally { cleanup(ctx); }
});

test('Wiederherstellungsschlüssel: neues Meisterpasswort, auch auf neuem Gerät', async () => {
  const ctx = setup({ deviceWrap: fakeDevice() });
  try {
    const { recoveryKey } = await ctx.vault.create(MASTER);
    const item = ctx.vault.add({ title: 'R', url: 'https://r.example', username: 'u', password: 'rette-mich-passwort' });
    ctx.vault.lock();
    const newDevice = ctx.make({ deviceWrap: fakeDevice() });
    await assert.rejects(newDevice.unlockWithRecovery('AAAA-BBBB-CCCC', 'neues-meisterpasswort-1'), { code: 'wrong_recovery_key' });
    await newDevice.unlockWithRecovery(recoveryKey.toLowerCase(), 'neues-meisterpasswort-1');
    assert.strictEqual(newDevice.get(item.id).password, 'rette-mich-passwort');
    newDevice.lock();
    await assert.rejects(newDevice.unlock(MASTER), { code: 'wrong_password' });
    await newDevice.unlock('neues-meisterpasswort-1');
  } finally { cleanup(ctx); }
});

test('Meisterpasswort ändern, Wiederherstellungsschlüssel erneuern', async () => {
  const ctx = setup();
  try {
    const { recoveryKey } = await ctx.vault.create(MASTER);
    ctx.vault.add({ title: 'A', url: 'https://a.example', username: 'u', password: 'bleibt-erhalten-1' });
    await assert.rejects(ctx.vault.changeMaster('falsches-passwort-1', 'brandneues-passwort-12'), { code: 'wrong_password' });
    await ctx.vault.changeMaster(MASTER, 'brandneues-passwort-12');
    ctx.vault.lock();
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'wrong_password' });
    await ctx.vault.unlock('brandneues-passwort-12');
    assert.strictEqual(ctx.vault.list().length, 1);

    const rotated = await ctx.vault.rotateRecoveryKey();
    assert.notStrictEqual(rotated.recoveryKey, recoveryKey);
    ctx.vault.lock();
    await assert.rejects(ctx.vault.unlockWithRecovery(recoveryKey, 'noch-ein-passwort-123'), { code: 'wrong_recovery_key' });
  } finally { cleanup(ctx); }
});

test('Automatische Sperre nach Inaktivität meldet den Grund', async () => {
  let reason = null;
  const ctx = setup({ autoLockMs: 60, onLock: (r) => { reason = r; } });
  try {
    await ctx.vault.create(MASTER);
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(ctx.vault.unlocked, false);
    assert.strictEqual(reason, 'idle');
    assert.throws(() => ctx.vault.setAutoLockMinutes(7), { code: 'invalid_setting' });
    ctx.vault.setAutoLockMinutes(15);
    assert.strictEqual(ctx.vault.status().autoLockMinutes, 15);
  } finally { cleanup(ctx); }
});

test('Passende Einträge: Host, Port, www, nie https-Daten auf http', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    ctx.vault.add({ title: 'Sicher', url: 'https://www.shop.example/login', username: 'a', password: 'x1' });
    ctx.vault.add({ title: 'Anderer Port', url: 'https://shop.example:8443', username: 'b', password: 'x2' });
    ctx.vault.add({ title: 'Lokal', url: 'http://localhost:3000', username: 'c', password: 'x3' });
    const titles = (url) => ctx.vault.findForUrl(url).map((m) => m.title);
    assert.deepStrictEqual(titles('https://shop.example/anmelden'), ['Sicher']);
    assert.deepStrictEqual(titles('http://shop.example/'), [], 'https-Daten nie auf http');
    assert.deepStrictEqual(titles('https://shop.example:8443/'), ['Anderer Port']);
    assert.deepStrictEqual(titles('https://shop.example.evil.com/'), [], 'kein Teilstring-Treffer');
    assert.deepStrictEqual(titles('https://evil-shop.example/'), []);
    assert.deepStrictEqual(titles('http://localhost:3000/'), ['Lokal']);
    assert.deepStrictEqual(titles('file:///etc/passwd'), []);
    assert.deepStrictEqual(ctx.vault.compareWithSaved('https://shop.example/', 'a', 'x1'), { kind: 'same', id: ctx.vault.findForUrl('https://shop.example/')[0].id });
    assert.strictEqual(ctx.vault.compareWithSaved('https://shop.example/', 'a', 'neu').kind, 'changed');
    assert.strictEqual(ctx.vault.compareWithSaved('https://shop.example/', 'z', 'neu').kind, 'new');
    ctx.vault.lock();
    assert.deepStrictEqual(ctx.vault.findForUrl('https://shop.example/'), [], 'gesperrt: keine Treffer');
  } finally { cleanup(ctx); }
});

test('"Nie speichern" gilt pro Seite und bleibt erhalten', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    ctx.vault.addNeverSave('https://www.nie.example/login');
    assert.ok(ctx.vault.neverSaveFor('https://nie.example/'));
    assert.ok(!ctx.vault.neverSaveFor('https://doch.example/'));
    ctx.vault.lock();
    await ctx.vault.unlock(MASTER);
    assert.ok(ctx.vault.neverSaveFor('https://nie.example/'));
  } finally { cleanup(ctx); }
});

test('Sicherheitsprüfung: schwach, wiederverwendet, alt', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    const a = ctx.vault.add({ title: 'a', url: 'https://a.example', username: 'u', password: '123456' });
    const b = ctx.vault.add({ title: 'b', url: 'https://b.example', username: 'u', password: 'Xk7#mQ2vLp9$Rt4w' });
    const c = ctx.vault.add({ title: 'c', url: 'https://c.example', username: 'u', password: 'Xk7#mQ2vLp9$Rt4w' });
    ctx.clock.now += 400 * 24 * 3600 * 1000;
    const result = ctx.vault.audit(estimateStrength);
    assert.deepStrictEqual(result.weak, [a.id]);
    assert.deepStrictEqual(result.reused, [[b.id, c.id]]);
    assert.strictEqual(result.old.length, 3);
  } finally { cleanup(ctx); }
});

test('CSV-Import: Chrome-, Bitwarden-Format, Duplikate, ungültige Zeilen', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    const chrome = 'name,url,username,password,note\nGitHub,https://github.com/login,tim,"pa,ss""wort",Notiz\nOhne,,x,\nKaputt,javascript:1,x,y\n';
    assert.deepStrictEqual(ctx.vault.importCsv(chrome), { added: 1, skipped: 0, invalid: 2 });
    assert.strictEqual(ctx.vault.get(ctx.vault.list()[0].id).password, 'pa,ss"wort');
    assert.deepStrictEqual(ctx.vault.importCsv(chrome), { added: 0, skipped: 1, invalid: 2 });
    const bitwarden = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Mail,,,0,https://mail.example,u,pw-1234567,\n';
    assert.strictEqual(ctx.vault.importCsv(bitwarden).added, 1);
    assert.throws(() => ctx.vault.importCsv('a,b\n1,2\n'), { code: 'csv_unrecognized' });
    assert.deepStrictEqual(parseCsv('a,"b\nc",d\n1,2,3'), [['a', 'b\nc', 'd'], ['1', '2', '3']]);
  } finally { cleanup(ctx); }
});

test('Verschlüsselte Sicherung und Löschen', async () => {
  const ctx = setup();
  try {
    await ctx.vault.create(MASTER);
    ctx.vault.add({ title: 'S', url: 'https://s.example', username: 'u', password: 'sicherung-pw-1' });
    const target = path.join(ctx.dir, 'backup.json');
    ctx.vault.exportBackup(target);
    assert.ok(!fs.readFileSync(target, 'utf8').includes('sicherung-pw-1'));
    ctx.vault.destroy();
    assert.strictEqual(ctx.vault.exists(), false);
    assert.strictEqual(fs.existsSync(`${ctx.file}.bak`), false);
    assert.strictEqual(ctx.vault.status().exists, false);
  } finally { cleanup(ctx); }
});

test('Kaputte oder fremde Tresordatei', async () => {
  const ctx = setup();
  try {
    fs.writeFileSync(ctx.file, 'kein json');
    assert.strictEqual(ctx.vault.status().error, 'vault_corrupt');
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'vault_corrupt' });
    fs.writeFileSync(ctx.file, JSON.stringify({ v: 99 }));
    await assert.rejects(ctx.vault.unlock(MASTER), { code: 'unsupported_version' });
  } finally { cleanup(ctx); }
});

test('Generator: Länge, Zeichenklassen, mehrdeutige Zeichen, Zufall', () => {
  const pw = generatePassword({ length: 24 });
  assert.strictEqual(pw.length, 24);
  assert.match(pw, /[a-z]/); assert.match(pw, /[A-Z]/); assert.match(pw, /\d/); assert.match(pw, /[^A-Za-z0-9]/);
  for (let i = 0; i < 50; i++) assert.ok(!/[O0oIl1|]/.test(generatePassword({ length: 30, avoidAmbiguous: true })));
  assert.match(generatePassword({ length: 16, lower: false, upper: false, symbols: false }), /^\d{16}$/);
  assert.strictEqual(generatePassword({ length: 3 }).length, 8, 'Mindestlänge');
  assert.strictEqual(generatePassword({ length: 500 }).length, 128, 'Höchstlänge');
  assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }));
  assert.notStrictEqual(generatePassword(), generatePassword());
});

test('Stärkeschätzung', () => {
  assert.ok(estimateStrength('123456').bits < 28);
  assert.ok(estimateStrength('Passwort123').bits < 40);
  assert.ok(estimateStrength('aaaaaaaaaaaaaaaa').bits < 50);
  assert.ok(estimateStrength(generatePassword({ length: 20 })).bits >= 80);
  assert.strictEqual(estimateStrength('').label, 'leer');
});

test('Datenleck-Prüfung sendet nur fünf Zeichen des Hashes', async () => {
  const hash = crypto.createHash('sha1').update('password').digest('hex').toUpperCase();
  let requested = null;
  const fakeFetch = async (url) => {
    requested = url;
    return { ok: true, text: async () => `0000000000000000000000000000000000A:3\r\n${hash.slice(5)}:9545824\r\nFFFFF:0` };
  };
  assert.strictEqual(await pwnedCount('password', fakeFetch), 9545824);
  assert.strictEqual(requested, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
  assert.ok(!requested.includes(hash.slice(5)));
  assert.strictEqual(await pwnedCount('ganz-sicher-nicht-im-leck-4711', async () => ({ ok: true, text: async () => 'ABCDE:1' })), 0);
  await assert.rejects(pwnedCount('x', async () => ({ ok: false, status: 503 })));
});
