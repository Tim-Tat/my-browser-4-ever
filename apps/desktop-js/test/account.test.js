const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../server/test/helpers');
const k = require('../src/main/account/keys');
const { AccountManager } = require('../src/main/account/account');

const PASSWORD = 'ein-langes-passwort-123';

const memoryStore = () => ({ saved: null, load() { return this.saved && JSON.parse(this.saved); }, save(d) { this.saved = JSON.stringify(d); } });
const manager = (name = 'Gerät') => new AccountManager({ store: memoryStore(), deviceName: name });

// Lokaler Datenspeicher für den Sync-Test.
function fakeLocal(initial = {}) {
  const data = { spaces: {}, tabs: {}, archive: {}, history: {}, bookmarks: {}, settings: {}, ...initial };
  return {
    data,
    collect: () => Object.fromEntries(Object.entries(data).map(([c, items]) => [c, Object.entries(items).map(([id, d]) => ({ id, data: d }))])),
    apply(collection, id, value) {
      if (value === null) delete data[collection][id];
      else data[collection][id] = value;
    },
  };
}

const sync = (m, local) => m.sync(local);
const withServer = (fn) => async () => {
  const s = await startServer();
  try { await fn(s); } finally { s.close(); }
};

test('Schlüssel: Verpacken, falscher Schlüssel, Manipulation', () => {
  const salt = k.newSalt();
  const a = k.deriveKeys('passwort', salt);
  const b = k.deriveKeys('anderes', salt);
  const dek = k.newDek();
  const wrapped = k.wrapDek(a.wrapKey, dek);
  assert.deepStrictEqual(k.unwrapDek(a.wrapKey, wrapped), dek);
  assert.throws(() => k.unwrapDek(b.wrapKey, wrapped));
  assert.notStrictEqual(a.authKey, b.authKey);
  const bytes = Buffer.from(wrapped, 'base64');
  bytes[20] ^= 1;
  assert.throws(() => k.unwrapDek(a.wrapKey, bytes.toString('base64')));
  assert.throws(() => k.decrypt(dek, k.encrypt(dek, Buffer.from('x'), 'a/1'), 'a/2'), 'AAD bindet den Eintrag');
});

test('Wiederherstellungsschlüssel: Format, Prüfung, Beweis', () => {
  const key = k.newRecoveryKey();
  const text = k.formatRecoveryKey(key);
  assert.match(text, /^([A-Z2-7]{4}-){12}[A-Z2-7]{1,4}$/);
  assert.deepStrictEqual(k.parseRecoveryKey(text.toLowerCase().replace(/-/g, ' ')), key);
  assert.throws(() => k.parseRecoveryKey('KURZ'));
  assert.notStrictEqual(k.recoveryProofHash(key), k.recoveryProofHash(k.newRecoveryKey()));
});

test('Zwei Geräte: Sync in beide Richtungen, Löschung, Server sieht nur Chiffretext', withServer(async (s) => {
  const a = manager('Laptop');
  const reg = await a.register({ serverUrl: s.base, email: 'sync@example.org', password: PASSWORD, mode: 'ultra' });
  assert.ok(reg.recoveryKey);

  const localA = fakeLocal({ bookmarks: { b1: { id: 'b1', url: 'https://geheim.example/pfad', title: 'Streng vertraulich', addedAt: 1 } }, spaces: { s1: { id: 's1', name: 'Arbeit', color: '#fff' } } });
  await sync(a, localA);

  const dump = JSON.stringify(s.app.db.prepare('SELECT * FROM records').all()) + JSON.stringify(s.app.db.prepare('SELECT * FROM accounts').all());
  assert.ok(!dump.includes('geheim.example') && !dump.includes('Streng') && !dump.includes('sync@example.org'));

  const b = manager('Handy');
  await b.login({ serverUrl: s.base, email: 'sync@example.org', password: PASSWORD });
  const localB = fakeLocal();
  await sync(b, localB);
  assert.strictEqual(localB.data.bookmarks.b1.title, 'Streng vertraulich');
  assert.strictEqual(localB.data.spaces.s1.name, 'Arbeit');

  localB.data.bookmarks.b2 = { id: 'b2', url: 'https://neu.example', title: 'Neu', addedAt: 2 };
  delete localB.data.bookmarks.b1;
  await sync(b, localB);
  const summary = await sync(a, localA);
  assert.strictEqual(summary.deleted, 1);
  assert.deepStrictEqual(Object.keys(localA.data.bookmarks), ['b2']);

  const again = await sync(a, localA);
  assert.deepStrictEqual([again.pushed, again.pulled, again.deleted], [0, 0, 0], 'nichts Neues, nichts zu tun');
}));

