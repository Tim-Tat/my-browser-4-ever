const DAY = 24 * 3600 * 1000;

function fromEnv(env = process.env) {
  const num = (key, fallback) => (env[key] !== undefined && env[key] !== '' ? Number(env[key]) : fallback);
  const key = (name) => (env[name] ? Buffer.from(env[name], 'base64') : null);
  return {
    port: num('AVEN_PORT', 8787),
    host: env.AVEN_HOST || '127.0.0.1',
    dbPath: env.AVEN_DB || './aven-server.db',
    searchKey: key('AVEN_SEARCH_KEY'),
    escrowKey: key('AVEN_ESCROW_KEY'),
    inactivityDaysUltra: num('AVEN_INACTIVITY_DAYS_ULTRA', 180),
    inactivityDaysNormal: num('AVEN_INACTIVITY_DAYS_NORMAL', 0), // 0 = aus
    exportMinIntervalMs: num('AVEN_EXPORT_MIN_INTERVAL_MIN', 10) * 60 * 1000,
    exportTtlMs: num('AVEN_EXPORT_TTL_MIN', 60) * 60 * 1000,
    quotaBytes: num('AVEN_QUOTA_MB', 50) * 1024 * 1024,
    allowRegistration: env.AVEN_ALLOW_REGISTRATION !== '0',
    mail: {
      type: env.AVEN_MAIL || 'console', // console | smtp
      host: env.AVEN_SMTP_HOST,
      port: num('AVEN_SMTP_PORT', 465),
      secure: env.AVEN_SMTP_SECURE !== '0',
      user: env.AVEN_SMTP_USER,
      pass: env.AVEN_SMTP_PASS,
      from: env.AVEN_MAIL_FROM || 'aven@localhost',
    },
  };
}

module.exports = { fromEnv, DAY };
