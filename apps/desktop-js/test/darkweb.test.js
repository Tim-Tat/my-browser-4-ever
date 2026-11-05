const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TorManager, buildTorrc, parseBootstrap, findTorBinary, sha256File } = require('../src/main/darkweb/tor');
const { Container } = require('../src/main/darkweb/container');

const FAKE_TOR = path.join(__dirname, 'fixtures', 'fake-tor.js');
const FAST_KDF = { name: 'scrypt', N: 1024, r: 8, p: 1 };
const PASS = 'eine-lange-darkweb-passphrase';

const fakeDevice = (key = crypto.randomBytes(32)) => ({
  isAvailable: () => true,
  encrypt(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, c.update(buf), c.final(), c.getAuthTag()]); },
  decrypt(buf) { const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(buf.length - 16)); return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]); },
});

test('torrc: nur lokaler SOCKS-Port, keine Steuerverbindung, Bridges nur ohne Zeilenumbrüche', () => {
  const rc = buildTorrc({ port: 9150, dataDir: 'C:/tmp/x', bridges: ['obfs4 1.2.3.4:443 ABC cert=x iat-mode=0', 'evil\nControlPort 9051'] });
  assert.match(rc, /^SocksPort 127\.0\.0\.1:9150 IsolateSOCKSAuth/m);
  assert.match(rc, /^ControlPort 0$/m);
  assert.match(rc, /^UseBridges 1$/m);
  assert.ok(!/^ControlPort 9051/m.test(rc), 'Einschleusen von Konfiguration wird verhindert');
  assert.ok(!buildTorrc({ port: 1, dataDir: 'x' }).includes('UseBridges'));
});

test('Bootstrap-Ausgabe lesen', () => {
  assert.strictEqual(parseBootstrap('Nov 04 12:00:01.000 [notice] Bootstrapped 45% (loading_status): Loading'), 45);
  assert.strictEqual(parseBootstrap('Bootstrapped 100% (done): Done'), 100);
  assert.strictEqual(parseBootstrap('irgendwas anderes'), null);
});

test('Tor-Programm finden: eingestellter Pfad vor Aven-Ordner vor PATH', () => {
  const present = new Set(['C:/aven/tor/tor.exe', 'C:/bin/tor.exe', 'D:/mein/tor.exe']);
  const exists = (f) => present.has(f.replace(/\\/g, '/'));
  const base = { userDataDir: 'C:/aven', env: { PATH: 'C:/bin' }, platform: 'win32', exists };
  assert.strictEqual(findTorBinary({ ...base, configured: 'D:/mein/tor.exe' }), 'D:/mein/tor.exe');
  assert.strictEqual(findTorBinary(base).replace(/\\/g, '/'), 'C:/aven/tor/tor.exe');
  assert.strictEqual(findTorBinary({ ...base, userDataDir: 'C:/leer' }).replace(/\\/g, '/'), 'C:/bin/tor.exe');
  assert.strictEqual(findTorBinary({ ...base, userDataDir: 'C:/leer', env: { PATH: '' } }), null);
});