test('Kategorien lassen sich abschalten, Verlauf ist standardmäßig aus', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'kat@example.org', password: PASSWORD, mode: 'normal' });
  assert.strictEqual(a.status().categories.history, false);
  const local = fakeLocal({ history: { h1: { id: 'h1', url: 'https://x.ch', title: 'x', visitedAt: 1 } }, bookmarks: { b1: { id: 'b1', url: 'https://y.ch', title: 'y', addedAt: 1 } } });
  await sync(a, local);
  const collections = s.app.db.prepare('SELECT DISTINCT collection FROM records').all().map((r) => r.collection);
  assert.deepStrictEqual(collections, ['bookmarks']);
  a.setCategories({ history: true, bookmarks: false });
  await sync(a, local);
  assert.ok(s.app.db.prepare("SELECT 1 FROM records WHERE collection = 'history'").get());
}));

test('Falsches Passwort scheitert, ohne dass etwas gespeichert wird', withServer(async (s) => {
  await manager().register({ serverUrl: s.base, email: 'pw@example.org', password: PASSWORD, mode: 'normal' });
  const b = manager();
  await assert.rejects(b.login({ serverUrl: s.base, email: 'pw@example.org', password: 'falsches-passwort-1' }), { code: 'invalid_credentials' });
  assert.strictEqual(b.signedIn, false);
  await assert.rejects(manager().register({ serverUrl: s.base, email: 'kurz@example.org', password: 'kurz', mode: 'normal' }), { code: 'password_too_short' });
  await assert.rejects(manager().register({ serverUrl: 'http://evil.example', email: 'x@example.org', password: PASSWORD, mode: 'normal' }), { code: 'insecure_server_url' });
}));

test('Manipulierte Datensätze werden erkannt und nicht übernommen', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'mani@example.org', password: PASSWORD, mode: 'normal' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'echt' } } }));
  const row = s.app.db.prepare('SELECT blob FROM records').get();
  const bytes = Buffer.from(row.blob, 'base64');
  bytes[bytes.length - 20] ^= 1;
  s.app.db.prepare('UPDATE records SET blob = ?').run(bytes.toString('base64'));
  const b = manager();
  await b.login({ serverUrl: s.base, email: 'mani@example.org', password: PASSWORD });
  const local = fakeLocal();
  const result = await sync(b, local);
  assert.strictEqual(result.failed, 1);
  assert.deepStrictEqual(local.data.bookmarks, {});
}));

test('Passwortwechsel: Daten bleiben lesbar, altes Passwort gilt nicht mehr', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'wechsel@example.org', password: PASSWORD, mode: 'normal' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'bleibt' } } }));
  await a.changePassword({ password: PASSWORD, newPassword: 'neues-passwort-456' });
  const b = manager();
  await assert.rejects(b.login({ serverUrl: s.base, email: 'wechsel@example.org', password: PASSWORD }), { code: 'invalid_credentials' });
  await b.login({ serverUrl: s.base, email: 'wechsel@example.org', password: 'neues-passwort-456' });
  const local = fakeLocal();
  await sync(b, local);
  assert.strictEqual(local.data.bookmarks.b1.title, 'bleibt');
}));

test('Normales Konto: Passwort vergessen, E-Mail-Code, Daten bleiben lesbar', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'vergessen@example.org', password: PASSWORD, mode: 'normal' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'gerettet' } } }));

  const b = manager();
  await b.recoverRequest({ serverUrl: s.base, email: 'vergessen@example.org' });
  const code = /Code: (\w+)/.exec(s.app.mailer.outbox.at(-1).text)[1];
  const verified = await b.recoverVerify({ email: 'vergessen@example.org', token: code });
  await b.recoverFinish({ email: 'vergessen@example.org', verified, newPassword: 'ganz-neues-passwort-1' });
  const local = fakeLocal();
  await sync(b, local);
  assert.strictEqual(local.data.bookmarks.b1.title, 'gerettet');
}));

