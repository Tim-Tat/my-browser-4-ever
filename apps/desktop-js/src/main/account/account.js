const os = require('os');
const k = require('./keys');
const { Api, ApiError, normalizeServerUrl } = require('./api');
const { SyncEngine, COLLECTIONS } = require('./sync');

const DAY = 24 * 3600 * 1000;
const defaultCategories = () => ({ spaces: true, tabs: true, archive: true, bookmarks: true, settings: true, history: false });

// Verwaltet Konto, Sitzung und Sync dieses Geräts. Schlüssel und Sitzungstoken liegen
// ausschließlich im verschlüsselten lokalen Speicher (`store`).
class AccountManager {
  constructor({ store, now = Date.now, deviceName = os.hostname() }) {
    this.store = store;
    this.now = now;
    this.deviceName = deviceName;
    this.data = store.load() || {};
    this.data.categories = { ...defaultCategories(), ...(this.data.categories || {}) };
    this.lastSync = null;
    this.authKeyInMemory = null; // nur im Arbeitsspeicher, nie gespeichert
  }

  save() {
    this.store.save(this.data);
  }

  get signedIn() {
    return !!this.data.token;
  }

  api() {
    if (!this.data.serverUrl) throw new ApiError(0, 'no_server');
    return new Api(this.data.serverUrl, this.data.token);
  }

  status() {
    return {
      serverUrl: this.data.serverUrl || '',
      signedIn: this.signedIn,
      mode: this.data.mode || null,
      accountId: this.data.accountId || null,
      email: this.data.emailHint || null,
      categories: this.data.categories,
      lastSyncAt: this.data.lastSyncAt || null,
      lastSync: this.lastSync,
      daysUntilDeletion: this.data.daysUntilDeletion ?? null,
      pendingCloudDelete: !!this.data.pendingCloudDelete,
      lastError: this.data.lastError || null,
    };
  }

  setServer(url) {
    this.data.serverUrl = normalizeServerUrl(url);
    this.save();
  }

  setCategories(patch) {
    for (const name of COLLECTIONS) if (typeof patch[name] === 'boolean') this.data.categories[name] = patch[name];
    this.save();
  }

  // ---------- Registrieren und Anmelden ----------

  async register({ serverUrl, email, password, mode }) {
    this.setServer(serverUrl);
    if (!password || password.length < 10) throw new ApiError(0, 'password_too_short');
    const api = new Api(this.data.serverUrl);
    const health = await api.health();
    if (mode === 'normal' && !health.normalModeAvailable) throw new ApiError(503, 'normal_mode_unavailable');

    const kdfSalt = k.newSalt();
    const { authKey, wrapKey } = k.deriveKeys(password, kdfSalt);
    const dek = k.newDek();
    const body = { email, mode, deviceName: this.deviceName, authKey, kdfSalt, wrappedDek: k.wrapDek(wrapKey, dek) };
    let recoveryKey = null;
    if (mode === 'normal') {
      body.dek = k.b64(dek);
    } else {
      recoveryKey = k.newRecoveryKey();
      body.recoveryWrappedDek = k.wrapDekWithRecovery(recoveryKey, dek);
      body.recoveryProofHash = k.recoveryProofHash(recoveryKey);
    }
    const res = await api.register(body);
    this.adopt({ token: res.token, accountId: res.accountId, mode, dek, kdfSalt, email, authKey });
    return { mode, recoveryKey: recoveryKey ? k.formatRecoveryKey(recoveryKey) : null };
  }

  async login({ serverUrl, email, password, totp, recoveryCode }) {
    if (serverUrl) this.setServer(serverUrl);
    const api = new Api(this.data.serverUrl);
    const pre = await api.prelogin(email);
    const { authKey, wrapKey } = k.deriveKeys(password, pre.kdfSalt, pre.kdf);
    const res = await api.login({ email, authKey, deviceName: this.deviceName, totp, recoveryCode });
    let dek;
    try {
      dek = k.unwrapDek(wrapKey, res.wrappedDek);
    } catch {
      throw new ApiError(0, 'key_unwrap_failed');
    }
    this.adopt({ token: res.token, accountId: res.accountId, mode: res.mode, dek, kdfSalt: res.kdfSalt, email, authKey });
    return { mode: res.mode };
  }

