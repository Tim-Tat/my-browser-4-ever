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

test('apply() meldet den lokal geltenden Stand: ein geöffneter Tab wird nicht mit alter URL zurückgeschrieben', async () => {
  const dek = k.newDek();
  // Auf dem Server liegt die neuere URL, lokal bleibt der geöffnete Tab auf der alten.
  const remote = { id: 't1', spaceId: 's1', pinned: false, url: 'https://neu.example', title: 'Neu' };
  const api = fakeApi(dek, [{ collection: 'tabs', id: 't1', data: remote }]);
  const pushed = [];
  api.push = async (records) => { pushed.push(...records); return { rejected: [] }; };

  const localTab = { id: 't1', spaceId: 's1', pinned: false, url: 'https://alt.example', title: 'Alt' };
  const local = {
    collect: () => ({ tabs: [{ id: 't1', data: { ...localTab } }] }),
    apply: () => ({ ...localTab }), // Tab übernimmt die empfangene URL nicht und gibt seinen Stand zurück
  };
  const state = { cursor: 0, map: {}, replay: [] };
  const engine = new SyncEngine({ api, dek, local, state });

  await engine.sync({ tabs: true });
  const afterFirst = pushed.length; // erster Lauf: Push läuft vor dem Pull
  pushed.length = 0;

  await engine.sync({ tabs: true });
  assert.strictEqual(pushed.length, 0, `kein erneuter Upload mit alter URL (nach erstem Lauf: ${afterFirst})`);
});
