const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { startServer, call, rand, registrationBody } = require('./helpers');
const totp = require('../src/totp');

const DAY = 24 * 3600 * 1000;

async function register(ctx, mode, email) {
  const body = registrationBody(mode, email);
  const res = await call(ctx.base, 'POST', '/v1/register', body);
  assert.strictEqual(res.status, 201, res.text);
  return { body, token: res.body.token, accountId: res.body.accountId };
}

test('Registrierung normal und Ultra, doppelte Adresse wird abgelehnt', async () => {
  const s = await startServer();
  try {
    await register(s, 'normal', 'a@example.org');
    const again = await call(s.base, 'POST', '/v1/register', registrationBody('ultra', 'A@Example.org'));
    assert.strictEqual(again.status, 409);
    const bad = await call(s.base, 'POST', '/v1/register', { ...registrationBody('ultra', 'b@example.org'), authKey: 'kurz' });
    assert.strictEqual(bad.status, 400);
  } finally { s.close(); }
});

test('Ultra speichert keine Klartext-E-Mail, auch nicht im Datenbankabbild', async () => {
  const s = await startServer();
  try {
    await register(s, 'ultra', 'geheim@example.org');
    const row = s.app.db.prepare('SELECT * FROM accounts').get();
    assert.strictEqual(row.email, null);
    assert.strictEqual(row.escrow, null);
    const dump = JSON.stringify(row);
    assert.ok(!dump.includes('geheim'));
    assert.ok(!dump.includes('example.org'));
  } finally { s.close(); }
});

test('Normalmodus ohne Escrow-Schlüssel ist nicht verfügbar', async () => {
  const s = await startServer({ escrowKey: null });
  try {
    const res = await call(s.base, 'POST', '/v1/register', registrationBody('normal'));
    assert.strictEqual(res.status, 503);
    const health = await call(s.base, 'GET', '/v1/health');
    assert.strictEqual(health.body.normalModeAvailable, false);
  } finally { s.close(); }
});

