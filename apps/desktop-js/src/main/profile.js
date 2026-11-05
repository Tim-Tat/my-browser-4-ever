const { randomUUID } = require('crypto');

const DAY = 24 * 3600 * 1000;
const HISTORY_LIMIT = 50000;

const ARCHIVE_HOURS = [0, 1, 6, 12, 24, 72, 168]; // 0 = nie archivieren
const RETENTION_DAYS = [0, 1, 7, 30, 90, 365]; // 0 = bis ich selbst lösche
const HOLD_MS = [500, 1000, 1500, 2000, 3000];
const PANIC_ACTIONS = ['endDarkweb', 'closeTabs', 'clearHistoryArchive', 'clearSiteData', 'stopSync', 'deleteAccount', 'lockVault', 'deleteVault', 'resetProfile'];

const defaultSettings = () => ({
  archiveAfterHours: 12,
  historyEnabled: true,
  historyRetentionDays: 90,
  archiveRetentionDays: 0,
  permissions: {},
  panic: {
    enabled: false,
    holdMs: 1500,
    actions: { endDarkweb: true, closeTabs: true, clearHistoryArchive: true, clearSiteData: true, stopSync: true, deleteAccount: false, lockVault: true, deleteVault: false, resetProfile: false },
  },
});

class Profile {
  constructor(store) {
    this.store = store;
    const saved = store.load() || {};
    this.settings = defaultSettings();
    this.updateSettings(saved.settings || {});
    this.settings.permissions = sanitizePermissions(saved.settings?.permissions);
    this.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks : [];
    this.history = Array.isArray(saved.history) ? saved.history : [];
    this.archive = Array.isArray(saved.archive) ? saved.archive : [];
  }

  data() {
    return { settings: this.settings, bookmarks: this.bookmarks, history: this.history, archive: this.archive };
  }

  save() {
    this.store.save(this.data());
  }

  flush() {
    this.store.save(this.data());
    this.store.flush();
  }

  // Übernimmt nur bekannte, gültige Werte.
  updateSettings(patch) {
    const s = this.settings;
    if (ARCHIVE_HOURS.includes(patch.archiveAfterHours)) s.archiveAfterHours = patch.archiveAfterHours;
    if (typeof patch.historyEnabled === 'boolean') s.historyEnabled = patch.historyEnabled;
    if (RETENTION_DAYS.includes(patch.historyRetentionDays)) s.historyRetentionDays = patch.historyRetentionDays;
    if (RETENTION_DAYS.includes(patch.archiveRetentionDays)) s.archiveRetentionDays = patch.archiveRetentionDays;
    const p = patch.panic;
    if (p && typeof p === 'object') {
      if (typeof p.enabled === 'boolean') s.panic.enabled = p.enabled;
      if (HOLD_MS.includes(p.holdMs)) s.panic.holdMs = p.holdMs;
      for (const key of PANIC_ACTIONS) {
        if (typeof p.actions?.[key] === 'boolean') s.panic.actions[key] = p.actions[key];
      }
    }
    this.save();
  }

  // ----- Verlauf -----

  recordVisit(url, title, now = Date.now()) {
    if (!this.settings.historyEnabled) return false;
    const last = this.history[0];
    if (last && last.url === url && now - last.visitedAt < 5000) return false;
    this.history.unshift({ id: randomUUID(), url, title: title || '', visitedAt: now });
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    this.save();
    return true;
  }

  updateTitle(url, title) {
    const entry = this.history.find((e) => e.url === url);
    if (entry && title && entry.title !== title) {
      entry.title = title;
      this.save();
    }
  }

