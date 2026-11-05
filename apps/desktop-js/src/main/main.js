const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, dialog, safeStorage, clipboard, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store } = require('./store');
const { Profile } = require('./profile');
const { Downloads } = require('./downloads');
const { buildExport, historyToCsv, toHtmlReport } = require('./exporter');
const { runPanic, PANIC_NOTE } = require('./panic');
const { AccountManager } = require('./account/account');
const { Vault } = require('./vault/vault');
const { TorManager } = require('./darkweb/tor');
const { createDarkweb } = require('./darkweb/darkweb');
const { generatePassword, estimateStrength, pwnedCount } = require('./vault/tools');
const { normalizeInput, isAllowedUrl, isInternalUrl, internalUrl, originOf } = require('./urls');

const PARTITION = 'persist:aven';
const TOOLBAR_H = 52;
const SIDEBAR_W = 260;
const CONTENT_GAP = 10;
const NEWTAB_URL = pathToFileURL(path.join(__dirname, '..', 'renderer', 'newtab.html')).href;
const SPACE_COLORS = ['#5b7cff', '#b57cff', '#14b4ff', '#3ec28f', '#e0a43a', '#e5604d'];
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ASKED_PERMISSIONS = { media: 'Kamera oder Mikrofon', geolocation: 'Ihren Standort', notifications: 'Benachrichtigungen' };
const ARCHIVE_CHECK_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let win = null;
let stateStore = null;
let profile = null;
let downloads = null;
let account = null;
let vault = null;
let darkweb = null;
let pendingCredential = null; // wartet auf das Entsperren des Tresors, nur im Arbeitsspeicher
let credentialPromptOpen = false;
const promptedAt = new Map();
let syncing = false;
let state = null; // { spaces, tabs, activeSpaceId, activeTabId, sidebarCollapsed, bounds }
const views = new Map(); // tabId -> WebContentsView
const closedTabs = [];
let nextId = 1;
let broadcastTimer = null;
let overlayOpen = false; // Intro der Oberfläche verdeckt die Webansichten

const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;
const tabById = (id) => state.tabs.find((t) => t.id === id);
const spaceById = (id) => state.spaces.find((s) => s.id === id);
const activeContents = () => views.get(state.activeTabId)?.webContents;
const siteSession = () => session.fromPartition(PARTITION);
const isShellPage = (url) => url === NEWTAB_URL || isInternalUrl(url);

// ---------- Zustand ----------

function defaultState() {
  const space = { id: uid('s'), name: 'Persönlich', color: SPACE_COLORS[0], lastTabId: null };
  return { spaces: [space], tabs: [], activeSpaceId: space.id, activeTabId: null, sidebarCollapsed: false };
}

function loadState() {
  const saved = stateStore.load();
  if (!saved || !Array.isArray(saved.spaces) || !saved.spaces.length) return defaultState();
  const now = Date.now();
  const s = {
    spaces: saved.spaces,
    tabs: (saved.tabs || []).map((t) => ({
      id: t.id, spaceId: t.spaceId, pinned: !!t.pinned,
      url: t.url || NEWTAB_URL, title: t.title || '', favicon: t.favicon || '',
      lastActive: t.lastActive || now,
    })),
    activeSpaceId: saved.activeSpaceId,
    activeTabId: saved.activeTabId,
    sidebarCollapsed: !!saved.sidebarCollapsed,
    bounds: saved.bounds,
  };
  if (!s.spaces.some((sp) => sp.id === s.activeSpaceId)) s.activeSpaceId = s.spaces[0].id;
  return s;
}

function persist() {
  if (win && !win.isDestroyed() && !win.isMaximized()) state.bounds = win.getBounds();
  stateStore.save({
    spaces: state.spaces,
    tabs: state.tabs.map(({ id, spaceId, pinned, url, title, favicon, lastActive }) => ({ id, spaceId, pinned, url, title, favicon, lastActive })),
    activeSpaceId: state.activeSpaceId,
    activeTabId: state.activeTabId,
    sidebarCollapsed: state.sidebarCollapsed,
    bounds: state.bounds,
  });
}

function snapshot() {
  const active = tabById(state.activeTabId);
  return {
    spaces: state.spaces,
    activeSpaceId: state.activeSpaceId,
    activeTabId: state.activeTabId,
    sidebarCollapsed: state.sidebarCollapsed,
    bookmarked: !!active && profile.isBookmarked(active.url),
    downloadsActive: downloads.active,
    vault: { exists: vault.exists(), unlocked: vault.unlocked, matches: active ? vault.findForUrl(active.url).length : 0 },
    panic: { enabled: profile.settings.panic.enabled, holdMs: profile.settings.panic.holdMs },
    tabs: state.tabs.map((t) => {
      const wc = views.get(t.id)?.webContents;
      return {
        id: t.id, spaceId: t.spaceId, pinned: t.pinned, url: t.url, title: t.title, favicon: t.favicon,
        loading: !!wc && wc.isLoading(),
        canGoBack: !!wc && wc.navigationHistory.canGoBack(),
        canGoForward: !!wc && wc.navigationHistory.canGoForward(),
      };
    }),
  };
}

function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('aven:state', snapshot());
    persist();
  }, 30);
}

