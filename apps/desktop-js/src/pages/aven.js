const api = window.avenPages;
const main = document.getElementById('main');

// Kleiner DOM-Helfer: Texte werden immer als Text gesetzt, nie als HTML.
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

const ARCHIVE_HOURS = [[0, 'Nie archivieren'], [1, 'Nach 1 Stunde'], [6, 'Nach 6 Stunden'], [12, 'Nach 12 Stunden'], [24, 'Nach 24 Stunden'], [72, 'Nach 3 Tagen'], [168, 'Nach 7 Tagen']];
const RETENTION = [[0, 'Unbegrenzt, bis ich selbst lösche'], [1, '1 Tag'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '1 Jahr']];
const HOLD = [[500, '0,5 Sekunden'], [1000, '1 Sekunde'], [1500, '1,5 Sekunden'], [2000, '2 Sekunden'], [3000, '3 Sekunden']];

function toast(text) {
  const el = h('div', { class: 'toast' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

const formatTime = (ms) => new Date(ms).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
const formatDay = (ms) => new Date(ms).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const formatSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

function header(title, lead) {
  return [h('h1', {}, title), lead ? h('p', { class: 'lead' }, lead) : null];
}

function select(options, value, onChange) {
  return h('select', { onchange: (e) => onChange(Number(e.target.value)) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

function setting(label, hint, control) {
  return h('div', { class: 'row' }, h('div', { class: 'label' }, label, hint ? h('small', {}, hint) : null), control);
}

// ---------- Einstellungen ----------

async function renderSettings() {
  let s = await api.invoke('settings:get');
  const save = async (patch) => { s = await api.invoke('settings:set', patch); toast('Gespeichert'); };
  const panicAction = (key, label, hint) => h('label', {},
    h('input', { type: 'checkbox', checked: s.panic.actions[key], onchange: (e) => save({ panic: { actions: { [key]: e.target.checked } } }) }),
    h('span', {}, label, hint ? h('small', { style: 'display:block;color:var(--muted)' }, hint) : null));

  const permissions = Object.entries(s.permissions);
  main.replaceChildren(
    ...header('Einstellungen'),
    h('h2', {}, 'Tabs und Archiv'),
    setting('Nicht angeheftete Tabs archivieren', 'Archivierte Tabs verschwinden aus der Seitenleiste, bleiben aber im Archiv. Sie sind nicht im Verlauf gelöscht.',
      select(ARCHIVE_HOURS, s.archiveAfterHours, (v) => save({ archiveAfterHours: v }))),
    setting('Archiv aufbewahren', null, select(RETENTION, s.archiveRetentionDays, (v) => save({ archiveRetentionDays: v }))),
    h('h2', {}, 'Verlauf'),
    setting('Verlauf speichern', 'Besuchte Seiten mit Zeitpunkt, nur auf diesem Gerät.',
      h('input', { type: 'checkbox', checked: s.historyEnabled, onchange: (e) => save({ historyEnabled: e.target.checked }) })),
    setting('Verlauf aufbewahren', null, select(RETENTION, s.historyRetentionDays, (v) => save({ historyRetentionDays: v }))),
    h('h2', {}, 'Notfallknopf'),
    h('p', { class: 'lead' }, 'Optionaler Knopf oben rechts. Er löst aus, wenn er gedrückt gehalten wird. Du legst vorher fest, was passiert.'),
    setting('Notfallknopf anzeigen', null,
      h('input', { type: 'checkbox', checked: s.panic.enabled, onchange: (e) => save({ panic: { enabled: e.target.checked } }) })),
    setting('Gedrückt halten für', 'Schützt vor versehentlichem Auslösen.', select(HOLD, s.panic.holdMs, (v) => save({ panic: { holdMs: v } }))),
    h('div', { class: 'checks' },
      panicAction('endDarkweb', 'Darkweb-Sitzung beenden', 'Schließt das Fenster, stoppt Tor, verwirft Sitzungsdaten und sperrt den Container.'),
      panicAction('closeTabs', 'Offene Tabs schließen'),
      panicAction('clearHistoryArchive', 'Verlauf, Archiv und Download-Liste entfernen'),
      panicAction('clearSiteData', 'Cookies, Cache und Website-Daten löschen'),
      panicAction('stopSync', 'Sync stoppen, Sitzung beenden, lokale Schlüssel verwerfen'),
      panicAction('lockVault', 'Passwort-Tresor sperren'),
      panicAction('deleteVault', 'Passwort-Tresor unwiderruflich löschen', 'Entfernt alle gespeicherten Passwörter. Sicherungsdateien bleiben bestehen.'),
      panicAction('deleteAccount', 'Konto und Sync-Daten auf dem Server löschen', 'Braucht eine Verbindung. Schlägt es fehl, bleibt die Löschung als ausstehend markiert und wird später wiederholt.'),
      panicAction('resetProfile', 'Lokales Profil zurücksetzen', 'Entfernt auch Lesezeichen, Spaces und diese Einstellungen.')),
    h('p', { class: 'note' }, 'Es werden nur lokale Daten gelöscht. Eine vollständige Entfernung aller Spuren auf Datenträgern kann nicht garantiert werden. Nach der Aktion siehst du, welche Schritte gelungen sind.'),
    h('h2', {}, 'Einführung'),
    h('div', { class: 'actions' }, h('button', { onclick: () => api.invoke('intro:show') }, 'Einführung erneut anzeigen')),
    h('h2', {}, 'Website-Berechtigungen'),
    permissions.length
      ? h('div', {}, permissions.map(([origin, perms]) => h('div', { class: 'row' },
        h('div', { class: 'label' }, hostOf(origin), h('small', {}, Object.entries(perms).map(([n, v]) => `${n}: ${v ? 'erlaubt' : 'blockiert'}`).join(', '))),
        h('button', { class: 'small', onclick: async () => { await api.invoke('permissions:reset', origin); renderSettings(); } }, 'Zurücksetzen'))))
      : h('p', { class: 'lead' }, 'Keine gespeicherten Entscheidungen. Aven fragt bei Kamera, Mikrofon, Standort und Benachrichtigungen jedes Mal nach.'));
}

// ---------- Datenschutz & meine Daten ----------

function category(title, rows) {
  return h('div', { class: 'card' }, h('h3', {}, title),
    h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
}

async function renderPrivacy() {
  const o = await api.invoke('overview');
  const acct = await api.invoke('account:status');
  const s = await api.invoke('settings:get');
  const form = o.encrypted ? 'Mit Windows-Benutzerkonto verschlüsselt (DPAPI)' : 'Unverschlüsselt (Verschlüsselung des Betriebssystems nicht verfügbar)';
  const keep = (days) => (days === 0 ? 'Bis du es selbst löschst' : `${days} Tag(e)`);
  const local = 'Nur auf diesem Gerät';
  const synced = (name) => acct.signedIn && acct.categories[name];
  const readers = (name) => (synced(name)
    ? (acct.mode === 'ultra'
      ? 'Du und jeder mit Zugriff auf dein Windows-Konto. Der Server speichert nur Chiffretext und hat keinen Schlüssel.'
      : 'Du und jeder mit Zugriff auf dein Windows-Konto. Der Server speichert Chiffretext, hält aber eine Treuhandkopie des Schlüssels für die E-Mail-Wiederherstellung. Ein Betreiber mit Zugriff darauf könnte lesen.')
    : 'Du und jeder, der Zugriff auf dein Windows-Konto hat. Aven-Betreiber: niemand, es wird nichts übertragen.');
  const transfer = (name) => (synced(name) ? `Verschlüsselt an ${acct.serverUrl} beim Synchronisieren` : 'Keine');

  const exportButton = (format, label) => h('button', { onclick: async () => {
    const r = await api.invoke('export', format);
    if (r?.ok) toast(`Gespeichert: ${r.path}`);
  } }, label);

  main.replaceChildren(
    ...header('Datenschutz & meine Daten', `Aven ${o.version}. Hier siehst du, was gespeichert wird, wo und wie lange.`),
    h('p', { class: 'note' }, (acct.signedIn ? `Du bist mit ${acct.serverUrl} verbunden (${acct.mode === 'ultra' ? 'Ultra Privacy' : 'normales Konto'}). Nur die Kategorien, die du unter „Konto und Sync“ aktivierst, werden verschlüsselt übertragen.` : 'Du bist nicht angemeldet. Aven sendet keine Daten an eigene Server.') + ' Websites, die du besuchst, erhalten natürlich deine Anfragen und deine IP-Adresse. Aven macht dich beim Surfen nicht anonym.'),
    h('h2', {}, 'Gespeicherte Daten'),
    category(`Spaces und offene Tabs (${o.counts.spaces} / ${o.counts.tabs})`, [
      ['Was', 'Namen der Spaces, Adresse, Titel und Icon der Tabs, damit sie nach einem Neustart zurückkommen'],
      ['Wo', synced('tabs') ? 'Dieses Gerät und beim Sync-Server (verschlüsselt)' : local], ['Form', form], ['Wer kann es lesen', readers('tabs')],
      ['Wie lange', 'Bis du Tabs schließt; nicht angeheftete Tabs wandern nach der eingestellten Frist ins Archiv'],
      ['Übertragung', transfer('tabs')], ['Zurücksetzen', 'Notfallknopf oder Profil zurücksetzen'],
    ]),
    category(`Archiv (${o.counts.archive})`, [
      ['Was', 'Automatisch abgelegte Tabs mit Adresse, Titel und Zeitpunkt'],
      ['Wo', synced('archive') ? 'Dieses Gerät und beim Sync-Server (verschlüsselt)' : local], ['Form', form], ['Wer kann es lesen', readers('archive')],
      ['Wie lange', keep(s.archiveRetentionDays)], ['Übertragung', transfer('archive')],
      ['Löschen', h('a', { href: '#archive' }, 'Archiv öffnen')],
    ]),
    category(`Verlauf (${o.counts.history})`, [
      ['Was', s.historyEnabled ? 'Besuchte Seiten mit Titel, Adresse und Zeitpunkt' : 'Wird zurzeit nicht gespeichert'],
      ['Wo', synced('history') ? 'Dieses Gerät und beim Sync-Server (verschlüsselt)' : local], ['Form', form], ['Wer kann es lesen', readers('history')],
      ['Wie lange', keep(s.historyRetentionDays)], ['Übertragung', transfer('history')],
      ['Löschen', h('a', { href: '#history' }, 'Verlauf öffnen')],
    ]),
    category(`Lesezeichen (${o.counts.bookmarks})`, [
      ['Was', 'Adresse, Titel und Zeitpunkt'], ['Wo', synced('bookmarks') ? 'Dieses Gerät und beim Sync-Server (verschlüsselt)' : local], ['Form', form], ['Wer kann es lesen', readers('bookmarks')],
      ['Wie lange', 'Bis du sie selbst löschst'], ['Übertragung', transfer('bookmarks')],
      ['Löschen', h('a', { href: '#bookmarks' }, 'Lesezeichen öffnen')],
    ]),
    category(`Passwort-Tresor (${o.vault.exists ? (o.vault.unlocked ? o.vault.count : 'gesperrt') : 'nicht eingerichtet'})`, [
      ['Was', 'Zugangsdaten, die du speicherst: Titel, Adresse, Benutzername, Passwort, Notizen'],
      ['Wo', local],
      ['Form', 'Jeder Eintrag einzeln mit AES-256-GCM verschlüsselt. Schlüssel aus Meisterpasswort (scrypt)' + (o.vault.deviceBound ? ' und zusätzlich an dein Windows-Konto gebunden' : '') + '. Ein Wiederherstellungsschlüssel öffnet ihn als zweiter Weg.'],
      ['Wer kann es lesen', 'Nur wer das Meisterpasswort kennt' + (o.vault.deviceBound ? ' und dein Windows-Konto nutzt' : '') + ', oder den Wiederherstellungsschlüssel hat. Der Aven-Betreiber nie.'],
      ['Wie lange', 'Bis du Einträge oder den Tresor löschst'],
      ['Übertragung', 'Keine. Passwörter werden nicht synchronisiert. Nur wenn du ausdrücklich einen Datenleck-Check startest, gehen 5 Zeichen eines Hashes an api.pwnedpasswords.com.'],
      ['Löschen', h('a', { href: '#passwords' }, 'Passwörter öffnen')],
    ]),
    category('Cookies, Cache und Website-Daten', [
      ['Was', 'Anmeldungen und Daten, die Websites in Aven ablegen'],
      ['Wo', local], ['Form', 'Im Profilordner von Aven, nicht zusätzlich verschlüsselt'],
      ['Wer kann es lesen', 'Du, jeder mit Zugriff auf dein Windows-Konto, und die jeweilige Website'],
      ['Wie lange', 'Bis die Website sie löscht oder du es tust'], ['Übertragung', 'An die jeweilige Website bei Besuchen'],
      ['Löschen', h('button', { class: 'small danger', onclick: async () => { await api.invoke('sitedata:clear'); toast('Website-Daten gelöscht'); } }, 'Jetzt löschen')],
    ]),
    category(`Downloads (${o.counts.downloads}) und Berechtigungen (${o.counts.permissions})`, [
      ['Download-Liste', 'Nur im Arbeitsspeicher, wird beim Beenden verworfen. Die Dateien selbst bleiben an dem Ort, den du gewählt hast.'],
      ['Berechtigungen', 'Deine Entscheidungen pro Website, gespeichert wie die Einstellungen'],
    ]),
    h('h2', {}, 'Meine Daten exportieren'),
    h('p', { class: 'lead' }, 'Der Export entsteht lokal auf diesem Gerät. Es gibt keine künstlichen Grenzen.'),
    h('div', { class: 'actions' }, exportButton('json', 'Alles als JSON'), exportButton('csv', 'Verlauf als CSV'), exportButton('html', 'Lesbarer HTML-Bericht')),
    h('h2', {}, 'Grenzen'),
    h('p', { class: 'note' }, `Daten liegen im Ordner ${o.dataDir}. Wer dein entsperrtes Windows-Konto nutzt oder Schadsoftware auf dem Gerät hat, kann Daten lesen. Gelöschte Daten können auf SSDs, in Backups oder in der Auslagerungsdatei Spuren hinterlassen.`));
}

// ---------- Verlauf ----------

async function renderHistory(query = '') {
  const entries = await api.invoke('history:list', { query, limit: 500 });
  const list = h('div', { class: 'list' });
  let day = '';
  for (const e of entries) {
    const d = formatDay(e.visitedAt);
    if (d !== day) { day = d; list.append(h('div', { class: 'day' }, d)); }
    list.append(h('div', { class: 'item' },
      h('a', { class: 'main', href: e.url, target: '_blank' }, h('div', { class: 'title' }, e.title || e.url), h('div', { class: 'meta' }, `${new Date(e.visitedAt).toLocaleTimeString('de-CH', { timeStyle: 'short' })} · ${hostOf(e.url)}`)),
      h('button', { class: 'small', onclick: async () => { await api.invoke('history:delete', e.id); renderHistory(query); } }, 'Entfernen')));
  }
  if (!entries.length) list.append(h('div', { class: 'empty' }, query ? 'Keine Treffer.' : 'Der Verlauf ist leer.'));
  const search = h('input', { type: 'search', placeholder: 'Verlauf durchsuchen', value: query });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderHistory(search.value); });
  main.replaceChildren(
    ...header('Verlauf'),
    search,
    h('div', { class: 'actions' }, h('button', { class: 'danger', onclick: async () => { await api.invoke('history:clear'); renderHistory(); } }, 'Gesamten Verlauf löschen')),
    list);
  if (query) search.focus();
}

// ---------- Lesezeichen ----------

async function renderBookmarks() {
  const items = await api.invoke('bookmarks:list');
  main.replaceChildren(
    ...header('Lesezeichen', 'Mit Strg+D setzt oder entfernst du ein Lesezeichen für die aktuelle Seite.'),
    h('div', { class: 'list' },
      items.length ? items.map((b) => h('div', { class: 'item' },
        h('a', { class: 'main', href: b.url, target: '_blank' }, h('div', { class: 'title' }, b.title || b.url), h('div', { class: 'meta' }, b.url)),
        h('button', { class: 'small', onclick: async () => { await api.invoke('bookmarks:delete', b.id); renderBookmarks(); } }, 'Entfernen')))
        : h('div', { class: 'empty' }, 'Noch keine Lesezeichen.')));
}

// ---------- Archiv ----------

async function renderArchive() {
  const items = await api.invoke('archive:list');
  main.replaceChildren(
    ...header('Archiv', 'Nicht angeheftete Tabs, die nach der eingestellten Frist aus der Seitenleiste verschoben wurden. Das ist kein Verlauf.'),
    items.length ? h('div', { class: 'actions' }, h('button', { class: 'danger', onclick: async () => { await api.invoke('archive:clear'); renderArchive(); } }, 'Archiv leeren')) : null,
    h('div', { class: 'list' },
      items.length ? items.map((a) => h('div', { class: 'item' },
        h('div', { class: 'main' }, h('div', { class: 'title' }, a.title || a.url), h('div', { class: 'meta' }, `${hostOf(a.url)} · archiviert ${formatTime(a.archivedAt)}`)),
        h('button', { class: 'small', onclick: async () => { await api.invoke('archive:restore', a.id); renderArchive(); } }, 'Wiederherstellen'),
        h('button', { class: 'small', onclick: async () => { await api.invoke('archive:delete', a.id); renderArchive(); } }, 'Löschen')))
        : h('div', { class: 'empty' }, 'Das Archiv ist leer.')));
}

// ---------- Downloads ----------

const STATE_LABEL = { progressing: 'Lädt', paused: 'Pausiert', completed: 'Fertig', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };

async function renderDownloads() {
  const items = await api.invoke('downloads:list');
  main.replaceChildren(
    ...header('Downloads', 'Die Liste gilt nur für diese Sitzung. Dateien bleiben an dem Ort, den du gewählt hast.'),
    items.length ? h('div', { class: 'actions' }, h('button', { onclick: async () => { await api.invoke('downloads:clear'); renderDownloads(); } }, 'Liste leeren')) : null,
    h('div', { class: 'list' },
      items.length ? items.map((d) => {
        const done = d.state === 'completed';
        const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
        return h('div', { class: 'item' },
          h('div', { class: 'main' },
            h('div', { class: 'title' }, d.filename),
            h('div', { class: 'meta' }, `${STATE_LABEL[d.state] || d.state} · ${formatSize(d.received)}${d.total > 0 ? ` von ${formatSize(d.total)}` : ''} · ${hostOf(d.url)}`),
            d.state === 'progressing' ? h('div', { class: 'bar' }, h('div', { style: `width:${pct}%` })) : null),
          done ? h('button', { class: 'small', onclick: () => api.invoke('downloads:open', d.id) }, 'Öffnen') : null,
          d.path ? h('button', { class: 'small', onclick: () => api.invoke('downloads:show', d.id) }, 'Im Ordner zeigen') : null,
          d.state === 'progressing' || d.state === 'paused' ? h('button', { class: 'small', onclick: () => api.invoke('downloads:cancel', d.id) }, 'Abbrechen') : null);
      }) : h('div', { class: 'empty' }, 'Keine Downloads.')));
}


// ---------- Konto und Sync ----------

const ERRORS = {
  invalid_credentials: 'E-Mail oder Passwort stimmt nicht.',
  second_factor_required: 'Bitte den Code deines zweiten Faktors eingeben.',
  second_factor_invalid: 'Der Code ist ungültig.',
  exists: 'Diese E-Mail-Adresse ist schon registriert.',
  password_too_short: 'Das Passwort braucht mindestens 10 Zeichen.',
  rate_limited: 'Zu viele Versuche. Bitte später erneut versuchen.',
  account_locked: 'Das Konto ist nach Fehlversuchen vorübergehend gesperrt.',
  network: 'Der Server ist nicht erreichbar.',
  timeout: 'Der Server antwortet nicht.',
  insecure_server_url: 'Die Server-Adresse muss mit https:// beginnen.',
  invalid_server_url: 'Das ist keine gültige Server-Adresse.',
  no_server: 'Bitte zuerst eine Server-Adresse eintragen.',
  normal_mode_unavailable: 'Dieser Server bietet das normale Konto nicht an.',
  registration_closed: 'Auf diesem Server sind keine Registrierungen möglich.',
  invalid_token: 'Der Code ist ungültig oder abgelaufen.',
  invalid_email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  recovery_key_wrong: 'Der Wiederherstellungsschlüssel passt nicht zu diesem Konto.',
  recovery_proof_required: 'Ohne den richtigen Wiederherstellungsschlüssel ist nur das Zurücksetzen mit Datenverlust möglich.',
  step_up_failed: 'Das Passwort stimmt nicht.',
  key_unwrap_failed: 'Die Schlüssel konnten mit diesem Passwort nicht geöffnet werden.',
  export_rate_limited: 'Der letzte Export ist noch zu frisch. Bitte später erneut anfordern.',
  quota_exceeded: 'Der Speicherplatz auf dem Server ist aufgebraucht.',
  invalid_code: 'Der Code ist ungültig.',
  totp_already_enabled: 'Der zweite Faktor ist schon aktiv. Zum Ändern zuerst abschalten, dann neu einrichten.',
  not_ready: 'Der Export ist noch nicht fertig.',
};

// Ruft eine Aktion auf und wirft bei einem Fehler eine verständliche Meldung.
async function call(name, payload) {
  const res = await api.invoke(name, payload);
  if (res && res.__error) {
    const wait = res.retryAfterMs ? ` (in etwa ${Math.ceil(res.retryAfterMs / 60000)} Min.)` : '';
    throw new Error((ERRORS[res.__error] || `Fehler: ${res.__error}`) + (res.status === 429 ? wait : ''));
  }
  return res;
}

function field(label, type, attrs = {}) {
  const input = h('input', { type, autocomplete: 'off', spellcheck: 'false', ...attrs });
  return { input, row: h('label', { class: 'field' }, h('span', {}, label), input) };
}

// Führt einen Schritt aus und zeigt Fehler im Formular an.
function runStep(box, button, fn) {
  return async () => {
    button.disabled = true;
    box.textContent = '';
    try { await fn(); } catch (err) { box.textContent = err.message; }
    button.disabled = false;
  };
}

function recoveryKeyNotice(key, onDone) {
  const confirm = h('input', { type: 'checkbox' });
  const done = h('button', { class: 'primary', disabled: true, onclick: onDone }, 'Weiter');
  confirm.addEventListener('change', () => { done.disabled = !confirm.checked; });
  return h('div', { class: 'card' },
    h('h3', {}, 'Dein Wiederherstellungsschlüssel'),
    h('p', {}, 'Schreibe ihn auf und bewahre ihn getrennt vom Gerät auf. Aven speichert ihn nicht und kann ihn nicht erneut anzeigen. Ohne ihn und ohne Passwort sind deine Sync-Daten unwiederbringlich verloren.'),
    h('p', { class: 'mono' }, key),
    h('label', { class: 'checks' }, confirm, ' Ich habe den Schlüssel sicher gespeichert.'),
    done);
}

async function renderAccount() {
  const s = await call('account:status');
  main.replaceChildren(...header('Konto und Sync', 'Optional. Ohne Konto bleibt alles auf diesem Gerät.'));
  if (!s.signedIn) return renderSignedOut(s);
  return renderSignedIn(s);
}

function serverField(s) {
  return field('Server-Adresse', 'url', { value: s.serverUrl, placeholder: 'https://sync.example.org' });
}

function renderSignedOut(s) {
  const server = serverField(s);
  const tabs = { login: renderLogin, register: renderRegister, recover: renderRecover };
  let current = location.hash.includes('recover') ? 'recover' : 'login';
  const body = h('div');
  const nav = h('div', { class: 'actions' });
  const draw = () => {
    nav.replaceChildren(...[['login', 'Anmelden'], ['register', 'Registrieren'], ['recover', 'Passwort vergessen']].map(([key, label]) =>
      h('button', { class: key === current ? 'primary' : '', onclick: () => { current = key; draw(); } }, label)));
    body.replaceChildren(tabs[current](server.input));
  };
  main.append(
    h('p', { class: 'note' }, 'Aven sendet Daten nur an den Server, den du hier einträgst. Sync-Daten werden vor dem Senden auf deinem Gerät verschlüsselt. Du kannst auch einen eigenen Server betreiben (siehe docs/SERVER.md).'),
    h('div', { class: 'card' }, server.row, nav), body);
  draw();
}

function renderLogin(serverInput) {
  const email = field('E-Mail', 'email');
  const password = field('Passwort', 'password');
  const second = field('Code des zweiten Faktors (nur falls aktiviert)', 'text');
  const error = h('p', { class: 'error' });
  const button = h('button', { class: 'primary' }, 'Anmelden');
  button.addEventListener('click', runStep(error, button, async () => {
    const code = second.input.value.trim();
    const isRecoveryCode = code.length > 6;
    await call('account:login', { serverUrl: serverInput.value, email: email.input.value, password: password.input.value, totp: isRecoveryCode ? undefined : code || undefined, recoveryCode: isRecoveryCode ? code : undefined });
    renderAccount();
  }));
  return h('div', { class: 'card' }, email.row, password.row, second.row, error, button);
}

function renderRegister(serverInput) {
  const email = field('E-Mail', 'email');
  const password = field('Passwort (mindestens 10 Zeichen)', 'password');
  const mode = { value: 'normal' };
  const radio = (value, title, text) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'mode', checked: value === 'normal', onchange: () => { mode.value = value; } }),
    h('span', {}, h('b', {}, title), h('small', {}, text)));
  const error = h('p', { class: 'error' });
  const button = h('button', { class: 'primary' }, 'Konto erstellen');
  const box = h('div');
  button.addEventListener('click', runStep(error, button, async () => {
    const result = await call('account:register', { serverUrl: serverInput.value, email: email.input.value, password: password.input.value, mode: mode.value });
    if (result.recoveryKey) box.replaceChildren(recoveryKeyNotice(result.recoveryKey, renderAccount));
    else renderAccount();
  }));
  return h('div', {},
    h('div', { class: 'card' }, email.row, password.row,
      radio('normal', 'Normales Konto', 'Du kannst dein Passwort vergessen und alle Sync-Daten über deine E-Mail zurückholen. Dafür liegt beim Server eine Treuhandkopie des Schlüssels. Das ist nicht Zero-Knowledge: Wer den Server und dessen Schlüssel kontrolliert, könnte deine Daten lesen.'),
      radio('ultra', 'Ultra Privacy', 'Der Server speichert deine E-Mail nicht im Klartext und hat keinen Schlüssel für deine Daten. Du bekommst einen Wiederherstellungsschlüssel. Ohne Passwort und Schlüssel sind Daten verloren. Das Konto wird nach 180 Tagen ohne Nutzung gelöscht.'),
      error, button),
    box);
}

function renderRecover(serverInput) {
  const box = h('div');
  const email = field('E-Mail', 'email');
  const error = h('p', { class: 'error' });
  const ask = h('button', { class: 'primary' }, 'Code per E-Mail anfordern');
  ask.addEventListener('click', runStep(error, ask, async () => {
    await call('account:recover:request', { serverUrl: serverInput.value, email: email.input.value });
    stepCode(email.input.value);
  }));

  function stepCode(mail) {
    const code = field('Code aus der E-Mail', 'text');
    const second = field('Code des zweiten Faktors (nur falls aktiviert)', 'text');
    const err = h('p', { class: 'error' });
    const go = h('button', { class: 'primary' }, 'Weiter');
    go.addEventListener('click', runStep(err, go, async () => {
      const factor = second.input.value.trim();
      const verified = await call('account:recover:verify', { email: mail, token: code.input.value, secondFactor: factor ? (factor.length > 6 ? { recoveryCode: factor } : { totp: factor }) : undefined });
      stepNewPassword(mail, verified);
    }));
    box.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'Falls die Adresse bei diesem Server registriert ist, wurde ein Code verschickt.'), code.row, second.row, err, go));
  }

  function stepNewPassword(mail, verified) {
    const password = field('Neues Passwort (mindestens 10 Zeichen)', 'password');
    const err = h('p', { class: 'error' });
    const parts = [password.row];
    let key = null;
    const reset = h('input', { type: 'checkbox' });
    if (verified.mode === 'ultra') {
      key = field('Wiederherstellungsschlüssel', 'text', { placeholder: 'XXXX-XXXX-…' });
      parts.push(key.row, h('label', { class: 'checks' }, reset, ' Ich habe den Schlüssel nicht. Zurücksetzen und alle Sync-Daten unwiderruflich löschen.'));
    } else {
      parts.push(h('p', { class: 'note' }, 'Deine Sync-Daten werden wiederhergestellt.'));
    }
    const go = h('button', { class: 'primary' }, 'Passwort setzen');
    go.addEventListener('click', runStep(err, go, async () => {
      const result = await call('account:recover:finish', { email: mail, verified, newPassword: password.input.value, recoveryKeyText: key?.input.value, reset: reset.checked });
      if (result.recoveryKey) box.replaceChildren(recoveryKeyNotice(result.recoveryKey, renderAccount));
      else renderAccount();
    }));
    box.replaceChildren(h('div', { class: 'card' }, ...parts, err, go));
  }

  return h('div', {}, h('div', { class: 'card' }, email.row, error, ask), box);
}