  adopt({ token, accountId, mode, dek, kdfSalt, email, authKey }) {
    Object.assign(this.data, {
      token, accountId, mode, kdfSalt, dek: k.b64(dek), emailHint: mode === 'ultra' ? null : email,
      cursor: 0, map: {}, lastSyncAt: null, lastHeartbeatAt: 0, lastError: null, pendingCloudDelete: null,
    });
    this.authKeyInMemory = authKey;
    this.save();
  }

  // Beendet die Sitzung und verwirft die lokalen Schlüssel.
  async logout() {
    try { await this.api().logout(); } catch { /* offline: lokal trotzdem abmelden */ }
    this.discardLocal();
  }

  discardLocal() {
    for (const key of ['token', 'accountId', 'mode', 'kdfSalt', 'dek', 'emailHint', 'cursor', 'map', 'lastSyncAt', 'daysUntilDeletion']) delete this.data[key];
    this.authKeyInMemory = null;
    this.save();
  }

  // Leitet den authKey für Schritte mit erneuter Bestätigung ab (Export, Löschen, 2FA).
  stepUpKey(password) {
    if (!this.data.kdfSalt) throw new ApiError(0, 'not_signed_in');
    return k.deriveKeys(password, this.data.kdfSalt).authKey;
  }

  // ---------- Passwort, Modus, zweiter Faktor ----------

  async changePassword({ password, newPassword }) {
    if (!newPassword || newPassword.length < 10) throw new ApiError(0, 'password_too_short');
    const authKey = this.stepUpKey(password);
    const salt = k.newSalt();
    const next = k.deriveKeys(newPassword, salt);
    const dek = k.unb64(this.data.dek);
    await this.api().changePassword({ authKey, newAuthKey: next.authKey, newKdfSalt: salt, newWrappedDek: k.wrapDek(next.wrapKey, dek) });
    this.data.kdfSalt = salt;
    this.authKeyInMemory = next.authKey;
    this.save();
  }

  // Normal -> Ultra entfernt die Treuhandkopie; Ultra -> Normal legt sie mit Zustimmung neu an.
  async changeMode({ password, mode, email }) {
    const authKey = this.stepUpKey(password);
    const dek = k.unb64(this.data.dek);
    let recoveryKey = null;
    const body = { authKey, mode };
    if (mode === 'ultra') {
      recoveryKey = k.newRecoveryKey();
      body.recoveryWrappedDek = k.wrapDekWithRecovery(recoveryKey, dek);
      body.recoveryProofHash = k.recoveryProofHash(recoveryKey);
    } else {
      body.dek = k.b64(dek);
      body.email = email;
    }
    await this.api().changeMode(body);
    this.data.mode = mode;
    this.data.emailHint = mode === 'ultra' ? null : email;
    this.save();
    return { recoveryKey: recoveryKey ? k.formatRecoveryKey(recoveryKey) : null };
  }

  totpSetup(password) { return this.api().totpSetup(this.stepUpKey(password)); }
  totpEnable(code) { return this.api().totpEnable(code); }
  totpDisable({ password, totp, recoveryCode }) { return this.api().totpDisable({ authKey: this.stepUpKey(password), totp, recoveryCode }); }

  // ---------- Passwort vergessen ----------

  recoverRequest({ serverUrl, email }) {
    if (serverUrl) this.setServer(serverUrl);
    return new Api(this.data.serverUrl).recoverRequest(email);
  }

  recoverVerify({ email, token, secondFactor }) {
    return new Api(this.data.serverUrl).recoverVerify({ email, token, secondFactor });
  }

  // Normal: der Server gibt den DEK frei. Ultra: nur mit Wiederherstellungsschlüssel, sonst `reset: true`.
  async recoverFinish({ email, verified, newPassword, recoveryKeyText, reset }) {
    if (!newPassword || newPassword.length < 10) throw new ApiError(0, 'password_too_short');
    const api = new Api(this.data.serverUrl);
    const salt = k.newSalt();
    const next = k.deriveKeys(newPassword, salt);
    const body = { ticket: verified.ticket, newAuthKey: next.authKey, newKdfSalt: salt };
    let dek;
    let newRecoveryKey = null;
    if (verified.mode === 'normal') {
      dek = k.unb64(verified.dek);
    } else if (reset) {
      dek = k.newDek();
      newRecoveryKey = k.newRecoveryKey();
      body.reset = true;
      body.newRecoveryWrappedDek = k.wrapDekWithRecovery(newRecoveryKey, dek);
      body.newRecoveryProofHash = k.recoveryProofHash(newRecoveryKey);
    } else {
      const recoveryKey = k.parseRecoveryKey(recoveryKeyText);
      try {
        dek = k.unwrapDekWithRecovery(recoveryKey, verified.recoveryWrappedDek);
      } catch {
        throw new ApiError(0, 'recovery_key_wrong');
      }
      body.recoveryProof = k.b64(k.recoveryProofKey(recoveryKey));
    }
    body.newWrappedDek = k.wrapDek(next.wrapKey, dek);
    await api.recoverFinish(body);
    const res = await this.login({ email, password: newPassword });
    return { ...res, reset: !!reset, recoveryKey: newRecoveryKey ? k.formatRecoveryKey(newRecoveryKey) : null };
  }

