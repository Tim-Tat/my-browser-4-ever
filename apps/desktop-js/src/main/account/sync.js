const crypto = require('crypto');
const { encrypt, decrypt } = require('./keys');

const COLLECTIONS = ['spaces', 'tabs', 'archive', 'history', 'bookmarks', 'settings'];
const BATCH = 200;

// Gleiche Daten ergeben immer den gleichen Text, unabhängig von der Schlüsselreihenfolge.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hashOf = (data) => crypto.createHash('sha256').update(stableStringify(data)).digest('hex');

// Gleicht lokale Daten mit dem Server ab. Der Server sieht nur Chiffretext.
//   local.collect()                  -> { sammlung: [{ id, data }] }
//   local.apply(sammlung, id, data)  -> übernimmt einen Eintrag oder löscht ihn (data = null)
// `state` ({ cursor, map }) wird vom Aufrufer gespeichert.
class SyncEngine {
  constructor({ api, dek, local, state, now = Date.now }) {
    this.api = api;
    this.dek = dek;
    this.local = local;
    this.state = state;
    this.now = now;
    this.state.cursor ||= 0;
    this.state.map ||= {};
    this.state.replay ||= []; // Kategorien, die seit dem Einschalten noch ab Anfang nachgeladen werden müssen
  }

  async sync(enabled) {
    const on = COLLECTIONS.filter((c) => enabled[c]);
    const summary = { pushed: 0, pulled: 0, deleted: 0, failed: 0, rejected: 0 };
    const rejected = await this.push(on, summary);
    await this.pull(on, summary);
    // Neu eingeschaltete Kategorien ab Anfang nachladen, ohne den gemeinsamen Cursor zu verschieben.
    const replay = this.state.replay.filter((c) => on.includes(c));
    if (replay.length) {
      await this.pull(replay, summary, 0);
      this.state.replay = this.state.replay.filter((c) => !replay.includes(c));
    }
    return summary;
  }

  async push(collections, summary) {
    const collected = this.local.collect(collections);
    const t = this.now();
    const outgoing = [];
    const seen = new Set();

    for (const collection of collections) {
      for (const { id, data } of collected[collection] || []) {
        const key = `${collection}/${id}`;
        seen.add(key);
        const hash = hashOf(data);
        const entry = this.state.map[key];
        if (entry && !entry.deleted && entry.hash === hash) continue;
        outgoing.push({
          key, hash, updatedAt: t,
          record: { collection, id, updatedAt: t, blob: encrypt(this.dek, Buffer.from(JSON.stringify(data)), key) },
        });
      }
    }
    for (const [key, entry] of Object.entries(this.state.map)) {
      const collection = key.split('/')[0];
      if (!collections.includes(collection) || seen.has(key) || entry.deleted) continue;
      outgoing.push({ key, deleted: true, updatedAt: t, record: { collection, id: key.slice(collection.length + 1), updatedAt: t, deleted: true } });
    }

    const rejected = new Set();
    for (let i = 0; i < outgoing.length; i += BATCH) {
      const batch = outgoing.slice(i, i + BATCH);
      const res = await this.api.push(batch.map((o) => o.record));
      for (const r of res.rejected || []) rejected.add(`${r.collection}/${r.id}`);
      for (const o of batch) {
        if (rejected.has(o.key)) { summary.rejected += 1; continue; }
        this.state.map[o.key] = o.deleted ? { deleted: true, updatedAt: o.updatedAt } : { hash: o.hash, updatedAt: o.updatedAt };
        summary.pushed += 1;
      }
    }
    return rejected;
  }

  // `from` gesetzt: Nachladen ab dieser Stelle mit eigenem Cursor, der gemeinsame bleibt unberührt.
  async pull(collections, summary, from = null) {
    const replay = from !== null;
    let cursor = replay ? from : this.state.cursor;
    for (;;) {
      const res = await this.api.pull(cursor);
      for (const rec of res.records) {
        cursor = Math.max(cursor, rec.seq);
        if (!replay) this.state.cursor = cursor;
        if (!collections.includes(rec.collection)) continue;
        const key = `${rec.collection}/${rec.id}`;
        const known = this.state.map[key];
        if (known && known.updatedAt === rec.updatedAt) continue; // eigener Eintrag
        if (rec.deleted) {
          this.local.apply(rec.collection, rec.id, null);
          this.state.map[key] = { deleted: true, updatedAt: rec.updatedAt };
          summary.deleted += 1;
          continue;
        }
        let data;
        try {
          data = JSON.parse(decrypt(this.dek, rec.blob, key).toString('utf8'));
        } catch {
          summary.failed += 1; // falscher Schlüssel oder manipulierter Datensatz
          continue;
        }
        this.local.apply(rec.collection, rec.id, data);
        this.state.map[key] = { hash: hashOf(data), updatedAt: rec.updatedAt };
        summary.pulled += 1;
      }
      if (!res.more) break;
    }
  }
}

module.exports = { SyncEngine, COLLECTIONS, stableStringify, hashOf };