async function renderSignedIn(s) {
  const daysLeft = s.daysUntilDeletion;
  const synced = s.lastSyncAt ? formatTime(s.lastSyncAt) : 'noch nie';
  const status = h('div', { class: 'card' },
    h('h3', {}, 'Verbunden'),
    h('dl', {},
      h('dt', {}, 'Modus'), h('dd', {}, s.mode === 'ultra' ? 'Ultra Privacy' : 'Normales Konto'),
      h('dt', {}, 'Server'), h('dd', {}, s.serverUrl),
      s.email ? [h('dt', {}, 'E-Mail'), h('dd', {}, s.email)] : null,
      h('dt', {}, 'Letzter Sync'), h('dd', {}, synced + (s.lastError ? ` (Fehler: ${ERRORS[s.lastError] || s.lastError})` : '')),
      daysLeft != null ? [h('dt', {}, 'Automatische Löschung'), h('dd', {}, daysLeft <= 30 ? `Achtung: in ${daysLeft} Tagen, wenn du Aven nicht benutzt.` : `in ${daysLeft} Tagen ohne Nutzung`)] : null));
  const syncErr = h('p', { class: 'error' });
  const syncBtn = h('button', {}, 'Jetzt synchronisieren');
  syncBtn.addEventListener('click', runStep(syncErr, syncBtn, async () => { await call('account:sync'); renderAccount(); }));
  const cats = [['spaces', 'Spaces'], ['tabs', 'Offene und angeheftete Tabs'], ['bookmarks', 'Lesezeichen'], ['archive', 'Archiv'], ['settings', 'Ausgewählte Einstellungen'], ['history', 'Verlauf (sensibel, getrennt steuerbar)']];
  const categories = h('div', { class: 'card' }, h('h3', {}, 'Was synchronisiert wird'),
    h('div', { class: 'checks' }, cats.map(([key, label]) => h('label', {}, h('input', { type: 'checkbox', checked: s.categories[key], onchange: (e) => call('account:categories', { [key]: e.target.checked }) }), label))),
    h('p', { class: 'note' }, 'Cookies, Sitzungen und Passwörter werden nie synchronisiert.'), syncErr, syncBtn);

  main.append(status, categories, accountSecurity(s), await accountDevices(), accountExport(), accountDanger(s));
}

