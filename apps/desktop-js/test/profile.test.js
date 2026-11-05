const test = require('node:test');
const assert = require('node:assert');
const { Profile } = require('../src/main/profile');

const memoryStore = () => ({ load: () => null, save() {}, flush() {}, remove() {} });
const DAY = 24 * 3600 * 1000;

test('Einstellungen: ungültige Werte werden ignoriert', () => {
  const p = new Profile(memoryStore());
  p.updateSettings({ archiveAfterHours: 7, historyRetentionDays: 'x', panic: { holdMs: 1, enabled: 'ja' }, evil: true });
  assert.strictEqual(p.settings.archiveAfterHours, 12);
  assert.strictEqual(p.settings.historyRetentionDays, 90);
  assert.strictEqual(p.settings.panic.holdMs, 1500);
  assert.strictEqual(p.settings.panic.enabled, false);
  assert.strictEqual(p.settings.evil, undefined);
});

test('Einstellungen: gültige Werte werden übernommen', () => {
  const p = new Profile(memoryStore());
  p.updateSettings({ archiveAfterHours: 0, historyRetentionDays: 0, panic: { enabled: true, actions: { resetProfile: true } } });
  assert.strictEqual(p.settings.archiveAfterHours, 0);
  assert.strictEqual(p.settings.historyRetentionDays, 0);
  assert.strictEqual(p.settings.panic.enabled, true);
  assert.strictEqual(p.settings.panic.actions.resetProfile, true);
  assert.strictEqual(p.settings.panic.actions.closeTabs, true);
});

test('Verlauf: kurz aufeinanderfolgende Duplikate werden übersprungen', () => {
  const p = new Profile(memoryStore());
  assert.ok(p.recordVisit('https://a.ch/', 'A', 1000));
  assert.ok(!p.recordVisit('https://a.ch/', 'A', 2000));
  assert.ok(p.recordVisit('https://a.ch/', 'A', 9000));
  assert.strictEqual(p.history.length, 2);
});

test('Verlauf: deaktiviert speichert nichts', () => {
  const p = new Profile(memoryStore());
  p.updateSettings({ historyEnabled: false });
  assert.ok(!p.recordVisit('https://a.ch/', 'A'));
  assert.strictEqual(p.history.length, 0);
});

test('Aufbewahrung: alte Einträge werden entfernt, 0 behält alles', () => {
  const p = new Profile(memoryStore());
  const now = Date.now();
  p.recordVisit('https://alt.ch/', 'alt', now - 100 * DAY);
  p.recordVisit('https://neu.ch/', 'neu', now - DAY);
  p.prune(now);
  assert.deepStrictEqual(p.history.map((e) => e.title), ['neu']);

  p.updateSettings({ historyRetentionDays: 0 });
  p.recordVisit('https://uralt.ch/', 'uralt', now - 1000 * DAY);
  p.prune(now);
  assert.strictEqual(p.history.length, 2);
});

test('Lesezeichen: umschalten', () => {
  const p = new Profile(memoryStore());
  assert.strictEqual(p.toggleBookmark('https://a.ch/', 'A'), true);
  assert.ok(p.isBookmarked('https://a.ch/'));
  assert.strictEqual(p.toggleBookmark('https://a.ch/', 'A'), false);
  assert.ok(!p.isBookmarked('https://a.ch/'));
});

test('Archiv: ablegen und wieder entnehmen', () => {
  const p = new Profile(memoryStore());
  p.addToArchive({ url: 'https://a.ch/', title: 'A', spaceId: 's1' });
  const id = p.archive[0].id;
  assert.strictEqual(p.takeFromArchive(id).url, 'https://a.ch/');
  assert.strictEqual(p.archive.length, 0);
  assert.strictEqual(p.takeFromArchive(id), null);
});

test('Berechtigungen: gespeicherte Entscheidungen', () => {
  const p = new Profile(memoryStore());
  p.setPermission('https://a.ch', 'media', true);
  assert.strictEqual(p.settings.permissions['https://a.ch'].media, true);
  p.resetPermissions('https://a.ch');
  assert.deepStrictEqual(p.settings.permissions, {});
});

test('Zurücksetzen leert alles', () => {
  const p = new Profile(memoryStore());
  p.recordVisit('https://a.ch/', 'A');
  p.toggleBookmark('https://a.ch/', 'A');
  p.reset();
  assert.strictEqual(p.history.length + p.bookmarks.length + p.archive.length, 0);
});
