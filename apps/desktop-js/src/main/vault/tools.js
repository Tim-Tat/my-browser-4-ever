const crypto = require('crypto');

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
};
const AMBIGUOUS = /[O0oIl1|]/g;

// Passwortgenerator mit kryptografischem Zufall. Aus jeder gewählten Zeichenklasse kommt mindestens ein Zeichen.
function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true, avoidAmbiguous = false } = {}, randomInt = crypto.randomInt) {
  const len = Math.min(128, Math.max(8, Math.floor(Number(length)) || 20));
  const classes = Object.entries({ lower, upper, digits, symbols })
    .filter(([, on]) => on)
    .map(([name]) => (avoidAmbiguous ? SETS[name].replace(AMBIGUOUS, '') : SETS[name]));
  if (!classes.length) throw new Error('Mindestens eine Zeichenart wählen');
  const pool = classes.join('');
  const out = classes.map((set) => set[randomInt(set.length)]);
  while (out.length < len) out.push(pool[randomInt(pool.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

const COMMON = ['password', 'passwort', 'qwerty', 'qwertz', 'letmein', 'welcome', 'willkommen', 'iloveyou', 'admin', 'dragon', 'monkey', 'sommer', 'winter', 'hallo', 'test', 'abc123', 'secret', 'geheim', 'login'];

// Grobe Schätzung der Stärke in Bit. Sie berücksichtigt Länge, Zeichenvielfalt, Wiederholungen,
// Zahlen- und Buchstabenfolgen und häufige Wörter. Eine Schätzung, kein Beweis.
function estimateStrength(password) {
  const pw = String(password || '');
  if (!pw) return { bits: 0, label: 'leer' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 30;
  let bits = pw.length * Math.log2(pool || 1);
  bits *= Math.min(1, new Set(pw).size / pw.length + 0.25);
  const lower = pw.toLowerCase();
  for (let i = 0; i + 3 <= lower.length; i += 1) {
    const a = lower.charCodeAt(i);
    if (lower.charCodeAt(i + 1) - a === 1 && lower.charCodeAt(i + 2) - a === 2) bits -= 6;
  }
  const hit = COMMON.find((w) => lower.includes(w));
  if (hit) bits = Math.min(bits - hit.length * 4, 24);
  bits = Math.max(0, Math.round(bits));
  const label = bits < 28 ? 'sehr schwach' : bits < 40 ? 'schwach' : bits < 60 ? 'mittel' : bits < 80 ? 'stark' : 'sehr stark';
  return { bits, label };
}

// Prüft über die "Have I Been Pwned"-Schnittstelle, wie oft ein Passwort in bekannten Datenlecks vorkommt.
// Es werden nur die ersten 5 Zeichen des SHA-1-Hashes gesendet (k-Anonymität), nie das Passwort.
async function pwnedCount(password, fetchImpl = fetch) {
  const hash = crypto.createHash('sha1').update(String(password)).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
  if (!res.ok) throw new Error(`Prüfdienst nicht erreichbar (${res.status})`);
  for (const line of (await res.text()).split(/\r?\n/)) {
    const [candidate, count] = line.split(':');
    if (candidate && candidate.trim() === suffix) return Number(count) || 0;
  }
  return 0;
}

module.exports = { generatePassword, estimateStrength, pwnedCount, SETS };