// Sagt allen offenen internen Seiten, dass der Tresor gesperrt ist (Sperre per Zeit, System, Hand).
function notifyVaultLocked() {
  for (const view of views.values()) {
    const wc = view.webContents;
    if (!wc.isDestroyed() && /\/pages\/aven\.html/.test(wc.getURL())) wc.send('aven:vault-locked');
  }
}

const sendEvent = (name, data) => win && !win.isDestroyed() && win.webContents.send('aven:event', name, data);

// ---------- Tabs ----------

function layoutViews() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const sidebar = state.sidebarCollapsed ? 0 : SIDEBAR_W;
  const bounds = {
    x: sidebar + CONTENT_GAP, y: TOOLBAR_H,
    width: Math.max(0, w - sidebar - 2 * CONTENT_GAP), height: Math.max(0, h - TOOLBAR_H - CONTENT_GAP),
  };
  for (const v of views.values()) {
    v.setBounds(bounds);
    v.setBorderRadius(14);
  }
}

function refreshVisibility() {
  for (const [id, v] of views) v.setVisible(!overlayOpen && id === state.activeTabId);
}

function createView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'view-preload.js'),
    },
  });
  const wc = view.webContents;
  views.set(tab.id, view);
  view.setVisible(false);
  view.setBackgroundColor('#0a0a14');
  win.contentView.addChildView(view);

  const sync = () => {
    const url = wc.getURL();
    if (url) tab.url = url;
    broadcast();
  };
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    profile.updateTitle(wc.getURL(), title);
    broadcast();
  });
  wc.on('page-favicon-updated', (_e, icons) => { tab.favicon = icons[0] || ''; broadcast(); });
  wc.on('did-navigate', (_e, url) => {
    tab.favicon = '';
    if (/^https?:/.test(url)) profile.recordVisit(url, wc.getTitle());
    sync();
  });
  wc.on('did-navigate-in-page', sync);
  wc.on('did-start-loading', broadcast);
  wc.on('did-stop-loading', sync);
  wc.on('will-navigate', (e, url) => { if (!isAllowedUrl(url)) e.preventDefault(); });
  wc.on('found-in-page', (_e, result) => {
    if (tab.id === state.activeTabId) sendEvent('find-result', { matches: result.matches, active: result.activeMatchOrdinal });
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) createTab({ url, spaceId: tab.spaceId });
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({ label: 'Link in neuem Tab öffnen', click: () => createTab({ url: params.linkURL, spaceId: tab.spaceId }) });
      items.push({ label: 'Link-Adresse kopieren', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    else if (params.selectionText) items.push({ role: 'copy' });
    items.push({ type: 'separator' }, { label: 'Neu laden', click: () => wc.reload() });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  wc.on('render-process-gone', () => broadcast());

  wc.loadURL(tab.url || NEWTAB_URL);
  layoutViews();
  return view;
}

function createTab({ url = NEWTAB_URL, spaceId = state.activeSpaceId, pinned = false, title = '', favicon = '', activate = true } = {}) {
  const tab = { id: uid('t'), spaceId, pinned, url, title, favicon, lastActive: Date.now() };
  state.tabs.push(tab);
  if (activate) activateTab(tab.id);
  else broadcast();
  return tab;
}

function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  const previous = tabById(state.activeTabId);
  if (previous && previous !== tab) {
    previous.lastActive = Date.now();
    views.get(previous.id)?.webContents.stopFindInPage('clearSelection');
  }
  if (!views.has(id)) createView(tab);
  state.activeTabId = id;
  state.activeSpaceId = tab.spaceId;
  tab.lastActive = Date.now();
  const space = spaceById(tab.spaceId);
  if (space) space.lastTabId = id;
  refreshVisibility();
  views.get(id).webContents.focus();
  broadcast();
}

// Entfernt Tab und Webansicht und wählt bei Bedarf einen Nachfolger im selben Space.
function removeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const [tab] = state.tabs.splice(idx, 1);
  const view = views.get(id);
  if (view) {
    views.delete(id);
    win.contentView.removeChildView(view);
    view.webContents.close();
  }
  if (state.activeTabId === id) {
    const sameSpace = state.tabs.filter((t) => t.spaceId === tab.spaceId);
    const next = sameSpace[Math.min(idx, sameSpace.length - 1)] || sameSpace[sameSpace.length - 1];
    state.activeTabId = null;
    if (next) activateTab(next.id);
    else createTab({ spaceId: tab.spaceId });
  } else {
    broadcast();
  }
  return tab;
}

function closeTab(id) {
  const tab = removeTab(id);
  if (!tab || isShellPage(tab.url)) return;
  closedTabs.push({ url: tab.url, spaceId: tab.spaceId, pinned: tab.pinned, title: tab.title, favicon: tab.favicon });
  if (closedTabs.length > 20) closedTabs.shift();
}

function reopenClosedTab() {
  const last = closedTabs.pop();
  if (last && spaceById(last.spaceId)) createTab(last);
}

function cycleTab(dir) {
  const list = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === state.activeTabId);
  activateTab(list[(i + dir + list.length) % list.length].id);
}

