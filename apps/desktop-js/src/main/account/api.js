class ApiError extends Error {
  constructor(status, code, body = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Nur HTTPS ist erlaubt, außer für lokale Entwicklung.
function normalizeServerUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new ApiError(0, 'invalid_server_url');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ApiError(0, 'insecure_server_url');
  return url.origin;
}

class Api {
  constructor(baseUrl, token = null, { timeoutMs = 15000 } = {}) {
    this.base = normalizeServerUrl(baseUrl);
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(0, err.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* keine JSON-Antwort */ }
    if (!res.ok) throw new ApiError(res.status, json.error || 'http_error', json);
    return json;
  }

  health() { return this.request('GET', '/v1/health'); }
  prelogin(email) { return this.request('POST', '/v1/prelogin', { email }); }
  register(body) { return this.request('POST', '/v1/register', body); }
  login(body) { return this.request('POST', '/v1/login', body); }
  logout() { return this.request('POST', '/v1/logout'); }
  account() { return this.request('GET', '/v1/account'); }
  heartbeat() { return this.request('POST', '/v1/heartbeat'); }
  devices() { return this.request('GET', '/v1/devices'); }
  revokeDevice(id) { return this.request('DELETE', `/v1/devices/${id}`); }
  pull(since) { return this.request('GET', `/v1/sync?since=${since}`); }
  push(records) { return this.request('PUT', '/v1/sync', { records }); }
  totpSetup(authKey) { return this.request('POST', '/v1/totp/setup', { authKey }); }
  totpEnable(code) { return this.request('POST', '/v1/totp/enable', { code }); }
  totpDisable(body) { return this.request('POST', '/v1/totp/disable', body); }
  changePassword(body) { return this.request('POST', '/v1/password', body); }
  changeMode(body) { return this.request('POST', '/v1/mode', body); }
  recoverRequest(email) { return this.request('POST', '/v1/recover/request', { email }); }
  recoverVerify(body) { return this.request('POST', '/v1/recover/verify', body); }
  recoverFinish(body) { return this.request('POST', '/v1/recover/finish', body); }
  exportRequest(authKey) { return this.request('POST', '/v1/export', { authKey }); }
  exportStatus(id) { return this.request('GET', `/v1/export/${id}`); }
  exportDownload(id) { return this.request('GET', `/v1/export/${id}/download`); }
  deleteAccount(authKey) { return this.request('DELETE', '/v1/account', { authKey }); }
  emergencyDelete() { return this.request('DELETE', '/v1/account/emergency'); }
}

module.exports = { Api, ApiError, normalizeServerUrl };