function accountSecurity(s) {
  const err = h('p', { class: 'error' });
  const current = field('Aktuelles Passwort', 'password');
  const next = field('Neues Passwort', 'password');
  const change = h('button', {}, 'Passwort ändern');
  change.addEventListener('click', runStep(err, change, async () => {
    await call('account:password', { password: current.input.value, newPassword: next.input.value });
    toast('Passwort geändert');
    current.input.value = next.input.value = '';
  }));

  const totpBox = h('div');
  const totpPassword = field('Passwort bestätigen', 'password');
  const totpErr = h('p', { class: 'error' });
  const totpStart = h('button', {}, 'Zweiten Faktor einrichten');
  totpStart.addEventListener('click', runStep(totpErr, totpStart, async () => {
    const setup = await call('account:totp:setup', totpPassword.input.value);
    const code = field('Code aus deiner Authenticator-App', 'text');
    const codeErr = h('p', { class: 'error' });
    const enable = h('button', { class: 'primary' }, 'Aktivieren');
    enable.addEventListener('click', runStep(codeErr, enable, async () => {
      const res = await call('account:totp:enable', code.input.value);
      totpBox.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Einmalcodes'), h('p', {}, 'Bewahre diese Codes sicher auf. Jeder gilt einmal, falls du dein Gerät verlierst.'), h('p', { class: 'mono' }, res.recoveryCodes.join('  '))));
    }));
    totpBox.replaceChildren(h('div', { class: 'card' },
      h('p', {}, 'Trage dieses Geheimnis in deiner Authenticator-App ein (Zeitbasiert, 6 Stellen):'), h('p', { class: 'mono' }, setup.secret), code.row, codeErr, enable));
  }));

  const modeErr = h('p', { class: 'error' });
  const modePassword = field('Passwort bestätigen', 'password');
  const modeEmail = field('E-Mail (für das normale Konto nötig)', 'email');
  const modeBox = h('div');
  const ultra = s.mode === 'ultra';
  const modeBtn = h('button', {}, ultra ? 'Zu normalem Konto wechseln' : 'Zu Ultra Privacy wechseln');
  modeBtn.addEventListener('click', runStep(modeErr, modeBtn, async () => {
    const res = await call('account:mode', { password: modePassword.input.value, mode: ultra ? 'normal' : 'ultra', email: modeEmail.input.value });
    if (res.recoveryKey) modeBox.replaceChildren(recoveryKeyNotice(res.recoveryKey, renderAccount));
    else renderAccount();
  }));

  return h('div', {},
    h('h2', {}, 'Sicherheit'),
    h('div', { class: 'card' }, h('h3', {}, 'Passwort'), current.row, next.row, err, change),
    h('div', { class: 'card' }, h('h3', {}, 'Zweiter Faktor (TOTP)'), totpPassword.row, totpErr, totpStart), totpBox,
    h('div', { class: 'card' }, h('h3', {}, 'Kontomodus'),
      h('p', { class: 'note' }, ultra
        ? 'Beim Wechsel zum normalen Konto legst du mit deiner Zustimmung eine Treuhandkopie des Schlüssels beim Server an.'
        : 'Beim Wechsel zu Ultra Privacy wird die Treuhandkopie beim Server entfernt. Ältere Sicherungskopien des Betreibers können sie noch bis zu ihrem Ablauf enthalten.'),
      modePassword.row, ultra ? modeEmail.row : null, modeErr, modeBtn), modeBox);
}