test('Ultra: mit Wiederherstellungsschlüssel bleiben Daten, ohne ihn nur destruktiver Reset', withServer(async (s) => {
  const a = manager();
  const { recoveryKey } = await a.register({ serverUrl: s.base, email: 'ultra@example.org', password: PASSWORD, mode: 'ultra' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'nur mit Schlüssel' } } }));

  const requestCode = async (m) => {
    await m.recoverRequest({ serverUrl: s.base, email: 'ultra@example.org' });
    const code = /Code: (\w+)/.exec(s.app.mailer.outbox.at(-1).text)[1];
    return m.recoverVerify({ email: 'ultra@example.org', token: code });
  };

  const b = manager();
  const verified = await requestCode(b);
  assert.strictEqual(verified.dek, undefined);
  await assert.rejects(b.recoverFinish({ email: 'ultra@example.org', verified, newPassword: 'ultra-neu-passwort-1', recoveryKeyText: 'AAAA-BBBB' }));
  await b.recoverFinish({ email: 'ultra@example.org', verified, newPassword: 'ultra-neu-passwort-1', recoveryKeyText: recoveryKey });
  const kept = fakeLocal();
  await sync(b, kept);
  assert.strictEqual(kept.data.bookmarks.b1.title, 'nur mit Schlüssel');

  const c = manager();
  const verified2 = await requestCode(c);
  const result = await c.recoverFinish({ email: 'ultra@example.org', verified: verified2, newPassword: 'ultra-reset-passwort-1', reset: true });
  assert.ok(result.recoveryKey, 'nach dem Reset gibt es einen neuen Schlüssel');
  const empty = fakeLocal();
  await sync(c, empty);
  assert.deepStrictEqual(empty.data.bookmarks, {}, 'alte Daten sind nach dem Reset weg');
}));

test('Lebenszeichen höchstens einmal pro 24 Stunden', withServer(async (s) => {
  let t = Date.now();
  const a = new AccountManager({ store: memoryStore(), now: () => t });
  await a.register({ serverUrl: s.base, email: 'beat@example.org', password: PASSWORD, mode: 'ultra' });
  assert.ok(await a.heartbeat());
  t += 3600 * 1000;
  assert.strictEqual(await a.heartbeat(), null);
  t += 24 * 3600 * 1000;
  assert.ok(await a.heartbeat());
  assert.strictEqual(a.status().daysUntilDeletion, 180);
}));

test('Export aus der Cloud wird auf dem Gerät entschlüsselt', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'exp@example.org', password: PASSWORD, mode: 'normal' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'im Export' } } }));
  await assert.rejects(a.exportRequest('falsches-passwort-1'), { code: 'step_up_failed' });
  const job = await a.exportRequest(PASSWORD);
  await s.app.processExports();
  assert.strictEqual((await a.exportStatus(job.id)).status, 'ready');
  const file = await a.exportDownload(job.id);
  assert.strictEqual(file.records[0].data.title, 'im Export');
}));

test('Notfall-Löschung: Server leer; bei Ausfall bleibt sie ausstehend', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'notfall@example.org', password: PASSWORD, mode: 'ultra' });
  await sync(a, fakeLocal({ bookmarks: { b1: { id: 'b1', title: 'x' } } }));
  assert.deepStrictEqual(await a.emergencyDelete(), { ok: true });
  assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  assert.strictEqual(a.signedIn, false);
  assert.strictEqual(a.status().pendingCloudDelete, false);

  const b = manager();
  await b.register({ serverUrl: s.base, email: 'notfall2@example.org', password: PASSWORD, mode: 'ultra' });
  s.app.server.close();
  b.data.serverUrl = 'http://127.0.0.1:9'; // nicht erreichbar
  const failed = await b.emergencyDelete();
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(b.status().pendingCloudDelete, true, 'wird nicht als erfolgreich gemeldet');
  assert.strictEqual(b.signedIn, false, 'lokale Schlüssel sind trotzdem verworfen');
  assert.strictEqual(b.data.dek, undefined);
}));

test('Konto löschen mit Passwort', withServer(async (s) => {
  const a = manager();
  await a.register({ serverUrl: s.base, email: 'weg@example.org', password: PASSWORD, mode: 'normal' });
  await assert.rejects(a.deleteAccount('falsches-passwort-1'), { code: 'step_up_failed' });
  await a.deleteAccount(PASSWORD);
  assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
}));
