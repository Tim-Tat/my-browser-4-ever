const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { findTorBinary, sha256File } = require('./tor');
const { Container } = require('./container');

const BAR_HEIGHT = 86; // Leiste mit Adresse (52) und Tabs (34)
const LEVELS = ['standard', 'safer', 'safest'];
const BLACKHOLE = 'socks5://127.0.0.1:1'; // Ohne Tor geht jede Anfrage ins Leere, nie direkt ins Netz.
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[::1?\]|\[f[cd][0-9a-f]{2}:.*\]|\[fe80:.*\])$/i;

const HONEST_NOTICE = [
  'Das ist nicht der Tor Browser. Er ist darauf gebaut, dass alle Nutzer gleich aussehen. Aven erreicht diesen Schutz vor Fingerprinting nicht. Wer ernsthaft anonym bleiben muss, sollte den Tor Browser verwenden.',
  'Doppelte Verschlüsselung ersetzt keine Anonymität. Sie schützt Inhalte und gespeicherte Daten, nicht dein Verhalten (Anmeldung mit echtem Namen, Dateien öffnen, Skripte).',
  'Ein kompromittierter Computer bleibt kompromittiert. Schadsoftware, Keylogger und Bildschirmfreigabe umgehen alle Schutzschichten.',
  'Spuren außerhalb von Aven (Betriebssystem, Auslagerungsdatei, Screenshots) kann Aven nur eingeschränkt kontrollieren.',
  'Aven bietet keine Inhalte, Verzeichnisse oder Empfehlungen an. Du bist selbst für rechtmäßiges Verhalten verantwortlich.',
].join('\n\n');

// Nur Webadressen über Tor. Lokale und private Ziele sind gesperrt, damit Seiten keine Dienste im eigenen Netz abtasten.
function isAllowedRequest(url, torReady) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true; // rein lokal, kein Netzwerk
  if (!torReady) return false;
  if (!/^(https?|wss?):$/.test(parsed.protocol)) return false;
  return !PRIVATE_HOST.test(parsed.hostname);
}

