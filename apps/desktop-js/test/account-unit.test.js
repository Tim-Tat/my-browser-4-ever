const test = require('node:test');
const assert = require('node:assert');
const k = require('../src/main/account/keys');
const { Api } = require('../src/main/account/api');
const { ApiError } = require('../src/main/account/api');
const { AccountManager } = require('../src/main/account/account');

const memoryStore = () => ({ saved: null, load() { return this.saved && JSON.parse(this.saved); }, save(d) { this.saved = JSON.stringify(d); } });
const manager = () => new AccountManager({ store: memoryStore(), deviceName: 'Test' });

// Ersetzt eine Api-Methode für die Dauer eines Tests.
async function withApi(methods, fn) {
  const saved = {};
  for (const [name, impl] of Object.entries(methods)) { saved[name] = Api.prototype[name]; Api.prototype[name] = impl; }
  try { await fn(); } finally { for (const [name, impl] of Object.entries(saved)) Api.prototype[name] = impl; }
}

test('Notfall-Löschung: ein 401 gilt nicht als Erfolg, der Auftrag bleibt offen', async () => {
  const m = manager();
  Object.assign(m.data, { serverUrl: 'https://sync.example', token: 'abgelaufen', dek: k.b64(k.newDek()) });
  await withApi({ emergencyDelete: async () => { throw new ApiError(401, 'unauthorized'); } }, async () => {
    const res = await m.emergencyDelete();
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /unbestätigt/);
    assert.ok(m.data.pendingCloudDelete, 'Löschauftrag bleibt gespeichert');
    assert.strictEqual(m.signedIn, false, 'lokale Schlüssel sind trotzdem verworfen');
  });
});

test('Sync: nach einer Abmeldung während des Laufs wird nichts mehr zurückgeschrieben', async () => {
  const m = manager();
  const dek = k.newDek();
  Object.assign(m.data, { serverUrl: 'https://sync.example', token: 'tok', dek: k.b64(dek) });
  const key = 'bookmarks/b1';
  const rec = { seq: 1, collection: 'bookmarks', id: 'b1', updatedAt: 1000, blob: k.encrypt(dek, Buffer.from(JSON.stringify({ url: 'https://a.example' })), key) };
  m.api = () => ({ push: async () => ({ rejected: [] }), pull: async () => ({ records: [rec], more: false }) });
  const local = {
    collect: () => ({}),
    apply: () => { m.discardLocal(); }, // Notfall: Abmeldung, während die Antwort verarbeitet wird
  };
  await m.sync(local);
  assert.strictEqual(m.signedIn, false);
  for (const field of ['cursor', 'map', 'replay', 'pending']) assert.strictEqual(m.data[field], undefined, `${field} wurde nicht wieder angelegt`);
});

test('Wiederherstellung: der Server stellt eine neue Sitzung aus, kein erneuter Login nötig', async () => {
  const m = manager();
  m.data.serverUrl = 'https://sync.example';
  await withApi({
    recoverFinish: async () => ({ ok: true, reset: false, token: 'neue-sitzung', accountId: 'a1', mode: 'normal' }),
    prelogin: async () => { throw new Error('Login darf nicht nötig sein'); },
  }, async () => {
    const res = await m.recoverFinish({
      email: 'a@example.org', verified: { ticket: 'x', mode: 'normal', dek: k.b64(k.newDek()) }, newPassword: 'ein-langes-passwort-123',
    });
    assert.strictEqual(res.signedIn, true);
    assert.strictEqual(m.data.token, 'neue-sitzung');
    assert.strictEqual(m.signedIn, true);
  });
});
