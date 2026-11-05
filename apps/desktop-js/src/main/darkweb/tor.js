const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// Konfiguration für einen Tor-Client, der nur lokal als SOCKS5-Proxy lauscht.
function buildTorrc({ port, dataDir, bridges = [], pluginPath = null }) {
  const lines = [
    `SocksPort 127.0.0.1:${port} IsolateSOCKSAuth IsolateClientAddr`,
    'ControlPort 0',
    `DataDirectory ${dataDir}`,
    'AvoidDiskWrites 1',
    'ClientOnly 1',
    'SafeLogging 1',
    'Log notice stdout',
  ];
  const clean = bridges.map((b) => String(b).trim()).filter((b) => b && !/[\r\n]/.test(b));
  if (clean.length) {
    lines.push('UseBridges 1');
    if (pluginPath) lines.push(`ClientTransportPlugin obfs4,snowflake,meek_lite exec ${pluginPath}`);
    for (const bridge of clean) lines.push(`Bridge ${bridge}`);
  }
  return lines.join('\n') + '\n';
}

function parseBootstrap(line) {
  const match = /Bootstrapped (\d{1,3})%/.exec(String(line));
  return match ? Math.min(100, Number(match[1])) : null;
}

// Sucht das Tor-Programm: eingestellter Pfad, Aven-Ordner, mitgelieferter Ordner, PATH.
function findTorBinary({ configured, userDataDir, resourcesDir, env = process.env, platform = process.platform, exists = fs.existsSync }) {
  const name = platform === 'win32' ? 'tor.exe' : 'tor';
  const candidates = [
    configured,
    userDataDir && path.join(userDataDir, 'tor', name),
    resourcesDir && path.join(resourcesDir, 'tor', name),
    ...String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map((dir) => path.join(dir, name)),
  ].filter(Boolean);
  return candidates.find((file) => exists(file)) || null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Startet und stoppt den Tor-Begleitprozess. Zustände: stopped, starting, ready, failed.
// `command` und `prefixArgs` erlauben es, in Tests ein Ersatzprogramm zu starten.
class TorManager extends EventEmitter {
  constructor({ tmpDir = os.tmpdir(), command = null, prefixArgs = [], extraEnv = {}, startupTimeoutMs = 120000 } = {}) {
    super();
    this.tmpDir = tmpDir;
    this.command = command;
    this.prefixArgs = prefixArgs;
    this.extraEnv = extraEnv;
    this.startupTimeoutMs = startupTimeoutMs;
    this.proc = null;
    this.dataDir = null;
    this.stopping = false;
    this.state = { state: 'stopped', progress: 0, port: null, error: null };
  }

  status() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.status());
  }

  async start(binary, { bridges = [], pluginPath = null } = {}) {
    if (this.proc) return this.status();
    this.stopping = false;
    const port = await freePort();
    this.dataDir = fs.mkdtempSync(path.join(this.tmpDir, 'aven-tor-'));
    const torrc = path.join(this.dataDir, 'torrc');
    fs.writeFileSync(torrc, buildTorrc({ port, dataDir: path.join(this.dataDir, 'data'), bridges, pluginPath }));
    this.setState({ state: 'starting', progress: 0, port: null, error: null });

    return new Promise((resolve, reject) => {
      const proc = spawn(this.command || binary, [...this.prefixArgs, '-f', torrc], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...this.extraEnv },
      });
      this.proc = proc;
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { this.setState({ state: 'failed', port: null, error: err.message }); this.cleanup(); reject(err); }
        else resolve(this.status());
      };
      const timer = setTimeout(() => { this.stopping = true; finish(new Error('Tor hat sich nicht rechtzeitig verbunden.')); this.kill(); }, this.startupTimeoutMs);
      let buffer = '';
      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const line of lines) {
          const progress = parseBootstrap(line);
          if (progress === null) continue;
          if (progress >= 100) { this.setState({ state: 'ready', progress: 100, port }); finish(); }
          else this.setState({ progress });
        }
      });
      proc.on('error', (err) => finish(new Error(`Tor konnte nicht gestartet werden: ${err.message}`)));
      proc.on('exit', (code) => {
        this.proc = null;
        if (this.stopping) return;
        // Ein unerwartetes Ende heißt: alle Anfragen bleiben blockiert.
        finish(new Error(`Tor wurde unerwartet beendet (Code ${code}).`));
        if (this.state.state === 'ready') this.setState({ state: 'failed', port: null, error: `Tor wurde unerwartet beendet (Code ${code}).` });
        this.cleanup();
      });
    });
  }

  kill() {
    if (this.proc) { try { this.proc.kill(); } catch { /* bereits beendet */ } }
  }

  cleanup() {
    if (this.dataDir) {
      try { fs.rmSync(this.dataDir, { recursive: true, force: true }); } catch { /* wird beim nächsten Start ersetzt */ }
      this.dataDir = null;
    }
  }

  async stop() {
    this.stopping = true;
    const proc = this.proc;
    this.kill();
    if (proc) await new Promise((resolve) => { proc.once('exit', resolve); setTimeout(resolve, 3000); });
    this.proc = null;
    this.cleanup();
    this.setState({ state: 'stopped', progress: 0, port: null, error: null });
  }
}

module.exports = { TorManager, buildTorrc, parseBootstrap, findTorBinary, sha256File, freePort };