async function accountDevices() {
  const res = await call('account:devices').catch(() => ({ devices: [] }));
  return h('div', {}, h('h2', {}, 'Geräte'), h('div', { class: 'list' }, res.devices.map((d) => h('div', { class: 'item' },
    h('div', { class: 'main' }, h('div', { class: 'title' }, d.name + (d.current ? ' (dieses Gerät)' : '')), h('div', { class: 'meta' }, `angemeldet ${formatTime(d.createdAt)} · zuletzt ${formatTime(d.lastSeenAt)}`)),
    d.current ? null : h('button', { class: 'small', onclick: async () => { await call('account:device:revoke', d.id); renderAccount(); } }, 'Abmelden')))));
}

function accountExport() {
  const password = field('Passwort bestätigen', 'password');
  const err = h('p', { class: 'error' });
  const info = h('p', { class: 'note' });
  const button = h('button', {}, 'Cloud-Export anfordern');
  button.addEventListener('click', runStep(err, button, async () => {
    const job = await call('account:export:request', password.input.value);
    info.textContent = 'Export angefordert. Das kann einige Minuten dauern.';
    for (let i = 0; i < 90; i++) {
      const st = await call('account:export:status', job.id);
      if (st.status === 'ready') {
        const saved = await call('account:export:download', job.id);
        info.textContent = saved.ok ? `Gespeichert: ${saved.path}` : 'Abgebrochen.';
        return;
      }
      if (st.status === 'failed' || st.status === 'expired') throw new Error('Der Export ist fehlgeschlagen.');
      await new Promise((r) => setTimeout(r, 2000));
    }
    info.textContent = 'Der Export ist noch in Arbeit. Bitte später erneut versuchen.';
  }));
  return h('div', {}, h('h2', {}, 'Export aus der Cloud'),
    h('div', { class: 'card' }, h('p', {}, 'Der Server liefert nur Chiffretext. Lesbar wird die Datei erst auf diesem Gerät. Ein lokaler Export ohne Konto steht unter „Datenschutz & meine Daten“.'), password.row, err, info, button));
}