function togglePin(id) {
  const tab = tabById(id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  broadcast();
}

function openPage(name) {
  const url = internalUrl(name);
  const existing = state.tabs.find((t) => t.url === url);
  if (existing) activateTab(existing.id);
  else createTab({ url });
}

// ---------- Archiv: nicht angeheftete Tabs wandern nach einer Frist aus der Tabliste ----------

function archiveStaleTabs() {
  const hours = profile.settings.archiveAfterHours;
  if (!hours) return;
  const cutoff = Date.now() - hours * 3600 * 1000;
  for (const tab of [...state.tabs]) {
    if (tab.pinned || tab.id === state.activeTabId || tab.lastActive >= cutoff) continue;
    if (!isShellPage(tab.url)) profile.addToArchive(tab);
    removeTab(tab.id);
  }
}

function maintenance() {
  profile.prune();
  archiveStaleTabs();
}

// ---------- Spaces ----------

function createSpace() {
  const color = SPACE_COLORS[state.spaces.length % SPACE_COLORS.length];
  const space = { id: uid('s'), name: `Space ${state.spaces.length + 1}`, color, lastTabId: null };
  state.spaces.push(space);
  state.activeSpaceId = space.id;
  createTab({ spaceId: space.id });
  sendEvent('rename-space', space.id);
}

function switchSpace(id) {
  const space = spaceById(id);
  if (!space) return;
  const inSpace = state.tabs.filter((t) => t.spaceId === id);
  const target = tabById(space.lastTabId)?.spaceId === id ? space.lastTabId : inSpace[0]?.id;
  if (target) activateTab(target);
  else {
    state.activeSpaceId = id;
    createTab({ spaceId: id });
  }
}

function deleteSpace(id) {
  if (state.spaces.length < 2) return;
  state.tabs.filter((t) => t.spaceId === id).forEach((t) => removeTab(t.id));
  state.spaces = state.spaces.filter((s) => s.id !== id);
  if (state.activeSpaceId === id || !spaceById(state.activeSpaceId)) switchSpace(state.spaces[0].id);
  else broadcast();
}

// ---------- Datenschutz: Löschen, Export, Notfallaktion ----------

async function clearSiteData() {
  const ses = siteSession();
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  await ses.clearHostResolverCache();
}

function closeAllTabs() {
  for (const id of state.tabs.map((t) => t.id)) removeTab(id);
  closedTabs.length = 0;
  if (!state.tabs.length) createTab();
}

function resetProfile() {
  profile.reset();
  account.discardLocal();
  closeAllTabs();
  const space = state.spaces[0];
  state.spaces = [{ ...space, name: 'Persönlich', color: SPACE_COLORS[0], lastTabId: null }];
  for (const t of state.tabs) t.spaceId = space.id;
  state.activeSpaceId = space.id;
  downloads.reset();
  broadcast();
}

async function panic() {
  const results = await runPanic(profile.settings.panic.actions, {
    endDarkweb: () => darkweb.endSession(),
    closeTabs: closeAllTabs,
    clearHistoryArchive: () => { profile.clearHistory(); profile.clearArchive(); downloads.reset(); },
    clearSiteData,
    stopSync: async () => { if (account.signedIn) await account.logout(); },
    deleteAccount: () => account.emergencyDelete(),
    lockVault: () => vault.lock('panic'),
    deleteVault: () => vault.destroy(),
    resetProfile,
  });
  broadcast();
  const lines = results.map((r) => `${r.ok === true ? '✔' : r.ok === false ? '✘' : '–'} ${r.label}${r.detail ? `: ${r.detail}` : ''}`);
  dialog.showMessageBox(win, { type: 'info', title: 'Notfallaktion', message: 'Notfallaktion abgeschlossen', detail: `${lines.join('\n')}\n\n${PANIC_NOTE}`, buttons: ['OK'] });
  return results;
}

async function exportData(format) {
  const data = buildExport({ appVersion: app.getVersion(), spaces: state.spaces, tabs: state.tabs, profile });
  const day = new Date().toISOString().slice(0, 10);
  const types = {
    json: { name: 'JSON', ext: 'json', body: () => JSON.stringify(data, null, 2) },
    csv: { name: 'CSV (Verlauf)', ext: 'csv', body: () => historyToCsv(profile.history) },
    html: { name: 'HTML-Bericht', ext: 'html', body: () => toHtmlReport(data) },
  };
  const type = types[format];
  if (!type) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `aven-export-${day}.${type.ext}`),
    filters: [{ name: type.name, extensions: [type.ext] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, type.body(), 'utf8');
  return { ok: true, path: filePath };
}

function overview() {
  return {
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    encrypted: stateStore.encrypted,
    vault: vault.status(),
    counts: {
      tabs: state.tabs.length, spaces: state.spaces.length, bookmarks: profile.bookmarks.length,
      history: profile.history.length, archive: profile.archive.length, downloads: downloads.list.length,
      permissions: Object.keys(profile.settings.permissions).length,
    },
  };
}

// ---------- Aktionen der Browser-Oberfläche ----------

const actions = {
  getState: () => snapshot(),
  setOverlay: (open) => { overlayOpen = !!open; refreshVisibility(); },
  newTab: () => createTab(),
  selectTab: (id) => activateTab(id),
  closeTab: (id) => closeTab(id),
  navigate: ({ input }) => {
    const url = normalizeInput(input);
    const tab = tabById(state.activeTabId);
    if (!url || !tab) return;
    tab.url = url;
    views.get(tab.id)?.webContents.loadURL(url);
    broadcast();
  },
  back: () => { const wc = activeContents(); if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); },
  forward: () => { const wc = activeContents(); if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); },
  reload: () => {
    const wc = activeContents();
    if (!wc) return;
    if (wc.isLoading()) wc.stop(); else wc.reload();
  },
  toggleSidebar: () => { state.sidebarCollapsed = !state.sidebarCollapsed; layoutViews(); broadcast(); },
  newSpace: () => createSpace(),
  switchSpace: (id) => switchSpace(id),
  renameSpace: ({ id, name }) => {
    const space = spaceById(id);
    const clean = String(name || '').trim().slice(0, 30);
    if (space && clean) { space.name = clean; broadcast(); }
  },
  toggleBookmark: () => {
    const tab = tabById(state.activeTabId);
    if (!tab || isShellPage(tab.url)) return;
    profile.toggleBookmark(tab.url, tab.title);
    broadcast();
  },
  find: ({ text, forward = true, next = false }) => {
    const wc = activeContents();
    if (!wc) return;
    if (!text) wc.stopFindInPage('clearSelection');
    else wc.findInPage(text, { forward, findNext: next });
  },
  stopFind: () => activeContents()?.stopFindInPage('clearSelection'),
  openPage: (name) => openPage(name),
  panic: () => (profile.settings.panic.enabled ? panic() : null),
  tabMenu: (id) => {
    const tab = tabById(id);
    if (!tab) return;
    Menu.buildFromTemplate([
      { label: tab.pinned ? 'Lösen' : 'Anheften', click: () => togglePin(id) },
      { label: 'Duplizieren', click: () => createTab({ url: tab.url, spaceId: tab.spaceId }) },
      { type: 'separator' },
      { label: 'Tab schließen', click: () => closeTab(id) },
    ]).popup({ window: win });
  },
  spaceMenu: (id) => {
    Menu.buildFromTemplate([
      { label: 'Umbenennen', click: () => sendEvent('rename-space', id) },
      { label: 'Space löschen', enabled: state.spaces.length > 1, click: () => deleteSpace(id) },
    ]).popup({ window: win });
  },
  vaultFill: (id) => fillCredential(id),
  vaultMenu: () => {
    const st = vault.status();
    const items = [];
    if (!st.exists) items.push({ label: 'Passwort-Tresor einrichten…', click: () => openPage('passwords') });
    else if (!st.unlocked) items.push({ label: 'Tresor entsperren…', click: () => openPage('passwords') });
    else {
      const url = tabById(state.activeTabId)?.url || '';
      const matches = vault.findForUrl(url);
      if (matches.length) {
        for (const m of matches) items.push({ label: `Ausfüllen: ${m.username || m.title}`, click: () => fillCredential(m.id) });
      } else items.push({ label: 'Keine Zugangsdaten für diese Seite', enabled: false });
      items.push({ type: 'separator' }, { label: 'Tresor öffnen', click: () => openPage('passwords') }, { label: 'Jetzt sperren', click: () => { vault.lock('manual'); broadcast(); } });
    }
    Menu.buildFromTemplate(items).popup({ window: win });
  },
  mainMenu: () => {
    Menu.buildFromTemplate([
      { label: 'Verlauf', click: () => openPage('history') },
      { label: 'Lesezeichen', click: () => openPage('bookmarks') },
      { label: 'Archiv', click: () => openPage('archive') },
      { label: 'Downloads', click: () => openPage('downloads') },
      { label: 'Passwörter', click: () => openPage('passwords') },
      { type: 'separator' },
      { label: 'Datenschutz & meine Daten', click: () => openPage('privacy') },
      { label: 'Einstellungen', click: () => openPage('settings') },
    ]).popup({ window: win });
  },
};