test('Hash einer Datei', async () => {
  const file = path.join(os.tmpdir(), `hash-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(file, 'abc');
  assert.strictEqual(await sha256File(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  fs.rmSync(file);
});

test('Tor-Prozess: Start bis bereit, Stopp räumt auf', async () => {
  const tor = new TorManager({ command: process.execPath, prefixArgs: [FAKE_TOR] });
  const states = [];
  tor.on('status', (s) => states.push(s.state));
  const status = await tor.start('ignoriert');
  assert.strictEqual(status.state, 'ready');
  assert.ok(status.port > 0);
  const dir = tor.dataDir;
  assert.ok(fs.existsSync(dir));
  await tor.stop();
  assert.strictEqual(tor.status().state, 'stopped');
  assert.ok(!fs.existsSync(dir), 'temporärer Ordner ist weg');
  assert.ok(states.includes('starting') && states.includes('ready'));
});

test('Tor-Prozess: unerwartetes Ende führt zu "failed"', async () => {
  const tor = new TorManager({ command: process.execPath, prefixArgs: [FAKE_TOR] });
  await tor.start('x');
  tor.proc.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(tor.status().state, 'failed');
  assert.strictEqual(tor.status().port, null);
});

test('Tor-Prozess: fehlendes Programm und Zeitüberschreitung', async () => {
  const missing = new TorManager({ command: path.join(os.tmpdir(), 'gibt-es-nicht.exe') });
  await assert.rejects(missing.start('x'), /nicht gestartet/);
  assert.strictEqual(missing.status().state, 'failed');
  const silent = new TorManager({ command: process.execPath, prefixArgs: [path.join(__dirname, 'fixtures', 'silent-tor.js')], startupTimeoutMs: 300 });
  await assert.rejects(silent.start('x'), /nicht rechtzeitig/);
  assert.strictEqual(silent.status().state, 'failed');
});

function containerSetup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aven-dw-'));
  const file = path.join(dir, 'container.json');
  return { dir, file, make: (extra = {}) => new Container(file, { kdf: FAST_KDF, ...opts, ...extra }) };
}

test('Container: Daten verschlüsselt, ohne Klartext, nach Sperre unlesbar', async () => {
  const { dir, file, make } = containerSetup({ deviceWrap: fakeDevice() });
  try {
    const c = make();
    await c.create(PASS, { bookmarks: [{ id: '1', url: 'http://geheim.onion', title: 'Versteckt' }] });
    c.lock();
    assert.strictEqual(c.data, null);
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('geheim.onion') && !raw.includes('Versteckt'));
    await assert.rejects(c.create(PASS), { code: 'exists' });
    await assert.rejects(containerSetup().make().create('kurz'), { code: 'passphrase_too_short' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Container: beide Hüllen nötig (Passphrase und Windows-Konto)', async () => {
  const device = fakeDevice();
  const { dir, make } = containerSetup({ deviceWrap: device });
  try {
    const c = make();
    await c.create(PASS, { bookmarks: [{ id: '1' }] });
    c.lock();
    await assert.rejects(c.unlock('falsche-passphrase-123'), { code: 'wrong_password' });
    await c.unlock(PASS);
    assert.strictEqual(c.data.bookmarks.length, 1);
    c.save({ bookmarks: [{ id: '1' }, { id: '2' }] });
    c.lock();
    await assert.rejects(make({ deviceWrap: fakeDevice() }).unlock(PASS), { code: 'device_key_unavailable' }, 'kopierte Datei, anderes Konto');
    await assert.rejects(make({ deviceWrap: null }).unlock(PASS), { code: 'device_key_unavailable' });
    const again = make({ deviceWrap: device });
    await again.unlock(PASS);
    assert.strictEqual(again.data.bookmarks.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Container: Fehlversuche bremsen, Manipulation erkannt, Löschen', async () => {
  const clock = { now: 1e12 };
  const { dir, file, make } = containerSetup({ now: () => clock.now });
  try {
    const c = make();
    await c.create(PASS, { a: 1 });
    c.lock();
    for (let i = 0; i < 4; i++) await assert.rejects(c.unlock('falsche-passphrase-123'), { code: 'wrong_password' });
    await assert.rejects(c.unlock(PASS), { code: 'too_many_attempts' });
    clock.now += 60000;
    await c.unlock(PASS);
    c.lock();
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bytes = Buffer.from(doc.blob, 'base64');
    bytes[bytes.length - 20] ^= 1;
    doc.blob = bytes.toString('base64');
    fs.writeFileSync(file, JSON.stringify(doc));
    await assert.rejects(c.unlock(PASS), { code: 'container_tampered' });
    assert.strictEqual(c.unlocked, false);
    c.destroy();
    assert.strictEqual(c.exists(), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const { isAllowedRequest, normalizeDarkInput } = require('../src/main/darkweb/darkweb');

test('Anfragen: ohne Tor nichts, mit Tor nur Webadressen, nie lokale oder private Ziele', () => {
  assert.strictEqual(isAllowedRequest('https://example.com/', false), false);
  assert.strictEqual(isAllowedRequest('http://abc234abc234abc2.onion/', false), false);
  assert.strictEqual(isAllowedRequest('https://example.com/', true), true);
  assert.strictEqual(isAllowedRequest('wss://example.com/socket', true), true);
  for (const blocked of ['http://localhost/', 'http://127.0.0.1:8080/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.20.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://drucker.local/', 'file:///C:/Windows/win.ini', 'ftp://example.com/', 'chrome://settings', 'javascript:alert(1)']) {
    assert.strictEqual(isAllowedRequest(blocked, true), false, blocked);
  }
  assert.strictEqual(isAllowedRequest('data:text/plain,hallo', false), true, 'rein lokal, kein Netzwerk');
  assert.strictEqual(isAllowedRequest('http://172.32.0.1/', true), true, 'außerhalb des privaten Bereichs');
});

test('Adresseingabe: keine Suche und keine Vorschläge', () => {
  assert.strictEqual(normalizeDarkInput('abc234abc234abc2.onion'), 'http://abc234abc234abc2.onion');
  assert.strictEqual(normalizeDarkInput('http://abc234abc234abc2.onion/pfad'), 'http://abc234abc234abc2.onion/pfad');
  assert.strictEqual(normalizeDarkInput('beispiel.ch/a?b=1'), 'https://beispiel.ch/a?b=1');
  assert.strictEqual(normalizeDarkInput('wie wird das wetter'), null);
  assert.strictEqual(normalizeDarkInput('wetter'), null);
  assert.strictEqual(normalizeDarkInput('http://localhost:3000'), null);
  assert.strictEqual(normalizeDarkInput('file:///C:/x'), null);
  assert.strictEqual(normalizeDarkInput(''), null);
});
