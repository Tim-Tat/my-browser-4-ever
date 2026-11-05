const $ = (id) => document.getElementById(id);
const address = $('address');
let state = null;
let renamingId = null;

const act = (name, payload) => window.aven.invoke(name, payload);

function isNewTab(url) {
  return !url || url.endsWith('/newtab.html');
}

function isInternal(url) {
  return /[/]pages[/]aven[.]html(#|$)/.test(url || '');
}

// Adresse, wie sie in der Adressleiste erscheint.
function displayUrl(url) {
  if (isNewTab(url)) return '';
  if (isInternal(url)) return 'aven://' + (url.split('#')[1] || 'settings');
  return url;
}

function favicon(tab) {
  if (isNewTab(tab.url) || isInternal(tab.url)) {
    const img = document.createElement('img');
    img.className = 'fav logo-fav';
    img.src = '../../assets/logo/favicon.svg';
    return img;
  }
  if (tab.favicon) {
    const img = document.createElement('img');
    img.className = 'fav';
    img.src = tab.favicon;
    img.onerror = () => img.replaceWith(letter(tab));
    return img;
  }
  return letter(tab);
}

function letter(tab) {
  const el = document.createElement('span');
  el.className = 'fav letter';
  el.textContent = (tab.title || hostOf(tab.url) || 'A').trim().charAt(0).toUpperCase();
  return el;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function titleOf(tab) {
  if (isNewTab(tab.url)) return 'Neuer Tab';
  return tab.title || hostOf(tab.url) || tab.url;
}

function render() {
  if (!state) return;
  document.body.classList.toggle('collapsed', state.sidebarCollapsed);
  const inSpace = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
  const pins = $('pins');
  const tabs = $('tabs');
  pins.replaceChildren();
  tabs.replaceChildren();

  for (const tab of inSpace) {
    const active = tab.id === state.activeTabId;
    const el = document.createElement('div');
    el.className = `${tab.pinned ? 'pin' : 'tab'}${active ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
    el.title = titleOf(tab);
    el.addEventListener('click', () => act('selectTab', tab.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) act('closeTab', tab.id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); act('tabMenu', tab.id); });
    el.append(favicon(tab));
    if (!tab.pinned) {
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = titleOf(tab);
      const close = document.createElement('button');
      close.className = 'close';
      close.innerHTML = "<svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m5 5 14 14M19 5 5 19\"/></svg>";
      close.title = 'Tab schließen';
      close.addEventListener('click', (e) => { e.stopPropagation(); act('closeTab', tab.id); });
      el.append(title, close);
    }
    (tab.pinned ? pins : tabs).append(el);
  }

  renderSpaces();

  const current = state.tabs.find((t) => t.id === state.activeTabId);
  $('back').disabled = !current?.canGoBack;
  $('forward').disabled = !current?.canGoForward;
  $('reload').classList.toggle('busy', !!current?.loading);
  $('reload').title = current?.loading ? 'Laden stoppen' : 'Neu laden (Strg+R)';
  if (document.activeElement !== address) address.value = current ? displayUrl(current.url) : '';

  $('bookmark').classList.toggle('on', !!state.bookmarked);
  $('bookmark').disabled = !current || isNewTab(current.url) || isInternal(current.url);
  $('downloads').hidden = !state.downloadsActive;
  const vaultBtn = $('vault');
  vaultBtn.classList.toggle('on', state.vault.unlocked && state.vault.matches > 0);
  vaultBtn.classList.toggle('locked', state.vault.exists && !state.vault.unlocked);
  vaultBtn.title = !state.vault.exists ? 'Passwort-Tresor einrichten' : !state.vault.unlocked ? 'Passwort-Tresor ist gesperrt' : state.vault.matches ? 'Zugangsdaten ausfüllen' : 'Passwort-Tresor';
  const panicBtn = $('panic');
  panicBtn.hidden = !state.panic.enabled;
  panicBtn.style.setProperty('--hold', state.panic.holdMs + 'ms');
}

function renderSpaces() {
  const box = $('spaces');
  box.replaceChildren();
  for (const space of state.spaces) {
    const el = document.createElement('div');
    el.className = `space${space.id === state.activeSpaceId ? ' active' : ''}`;
    el.title = space.name;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = space.color;
    el.append(dot);

    if (renamingId === space.id) {
      const input = document.createElement('input');
      input.value = space.name;
      input.maxLength = 30;
      const finish = (save) => {
        if (renamingId !== space.id) return;
        renamingId = null;
        if (save) act('renameSpace', { id: space.id, name: input.value });
        render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      el.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
    } else {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = space.name;
      el.append(name);
      el.addEventListener('click', () => act('switchSpace', space.id));
      el.addEventListener('dblclick', () => { renamingId = space.id; render(); });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); act('spaceMenu', space.id); });
    }
    box.append(el);
  }
}

address.addEventListener('focus', () => address.select());
address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    act('navigate', { input: address.value });
    address.blur();
  } else if (e.key === 'Escape') {
    address.blur();
    render();
  }
});
address.addEventListener('blur', render);

$('new-tab').addEventListener('click', () => act('newTab'));
$('new-space').addEventListener('click', () => act('newSpace'));
$('back').addEventListener('click', () => act('back'));
$('forward').addEventListener('click', () => act('forward'));
$('reload').addEventListener('click', () => act('reload'));
$('toggle-sidebar').addEventListener('click', () => act('toggleSidebar'));
$('bookmark').addEventListener('click', () => act('toggleBookmark'));
$('downloads').addEventListener('click', () => act('openPage', 'downloads'));
$('menu').addEventListener('click', () => act('mainMenu'));
$('vault').addEventListener('click', () => act('vaultMenu'));

// Notfallknopf: nur durch bewusstes Gedrückthalten auslösen
const panicBtn = $('panic');
let panicTimer = null;
function cancelPanic() {
  clearTimeout(panicTimer);
  panicBtn.classList.remove('holding');
}
panicBtn.addEventListener('pointerdown', () => {
  panicBtn.classList.add('holding');
  panicTimer = setTimeout(() => { cancelPanic(); act('panic'); }, state.panic.holdMs);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) panicBtn.addEventListener(type, cancelPanic);

// Suche auf der Seite
const toolbar = $('toolbar');
const findInput = $('find-input');
function openFind() {
  $('findbar').hidden = false;
  toolbar.dataset.find = '1';
  findInput.focus();
  findInput.select();
}
function closeFind() {
  $('findbar').hidden = true;
  delete toolbar.dataset.find;
  $('find-count').textContent = '';
  act('stopFind');
}
const findNext = (forward) => findInput.value && act('find', { text: findInput.value, forward, next: true });
findInput.addEventListener('input', () => {
  $('find-count').textContent = '';
  act('find', { text: findInput.value });
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findNext(!e.shiftKey);
  if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => findNext(true));
$('find-prev').addEventListener('click', () => findNext(false));
$('find-close').addEventListener('click', closeFind);

// Einführung beim ersten Start: Willkommen, optionales Konto, kurzes Tutorial
const intro = $('intro');
const TOUR = [
  { title: 'Tabs, Spaces und Pins', items: ['Tabs stehen links. Mit <kbd>Strg</kbd>+<kbd>T</kbd> öffnest du einen neuen.', 'Spaces trennen Themen, zum Beispiel Arbeit und Privat. Unten links wechselst du oder legst neue an.', 'Rechtsklick auf einen Tab: anheften, duplizieren, schließen.'] },
  { title: 'Archiv, Suche, Lesezeichen', items: ['Nicht angeheftete Tabs wandern nach 12 Stunden ins Archiv. Nichts geht verloren.', '<kbd>Strg</kbd>+<kbd>F</kbd> sucht auf der Seite, <kbd>Strg</kbd>+<kbd>D</kbd> setzt ein Lesezeichen, <kbd>Strg</kbd>+<kbd>H</kbd> öffnet den Verlauf.', 'Das Menü (drei Punkte) führt zu allen Bereichen.'] },
  { title: 'Deine Daten, deine Regeln', items: ['Unter „Datenschutz & meine Daten“ siehst du, was gespeichert wird, wo und wie lange.', 'Verlauf und Archiv kannst du begrenzen, löschen und exportieren.', 'Optional gibt es einen Notfallknopf oben rechts. Du richtest ihn in den Einstellungen ein.'] },
];
let tourIndex = 0;

function showStep(name) {
  intro.querySelectorAll('.step').forEach((el) => el.classList.toggle('on', el.dataset.step === name));
}

function drawTour() {
  const slide = TOUR[tourIndex];
  const box = $('tour');
  box.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = slide.title;
  const list = document.createElement('ul');
  for (const item of slide.items) {
    const li = document.createElement('li');
    // Nur feste, selbst geschriebene Texte mit <kbd>; keine fremden Inhalte.
    li.innerHTML = item;
    list.append(li);
  }
  box.append(title, list);
  $('tour-dots').replaceChildren(...TOUR.map((_, i) => Object.assign(document.createElement('span'), { className: i === tourIndex ? 'on' : '' })));
  $('tour-prev').disabled = tourIndex === 0;
  $('tour-next').textContent = tourIndex === TOUR.length - 1 ? 'Starten' : 'Weiter';
}

function closeIntro() {
  intro.classList.add('hide');
  act('setOverlay', false);
  try { localStorage.setItem('aven-intro-seen', '1'); } catch {}
  setTimeout(() => { intro.hidden = true; intro.classList.remove('hide'); }, 600);
}

function openIntro() {
  tourIndex = 0;
  drawTour();
  showStep('welcome');
  intro.hidden = false;
  intro.classList.remove('hide');
  act('setOverlay', true);
}

const INTRO_ERRORS = {
  invalid_credentials: 'E-Mail oder Passwort stimmt nicht.', exists: 'Diese E-Mail-Adresse ist schon registriert.',
  password_too_short: 'Das Passwort braucht mindestens 10 Zeichen.', network: 'Der Server ist nicht erreichbar.',
  timeout: 'Der Server antwortet nicht.', insecure_server_url: 'Die Server-Adresse muss mit https:// beginnen.',
  invalid_server_url: 'Das ist keine gültige Server-Adresse.', no_server: 'Bitte eine Server-Adresse eintragen.',
  normal_mode_unavailable: 'Dieser Server bietet das normale Konto nicht an.', registration_closed: 'Hier sind keine Registrierungen möglich.',
  rate_limited: 'Zu viele Versuche. Bitte später erneut.', invalid_email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  second_factor_required: 'Für dieses Konto ist ein zweiter Faktor aktiv. Melde dich unter Einstellungen > Konto an.',
};
let registering = false;
function setRegistering(on) {
  registering = on;
  $('intro-tab-login').classList.toggle('on', !on);
  $('intro-tab-register').classList.toggle('on', on);
  $('intro-modes').hidden = !on;
  $('intro-submit').textContent = on ? 'Konto erstellen' : 'Anmelden';
  $('intro-error').textContent = '';
}

intro.querySelectorAll('[data-step="welcome"] [data-next]').forEach((b) => b.addEventListener('click', () => showStep('account')));
$('intro-tab-login').addEventListener('click', () => setRegistering(false));
$('intro-tab-register').addEventListener('click', () => setRegistering(true));
$('intro-skip-account').addEventListener('click', () => showStep('tutorial'));
$('intro-submit').addEventListener('click', async () => {
  const button = $('intro-submit');
  const error = $('intro-error');
  button.disabled = true;
  error.textContent = '';
  const payload = {
    serverUrl: $('intro-server').value, email: $('intro-email').value, password: $('intro-password').value,
    mode: intro.querySelector('input[name="intro-mode"]:checked').value,
  };
  const result = await act(registering ? 'account:register' : 'account:login', payload);
  button.disabled = false;
  if (result && result.__error) {
    error.textContent = INTRO_ERRORS[result.__error] || `Fehler: ${result.__error}`;
    return;
  }
  $('intro-password').value = '';
  if (result.recoveryKey) {
    $('intro-key').textContent = result.recoveryKey;
    showStep('recovery');
  } else {
    showStep('tutorial');
  }
});
$('intro-key-saved').addEventListener('change', (e) => { $('intro-key-next').disabled = !e.target.checked; });
$('intro-key-next').addEventListener('click', () => { $('intro-key').textContent = ''; showStep('tutorial'); });
$('tour-prev').addEventListener('click', () => { tourIndex = Math.max(0, tourIndex - 1); drawTour(); });
$('tour-next').addEventListener('click', () => {
  if (tourIndex === TOUR.length - 1) closeIntro();
  else { tourIndex += 1; drawTour(); }
});
$('tour-skip').addEventListener('click', closeIntro);
intro.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('intro-submit').click(); });

let seen = false;
try { seen = localStorage.getItem('aven-intro-seen') === '1'; } catch {}
if (seen) intro.hidden = true;
else openIntro();

window.aven.onState((s) => { state = s; render(); });
window.aven.onEvent((name, data) => {
  if (name === 'focus-address') { closeFind(); address.focus(); }
  if (name === 'find') openFind();
  if (name === 'show-intro') openIntro();
  if (name === 'find-result') $('find-count').textContent = data.matches ? `${data.active} von ${data.matches}` : 'Keine Treffer';
  if (name === 'rename-space') { renamingId = data; render(); }
});
act('getState').then((s) => { if (s) { state = s; render(); } });