test('Anmeldung: richtig, falsch, Sperre nach zehn Fehlversuchen', async () => {
  const s = await startServer();
  try {
    const { body } = await register(s, 'normal', 'login@example.org');
    const ok = await call(s.base, 'POST', '/v1/login', { email: 'login@example.org', authKey: body.authKey, deviceName: 'Zweites Gerät' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.wrappedDek, body.wrappedDek);
    for (let i = 0; i < 10; i++) {
      const bad = await call(s.base, 'POST', '/v1/login', { email: 'login@example.org', authKey: rand(32) });
      assert.strictEqual(bad.status, 401);
      s.app.db.prepare('UPDATE accounts SET failed_logins = failed_logins').run();
    }
    const locked = await call(s.base, 'POST', '/v1/login', { email: 'login@example.org', authKey: body.authKey });
    assert.strictEqual(locked.status, 429);
    assert.strictEqual(locked.body.error, 'account_locked');
    s.clock.now += 16 * 60000;
    const later = await call(s.base, 'POST', '/v1/login', { email: 'login@example.org', authKey: body.authKey });
    assert.strictEqual(later.status, 200);
  } finally { s.close(); }
});

test('Prelogin verrät nicht, ob eine Adresse existiert', async () => {
  const s = await startServer();
  try {
    await register(s, 'ultra', 'da@example.org');
    const known = await call(s.base, 'POST', '/v1/prelogin', { email: 'da@example.org' });
    const unknown1 = await call(s.base, 'POST', '/v1/prelogin', { email: 'nicht@example.org' });
    const unknown2 = await call(s.base, 'POST', '/v1/prelogin', { email: 'nicht@example.org' });
    assert.deepStrictEqual(Object.keys(known.body), Object.keys(unknown1.body));
    assert.strictEqual(unknown1.body.kdfSalt, unknown2.body.kdfSalt);
    assert.notStrictEqual(unknown1.body.kdfSalt, known.body.kdfSalt);
  } finally { s.close(); }
});

test('Sync: schreiben, lesen, Tombstone, Konflikt nach neuerem Zeitstempel, Fremdzugriff', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'normal', 'sync-a@example.org');
    const b = await register(s, 'normal', 'sync-b@example.org');
    const put = await call(s.base, 'PUT', '/v1/sync', { records: [
      { collection: 'bookmarks', id: 'b1', blob: 'AAAA', updatedAt: 100, deleted: false },
      { collection: 'tabs', id: 't1', blob: 'BBBB', updatedAt: 100, deleted: false },
    ] }, a.token);
    assert.strictEqual(put.body.accepted, 2);
    const pull = await call(s.base, 'GET', '/v1/sync?since=0', null, a.token);
    assert.strictEqual(pull.body.records.length, 2);
    const cursor = pull.body.seq;

    const stale = await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'bookmarks', id: 'b1', blob: 'ALT!', updatedAt: 50 }] }, a.token);
    assert.strictEqual(stale.body.accepted, 0);
    assert.strictEqual(stale.body.rejected.length, 1);

    await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'bookmarks', id: 'b1', updatedAt: 200, deleted: true }] }, a.token);
    const delta = await call(s.base, 'GET', `/v1/sync?since=${cursor}`, null, a.token);
    assert.strictEqual(delta.body.records.length, 1);
    assert.strictEqual(delta.body.records[0].deleted, true);
    assert.strictEqual(delta.body.records[0].blob, null);

    const other = await call(s.base, 'GET', '/v1/sync?since=0', null, b.token);
    assert.strictEqual(other.body.records.length, 0);
    assert.strictEqual((await call(s.base, 'GET', '/v1/sync')).status, 401);
    const invalid = await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'passwoerter', id: 'x', blob: 'A', updatedAt: 1 }] }, a.token);
    assert.strictEqual(invalid.status, 400);
  } finally { s.close(); }
});

test('Speicherkontingent wird durchgesetzt', async () => {
  const s = await startServer({ quotaBytes: 100 });
  try {
    const a = await register(s, 'normal', 'quota@example.org');
    const res = await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'history', id: 'h1', blob: 'x'.repeat(200), updatedAt: 1 }] }, a.token);
    assert.strictEqual(res.status, 413);
  } finally { s.close(); }
});

test('Lebenszeichen: höchstens eines pro 24 Stunden, Inaktivitätslöschung', async () => {
  const s = await startServer({ inactivityDaysUltra: 180, inactivityDaysNormal: 0 });
  try {
    const ultra = await register(s, 'ultra', 'u@example.org');
    const normal = await register(s, 'normal', 'n@example.org');
    s.clock.now += 3600 * 1000;
    await call(s.base, 'POST', '/v1/heartbeat', null, ultra.token);
    const first = s.app.db.prepare('SELECT last_active_at FROM accounts WHERE id = ?').get(ultra.accountId).last_active_at;
    assert.ok(s.clock.now - first >= 3600 * 1000 - 1, 'Lebenszeichen innerhalb von 24 h darf nichts ändern');

    s.clock.now += 60 * DAY;
    let info = await call(s.base, 'GET', '/v1/account', null, ultra.token);
    assert.strictEqual(info.body.daysUntilDeletion, 120);
    await call(s.base, 'POST', '/v1/heartbeat', null, ultra.token);
    info = await call(s.base, 'GET', '/v1/account', null, ultra.token);
    assert.strictEqual(info.body.daysUntilDeletion, 180);

    s.clock.now += 181 * DAY;
    const result = s.app.maintenance();
    assert.strictEqual(result.deleted, 1);
    assert.ok(!s.app.db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(ultra.accountId));
    assert.ok(s.app.db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(normal.accountId), 'Normalkonto bleibt ohne Frist erhalten');
  } finally { s.close(); }
});