function accountDanger(s) {
  const err = h('p', { class: 'error' });
  const logout = h('button', {}, 'Abmelden und lokale Schlüssel verwerfen');
  logout.addEventListener('click', runStep(err, logout, async () => { await call('account:logout'); renderAccount(); }));
  const password = field('Passwort bestätigen', 'password');
  const delErr = h('p', { class: 'error' });
  const del = h('button', { class: 'danger' }, 'Konto und Sync-Daten auf dem Server löschen');
  del.addEventListener('click', runStep(delErr, del, async () => { await call('account:delete', password.input.value); renderAccount(); }));
  return h('div', {}, h('h2', {}, 'Abmelden und Löschen'),
    h('div', { class: 'card' }, h('p', {}, 'Nach dem Abmelden bleiben die Daten auf diesem Gerät, aber es wird nichts mehr synchronisiert.'), err, logout),
    h('div', { class: 'card' }, h('p', {}, 'Das Löschen auf dem Server ist endgültig. Daten auf anderen Geräten bleiben dort lokal erhalten.'), password.row, delErr, del));
}


// ---------- Passwörter ----------

Object.assign(ERRORS, {
  wrong_password: 'Das Meisterpasswort stimmt nicht.',
  too_many_attempts: 'Zu viele Fehlversuche. Bitte warten.',
  master_too_short: 'Das Meisterpasswort braucht mindestens 12 Zeichen.',
  wrong_recovery_key: 'Der Wiederherstellungsschlüssel stimmt nicht.',
  vault_tampered: 'Der Tresor wurde verändert und wird aus Sicherheitsgründen nicht geöffnet. Nutze eine Sicherung.',
  vault_corrupt: 'Die Tresordatei ist beschädigt. Nutze eine Sicherung.',
  device_key_unavailable: 'Der Tresor ist an ein anderes Windows-Konto gebunden. Öffne ihn mit dem Wiederherstellungsschlüssel.',
  locked: 'Der Tresor ist gesperrt.',
  csv_unrecognized: 'Die Datei hat kein bekanntes Format (Spalte „password“ fehlt).',
  csv_too_large: 'Die Datei ist zu groß.',
  invalid_url: 'Die Adresse muss mit http:// oder https:// beginnen.',
  password_required: 'Bitte ein Passwort eingeben.',
  confirm_required: 'Bitte LÖSCHEN eintippen.',
  vault_full: 'Der Tresor ist voll.',
});

