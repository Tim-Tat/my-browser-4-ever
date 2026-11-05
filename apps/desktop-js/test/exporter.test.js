const test = require('node:test');
const assert = require('node:assert');
const { buildExport, historyToCsv, toHtmlReport } = require('../src/main/exporter');
const { Profile } = require('../src/main/profile');

const memoryStore = () => ({ load: () => null, save() {}, flush() {}, remove() {} });

test('CSV: Anführungszeichen, Kommas und Formeln werden entschärft', () => {
  const csv = historyToCsv([{ visitedAt: 0, title: 'a, "b"', url: 'https://x.ch/' }, { visitedAt: 0, title: '=HYPERLINK("x")', url: 'u' }]);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines[0], 'besucht_am,titel,adresse');
  assert.strictEqual(lines[1], '1970-01-01T00:00:00.000Z,"a, ""b""",https://x.ch/');
  assert.ok(lines[2].includes(`"'=HYPERLINK(""x"")"`));
});

test('Export enthält Schema, Version und alle Datenarten', () => {
  const p = new Profile(memoryStore());
  p.recordVisit('https://a.ch/', 'A');
  p.toggleBookmark('https://a.ch/', 'A');
  const data = buildExport({
    appVersion: '1.0.0',
    spaces: [{ id: 's1', name: 'Persönlich', color: '#fff' }],
    tabs: [{ id: 't1', spaceId: 's1', pinned: true, url: 'https://a.ch/', title: 'A', favicon: 'x' }],
    profile: p,
  });
  assert.strictEqual(data.format, 'aven-export');
  assert.strictEqual(data.schemaVersion, 1);
  assert.strictEqual(data.tabs[0].favicon, undefined);
  assert.strictEqual(data.history.length, 1);
  assert.strictEqual(data.bookmarks.length, 1);
});

test('HTML-Bericht maskiert Inhalte', () => {
  const html = toHtmlReport({
    exportedAt: new Date().toISOString(), app: { version: '1.0.0' }, spaces: [], tabs: [], archive: [], bookmarks: [],
    history: [{ title: '<script>alert(1)</script>', url: 'https://a.ch/?a=1&b=2', visitedAt: 0 }],
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a=1&amp;b=2'));
});