test('Sync alleine verlängert die Inaktivitätsfrist nicht', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'ultra', 'passiv@example.org');
    s.clock.now += 10 * DAY;
    await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'tabs', id: 't', blob: 'A', updatedAt: 1 }] }, a.token);
    await call(s.base, 'GET', '/v1/sync', null, a.token);
    const info = await call(s.base, 'GET', '/v1/account', null, a.token);
    assert.strictEqual(info.body.daysUntilDeletion, 170);
  } finally { s.close(); }
});

test('Export: Step-up, Warteschlange, Ergebnis, Rate-Limit, Ablauf', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'normal', 'export@example.org');
    await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'bookmarks', id: 'b', blob: 'CIPHER', updatedAt: 1 }] }, a.token);
    assert.strictEqual((await call(s.base, 'POST', '/v1/export', { authKey: rand(32) }, a.token)).status, 403);

    const job = await call(s.base, 'POST', '/v1/export', { authKey: a.body.authKey }, a.token);
    assert.strictEqual(job.status, 202);
    const again = await call(s.base, 'POST', '/v1/export', { authKey: a.body.authKey }, a.token);
    assert.strictEqual(again.body.id, job.body.id, 'nur ein aktiver Auftrag pro Konto');
    assert.strictEqual((await call(s.base, 'GET', `/v1/export/${job.body.id}/download`, null, a.token)).status, 409);

    await s.app.processExports();
    const status = await call(s.base, 'GET', `/v1/export/${job.body.id}`, null, a.token);
    assert.strictEqual(status.body.status, 'ready');
    const file = await call(s.base, 'GET', `/v1/export/${job.body.id}/download`, null, a.token);
    assert.strictEqual(file.body.format, 'aven-cloud-export');
    assert.strictEqual(file.body.records[0].blob, 'CIPHER');
    assert.ok(!file.text.includes('export@example.org'));

    const tooSoon = await call(s.base, 'POST', '/v1/export', { authKey: a.body.authKey }, a.token);
    assert.strictEqual(tooSoon.status, 429);
    s.clock.now += 11 * 60000;
    assert.strictEqual((await call(s.base, 'POST', '/v1/export', { authKey: a.body.authKey }, a.token)).status, 202);

    s.clock.now += 2 * 3600 * 1000;
    s.app.maintenance();
    assert.strictEqual((await call(s.base, 'GET', `/v1/export/${job.body.id}/download`, null, a.token)).status, 409);
  } finally { s.close(); }
});

test('Wiederherstellung normal: Mail-Code gibt den DEK über die Treuhandkopie frei', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'normal', 'recover@example.org');
    assert.strictEqual((await call(s.base, 'POST', '/v1/recover/request', { email: 'unbekannt@example.org' })).status, 202);
    assert.strictEqual(s.app.mailer.outbox.length, 0);
    assert.strictEqual((await call(s.base, 'POST', '/v1/recover/request', { email: 'recover@example.org' })).status, 202);
    const code = /Code: (\w+)/.exec(s.app.mailer.outbox[0].text)[1];
    assert.strictEqual((await call(s.base, 'POST', '/v1/recover/verify', { email: 'recover@example.org', token: 'falsch' })).status, 400);
    const verify = await call(s.base, 'POST', '/v1/recover/verify', { email: 'recover@example.org', token: code });
    assert.strictEqual(verify.status, 200);
    assert.strictEqual(verify.body.dek, a.body.dek);
    const newKey = rand(32);
    const fin = await call(s.base, 'POST', '/v1/recover/finish', { ticket: verify.body.ticket, newAuthKey: newKey, newKdfSalt: rand(16), newWrappedDek: rand(60) });
    assert.strictEqual(fin.status, 200);
    assert.strictEqual((await call(s.base, 'GET', '/v1/account', null, a.token)).status, 401, 'alte Sitzungen sind widerrufen');
    assert.strictEqual((await call(s.base, 'POST', '/v1/login', { email: 'recover@example.org', authKey: newKey })).status, 200);
    assert.strictEqual((await call(s.base, 'POST', '/v1/recover/finish', { ticket: verify.body.ticket, newAuthKey: rand(32), newKdfSalt: rand(16), newWrappedDek: rand(60) })).status, 400, 'Ticket gilt nur einmal');
  } finally { s.close(); }
});

