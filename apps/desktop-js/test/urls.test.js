const test = require('node:test');
const assert = require('node:assert');
const { normalizeInput } = require('../src/main/urls');

test('Domains bekommen https', () => {
  assert.strictEqual(normalizeInput('example.com/a?b=1'), 'https://example.com/a?b=1');
});
test('localhost bekommt http', () => {
  assert.strictEqual(normalizeInput('localhost:3000'), 'http://localhost:3000');
});
test('Freitext wird gesucht', () => {
  assert.strictEqual(normalizeInput('hallo welt'), 'https://duckduckgo.com/?q=hallo%20welt');
});
test('gefährliche Schemas werden abgelehnt', () => {
  assert.strictEqual(normalizeInput('javascript://x'), null);
  assert.strictEqual(normalizeInput('chrome://settings'), null);
});
test('leere Eingabe', () => {
  assert.strictEqual(normalizeInput('  '), null);
});

test('interne aven://-Adressen', () => {
  const { internalUrl } = require('../src/main/urls');
  assert.strictEqual(normalizeInput('aven://history'), internalUrl('history'));
  assert.strictEqual(normalizeInput('aven://gibtesnicht'), null);
});

test('isInternalUrl erkennt nur die exakte lokale Seite', () => {
  const { isInternalUrl, internalUrl, PAGES_URL } = require('../src/main/urls');
  assert.strictEqual(isInternalUrl(internalUrl('passwords')), true);
  assert.strictEqual(isInternalUrl(PAGES_URL), true);
  assert.strictEqual(isInternalUrl('https://evil.example/pages/aven.html#passwords'), false);
  assert.strictEqual(isInternalUrl('file:///C:/evil/pages/aven.html#passwords'), false);
  assert.strictEqual(isInternalUrl(PAGES_URL + 'x#passwords'), false);
});
