const $ = (id) => document.getElementById(id);
const call = (name, payload) => window.darkweb.invoke(name, payload);
let state = null;
let panelKind = null;

const ERRORS = {
  tor_missing: 'Das Tor-Programm wurde nicht gefunden.',
  tor_hash_mismatch: 'Das Tor-Programm hat sich seit dem letzten Start verändert und wird nicht gestartet.',
  invalid_address: 'Bitte eine vollständige Adresse eingeben, zum Beispiel xyz.onion oder https://beispiel.ch. Lokale Adressen sind gesperrt.',
  wrong_password: 'Die Passphrase stimmt nicht.',
  too_many_attempts: 'Zu viele Fehlversuche. Bitte warten.',
  passphrase_too_short: 'Die Passphrase braucht mindestens 12 Zeichen.',
  device_key_unavailable: 'Der Container ist an ein anderes Windows-Konto gebunden.',
  container_tampered: 'Der Container wurde verändert und wird nicht geöffnet.',
  exists: 'Es gibt schon einen Container.',
  nothing_to_save: 'Es gibt keine Seite zum Speichern.',
  invalid_bridge: 'Eine Bridge-Zeile ist ungültig.',
};
const message = (res) => (ERRORS[res.__error] || `Fehler: ${res.__error}`) + (res.retryAfterMs ? ` Nächster Versuch in ${Math.ceil(res.retryAfterMs / 1000)} Sekunden.` : '');

// Kleiner DOM-Helfer; Texte werden nie als HTML gesetzt.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child.nodeType ? child : document.createTextNode(child));
  return el;
}

function notice(text) {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 7000);
}

const STATUS = {
  stopped: 'Nicht verbunden – alle Anfragen blockiert',
  failed: 'Getrennt – alle Anfragen blockiert',
};

function render() {
  if (!state) return;
  const { tor } = state;
  const status = $('status');
  status.className = `status ${tor.state}`;
  status.textContent = tor.state === 'ready' ? 'Verbunden' : tor.state === 'starting' ? `Verbinde … ${tor.progress} %` : (state.setup.found ? STATUS[tor.state] : 'Tor nicht gefunden – alle Anfragen blockiert');
  $('level').value = state.level;
  const tab = state.tabs.find((t) => t.id === state.activeId);
  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;
  if (document.activeElement !== $('address')) $('address').value = tab?.url || '';

  const strip = $('tabs');
  strip.replaceChildren(...state.tabs.map((t) => h('div', { class: `tab${t.id === state.activeId ? ' active' : ''}`, onclick: () => call('selectTab', t.id) },
    h('span', {}, t.title || t.url || 'Neuer Tab'),
    h('button', { title: 'Schließen', onclick: (e) => { e.stopPropagation(); call('closeTab', t.id); } }, '✕'))),
    h('button', { class: 'plus', title: 'Neuer Tab', onclick: () => call('newTab') }, '＋'));

  const panel = $('panel');
  panel.hidden = !state.panelOpen;
  if (state.panelOpen && panelKind) drawPanel();
}

function openPanel(kind) {
  panelKind = kind;
  call('panel', true);
}

function closePanel() {
  panelKind = null;
  call('panel', false);
}

function drawPanel() {
  const panel = $('panel');
  const body = panelKind === 'tor' ? torPanel() : bookmarksPanel();
  panel.replaceChildren(h('div', { class: 'box' }, body));
}

function guard(button, errorEl, fn) {
  return async () => {
    button.disabled = true;
    errorEl.textContent = '';
    try { await fn(); } catch (err) { errorEl.textContent = err.message; }
    button.disabled = false;
  };
}