test('Wiederherstellung Ultra: ohne Schlüssel nur destruktiver Reset, mit Schlüssel bleiben Daten', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'ultra', 'ultra@example.org');
    await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'tabs', id: 't1', blob: 'GEHEIM', updatedAt: 1 }] }, a.token);
    const request = async () => {
      s.app.db.prepare('DELETE FROM tokens').run();
      await call(s.base, 'POST', '/v1/recover/request', { email: 'ultra@example.org' });
      const code = /Code: (\w+)/.exec(s.app.mailer.outbox.at(-1).text)[1];
      return (await call(s.base, 'POST', '/v1/recover/verify', { email: 'ultra@example.org', token: code })).body;
    };
    const v1 = await request();
    assert.strictEqual(v1.mode, 'ultra');
    assert.strictEqual(v1.dek, undefined, 'Ultra gibt nie einen DEK heraus');
    const noProof = await call(s.base, 'POST', '/v1/recover/finish', { ticket: v1.ticket, newAuthKey: rand(32), newKdfSalt: rand(16), newWrappedDek: rand(60) });
    assert.strictEqual(noProof.status, 403);

    const withProof = await call(s.base, 'POST', '/v1/recover/finish', { ticket: v1.ticket, newAuthKey: rand(32), newKdfSalt: rand(16), newWrappedDek: rand(60), recoveryProof: a.body._proofKey });
    assert.strictEqual(withProof.status, 200);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1, 'Daten bleiben nach Reset mit Schlüssel');

    const v2 = await request();
    const reset = await call(s.base, 'POST', '/v1/recover/finish', { ticket: v2.ticket, reset: true, newAuthKey: rand(32), newKdfSalt: rand(16), newWrappedDek: rand(60), newRecoveryWrappedDek: rand(60), newRecoveryProofHash: 'a'.repeat(64) });
    assert.strictEqual(reset.status, 200);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0, 'destruktiver Reset löscht die Datensätze');
  } finally { s.close(); }
});

test('Zweiter Faktor: Einrichtung, Pflicht bei Anmeldung, Einmalcode, Wiederherstellung umgeht ihn nicht', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'normal', 'totp@example.org');
    const setup = await call(s.base, 'POST', '/v1/totp/setup', { authKey: a.body.authKey }, a.token);
    assert.strictEqual((await call(s.base, 'POST', '/v1/totp/enable', { code: '000000' }, a.token)).status, 400);
    const enable = await call(s.base, 'POST', '/v1/totp/enable', { code: totp.totpNow(setup.body.secret, s.clock.now) }, a.token);
    assert.strictEqual(enable.body.recoveryCodes.length, 10);

    const login = (extra) => call(s.base, 'POST', '/v1/login', { email: 'totp@example.org', authKey: a.body.authKey, ...extra });
    assert.strictEqual((await login({})).body.error, 'second_factor_required');
    assert.strictEqual((await login({ totp: '123456' })).body.error, 'second_factor_invalid');
    assert.strictEqual((await login({ totp: totp.totpNow(setup.body.secret, s.clock.now) })).status, 200);
    const once = enable.body.recoveryCodes[0];
    assert.strictEqual((await login({ recoveryCode: once })).status, 200);
    assert.strictEqual((await login({ recoveryCode: once })).status, 401, 'Einmalcode gilt nur einmal');

    await call(s.base, 'POST', '/v1/recover/request', { email: 'totp@example.org' });
    const code = /Code: (\w+)/.exec(s.app.mailer.outbox.at(-1).text)[1];
    const blocked = await call(s.base, 'POST', '/v1/recover/verify', { email: 'totp@example.org', token: code });
    assert.strictEqual(blocked.status, 401);
    const ok = await call(s.base, 'POST', '/v1/recover/verify', { email: 'totp@example.org', token: code, secondFactor: { totp: totp.totpNow(setup.body.secret, s.clock.now) } });
    assert.strictEqual(ok.status, 200);
  } finally { s.close(); }
});