  listHistory({ query = '', limit = 500 } = {}) {
    const q = String(query).trim().toLowerCase();
    const list = q
      ? this.history.filter((e) => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q))
      : this.history;
    return list.slice(0, limit);
  }

  deleteHistory(id) {
    this.history = this.history.filter((e) => e.id !== id);
    this.save();
  }

  clearHistory() {
    this.history = [];
    this.save();
  }

  // ----- Lesezeichen -----

  isBookmarked(url) {
    return this.bookmarks.some((b) => b.url === url);
  }

  toggleBookmark(url, title) {
    const existing = this.bookmarks.find((b) => b.url === url);
    if (existing) this.bookmarks = this.bookmarks.filter((b) => b !== existing);
    else this.bookmarks.unshift({ id: randomUUID(), url, title: title || url, addedAt: Date.now() });
    this.save();
    return !existing;
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.save();
  }

  // ----- Archiv -----

  addToArchive({ url, title, favicon, spaceId }, now = Date.now()) {
    this.archive.unshift({ id: randomUUID(), url, title: title || '', favicon: favicon || '', spaceId, archivedAt: now });
    this.save();
  }

  takeFromArchive(id) {
    const entry = this.archive.find((e) => e.id === id);
    if (entry) {
      this.archive = this.archive.filter((e) => e !== entry);
      this.save();
    }
    return entry || null;
  }

  clearArchive() {
    this.archive = [];
    this.save();
  }

  // ----- Übernahme vom Sync -----

  upsertSynced(collection, data) {
    const list = { history: this.history, bookmarks: this.bookmarks, archive: this.archive }[collection];
    if (!list || !data || typeof data.id !== 'string' || typeof data.url !== 'string') return;
    const clean = collection === 'history'
      ? { id: data.id, url: data.url, title: String(data.title || ''), visitedAt: Number(data.visitedAt) || 0 }
      : collection === 'bookmarks'
        ? { id: data.id, url: data.url, title: String(data.title || ''), addedAt: Number(data.addedAt) || 0 }
        : { id: data.id, url: data.url, title: String(data.title || ''), favicon: '', spaceId: data.spaceId, archivedAt: Number(data.archivedAt) || 0 };
    const i = list.findIndex((e) => e.id === clean.id);
    if (i >= 0) list[i] = { ...list[i], ...clean };
    else list.push(clean);
    const key = { history: 'visitedAt', bookmarks: 'addedAt', archive: 'archivedAt' }[collection];
    list.sort((a, b) => b[key] - a[key]);
    this.save();
  }

  removeSynced(collection, id) {
    if (collection === 'history') this.history = this.history.filter((e) => e.id !== id);
    if (collection === 'bookmarks') this.bookmarks = this.bookmarks.filter((e) => e.id !== id);
    if (collection === 'archive') this.archive = this.archive.filter((e) => e.id !== id);
    this.save();
  }

  // ----- Berechtigungen -----

  setPermission(origin, permission, allow) {
    const perms = this.settings.permissions;
    perms[origin] = { ...perms[origin], [permission]: !!allow };
    this.save();
  }

  resetPermissions(origin) {
    if (origin) delete this.settings.permissions[origin];
    else this.settings.permissions = {};
    this.save();
  }

  // ----- Aufbewahrung -----

  prune(now = Date.now()) {
    const { historyRetentionDays: h, archiveRetentionDays: a } = this.settings;
    if (h > 0) this.history = this.history.filter((e) => now - e.visitedAt < h * DAY);
    if (a > 0) this.archive = this.archive.filter((e) => now - e.archivedAt < a * DAY);
    this.save();
  }

  reset() {
    this.settings = defaultSettings();
    this.bookmarks = [];
    this.history = [];
    this.archive = [];
    this.store.remove();
  }
}

function sanitizePermissions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [origin, perms] of Object.entries(raw)) {
    if (!perms || typeof perms !== 'object') continue;
    const clean = {};
    for (const [name, value] of Object.entries(perms)) if (typeof value === 'boolean') clean[name] = value;
    if (Object.keys(clean).length) out[origin] = clean;
  }
  return out;
}

module.exports = { Profile, ARCHIVE_HOURS, RETENTION_DAYS, HOLD_MS, PANIC_ACTIONS, defaultSettings };
