'use strict';

// Lokaler Wegwerf-Test: Blockiert Google die Anmeldung in Electron?
// Nicht Teil der App und nicht zum Committen gedacht.
//
//   npx electron spike/google-login-test.js --ua=standard
//   npx electron spike/google-login-test.js --ua=bereinigt
//
// Die Session liegt nur im Arbeitsspeicher: Nach dem Schliessen ist die Anmeldung weg.
// Geloggt werden nur Host und Pfad, keine Parameter und keine Seitentitel.

const { app, BrowserWindow, WebContentsView, session } = require('electron');

const START_URL = 'https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/';
const SMOKE_MS = 12000;

const uaArg = process.argv.find((arg) => arg.startsWith('--ua='));
const mode = uaArg ? uaArg.slice('--ua='.length) : 'standard';
const smoke = process.argv.includes('--smoke');

if (mode !== 'standard' && mode !== 'bereinigt') {
  console.error('Unbekannter Modus. Erlaubt: --ua=standard oder --ua=bereinigt');
  process.exit(1);
}

// Entfernt alle Produkt-Tokens ausser den üblichen Chromium-Angaben.
function cleanUserAgent(userAgent) {
  return userAgent
    .split(' ')
    .filter((part) => !/^[^/()]+\/\S+$/.test(part) || /^(Mozilla|AppleWebKit|Chrome|Safari)\//.test(part))
    .join(' ');
}

function logUrl(label, url) {
  const { host, pathname } = new URL(url);
  const blocked = /rejected/.test(pathname) ? '  <-- GOOGLE HAT BLOCKIERT' : '';
  console.log(`[${label}] ${host}${pathname}${blocked}`);
}

app.whenReady().then(() => {
  const ses = session.fromPartition('spike-google-login');
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.log(`[Berechtigung verweigert] ${permission}`);
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);

  if (mode === 'bereinigt') ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  console.log(`[Modus] ${mode}`);
  console.log(`[User-Agent] ${ses.getUserAgent()}`);

  const win = new BrowserWindow({ width: 1100, height: 800, title: `Google-Login-Test: ${mode}` });
  win.removeMenu();

  const page = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: ses },
  });
  win.contentView.addChildView(page);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    page.setBounds({ x: 0, y: 0, width, height });
  };
  layout();
  win.on('resize', layout);

  const { webContents } = page;
  webContents.setWindowOpenHandler(({ url }) => {
    logUrl('Popup verweigert', url);
    return { action: 'deny' };
  });
  webContents.on('did-navigate', (_event, url) => logUrl('Seite', url));
  webContents.on('did-navigate-in-page', (_event, url) => logUrl('Seite', url));
  webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.log(`[Ladefehler] ${code} ${description}`);
  });

  webContents.loadURL(START_URL);
  if (smoke) setTimeout(() => app.quit(), SMOKE_MS);
});

app.on('window-all-closed', () => app.quit());