const waitText = (ms) => (ms > 60000 ? `${Math.ceil(ms / 60000)} Minuten` : `${Math.ceil(ms / 1000)} Sekunden`);

// Fehler mit Wartezeit zeigen.
async function vaultCall(name, payload) {
  const res = await api.invoke(name, payload);
  if (res && res.__error) {
    const wait = res.retryAfterMs ? ` Nächster Versuch in ${waitText(res.retryAfterMs)}.` : '';
    throw new Error((ERRORS[res.__error] || `Fehler: ${res.__error}`) + wait);
  }
  return res;
}

function strengthMeter(input) {
  const bar = h('div', { class: 'bar' }, h('div', { style: 'width:0%' }));
  const label = h('small', { class: 'muted' });
  let timer = null;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = await api.invoke('vault:strength', input.value);
      bar.firstChild.style.width = `${Math.min(100, Math.round(s.bits / 1.1))}%`;
      bar.firstChild.style.background = s.bits < 40 ? 'var(--danger)' : s.bits < 60 ? '#e0a43a' : 'var(--accent)';
      label.textContent = input.value ? `${s.label} (etwa ${s.bits} Bit)` : '';
    }, 120);
  };
  input.addEventListener('input', update);
  return h('div', { class: 'meter' }, bar, label);
}

async function renderPasswords() {
  const st = await vaultCall('vault:status');
  main.replaceChildren(...header('Passwörter', 'Ein verschlüsselter Tresor nur auf diesem Gerät. Er wird nicht synchronisiert.'));
  if (!st.exists) return vaultSetup(st);
  if (!st.unlocked) return vaultLocked(st);
  return vaultOpen(st);
}

function vaultSetup(st) {
  const master = field('Meisterpasswort (mindestens 12 Zeichen)', 'password');
  const again = field('Meisterpasswort wiederholen', 'password');
  const meter = strengthMeter(master.input);
  const error = h('p', { class: 'error' });
  const button = h('button', { class: 'primary' }, 'Tresor erstellen');
  const box = h('div');
  button.addEventListener('click', runStep(error, button, async () => {
    if (master.input.value !== again.input.value) throw new Error('Die beiden Passwörter sind nicht gleich.');
    const res = await vaultCall('vault:create', master.input.value);
    box.replaceChildren(recoveryKeyNotice(res.recoveryKey, renderPasswords));
  }));
  main.append(
    h('div', { class: 'card' },
      h('h3', {}, 'So wird dein Tresor geschützt'),
      h('ul', { class: 'plain' },
        h('li', {}, 'Jeder Eintrag ist einzeln mit AES-256 verschlüsselt. Auf der Festplatte liegt nie Klartext.'),
        h('li', {}, 'Aus deinem Meisterpasswort wird mit scrypt (128 MiB Speicher) ein Schlüssel abgeleitet. Das bremst Rateversuche stark.'),
        h('li', {}, st.osProtection ? 'Zusätzlich ist der Tresor an dein Windows-Konto gebunden. Eine kopierte Datei ist auf einem anderen Rechner wertlos.' : 'Die Bindung an dein Windows-Konto ist auf diesem System nicht verfügbar.'),
        h('li', {}, 'Er sperrt sich nach Inaktivität, beim Sperren von Windows und im Notfall.'),
        h('li', {}, 'Ausgefüllt wird nur auf deinen Klick und nur auf der passenden Seite.')),
      h('p', { class: 'note' }, 'Vergisst du das Meisterpasswort, kann niemand es zurücksetzen. Dafür bekommst du gleich einen Wiederherstellungsschlüssel.')),
    h('div', { class: 'card' }, master.row, meter, again.row, error, button), box);
}