function torPanel() {
  const s = state.setup;
  const error = h('p', { class: 'error' });
  const connect = h('button', { class: 'primary' }, state.tor.state === 'ready' ? 'Neu verbinden' : 'Verbinden');
  connect.addEventListener('click', guard(connect, error, async () => {
    if (state.tor.state === 'ready') await call('disconnect');
    const res = await call('connect');
    if (res && res.__error) throw new Error(message(res));
    closePanel();
  }));
  const bridges = h('textarea', { placeholder: 'obfs4 192.0.2.1:443 FINGERPRINT cert=… iat-mode=0' });
  bridges.value = s.bridges.join('\n');
  const plugin = h('input', { type: 'text', placeholder: 'Pfad zum Transport-Programm (zum Beispiel lyrebird.exe), nur für Bridges' });
  plugin.value = s.pluginPath;
  const saveBridges = h('button', {}, 'Bridges speichern');
  saveBridges.addEventListener('click', guard(saveBridges, error, async () => {
    const res = await call('setBridges', { bridges: bridges.value, pluginPath: plugin.value });
    if (res.__error) throw new Error(message(res));
    notice('Gespeichert');
  }));
  const choose = h('button', {}, 'Tor-Programm auswählen …');
  choose.addEventListener('click', guard(choose, error, async () => { await call('chooseTor'); }));
  const trust = state.setup.pinned ? h('button', {}, 'Geändertem Programm vertrauen') : null;
  if (trust) trust.addEventListener('click', guard(trust, error, async () => { await call('trustTor'); notice('Neuer Fingerabdruck gespeichert'); }));
  return [
    h('h2', {}, 'Verbindung zum Tor-Netzwerk'),
    h('p', {}, 'Aven erfindet kein eigenes Anonymisierungsnetz, sondern nutzt das Tor-Programm als Begleitprozess. Es lauscht nur auf diesem Computer. Ohne Verbindung bleibt jede Anfrage blockiert, es gibt keinen Weg am Proxy vorbei.'),
    h('div', { class: 'card' },
      h('p', {}, s.found ? 'Ein Tor-Programm wurde gefunden.' : 'Es wurde kein Tor-Programm gefunden.'),
      h('p', {}, 'Lege es in diesen Ordner oder wähle die Datei aus. Lade Tor nur von torproject.org und prüfe die Signatur:'),
      h('p', {}, h('code', {}, s.searchDir)),
      s.pinned ? h('p', {}, 'Gemerkter Fingerabdruck (SHA-256): ', h('code', {}, `${s.pinned}…`)) : null,
      h('p', {}, 'Aven merkt sich beim ersten Start den Fingerabdruck und startet nur dieses Programm. Ändert sich die Datei, wird sie nicht mehr gestartet, bis du ihr ausdrücklich vertraust.'),
      choose, trust, connect, error),
    h('div', { class: 'card' }, h('h2', {}, 'Bridges (optional)'),
      h('p', {}, 'In Ländern, in denen Tor blockiert wird, helfen Bridges. Eine pro Zeile.'), bridges, plugin, saveBridges),
    h('button', { onclick: closePanel }, 'Schließen'),
  ];
}

function bookmarksPanel() {
  const c = state.container;
  const error = h('p', { class: 'error' });
  const pass = h('input', { type: 'password', placeholder: 'Passphrase (mindestens 12 Zeichen)', autocomplete: 'off' });
  const close = h('button', { onclick: closePanel }, 'Schließen');
  if (!c.exists || !c.unlocked) {
    const go = h('button', { class: 'primary' }, c.exists ? 'Entsperren' : 'Container erstellen');
    go.addEventListener('click', guard(go, error, async () => {
      const res = await call(c.exists ? 'containerUnlock' : 'containerCreate', pass.value);
      if (res && res.__error) throw new Error(message(res));
      pass.value = '';
    }));
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    return [
      h('h2', {}, 'Lesezeichen'),
      h('p', {}, c.exists
        ? 'Der Container ist gesperrt.'
        : 'Lesezeichen liegen in einem eigenen verschlüsselten Container. Zum Öffnen braucht es deine Passphrase und dein Windows-Konto. Es gibt keine Wiederherstellung: Wer die Passphrase verliert, verliert die Lesezeichen. Es wird kein Verlauf gespeichert.'),
      h('div', { class: 'card' }, pass, error, go), close,
    ];
  }
  const add = h('button', { class: 'primary' }, 'Aktuelle Seite speichern');
  add.addEventListener('click', guard(add, error, async () => { const res = await call('bookmarkAdd'); if (res && res.__error) throw new Error(message(res)); }));
  return [
    h('h2', {}, 'Lesezeichen'),
    h('div', {}, add, h('button', { onclick: () => call('containerLock') }, 'Container sperren'), close), error,
    h('div', {}, state.bookmarks.length ? state.bookmarks.map((b) => h('div', { class: 'item' },
      h('div', { class: 'main' }, h('div', { class: 't' }, b.title), h('div', { class: 'u' }, b.url)),
      h('button', { onclick: async () => { await call('navigate', b.url); closePanel(); } }, 'Öffnen'),
      h('button', { onclick: () => call('bookmarkRemove', b.id) }, 'Entfernen'))) : h('p', {}, 'Noch keine Lesezeichen.')),
  ];
}

$('address').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const res = await call('navigate', $('address').value);
  if (res && res.__error) notice(message(res));
  else $('address').blur();
});
$('address').addEventListener('focus', () => $('address').select());
$('back').addEventListener('click', () => call('back'));
$('forward').addEventListener('click', () => call('forward'));
$('reload').addEventListener('click', () => call('reload'));
$('level').addEventListener('change', (e) => call('setLevel', e.target.value));
$('status').addEventListener('click', () => openPanel('tor'));
$('bookmarks').addEventListener('click', () => openPanel('bookmarks'));
$('end').addEventListener('click', () => call('end'));

window.darkweb.onEvent((name, data) => {
  if (name === 'state') { state = data; render(); }
  if (name === 'notice') notice(data);
  if (name === 'privacy-shield') $('shield').hidden = !data;
});
call('state').then((s) => { if (s && !s.__error) { state = s; render(); } });
