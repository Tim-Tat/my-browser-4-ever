'use strict';

const path = require('node:path');
const { BrowserWindow, WebContentsView } = require('electron');

const SIDEBAR_WIDTH = 240;
const START_URL = 'https://www.wikipedia.org/';

const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    title: 'Aven',
    backgroundColor: '#0b0b14',
    webPreferences: SECURE_WEB_PREFERENCES,
  });

  // Statische Sidebar (eigene Oberfläche, lokale Datei)
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Webseiten-Inhalt in eigener Ansicht, ohne Zugriff auf Node/Electron
  const page = new WebContentsView({ webPreferences: SECURE_WEB_PREFERENCES });
  win.contentView.addChildView(page);

  // Keine zusätzlichen Fenster in Phase 0
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const layout = () => {
    const { width, height } = win.getContentBounds();
    page.setBounds({
      x: SIDEBAR_WIDTH,
      y: 0,
      width: Math.max(width - SIDEBAR_WIDTH, 0),
      height,
    });
  };
  layout();
  win.on('resize', layout);

  page.webContents.loadURL(START_URL);

  return { win, page };
}

module.exports = { createMainWindow, SIDEBAR_WIDTH, START_URL };