// ---------- Passwort-Tresor ----------

// Wird in der Webseite ausgeführt, nachdem der Nutzer das Ausfüllen ausdrücklich gewählt hat.
function fillScript(username, password) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pw = [...document.querySelectorAll('input[type=password]')].find(visible);
  if (!pw) return false;
  const root = pw.form || document;
  const fields = [...root.querySelectorAll('input')].filter((el) => visible(el) && ['text', 'email', 'tel', ''].includes(el.type));
  const user = fields.filter((el) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const fill = (el, value) => {
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (user && username) fill(user, username);
  fill(pw, password);
  return true;
}

const hostOfUrl = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Füllt nur im sichtbaren Tab, nur auf passender Seite und nie über unverschlüsseltes http (außer localhost).
async function fillCredential(itemId) {
  const wc = activeContents();
  if (!wc || !vault.unlocked) return { ok: false, error: 'locked' };
  const url = wc.getURL();
  if (!vault.findForUrl(url).some((m) => m.id === itemId)) return { ok: false, error: 'no_match' };
  const page = new URL(url);
  if (page.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(page.hostname)) return { ok: false, error: 'insecure' };
  const item = vault.get(itemId);
  const ok = await wc.executeJavaScript(`(${fillScript.toString()})(${JSON.stringify(item.username)}, ${JSON.stringify(item.password)})`, true);
  return { ok: !!ok, error: ok ? null : 'no_form' };
}

function copySecret(text) {
  clipboard.writeText(text);
  setTimeout(() => { if (clipboard.readText() === text) clipboard.clear(); }, 30000); // nur löschen, wenn nichts anderes kopiert wurde
}

// Bietet nach einer Anmeldung an, die Zugangsdaten zu speichern. Fragt höchstens einmal pro Seite und Minute.
async function offerSave({ url, username, password }) {
  const host = hostOfUrl(url);
  if (!host || credentialPromptOpen || Date.now() - (promptedAt.get(host) || 0) < 60000) return;
  promptedAt.set(host, Date.now());
  credentialPromptOpen = true;
  try {
    const ask = (options) => dialog.showMessageBox(win, { type: 'question', defaultId: 0, ...options });
    if (!vault.exists()) {
      const { response } = await ask({ message: 'Passwörter sicher speichern?', detail: 'Aven hat einen verschlüsselten Passwort-Tresor. Du schützt ihn mit einem Meisterpasswort.', buttons: ['Tresor einrichten', 'Nicht jetzt'], cancelId: 1 });
      if (response === 0) openPage('passwords');
      return;
    }
    if (!vault.unlocked) {
      const { response } = await ask({ message: `Passwort für ${host} speichern?`, detail: 'Der Passwort-Tresor ist gesperrt. Öffne ihn, um das Passwort zu speichern.', buttons: ['Tresor öffnen', 'Verwerfen'], cancelId: 1 });
      if (response === 0) {
        pendingCredential = { url, username, password, at: Date.now() };
        openPage('passwords');
      }
      return;
    }
    if (vault.neverSaveFor(url)) return;
    const saved = vault.compareWithSaved(url, username, password);
    if (saved.kind === 'same') return;
    const who = username || 'diesem Konto';
    if (saved.kind === 'changed') {
      const { response } = await ask({ message: `Gespeichertes Passwort für ${who} auf ${host} aktualisieren?`, buttons: ['Aktualisieren', 'Nicht jetzt'], cancelId: 1 });
      if (response === 0) vault.update(saved.id, { password });
      return;
    }
    const { response } = await ask({ message: `Passwort für ${who} auf ${host} speichern?`, buttons: ['Speichern', 'Nie für diese Seite', 'Nicht jetzt'], cancelId: 2 });
    if (response === 0) vault.add({ url: new URL(url).origin, username, password });
    if (response === 1) vault.addNeverSave(url);
  } finally {
    credentialPromptOpen = false;
    broadcast();
  }
}

const pendingInfo = () => (pendingCredential && Date.now() - pendingCredential.at < 5 * 60000
  ? { host: hostOfUrl(pendingCredential.url), username: pendingCredential.username } : null);

const vaultActions = {
  'vault:status': () => ({ ...vault.status(), pending: pendingInfo(), osProtection: safeStorage.isEncryptionAvailable() }),
  'vault:create': async (master) => { const r = await vault.create(master); broadcast(); return r; },
  'vault:unlock': async (master) => { await vault.unlock(master); broadcast(); return { ok: true }; },
  'vault:lock': () => { vault.lock('manual'); broadcast(); },
  'vault:recover': async ({ recoveryKey, newMaster }) => { await vault.unlockWithRecovery(recoveryKey, newMaster); broadcast(); return { ok: true }; },
  'vault:changeMaster': ({ oldPassword, newPassword }) => vault.changeMaster(oldPassword, newPassword),
  'vault:rotateRecovery': () => vault.rotateRecoveryKey(),
  'vault:autolock': (minutes) => { vault.setAutoLockMinutes(minutes); return vault.status(); },
  'vault:list': () => vault.list(),
  'vault:get': (id) => vault.get(id),
  'vault:add': (data) => { const item = vault.add(data); broadcast(); return { id: item.id }; },
  'vault:update': ({ id, patch }) => { vault.update(id, patch); broadcast(); return { ok: true }; },
  'vault:remove': (id) => { vault.remove(id); broadcast(); },
  'vault:copy': ({ id, field }) => {
    const item = vault.get(id);
    if (field === 'password') copySecret(item.password);
    else if (field === 'username') clipboard.writeText(item.username);
    return { ok: true };
  },
  'vault:generate': (options) => generatePassword(options),
  'vault:strength': (password) => estimateStrength(password),
  'vault:audit': () => vault.audit(estimateStrength),
  'vault:pwned': async (id) => ({ count: await pwnedCount(vault.get(id).password) }),
  'vault:import': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'CSV-Datei importieren', filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return { canceled: true };
    const stat = fs.statSync(filePaths[0]);
    if (stat.size > 5_000_000) return { __error: 'csv_too_large' };
    const result = vault.importCsv(fs.readFileSync(filePaths[0], 'utf8'));
    broadcast();
    return result;
  },
  'vault:backup': async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `aven-tresor-sicherung-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Verschlüsselte Tresor-Sicherung', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    vault.exportBackup(filePath);
    return { ok: true, path: filePath };
  },
  'vault:savePending': () => {
    const info = pendingInfo();
    if (!info) return { ok: false };
    vault.add({ url: new URL(pendingCredential.url).origin, username: pendingCredential.username, password: pendingCredential.password });
    pendingCredential = null;
    broadcast();
    return { ok: true };
  },
  'vault:discardPending': () => { pendingCredential = null; },
  'vault:destroy': ({ confirm }) => {
    if (confirm !== 'LÖSCHEN') return { __error: 'confirm_required' };
    vault.destroy();
    pendingCredential = null;
    broadcast();
    return { ok: true };
  },
};

// ---------- Konto und Sync ----------

const SYNCED_SETTINGS = ['archiveAfterHours', 'historyEnabled', 'historyRetentionDays', 'archiveRetentionDays'];

// Verbindet den Sync mit den lokalen Daten. Favicons und Verlaufsdetails bleiben außen vor.
const syncAdapter = {
  collect() {
    return {
      spaces: state.spaces.map(({ id, name, color }) => ({ id, data: { id, name, color } })),
      tabs: state.tabs.filter((t) => !isShellPage(t.url))
        .map(({ id, spaceId, pinned, url, title }) => ({ id, data: { id, spaceId, pinned, url, title } })),
      archive: profile.archive.map(({ id, url, title, spaceId, archivedAt }) => ({ id, data: { id, url, title, spaceId, archivedAt } })),
      history: profile.history.map(({ id, url, title, visitedAt }) => ({ id, data: { id, url, title, visitedAt } })),
      bookmarks: profile.bookmarks.map(({ id, url, title, addedAt }) => ({ id, data: { id, url, title, addedAt } })),
      settings: [{ id: 'main', data: Object.fromEntries(SYNCED_SETTINGS.map((key) => [key, profile.settings[key]])) }],
    };
  },
  // Gibt bei Tabs den Stand zurück, der lokal wirklich gilt. Ein geöffneter Tab behält seine aktuelle
  // URL; würde der Sync die empfangene URL als übernommen merken, lüde er danach die alte URL hoch
  // und setzte damit Navigationen auf anderen Geräten zurück.
  apply(collection, id, data) {
    let effective;
    if (collection === 'spaces') {
      if (data === null) return deleteSpace(id);
      const space = spaceById(id);
      if (space) Object.assign(space, { name: String(data.name || space.name).slice(0, 30), color: data.color || space.color });
      else state.spaces.push({ id, name: String(data.name || 'Space').slice(0, 30), color: data.color || SPACE_COLORS[0], lastTabId: null });
    } else if (collection === 'tabs') {
      if (data === null) return removeTab(id) && undefined;
      if (!spaceById(data.spaceId) || !isAllowedUrl(data.url)) return;
      const tab = tabById(id);
      if (tab) {
        Object.assign(tab, { spaceId: data.spaceId, pinned: !!data.pinned, title: data.title || tab.title });
        if (!views.has(id)) tab.url = data.url;
        effective = { id, spaceId: tab.spaceId, pinned: tab.pinned, url: tab.url, title: tab.title };
      } else {
        state.tabs.push({ id, spaceId: data.spaceId, pinned: !!data.pinned, url: data.url, title: data.title || '', favicon: '', lastActive: Date.now() });
      }
    } else if (collection === 'settings') {
      if (data) profile.updateSettings(data);
    } else if (data === null) {
      profile.removeSynced(collection, id);
    } else {
      profile.upsertSynced(collection, data);
    }
    broadcast();
    return effective;
  },
};

async function runSync() {
  if (syncing || !account.signedIn) return null;
  syncing = true;
  try {
    return await account.sync(syncAdapter);
  } catch {
    return null; // Fehler steht in account.status().lastError
  } finally {
    syncing = false;
    broadcast();
  }
}

const accountActions = {
  'account:status': () => account.status(),
  'account:server': (url) => { account.setServer(url); return account.status(); },
  'account:register': async (p) => { const r = await account.register(p); runSync(); return r; },
  'account:login': async (p) => { const r = await account.login(p); runSync(); return r; },
  'account:logout': async () => { await account.logout(); broadcast(); },
  'account:categories': (p) => { account.setCategories(p || {}); return account.status(); },
  'account:sync': async () => {
    if (syncing) return account.status();
    syncing = true;
    try { await account.sync(syncAdapter); } finally { syncing = false; }
    return account.status();
  },
  'account:password': (p) => account.changePassword(p),
  'account:mode': (p) => account.changeMode(p),
  'account:totp:setup': (password) => account.totpSetup(password),
  'account:totp:enable': (code) => account.totpEnable(code),
  'account:totp:disable': (p) => account.totpDisable(p),
  'account:recover:request': (p) => account.recoverRequest(p),
  'account:recover:verify': (p) => account.recoverVerify(p),
  'account:recover:finish': async (p) => { const r = await account.recoverFinish(p); runSync(); return r; },
  'account:devices': () => account.api().devices(),
  'account:device:revoke': (id) => account.api().revokeDevice(id),
  'account:export:request': (password) => account.exportRequest(password),
  'account:export:status': (id) => account.exportStatus(id),
  'account:export:download': async (id) => {
    const file = await account.exportDownload(id);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `aven-cloud-export-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf8');
    return { ok: true, path: filePath };
  },
  'account:delete': async (password) => { await account.deleteAccount(password); broadcast(); },
};

