const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { fromEnv } = require('../src/config');

// Startet einen Server mit frischer Datenbank auf einem freien Port.
async function startServer(overrides = {}) {
  const dbPath = path.join(os.tmpdir(), `aven-test-${crypto.randomUUID()}.db`);
  const config = {
    ...fromEnv({}),
    dbPath,
    searchKey: crypto.randomBytes(32),
    escrowKey: crypto.randomBytes(32),
    exportMinIntervalMs: 600000,
    ...overrides,
  };
  const clock = { now: Date.now() };
  const app = createApp(config, { now: () => clock.now });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, clock, config, close: () => app.close() };
}

async function call(base, method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leer */ }
  return { status: res.status, body: json, text };
}

const rand = (n) => crypto.randomBytes(n).toString('base64');

// Erzeugt ein Registrierungspaket, wie es der Client sendet (ohne echte Client-Kryptografie).
function registrationBody(mode, email = 'test@example.org') {
  const base = {
    email, mode, deviceName: 'Test', authKey: rand(32), kdfSalt: rand(16), wrappedDek: rand(60),
  };
  if (mode === 'normal') return { ...base, dek: rand(32) };
  const proofKey = crypto.randomBytes(32);
  return { ...base, recoveryWrappedDek: rand(60), recoveryProofHash: crypto.createHash('sha256').update(proofKey).digest('hex'), _proofKey: proofKey.toString('base64') };
}

module.exports = { startServer, call, rand, registrationBody };
