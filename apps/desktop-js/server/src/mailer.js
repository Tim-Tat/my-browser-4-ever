const net = require('net');
const tls = require('tls');

// Mailversand. `console` schreibt nur den Betreff ins Log und merkt sich Nachrichten
// im Speicher (für Tests und lokale Entwicklung), `smtp` spricht SMTP über TLS oder Klartext.
function createMailer(cfg) {
  if (cfg.type === 'smtp') return { send: (to, subject, text) => smtpSend(cfg, to, subject, text) };
  const outbox = [];
  return {
    outbox,
    async send(to, subject, text) {
      outbox.push({ to, subject, text });
      if (outbox.length > 50) outbox.shift();
      console.log(`[mail] ${subject}`);
    },
  };
}

function smtpSend(cfg, to, subject, text) {
  return new Promise((resolve, reject) => {
    const socket = cfg.secure ? tls.connect(cfg.port, cfg.host, { servername: cfg.host }) : net.connect(cfg.port, cfg.host);
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP-Zeitüberschreitung')); });
    socket.on('error', reject);
    let buffer = '';
    let waiting = null;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2];
      if (last && /^\d{3} /.test(last) && waiting) {
        const reply = buffer;
        const done = waiting;
        buffer = '';
        waiting = null;
        done(reply);
      }
    });
    const expect = async (code) => {
      const reply = await new Promise((res) => { waiting = res; });
      if (!reply.startsWith(code)) throw new Error(`SMTP: ${reply.trim()}`);
    };
    const cmd = async (line, code) => {
      socket.write(line + '\r\n');
      await expect(code);
    };
    (async () => {
      await expect('220');
      await cmd('EHLO aven', '250');
      if (cfg.user) {
        await cmd('AUTH LOGIN', '334');
        await cmd(Buffer.from(cfg.user).toString('base64'), '334');
        await cmd(Buffer.from(cfg.pass || '').toString('base64'), '235');
      }
      await cmd(`MAIL FROM:<${cfg.from}>`, '250');
      await cmd(`RCPT TO:<${to}>`, '250');
      await cmd('DATA', '354');
      const safeSubject = subject.replace(/[\r\n]/g, ' ');
      const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(`From: ${cfg.from}\r\nTo: ${to}\r\nSubject: ${safeSubject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`, '250');
      await cmd('QUIT', '221');
      socket.end();
      resolve();
    })().catch((err) => { socket.destroy(); reject(err); });
  });
}

module.exports = { createMailer };