// ---------- Aktionen der internen Seiten (aven://…) ----------

const pageActions = {
  overview: () => overview(),
  'settings:get': () => profile.settings,
  'settings:set': (patch) => { profile.updateSettings(patch || {}); broadcast(); return profile.settings; },
  'history:list': (opts) => profile.listHistory(opts),
  'history:delete': (id) => { profile.deleteHistory(id); },
  'history:clear': () => { profile.clearHistory(); },
  'bookmarks:list': () => profile.bookmarks,
  'bookmarks:delete': (id) => { profile.removeBookmark(id); broadcast(); },
  'archive:list': () => profile.archive,
  'archive:restore': (id) => {
    const entry = profile.takeFromArchive(id);
    if (entry) createTab({ url: entry.url, title: entry.title, favicon: entry.favicon, spaceId: spaceById(entry.spaceId) ? entry.spaceId : state.activeSpaceId });
  },
  'archive:delete': (id) => { profile.takeFromArchive(id); },
  'archive:clear': () => { profile.clearArchive(); },
  'downloads:list': () => downloads.list,
  'downloads:open': (id) => downloads.open(id),
  'downloads:show': (id) => downloads.show(id),
  'downloads:cancel': (id) => downloads.cancel(id),
  'downloads:clear': () => downloads.clear(),
  'intro:show': () => { sendEvent('show-intro'); },
  'permissions:reset': (origin) => { profile.resetPermissions(origin); return profile.settings.permissions; },
  'sitedata:clear': () => clearSiteData(),
  export: (format) => exportData(format),
  ...accountActions,
  ...vaultActions,
};

