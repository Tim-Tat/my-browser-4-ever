const test = require('node:test');
const assert = require('node:assert');
const k = require('../src/main/account/keys');
const { SyncEngine } = require('../src/main/account/sync');

// Server-Ersatz: eine Liste verschlüsselter Einträge mit fortlaufender Nummer.
function fakeApi(dek, entries) {
  const records = entries.map((e, i) => {
    const key = `${e.collection}/${e.id}`;
    return { seq: i + 1, collection: e.collection, id: e.id, updatedAt: 1000 + i, blob: k.encrypt(dek, Buffer.from(JSON.stringify(e.data)), key) };
  });
  return { push: async () => ({ rejected: [] }), pull: async (cursor) => ({ records: records.filter((r) => r.seq > cursor), more: false }) };
}

const localStore = () => ({ applied: {}, collect: () => ({}), apply(collection, id, data) { this.applied[`${collection}/${id}`] = data; } });

test('Neu eingeschaltete Kategorie lädt die übersprungenen Einträge nach, der gemeinsame Cursor bleibt', async () => {
  const dek = k.newDek();
  const api = fakeApi(dek, [
    { collection: 'history', id: 'h1', data: { url: 'https://a.example' } },
    { collection: 'bookmarks', id: 'b1', data: { url: 'https://b.example' } },
    { collection: 'history', id: 'h2', data: { url: 'https://c.example' } },
  ]);
  const local = localStore();
  const state = { cursor: 0, map: {}, replay: [] };
  const engine = new SyncEngine({ api, dek, local, state });

  // Verlauf ist aus: der Cursor rückt vor, die Einträge werden übersprungen.
  await engine.sync({ bookmarks: true, history: false });
  assert.strictEqual(state.cursor, 3);
  assert.deepStrictEqual(Object.keys(local.applied), ['bookmarks/b1']);

  // Verlauf wird eingeschaltet (AccountManager.setCategories trägt ihn zum Nachladen ein).
  state.replay.push('history');
  const summary = await engine.sync({ bookmarks: true, history: true });
  assert.deepStrictEqual(Object.keys(local.applied).sort(), ['bookmarks/b1', 'history/h1', 'history/h2']);
  assert.strictEqual(summary.pulled, 2);
  assert.deepStrictEqual(state.replay, [], 'Nachladen ist erledigt und wird nicht wiederholt');
  assert.strictEqual(state.cursor, 3);
});

test('Nachladen bleibt vorgemerkt, solange die Kategorie aus ist', async () => {
  const dek = k.newDek();
  const api = fakeApi(dek, [{ collection: 'history', id: 'h1', data: { url: 'https://a.example' } }]);
  const local = localStore();
  const state = { cursor: 1, map: {}, replay: ['history'] };
  await new SyncEngine({ api, dek, local, state }).sync({ history: false });
  assert.deepStrictEqual(state.replay, ['history']);
  assert.deepStrictEqual(local.applied, {});
});
