const test = require('node:test');
const assert = require('node:assert');
const k = require('../src/main/account/keys');
const { SyncEngine, DEFER } = require('../src/main/account/sync');

function fakeApi(dek, entries) {
  const records = entries.map((e, i) => {
    const key = `${e.collection}/${e.id}`;
    return { seq: i + 1, collection: e.collection, id: e.id, updatedAt: 1000 + i, blob: k.encrypt(dek, Buffer.from(JSON.stringify(e.data)), key) };
  });
  const pushed = [];
  return {
    pushed,
    push: async (batch) => { pushed.push(...batch); return { rejected: [] }; },
    pull: async (cursor) => ({ records: records.filter((r) => r.seq > cursor), more: false }),
  };
}

// Lokaler Speicher wie in main.js: ein Tab wird zurückgestellt, solange sein Space fehlt.
function localStore() {
  const spaces = new Map();
  const tabs = new Map();
  return {
    spaces, tabs,
    collect: () => ({
      spaces: [...spaces.values()].map((d) => ({ id: d.id, data: d })),
      tabs: [...tabs.values()].map((d) => ({ id: d.id, data: d })),
    }),
    apply(collection, id, data) {
      if (collection === 'spaces') { if (data) spaces.set(id, data); else spaces.delete(id); return undefined; }
      if (data === null) { tabs.delete(id); return undefined; }
      if (!spaces.has(data.spaceId)) return DEFER;
      tabs.set(id, data);
      return undefined;
    },
  };
}

const tab = (id, spaceId) => ({ id, spaceId, pinned: false, url: `https://${id}.example`, title: id });

test('Tab vor seinem Space: wird zurückgestellt, übernommen und nie als gelöscht hochgeladen', async () => {
  const dek = k.newDek();
  // Der Space wurde nach seinen Tabs geändert und kommt deshalb im Strom hinter ihnen.
  const api = fakeApi(dek, [
    { collection: 'tabs', id: 't1', data: tab('t1', 's1') },
    { collection: 'tabs', id: 't2', data: tab('t2', 's1') },
    { collection: 'spaces', id: 's1', data: { id: 's1', name: 'Arbeit', color: 'blue' } },
  ]);
  const local = localStore();
  const state = { cursor: 0, map: {}, replay: [], pending: [] };
  const engine = new SyncEngine({ api, dek, local, state });

  const first = await engine.sync({ spaces: true, tabs: true });
  assert.deepStrictEqual([...local.tabs.keys()].sort(), ['t1', 't2'], 'beide Tabs sind nach dem Lauf da');
  assert.strictEqual(first.pulled, 3);
  assert.deepStrictEqual(state.pending, [], 'nichts bleibt zurückgestellt');

  api.pushed.length = 0;
  await engine.sync({ spaces: true, tabs: true });
  assert.deepStrictEqual(api.pushed.filter((r) => r.deleted), [], 'keine Löschmarkierungen für die Tabs');
});

test('Fehlt der Space dauerhaft: Tab bleibt gespeichert zurückgestellt, wird aber nicht als gelöscht gemeldet', async () => {
  const dek = k.newDek();
  const api = fakeApi(dek, [{ collection: 'tabs', id: 't1', data: tab('t1', 'fehlt') }]);
  const local = localStore();
  const state = { cursor: 0, map: {}, replay: [], pending: [] };
  const engine = new SyncEngine({ api, dek, local, state });

  const summary = await engine.sync({ spaces: true, tabs: true });
  assert.strictEqual(summary.deferred, 1);
  assert.strictEqual(local.tabs.size, 0);
  assert.strictEqual(state.map['tabs/t1'], undefined, 'nicht als übernommen gemerkt');
  assert.strictEqual(state.pending.length, 1, 'bleibt für spätere Läufe gespeichert');

  api.pushed.length = 0;
  await engine.sync({ spaces: true, tabs: true });
  assert.deepStrictEqual(api.pushed.filter((r) => r.deleted), []);
});

test('Spaces zuerst aus, später an: die übersprungenen Tabs kommen nach', async () => {
  const dek = k.newDek();
  const api = fakeApi(dek, [
    { collection: 'spaces', id: 's1', data: { id: 's1', name: 'Arbeit', color: 'blue' } },
    { collection: 'tabs', id: 't1', data: tab('t1', 's1') },
  ]);
  const local = localStore();
  const state = { cursor: 0, map: {}, replay: [], pending: [] };
  const engine = new SyncEngine({ api, dek, local, state });

  // Tabs an, Spaces vorübergehend aus: Der Cursor rückt vor, der Tab wird zurückgestellt.
  await engine.sync({ spaces: false, tabs: true });
  assert.strictEqual(local.tabs.size, 0);
  assert.strictEqual(state.pending.length, 1);
  assert.strictEqual(state.cursor, 2);

  // Spaces werden eingeschaltet (AccountManager.setCategories trägt sie zum Nachladen ein).
  state.replay.push('spaces');
  await engine.sync({ spaces: true, tabs: true });
  assert.deepStrictEqual([...local.tabs.keys()], ['t1'], 'der Tab ist jetzt da');
  assert.deepStrictEqual(state.pending, []);
});