function isTrustedPageSender(event, name = '') {
  const fromView = [...views.values()].some((v) => v.webContents === event.sender);
  const trusted = fromView && event.senderFrame === event.sender.mainFrame && isInternalUrl(event.senderFrame.url);
  // Tresor-Aktionen sind nur von der Tresor-Seite aus erlaubt.
  return trusted && (!name.startsWith('vault:') || event.senderFrame.url.endsWith('#passwords'));
}

// ---------- Menü, Sitzung, Fenster ----------

function buildMenu() {
  const act = (name, arg) => () => actions[name](arg);
  const reload = () => activeContents()?.reload();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Browser',
      submenu: [
        { label: 'Neuer Tab', accelerator: 'CmdOrCtrl+T', click: act('newTab') },
        { label: 'Tab schließen', accelerator: 'CmdOrCtrl+W', click: () => state.activeTabId && closeTab(state.activeTabId) },
        { label: 'Geschlossenen Tab wiederherstellen', accelerator: 'CmdOrCtrl+Shift+T', click: reopenClosedTab },
        { label: 'Tab anheften / lösen', accelerator: 'CmdOrCtrl+Shift+P', click: () => state.activeTabId && togglePin(state.activeTabId) },
        { label: 'Neuer Space', accelerator: 'CmdOrCtrl+Shift+N', click: act('newSpace') },
        { label: 'Darkweb-Fenster öffnen…', click: () => darkweb.open() },
        { type: 'separator' },
        { label: 'Adressleiste fokussieren', accelerator: 'CmdOrCtrl+L', click: () => { win.webContents.focus(); sendEvent('focus-address'); } },
        { label: 'Auf der Seite suchen', accelerator: 'CmdOrCtrl+F', click: () => { win.webContents.focus(); sendEvent('find'); } },
        { label: 'Lesezeichen setzen / entfernen', accelerator: 'CmdOrCtrl+D', click: act('toggleBookmark') },
        { label: 'Sidebar ein/aus', accelerator: 'CmdOrCtrl+B', click: act('toggleSidebar') },
        { type: 'separator' },
        { label: 'Nächster Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Vorheriger Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Navigation',
      submenu: [
        { label: 'Zurück', accelerator: 'Alt+Left', click: act('back') },
        { label: 'Vorwärts', accelerator: 'Alt+Right', click: act('forward') },
        { label: 'Neu laden', accelerator: 'CmdOrCtrl+R', click: reload },
        { label: 'Neu laden', accelerator: 'F5', visible: false, click: reload },
      ],
    },
    {
      label: 'Daten',
      submenu: [
        { label: 'Verlauf', accelerator: 'CmdOrCtrl+H', click: () => openPage('history') },
        { label: 'Lesezeichen', accelerator: 'CmdOrCtrl+Shift+O', click: () => openPage('bookmarks') },
        { label: 'Archiv', click: () => openPage('archive') },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => openPage('downloads') },
        { type: 'separator' },
        { label: 'Datenschutz & meine Daten', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => openPage('privacy') },
        { label: 'Einstellungen', accelerator: 'CmdOrCtrl+,', click: () => openPage('settings') },
      ],
    },
    { label: 'Bearbeiten', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'resetZoom', label: 'Zoom zurücksetzen' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { label: 'Entwicklerwerkzeuge', accelerator: 'F12', click: () => activeContents()?.toggleDevTools() },
      ],
    },
  ]));
}