function vaultLocked(st) {
  const master = field('Meisterpasswort', 'password');
  const error = h('p', { class: 'error' });
  const button = h('button', { class: 'primary' }, 'Entsperren');
  const unlock = runStep(error, button, async () => {
    await vaultCall('vault:unlock', master.input.value);
    master.input.value = '';
    renderPasswords();
  });
  button.addEventListener('click', unlock);
  master.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  const recover = h('div');
  const forgot = h('button', { class: 'small' }, 'Meisterpasswort vergessen');
  forgot.addEventListener('click', () => {
    const key = field('Wiederherstellungsschlüssel', 'text', { placeholder: 'XXXX-XXXX-…' });
    const next = field('Neues Meisterpasswort (mindestens 12 Zeichen)', 'password');
    const err = h('p', { class: 'error' });
    const go = h('button', { class: 'primary' }, 'Zurücksetzen und öffnen');
    go.addEventListener('click', runStep(err, go, async () => {
      await vaultCall('vault:recover', { recoveryKey: key.input.value, newMaster: next.input.value });
      renderPasswords();
    }));
    recover.replaceChildren(h('div', { class: 'card' }, key.row, next.row, strengthMeter(next.input), err, go));
  });
  const notes = [];
  if (st.lockedUntil > Date.now()) notes.push(h('p', { class: 'note' }, `Nach mehreren Fehlversuchen ist das Entsperren bis ${new Date(st.lockedUntil).toLocaleTimeString('de-CH')} gesperrt.`));
  if (st.error) notes.push(h('p', { class: 'error' }, ERRORS[st.error] || st.error));
  main.append(...notes, ...(st.pending ? [pendingBanner(st.pending, false)] : []),
    h('div', { class: 'card' }, h('h3', {}, 'Tresor gesperrt'), master.row, error, h('div', { class: 'actions' }, button, forgot)), recover);
  master.input.focus();
}

function pendingBanner(pending, unlocked) {
  const actions = unlocked
    ? [h('button', { class: 'primary small', onclick: async () => { await vaultCall('vault:savePending'); renderPasswords(); } }, 'Jetzt speichern'),
       h('button', { class: 'small', onclick: async () => { await vaultCall('vault:discardPending'); renderPasswords(); } }, 'Verwerfen')]
    : [];
  return h('div', { class: 'card' }, h('p', {}, `Zum Speichern vorgemerkt: ${pending.username || 'Konto'} auf ${pending.host}.`), h('div', { class: 'actions' }, ...actions),
    unlocked ? null : h('small', { class: 'muted' }, 'Wird nach dem Entsperren angeboten.'));
}

async function vaultOpen(st) {
  const items = await vaultCall('vault:list');
  const listBox = h('div', { class: 'list' });
  const panel = h('div');
  const search = h('input', { type: 'search', placeholder: 'Einträge durchsuchen' });
  let revealTimer = null;

  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((i) => !q || `${i.title} ${i.username} ${i.url}`.toLowerCase().includes(q));
    listBox.replaceChildren(...(shown.length ? shown.map(row) : [h('div', { class: 'empty' }, items.length ? 'Keine Treffer.' : 'Noch keine Einträge. Beim nächsten Anmelden auf einer Seite fragt Aven, ob es das Passwort speichern soll.')]));
  };

  function row(item) {
    const meta = h('div', { class: 'meta' }, [item.username, item.url].filter(Boolean).join(' · '));
    const confirmDelete = h('button', { class: 'small danger' }, 'Löschen');
    let armed = false;
    confirmDelete.addEventListener('click', async () => {
      if (!armed) { armed = true; confirmDelete.textContent = 'Wirklich löschen?'; setTimeout(() => { armed = false; confirmDelete.textContent = 'Löschen'; }, 3000); return; }
      await vaultCall('vault:remove', item.id);
      renderPasswords();
    });
    return h('div', { class: 'item' },
      h('div', { class: 'main' }, h('div', { class: 'title' }, item.title), meta),
      h('button', { class: 'small', onclick: () => vaultCall('vault:copy', { id: item.id, field: 'username' }).then(() => toast('Benutzername kopiert')) }, 'Benutzer'),
      h('button', { class: 'small', onclick: () => vaultCall('vault:copy', { id: item.id, field: 'password' }).then(() => toast('Passwort kopiert, wird nach 30 Sekunden gelöscht')) }, 'Passwort'),
      h('button', { class: 'small', onclick: async () => {
        const full = await vaultCall('vault:get', item.id);
        meta.textContent = full.password;
        meta.classList.add('mono');
        clearTimeout(revealTimer);
        revealTimer = setTimeout(() => { meta.textContent = [item.username, item.url].filter(Boolean).join(' · '); meta.classList.remove('mono'); }, 10000);
      } }, 'Anzeigen'),
      h('button', { class: 'small', onclick: () => editor(item.id) }, 'Bearbeiten'),
      confirmDelete);
  }

  async function editor(id) {
    const existing = id ? await vaultCall('vault:get', id) : { title: '', url: '', username: '', password: '', notes: '', history: [] };
    const title = field('Titel', 'text', { value: existing.title });
    const url = field('Adresse', 'url', { value: existing.url, placeholder: 'https://beispiel.ch' });
    const user = field('Benutzername', 'text', { value: existing.username });
    const pw = field('Passwort', 'password', { value: existing.password });
    const meter = strengthMeter(pw.input);
    const notes = h('textarea', { rows: 3 }, existing.notes);
    const err = h('p', { class: 'error' });
    const info = h('p', { class: 'note', hidden: true });
    const gen = h('button', { class: 'small' }, 'Generieren');
    gen.addEventListener('click', async () => { pw.input.value = await vaultCall('vault:generate', { length: 24 }); pw.input.type = 'text'; pw.input.dispatchEvent(new Event('input')); });
    const show = h('button', { class: 'small' }, 'Zeigen/Verbergen');
    show.addEventListener('click', () => { pw.input.type = pw.input.type === 'password' ? 'text' : 'password'; });
    const breach = id ? h('button', { class: 'small' }, 'Auf Datenlecks prüfen') : null;
    if (breach) {
      breach.addEventListener('click', runStep(err, breach, async () => {
        info.hidden = false;
        info.textContent = 'Es werden nur die ersten 5 Zeichen eines Hashes an api.pwnedpasswords.com gesendet, nie das Passwort.';
        const res = await vaultCall('vault:pwned', id);
        info.textContent = res.count ? `Achtung: Dieses Passwort tauchte ${res.count.toLocaleString('de-CH')} Mal in bekannten Datenlecks auf. Bitte ändern.` : 'Dieses Passwort ist in den bekannten Datenlecks nicht aufgetaucht.';
      }));
    }
    const save = h('button', { class: 'primary' }, id ? 'Speichern' : 'Hinzufügen');
    save.addEventListener('click', runStep(err, save, async () => {
      const data = { title: title.input.value, url: url.input.value, username: user.input.value, password: pw.input.value, notes: notes.value };
      if (id) await vaultCall('vault:update', { id, patch: data });
      else await vaultCall('vault:add', data);
      renderPasswords();
    }));
    panel.replaceChildren(h('div', { class: 'card' },
      h('h3', {}, id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'), title.row, url.row, user.row, pw.row,
      h('div', { class: 'actions tight' }, gen, show, breach), meter,
      h('label', { class: 'field' }, h('span', {}, 'Notizen'), notes),
      existing.history.length ? h('small', { class: 'muted' }, `${existing.history.length} frühere(s) Passwort/Passwörter gespeichert.`) : null,
      info, err, h('div', { class: 'actions' }, save, h('button', { onclick: () => panel.replaceChildren() }, 'Abbrechen'))));
  }

  function generator() {
    const opts = { length: 24, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false };
    const out = h('p', { class: 'mono' });
    const info = h('small', { class: 'muted' });
    const draw = async () => {
      try {
        out.textContent = await vaultCall('vault:generate', opts);
        const s = await api.invoke('vault:strength', out.textContent);
        info.textContent = `${s.label} (etwa ${s.bits} Bit)`;
      } catch (e) { out.textContent = e.message; }
    };
    const check = (key, label) => h('label', {}, h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; draw(); } }), label);
    const length = h('input', { type: 'number', min: 8, max: 128, value: 24, onchange: (e) => { opts.length = Number(e.target.value); draw(); } });
    draw();
    panel.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Passwort-Generator'), out, info,
      h('div', { class: 'checks' }, h('label', {}, 'Länge ', length), check('lower', 'Kleinbuchstaben'), check('upper', 'Großbuchstaben'), check('digits', 'Ziffern'), check('symbols', 'Sonderzeichen'), check('avoidAmbiguous', 'Ähnliche Zeichen vermeiden (O, 0, l, 1)')),
      h('div', { class: 'actions' }, h('button', { onclick: draw }, 'Neu würfeln'), h('button', { onclick: () => { navigator.clipboard?.writeText(out.textContent); toast('Kopiert'); } }, 'Kopieren'),
        h('button', { onclick: () => panel.replaceChildren() }, 'Schließen'))));
  }

  async function audit() {
    const res = await vaultCall('vault:audit');
    const names = (ids) => ids.map((id) => items.find((i) => i.id === id)?.title || '?').join(', ');
    panel.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Sicherheitscheck'),
      h('dl', {},
        h('dt', {}, 'Einträge'), h('dd', {}, String(res.total)),
        h('dt', {}, 'Schwache Passwörter'), h('dd', {}, res.weak.length ? names(res.weak) : 'keine'),
        h('dt', {}, 'Mehrfach verwendet'), h('dd', {}, res.reused.length ? res.reused.map(names).join(' | ') : 'keine'),
        h('dt', {}, 'Älter als ein Jahr'), h('dd', {}, res.old.length ? names(res.old) : 'keine')),
      h('p', { class: 'note' }, 'Die Prüfung läuft lokal. Ob ein Passwort in einem Datenleck vorkommt, prüfst du pro Eintrag beim Bearbeiten.'),
      h('button', { onclick: () => panel.replaceChildren() }, 'Schließen')));
  }

  const importBtn = h('button', {}, 'CSV importieren');
  const importMsg = h('p', { class: 'note', hidden: true });
  importBtn.addEventListener('click', async () => {
    try {
      const res = await vaultCall('vault:import');
      if (res.canceled) return;
      importMsg.hidden = false;
      importMsg.textContent = `${res.added} importiert, ${res.skipped} schon vorhanden, ${res.invalid} übersprungen. Lösche die CSV-Datei danach, sie enthält Klartext-Passwörter.`;
      setTimeout(renderPasswords, 4000);
    } catch (e) { importMsg.hidden = false; importMsg.textContent = e.message; }
  });
  const backupBtn = h('button', {}, 'Sicherung');
  backupBtn.addEventListener('click', async () => { const r = await vaultCall('vault:backup'); if (r.ok) toast(`Gespeichert: ${r.path}`); });

  search.addEventListener('input', drawList);
  main.append(
    ...(st.pending ? [pendingBanner(st.pending, true)] : []),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => editor(null) }, 'Neuer Eintrag'), h('button', { onclick: generator }, 'Generator'), h('button', { onclick: audit }, 'Sicherheitscheck'),
      importBtn, backupBtn, h('button', { onclick: async () => { await vaultCall('vault:lock'); renderPasswords(); } }, 'Jetzt sperren')),
    importMsg, panel, h('div', { style: 'margin-top:16px' }, search), listBox, vaultSettings(st));
  drawList();
}

