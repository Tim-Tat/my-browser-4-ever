const path = require('path');
const { pathToFileURL } = require('url');

const SEARCH_URL = 'https://duckduckgo.com/?q=';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

const PAGES_URL = pathToFileURL(path.join(__dirname, '..', 'pages', 'aven.html')).href;
const INTERNAL_PAGES = ['settings', 'account', 'privacy', 'history', 'bookmarks', 'archive', 'downloads', 'passwords'];

const internalUrl = (name) => `${PAGES_URL}#${name}`;
// Nur die eigene lokale Datei, optional mit #Seite. Kein bloßes Präfix und keine Pfadteile.
const isInternalUrl = (url) => typeof url === 'string' && (url === PAGES_URL || url.startsWith(`${PAGES_URL}#`));

// Wandelt Eingaben der Adressleiste in eine ladbare URL um.
function normalizeInput(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  const internal = /^aven:\/\/([a-z]+)\/?$/i.exec(input);
  if (internal) {
    const name = internal[1].toLowerCase();
    return INTERNAL_PAGES.includes(name) ? internalUrl(name) : null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    return isAllowedUrl(input) ? input : null;
  }
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#].*)?$/i.test(input)) {
    return 'http://' + input;
  }
  if (!/\s/.test(input) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(input)) {
    return 'https://' + input;
  }
  return SEARCH_URL + encodeURIComponent(input);
}

function isAllowedUrl(url) {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

module.exports = { normalizeInput, isAllowedUrl, isInternalUrl, internalUrl, originOf, PAGES_URL, INTERNAL_PAGES, SEARCH_URL };