// Adresseingabe: keine Suche, keine Vorschläge. Nur eine Adresse, die der Nutzer selbst eingibt.
function normalizeDarkInput(raw) {
  const input = String(raw || '').trim();
  if (!input || /\s/.test(input)) return null;
  if (/^https?:\/\//i.test(input)) return isAllowedRequest(input, true) ? input : null;
  if (/^[a-z2-7]{16,56}\.onion([/?#].*)?$/i.test(input)) return `http://${input}`;
  if (/^[^/?#]+\.[a-z]{2,}([/?#].*)?$/i.test(input)) return isAllowedRequest(`https://${input}`, true) ? `https://${input}` : null;
  return null;
}

function createDarkweb({ BrowserWindow, WebContentsView, session, ipcMain, dialog, userDataDir, uiDir, tor, deviceWrap = null, resourcesDir = null, kdf }) {
  const configFile = path.join(userDataDir, 'aven-darkweb-config.json');
  const container = new Container(path.join(userDataDir, 'aven-darkweb.json'), { deviceWrap, ...(kdf ? { kdf } : {}) });
  let win = null;
  let ses = null;
  let level = 'standard';
  let panelOpen = false;
  let closing = false;
  let nextTab = 1;
  const tabs = new Map(); // id -> { view, url, title }
  let activeId = null;

  const readConfig = () => {
    try { return { bridges: [], ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; } catch { return { bridges: [] }; }
  };
  const writeConfig = (patch) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ ...readConfig(), ...patch }), { mode: 0o600 });
  };

  const send = (name, data) => { if (win && !win.isDestroyed()) win.webContents.send('darkweb:event', name, data); };
  const torReady = () => tor.status().state === 'ready';

  function snapshot() {
    const cfg = readConfig();
    const binary = findTorBinary({ configured: cfg.torPath, userDataDir, resourcesDir });
    return {
      tor: tor.status(), level, activeId, panelOpen,
      tabs: [...tabs.entries()].map(([id, t]) => {
        const wc = t.view.webContents;
        return { id, url: wc.getURL() || t.url, title: t.title, loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() };
      }),
      container: { exists: container.exists(), unlocked: container.unlocked },
      bookmarks: container.unlocked ? container.data.bookmarks || [] : [],
      setup: { found: !!binary, searchDir: path.join(userDataDir, 'tor'), pinned: cfg.torSha256 ? cfg.torSha256.slice(0, 16) : null, bridges: cfg.bridges, pluginPath: cfg.pluginPath || '' },
    };
  }
  const push = () => send('state', snapshot());

  function layout() {
    if (!win || win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    for (const t of tabs.values()) t.view.setBounds({ x: 0, y: BAR_HEIGHT, width: w, height: Math.max(0, h - BAR_HEIGHT) });
  }

  // Bei Fokusverlust ist die native Webansicht ausgeblendet; ein HTML-Overlay allein läge darunter.
  let shielded = false;

  function refreshVisibility() {
    for (const [id, t] of tabs) t.view.setVisible(!panelOpen && !shielded && id === activeId);
  }

  async function applyProxy() {
    if (!ses) return;
    const state = tor.status();
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: state.state === 'ready' && state.port ? `socks5://127.0.0.1:${state.port}` : BLACKHOLE,
      proxyBypassRules: '<-loopback>',
    });
    await ses.closeAllConnections();
  }

  // ---------- Tabs ----------

  function createTab(url = null) {
    const view = new WebContentsView({
      webPreferences: {
        session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
        javascript: level !== 'safest', webgl: level === 'standard',
        autoplayPolicy: level === 'standard' ? 'no-user-gesture-required' : 'user-gesture-required',
      },
    });
    const id = nextTab++;
    const wc = view.webContents;
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    const tab = { view, url: url || '', title: '' };
    tabs.set(id, tab);
    view.setVisible(false);
    win.contentView.addChildView(view);
    wc.on('page-title-updated', (_e, title) => { tab.title = title; push(); });
    for (const evt of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) wc.on(evt, push);
    wc.on('will-navigate', (e, target) => { if (!isAllowedRequest(target, true)) e.preventDefault(); });
    wc.setWindowOpenHandler(({ url: target }) => {
      if (isAllowedRequest(target, true)) createTab(target);
      return { action: 'deny' };
    });
    layout();
    selectTab(id);
    if (url) wc.loadURL(url).catch(() => {});
    return id;
  }

  function selectTab(id) {
    if (!tabs.has(id)) return;
    activeId = id;
    refreshVisibility();
    push();
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (activeId === id) activeId = [...tabs.keys()].pop() ?? null;
    if (!tabs.size) createTab();
    else { refreshVisibility(); push(); }
  }

  // Beim Wechsel der Sicherheitsstufe bekommen alle Tabs neue Einstellungen.
  function rebuildTabs() {
    const urls = [...tabs.values()].map((t) => t.view.webContents.getURL() || t.url);
    for (const [id, tab] of [...tabs]) {
      tabs.delete(id);
      win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    activeId = null;
    if (!urls.length) urls.push('');
    for (const url of urls) createTab(url || null);
  }

  const activeContents = () => tabs.get(activeId)?.view.webContents;

  // ---------- Tor ----------

  async function connectTor() {
    const cfg = readConfig();
    const binary = findTorBinary({ configured: cfg.torPath, userDataDir, resourcesDir });
    if (!binary) return { __error: 'tor_missing' };
    const hash = await sha256File(binary);
    if (cfg.torSha256 && cfg.torSha256 !== hash) return { __error: 'tor_hash_mismatch' };
    if (!cfg.torSha256) writeConfig({ torSha256: hash, torPath: binary }); // beim ersten Mal merken, danach nur noch dieses Programm
    await tor.start(binary, { bridges: cfg.bridges, pluginPath: cfg.pluginPath || null });
    return { ok: true };
  }

  // ---------- Fenster ----------

  async function open() {
    if (win) { win.focus(); return; }
    const cfg = readConfig();
    if (!cfg.acknowledged) {
      const { response, checkboxChecked } = await dialog.showMessageBox({
        type: 'warning', title: 'Darkweb-Modus', message: 'Bitte lies das, bevor du den Darkweb-Modus nutzt', detail: HONEST_NOTICE,
        buttons: ['Verstanden, fortfahren', 'Abbrechen'], defaultId: 1, cancelId: 1, checkboxLabel: 'Diesen Hinweis nicht mehr zeigen',
      });
      if (response !== 0) return;
      if (checkboxChecked) writeConfig({ acknowledged: true });
    }
    closing = false;
    level = 'standard';
    ses = session.fromPartition(`aven-darkweb-${crypto.randomUUID()}`); // ohne "persist:": nur im Arbeitsspeicher
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !isAllowedRequest(details.url, torReady()) }));
    ses.on('will-download', (event) => {
      event.preventDefault();
      send('notice', 'Download blockiert. Geöffnete Dateien laufen außerhalb des geschützten Modus und können deine echte IP-Adresse verraten.');
    });
    await applyProxy();
    tor.on('status', onTorStatus);

    win = new BrowserWindow({
      width: 1180, height: 780, minWidth: 720, minHeight: 440, backgroundColor: '#0f0a02', title: 'Aven Onion-Modus',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(uiDir, 'index.html'));
    win.on('resize', layout);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => { win = null; endSession(); });
    // Verhindert, dass der Fensterinhalt im Taskwechsler sichtbar bleibt.
    win.on('blur', () => { shielded = true; refreshVisibility(); send('privacy-shield', true); });
    win.on('focus', () => { shielded = false; refreshVisibility(); send('privacy-shield', false); });
    win.webContents.once('did-finish-load', () => {
      createTab();
      push();
      connectTor().then((res) => { if (res && res.__error) push(); }).catch((err) => send('notice', err.message));
    });
  }

  function onTorStatus() {
    applyProxy().catch(() => {});
    push();
  }

  // Beendet die Sitzung: Fenster zu, Tor aus, Sitzungsdaten verwerfen, Container sperren, Schlüssel verwerfen.
  async function endSession() {
    if (closing) return;
    closing = true;
    tor.off('status', onTorStatus);
    container.lock();
    for (const tab of tabs.values()) { try { tab.view.webContents.close(); } catch { /* schon zu */ } }
    tabs.clear();
    activeId = null;
    const w = win;
    win = null;
    if (w && !w.isDestroyed()) w.destroy();
    await tor.stop();
    if (ses) {
      await ses.clearStorageData().catch(() => {});
      await ses.clearCache().catch(() => {});
      ses = null;
    }
  }

  // ---------- Aktionen der Oberfläche ----------

  const withError = async (fn) => {
    try { return await fn(); } catch (err) { return { __error: err.code || err.message, retryAfterMs: err.retryAfterMs }; }
  };

  const actions = {
    state: () => snapshot(),
    newTab: () => { createTab(); },
    selectTab: (id) => selectTab(id),
    closeTab: (id) => closeTab(id),
    navigate: (input) => {
      const url = normalizeDarkInput(input);
      if (!url) return { __error: 'invalid_address' };
      const wc = activeContents();
      if (wc) wc.loadURL(url).catch(() => {});
      return { ok: true };
    },
    back: () => { const wc = activeContents(); if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); },
    forward: () => { const wc = activeContents(); if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); },
    reload: () => { const wc = activeContents(); if (wc) (wc.isLoading() ? wc.stop() : wc.reload()); },
    panel: (open) => { panelOpen = !!open; refreshVisibility(); push(); },
    setLevel: (value) => {
      if (!LEVELS.includes(value) || value === level) return;
      level = value;
      rebuildTabs();
    },
    connect: () => connectTor(),
    disconnect: () => tor.stop(),
    chooseTor: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Tor-Programm auswählen', properties: ['openFile'], filters: [{ name: 'Programme', extensions: ['exe', ''] }] });
      if (canceled || !filePaths[0]) return { canceled: true };
      writeConfig({ torPath: filePaths[0], torSha256: await sha256File(filePaths[0]) });
      push();
      return { ok: true };
    },
    trustTor: async () => {
      const cfg = readConfig();
      const binary = findTorBinary({ configured: cfg.torPath, userDataDir, resourcesDir });
      if (!binary) return { __error: 'tor_missing' };
      writeConfig({ torPath: binary, torSha256: await sha256File(binary) });
      push();
      return { ok: true };
    },
    setBridges: ({ bridges, pluginPath }) => {
      const lines = String(bridges || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
      if (lines.some((l) => l.length > 400)) return { __error: 'invalid_bridge' };
      writeConfig({ bridges: lines, pluginPath: String(pluginPath || '').slice(0, 500) });
      push();
      return { ok: true };
    },
    containerCreate: (passphrase) => withError(async () => { await container.create(passphrase, { bookmarks: [] }); push(); return { ok: true }; }),
    containerUnlock: (passphrase) => withError(async () => { await container.unlock(passphrase); push(); return { ok: true }; }),
    containerLock: () => { container.lock(); push(); },
    bookmarkAdd: () => withError(async () => {
      const wc = activeContents();
      const url = wc?.getURL();
      if (!url || !isAllowedRequest(url, true)) return { __error: 'nothing_to_save' };
      const data = container.data;
      data.bookmarks = [{ id: crypto.randomUUID(), title: tabs.get(activeId).title || url, url, addedAt: Date.now() }, ...(data.bookmarks || [])].slice(0, 500);
      container.save(data);
      push();
      return { ok: true };
    }),
    bookmarkRemove: (id) => withError(async () => {
      const data = container.data;
      data.bookmarks = (data.bookmarks || []).filter((b) => b.id !== id);
      container.save(data);
      push();
    }),
    end: () => { endSession(); },
  };

  ipcMain.handle('darkweb:action', async (event, name, payload) => {
    if (!win || event.sender !== win.webContents) return null;
    const fn = actions[name];
    if (!fn) return null;
    return withError(() => fn(payload));
  });

  return {
    open, endSession, snapshot, actions,
    isOpen: () => !!win,
    destroyContainer: () => container.destroy(),
    getSession: () => ses,
  };
}

module.exports = { createDarkweb, isAllowedRequest, normalizeDarkInput, HONEST_NOTICE };