function vaultSettings(st) {
  const current = field('Aktuelles Meisterpasswort', 'password');
  const next = field('Neues Meisterpasswort (mindestens 12 Zeichen)', 'password');
  const err = h('p', { class: 'error' });
  const change = h('button', {}, 'Meisterpasswort ändern');
  change.addEventListener('click', runStep(err, change, async () => {
    await vaultCall('vault:changeMaster', { oldPassword: current.input.value, newPassword: next.input.value });
    current.input.value = next.input.value = '';
    toast('Meisterpasswort geändert');
  }));
  const keyBox = h('div');
  const rotateErr = h('p', { class: 'error' });
  const rotate = h('button', {}, 'Neuen Wiederherstellungsschlüssel erzeugen');
  rotate.addEventListener('click', runStep(rotateErr, rotate, async () => {
    const res = await vaultCall('vault:rotateRecovery');
    keyBox.replaceChildren(recoveryKeyNotice(res.recoveryKey, () => keyBox.replaceChildren()));
  }));
  const confirm = field('Zur Bestätigung LÖSCHEN eintippen', 'text');
  const delErr = h('p', { class: 'error' });
  const del = h('button', { class: 'danger' }, 'Tresor unwiderruflich löschen');
  del.addEventListener('click', runStep(delErr, del, async () => { await vaultCall('vault:destroy', { confirm: confirm.input.value }); renderPasswords(); }));
  return h('div', {},
    h('h2', {}, 'Tresor-Einstellungen'),
    setting('Automatisch sperren nach', 'Zusätzlich sperrt sich der Tresor beim Sperren von Windows und im Ruhezustand.',
      select([[1, '1 Minute'], [5, '5 Minuten'], [15, '15 Minuten'], [30, '30 Minuten'], [60, '60 Minuten']], st.autoLockMinutes, (v) => vaultCall('vault:autolock', v).then(() => toast('Gespeichert')))),
    h('div', { class: 'card' }, h('h3', {}, 'Meisterpasswort'), current.row, next.row, err, change),
    h('div', { class: 'card' }, h('h3', {}, 'Wiederherstellungsschlüssel'), h('p', {}, 'Der bisherige Schlüssel wird dabei ungültig.'), rotateErr, rotate), keyBox,
    h('div', { class: 'card' }, h('h3', {}, 'Löschen'), h('p', {}, 'Entfernt den Tresor und die automatische Sicherungskopie von diesem Gerät. Eigene Sicherungsdateien bleiben bestehen.'), confirm.row, delErr, del),
    h('p', { class: 'note' }, 'Ehrliche Grenzen: Wer dein entsperrtes Windows-Konto nutzt, während der Tresor offen ist, oder Schadsoftware mit Zugriff auf den Arbeitsspeicher hat, kann Passwörter abgreifen. Aven gibt Schlüssel beim Sperren frei, JavaScript kann Texte im Speicher aber nicht zuverlässig überschreiben. Ausgefüllte Passwörter sieht auch die Webseite selbst.'));
}

// ---------- Routing ----------

const pages = { settings: renderSettings, account: renderAccount, passwords: renderPasswords, privacy: renderPrivacy, history: () => renderHistory(), bookmarks: renderBookmarks, archive: renderArchive, downloads: renderDownloads };
let refreshTimer = null;

function route() {
  const name = pages[location.hash.slice(1)] ? location.hash.slice(1) : 'settings';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  clearInterval(refreshTimer);
  pages[name]();
  if (name === 'downloads') refreshTimer = setInterval(renderDownloads, 1000);
}

if (api) {
  window.addEventListener('hashchange', route);
  route();
} else {
  main.textContent = 'Diese Seite ist nur innerhalb von Aven verfügbar.';
}
