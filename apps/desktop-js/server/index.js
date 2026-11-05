const crypto = require('crypto');
const { fromEnv } = require('./src/config');
const { createApp } = require('./src/app');

if (process.argv[2] === 'gen-keys') {
  console.log(`AVEN_SEARCH_KEY=${crypto.randomBytes(32).toString('base64')}`);
  console.log(`AVEN_ESCROW_KEY=${crypto.randomBytes(32).toString('base64')}`);
  console.error('Diese Werte nur in der Umgebung des Servers hinterlegen, nie im Repository.');
  console.error('Wer AVEN_ESCROW_KEY verliert, kann normale Konten nicht mehr per E-Mail wiederherstellen.');
  process.exit(0);
}

const config = fromEnv();
config.trustProxy = process.env.AVEN_TRUST_PROXY === '1';
const app = createApp(config);

app.server.listen(config.port, config.host, () => {
  console.log(`Aven-Server läuft auf http://${config.host}:${config.port} (Normalmodus: ${config.escrowKey ? 'an' : 'aus'})`);
});

setInterval(() => app.processExports().catch(() => {}), 2000).unref();
setInterval(() => app.maintenance(), 3600 * 1000).unref();
app.maintenance();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close();
    process.exit(0);
  });
}
