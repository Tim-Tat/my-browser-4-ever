const crypto = require('crypto');

// Schlüsselableitung und Verpackung nach docs/SYNC_PROTOCOL.md.
const DEFAULT_KDF = { name: 'scrypt', N: 32768, r: 8, p: 1 };
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (str) => Buffer.from(String(str || ''), 'base64');
const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const newSalt = () => b64(crypto.randomBytes(16));
const newDek = () => crypto.randomBytes(32);

function deriveKeys(password, saltB64, kdf = DEFAULT_KDF) {
  if (kdf.name !== 'scrypt') throw new Error('Unbekanntes Ableitungsverfahren');
  const out = crypto.scryptSync(String(password).normalize('NFKC'), unb64(saltB64), 64, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 + (1 << 20),
  });
  return { authKey: b64(out.subarray(0, 32)), wrapKey: out.subarray(32, 64) };
}

function encrypt(key, plaintext, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return b64(Buffer.concat([nonce, body, cipher.getAuthTag()]));
}

function decrypt(key, blob, aad) {
  const raw = unb64(blob);
  if (raw.length < 28) throw new Error('Ungültiger Chiffretext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

const wrapDek = (wrapKey, dek) => encrypt(wrapKey, dek, 'dek');
const unwrapDek = (wrapKey, blob) => decrypt(wrapKey, blob, 'dek');

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(str) {
  let bits = '';
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Ungültiger Wiederherstellungsschlüssel');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Wiederherstellungsschlüssel: 32 Zufallsbytes, als Text mit Gruppen von vier Zeichen.
const newRecoveryKey = () => crypto.randomBytes(32);
const formatRecoveryKey = (key) => base32Encode(key).match(/.{1,4}/g).join('-');
function parseRecoveryKey(text) {
  const key = base32Decode(String(text).replace(/[\s-]/g, '').toUpperCase());
  if (key.length !== 32) throw new Error('Ungültiger Wiederherstellungsschlüssel');
  return key;
}

// Beweis, dass der Nutzer den Wiederherstellungsschlüssel kennt, ohne ihn preiszugeben.
const recoveryProofKey = (recoveryKey) => crypto.createHmac('sha256', recoveryKey).update('aven-proof').digest();
const recoveryProofHash = (recoveryKey) => sha256hex(recoveryProofKey(recoveryKey));
const wrapDekWithRecovery = (recoveryKey, dek) => encrypt(recoveryKey, dek, 'dek-recovery');
const unwrapDekWithRecovery = (recoveryKey, blob) => decrypt(recoveryKey, blob, 'dek-recovery');

module.exports = {
  DEFAULT_KDF, b64, unb64, sha256hex, newSalt, newDek, deriveKeys, encrypt, decrypt, wrapDek, unwrapDek,
  newRecoveryKey, formatRecoveryKey, parseRecoveryKey, recoveryProofKey, recoveryProofHash, wrapDekWithRecovery, unwrapDekWithRecovery,
};