function setupSession() {
  const ses = siteSession();
  const savedDecision = (origin, permission) => profile.settings.permissions[origin]?.[permission];

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (ALLOWED_PERMISSIONS.has(permission)) return callback(true);
    const label = ASKED_PERMISSIONS[permission];
    if (!label) return callback(false);
    const origin = originOf(details.requestingUrl);
    const saved = savedDecision(origin, permission);
    if (typeof saved === 'boolean') return callback(saved);
    dialog.showMessageBox(win, {
      type: 'question', buttons: ['Erlauben', 'Blockieren'], defaultId: 1, cancelId: 1,
      message: `${new URL(origin).host} möchte auf ${label} zugreifen.`,
      checkboxLabel: 'Entscheidung für diese Website merken',
    }).then(({ response, checkboxChecked }) => {
      const allow = response === 0;
      if (checkboxChecked) profile.setPermission(origin, permission, allow);
      callback(allow);
    });
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) || savedDecision(originOf(requestingOrigin), permission) === true);

  downloads.attach(ses);
}

function createWindow() {
  const b = state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y,
    minWidth: 720, minHeight: 440,
    backgroundColor: '#03011c',
    title: 'Aven',
    icon: path.join(__dirname, '..', '..', 'assets', 'logo', 'app-512.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#03011c', symbolColor: '#e9e9f1', height: TOOLBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('resize', () => { layoutViews(); broadcast(); });
  win.on('move', broadcast);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    maintenance();
    const inSpace = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
    const target = tabById(state.activeTabId)?.spaceId === state.activeSpaceId ? state.activeTabId : inSpace[0]?.id;
    if (target) activateTab(target); else createTab();
    layoutViews();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    const dir = app.getPath('userData');
    stateStore = new Store(dir, 'aven-state.json', safeStorage);
    profile = new Profile(new Store(dir, 'aven-data.json', safeStorage));
    state = loadState();
    downloads = new Downloads(broadcast);
    account = new AccountManager({ store: new Store(dir, 'aven-account.json', safeStorage) });
    const deviceWrap = {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (buf) => safeStorage.encryptString(buf.toString('base64')),
      decrypt: (buf) => Buffer.from(safeStorage.decryptString(buf), 'base64'),
    };
    vault = new Vault(path.join(dir, 'aven-vault.json'), {
      deviceWrap,
      onLock: () => { pendingCredential = null; notifyVaultLocked(); broadcast(); },
    });
    darkweb = createDarkweb({
      BrowserWindow, WebContentsView, session, ipcMain, dialog, userDataDir: dir, uiDir: path.join(__dirname, '..', 'darkweb'),
      tor: new TorManager({ tmpDir: app.getPath('temp') }), deviceWrap, resourcesDir: process.resourcesPath,
    });
    powerMonitor.on('lock-screen', () => vault.lock('system'));
    powerMonitor.on('suspend', () => vault.lock('system'));
    ipcMain.on('aven:cred-submit', (event, data) => {
      const fromView = [...views.values()].some((v) => v.webContents === event.sender);
      if (!fromView || event.senderFrame !== event.sender.mainFrame || !data) return;
      const { url, username, password } = data;
      if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') return;
      if (!password || password.length > 2000 || username.length > 500 || originOf(url) !== originOf(event.senderFrame.url) || !/^https?:/.test(url)) return;
      offerSave({ url, username, password });
    });
    setupSession();
    buildMenu();

    const RENDERER_ACCOUNT_ACTIONS = ['account:register', 'account:login'];
    ipcMain.handle('aven:action', async (event, name, payload) => {
      if (!win || event.sender !== win.webContents) return null;
      const fn = actions[name] || (RENDERER_ACCOUNT_ACTIONS.includes(name) ? accountActions[name] : null);
      if (!fn) return null;
      try {
        return await fn(payload);
      } catch (err) {
        return { __error: err.code || err.message || 'error' };
      }
    });
    ipcMain.handle('aven:page', async (event, name, payload) => {
      if (!isTrustedPageSender(event, name)) return null;
      const fn = pageActions[name];
      if (!fn) return null;
      try {
        return await fn(payload);
      } catch (err) {
        return { __error: err.code || err.message || 'error', status: err.status || 0, retryAfterMs: err.body?.retryAfterMs ?? err.retryAfterMs };
      }
    });

    createWindow();
    setInterval(maintenance, ARCHIVE_CHECK_MS);
    setInterval(runSync, SYNC_INTERVAL_MS);
    // Ein Lebenszeichen pro Tag, nur wenn der Browser tatsächlich benutzt wird. Sync zählt nicht.
    win.on('focus', () => account.heartbeat().then(broadcast, () => {}));
    setTimeout(() => {
      account.retryPendingDelete().then(broadcast, () => {});
      account.heartbeat().then(runSync, () => {});
    }, 3000);
  });

  app.on('before-quit', () => {
    if (!state) return;
    const active = tabById(state.activeTabId);
    if (active) active.lastActive = Date.now();
    persist();
    vault.lock('quit');
    darkweb.endSession();
    stateStore.flush();
    profile.flush();
    account.store.flush();
  });

  app.on('window-all-closed', () => app.quit());
}