test('Geräte, Passwortwechsel, Moduswechsel, Konto löschen', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'normal', 'devices@example.org');
    const second = await call(s.base, 'POST', '/v1/login', { email: 'devices@example.org', authKey: a.body.authKey, deviceName: 'Handy' });
    const list = await call(s.base, 'GET', '/v1/devices', null, a.token);
    assert.strictEqual(list.body.devices.length, 2);
    const handy = list.body.devices.find((d) => d.name === 'Handy');
    assert.strictEqual((await call(s.base, 'DELETE', `/v1/devices/${handy.id}`, null, a.token)).status, 200);
    assert.strictEqual((await call(s.base, 'GET', '/v1/account', null, second.body.token)).status, 401);

    const newKey = rand(32);
    assert.strictEqual((await call(s.base, 'POST', '/v1/password', { authKey: rand(32), newAuthKey: newKey, newKdfSalt: rand(16), newWrappedDek: rand(60) }, a.token)).status, 403);
    assert.strictEqual((await call(s.base, 'POST', '/v1/password', { authKey: a.body.authKey, newAuthKey: newKey, newKdfSalt: rand(16), newWrappedDek: rand(60) }, a.token)).status, 200);
    assert.strictEqual((await call(s.base, 'POST', '/v1/login', { email: 'devices@example.org', authKey: a.body.authKey })).status, 401);

    const proof = crypto.randomBytes(32);
    const toUltra = await call(s.base, 'POST', '/v1/mode', { authKey: newKey, mode: 'ultra', recoveryWrappedDek: rand(60), recoveryProofHash: crypto.createHash('sha256').update(proof).digest('hex') }, a.token);
    assert.strictEqual(toUltra.body.mode, 'ultra');
    const row = s.app.db.prepare('SELECT escrow, email FROM accounts WHERE id = ?').get(a.accountId);
    assert.strictEqual(row.escrow, null);
    assert.strictEqual(row.email, null);

    assert.strictEqual((await call(s.base, 'DELETE', '/v1/account', { authKey: rand(32) }, a.token)).status, 403);
    assert.strictEqual((await call(s.base, 'DELETE', '/v1/account', { authKey: newKey }, a.token)).body.deleted, true);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  } finally { s.close(); }
});

test('Notfall-Löschung braucht nur die Sitzung und entfernt alles', async () => {
  const s = await startServer();
  try {
    const a = await register(s, 'ultra', 'panic@example.org');
    await call(s.base, 'PUT', '/v1/sync', { records: [{ collection: 'tabs', id: 't', blob: 'A', updatedAt: 1 }] }, a.token);
    assert.strictEqual((await call(s.base, 'DELETE', '/v1/account/emergency')).status, 401);
    assert.strictEqual((await call(s.base, 'DELETE', '/v1/account/emergency', null, a.token)).body.deleted, true);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0);
    assert.strictEqual(s.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  } finally { s.close(); }
});

test('Unbekannte Pfade, falsche Methoden, kaputtes JSON, Sicherheitsheader', async () => {
  const s = await startServer();
  try {
    assert.strictEqual((await call(s.base, 'GET', '/v1/gibtsnicht')).status, 404);
    assert.strictEqual((await call(s.base, 'GET', '/v1/login')).status, 405);
    const res = await fetch(`${s.base}/v1/prelogin`, { method: 'POST', body: '{kaputt' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  } finally { s.close(); }
});