  // ---------- Sync, Lebenszeichen ----------

  async sync(local) {
    if (!this.signedIn) return null;
    const state = { cursor: this.data.cursor || 0, map: this.data.map || {} };
    const engine = new SyncEngine({ api: this.api(), dek: k.unb64(this.data.dek), local, state, now: this.now });
    try {
      this.lastSync = await engine.sync(this.data.categories);
      this.data.lastError = null;
    } catch (err) {
      this.data.lastError = err.code || 'sync_failed';
      if (err.status === 401) this.discardLocal();
      throw err;
    } finally {
      this.data.cursor = state.cursor;
      this.data.map = state.map;
      this.data.lastSyncAt = this.now();
      this.save();
    }
    return this.lastSync;
  }

  // Höchstens ein Lebenszeichen pro 24 Stunden. Sync zählt nicht als Nutzung.
  async heartbeat() {
    if (!this.signedIn || this.now() - (this.data.lastHeartbeatAt || 0) < DAY) return null;
    const res = await this.api().heartbeat();
    this.data.lastHeartbeatAt = this.now();
    this.data.daysUntilDeletion = res.daysUntilDeletion;
    this.save();
    return res;
  }

  // ---------- Export und Löschung ----------

  exportRequest(password) { return this.api().exportRequest(this.stepUpKey(password)); }
  exportStatus(id) { return this.api().exportStatus(id); }

  // Lädt den Cloud-Export und entschlüsselt ihn lokal.
  async exportDownload(id) {
    const file = await this.api().exportDownload(id);
    const dek = k.unb64(this.data.dek);
    const records = [];
    for (const r of file.records) {
      if (r.deleted) continue;
      try {
        records.push({ collection: r.collection, id: r.id, updatedAt: r.updatedAt, data: JSON.parse(k.decrypt(dek, r.blob, `${r.collection}/${r.id}`).toString('utf8')) });
      } catch { /* nicht entschlüsselbare Einträge auslassen */ }
    }
    return { format: 'aven-cloud-export-decrypted', schemaVersion: 1, exportedAt: file.exportedAt, account: { mode: file.account.mode }, records };
  }

  async deleteAccount(password) {
    await this.api().deleteAccount(this.stepUpKey(password));
    this.discardLocal();
  }

  // Notfall: löscht das Konto allein mit der Gerätesitzung. Schlägt das fehl, bleibt die Löschung
  // als „ausstehend“ gespeichert und wird nicht als erfolgreich gemeldet.
  async emergencyDelete() {
    if (!this.signedIn && !this.data.pendingCloudDelete) return { ok: null, detail: 'Kein Konto verbunden' };
    const target = this.data.pendingCloudDelete || { serverUrl: this.data.serverUrl, token: this.data.token };
    try {
      await new Api(target.serverUrl, target.token).emergencyDelete();
      this.data.pendingCloudDelete = null;
      this.discardLocal();
      return { ok: true };
    } catch (err) {
      if (err.status === 401) { // Konto oder Sitzung existiert serverseitig nicht mehr
        this.data.pendingCloudDelete = null;
        this.discardLocal();
        return { ok: true, detail: 'Auf dem Server war nichts mehr vorhanden' };
      }
      this.data.pendingCloudDelete = target;
      this.discardLocal(); // lokale Schlüssel verwerfen, Löschauftrag bleibt offen
      this.data.token = undefined;
      this.save();
      return { ok: false, detail: `Löschung auf dem Server ausstehend (${err.code})` };
    }
  }

  async retryPendingDelete() {
    if (!this.data.pendingCloudDelete) return null;
    return this.emergencyDelete();
  }
}

module.exports = { AccountManager, defaultCategories };
