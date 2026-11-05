// Ersatz für Tor in Tests: liest den SocksPort aus der torrc, meldet "Bootstrapped 100%"
// und protokolliert, welche Ziele über den SOCKS5-Proxy angefragt werden. Verbindungen werden abgelehnt.
const fs = require('fs');
const net = require('net');

const rc = fs.readFileSync(process.argv[process.argv.indexOf('-f') + 1], 'utf8');
const port = Number(/SocksPort 127\.0\.0\.1:(\d+)/.exec(rc)[1]);
const logFile = process.env.FAKE_TOR_LOG;
const targets = [];

net.createServer((socket) => {
  let stage = 0;
  socket.on('data', (data) => {
    if (stage === 0) { // Begrüßung: keine Authentifizierung
      socket.write(Buffer.from([5, data.includes(2) ? 2 : 0]));
      stage = data.includes(2) ? 1 : 2;
    } else if (stage === 1) { // Benutzername/Passwort angenommen
      socket.write(Buffer.from([1, 0]));
      stage = 2;
    } else if (stage === 2) { // CONNECT-Anfrage
      let host = '';
      if (data[3] === 3) host = data.subarray(5, 5 + data[4]).toString();
      else if (data[3] === 1) host = [...data.subarray(4, 8)].join('.');
      targets.push({ host, atyp: data[3] === 3 ? 'domain' : 'ip' });
      if (logFile) fs.writeFileSync(logFile, JSON.stringify(targets));
      socket.write(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); // Verbindung abgelehnt
      socket.end();
    }
  });
  socket.on('error', () => {});
}).listen(port, '127.0.0.1', () => {
  console.log('Bootstrapped 5% (conn)');
  console.log('Bootstrapped 100% (done): Done');
});

process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
