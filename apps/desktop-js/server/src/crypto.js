const crypto = require('crypto');

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (str) => Buffer.from(String(str || ''), 'base64');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const emailIndex = (searchKey, email) => crypto.createHmac('sha256', searchKey).update(normalizeEmail(email)).digest('hex');

// Scheinsalz für unbekannte Adressen: stabil, aber nicht von echten Salzen unterscheidbar.
const fakeSalt = (searchKey, index) => b64(crypto.createHmac('sha256', searchKey).update('salt:' + index).digest().subarray(0, 16));

function hashVerifier(authKey, serverSalt) {
  return b64(crypto.argon2Sync('argon2id', { message: unb64(authKey), nonce: unb64(serverSalt), memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }));
}

function verifyVerifier(authKey, serverSalt, verifier) {
  const actual = unb64(hashVerifier(authKey, serverSalt));
  const expected = unb64(verifier);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function aesEncrypt(key, plaintext, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return b64(Buffer.concat([nonce, body, cipher.getAuthTag()]));
}

function aesDecrypt(key, blob, aad) {
  const raw = unb64(blob);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { b64, unb64, sha256, randomToken, normalizeEmail, emailIndex, fakeSalt, hashVerifier, verifyVerifier, aesEncrypt, aesDecrypt, safeEqual };
