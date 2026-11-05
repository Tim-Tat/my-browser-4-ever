const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(str) {
  let bits = '';
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('ungültiges Base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

const totpNow = (secretBase32, now = Date.now()) => hotp(base32Decode(secretBase32), Math.floor(now / 30000));

function verifyTotp(secretBase32, code, now = Date.now(), window = 1) {
  const secret = base32Decode(secretBase32);
  const step = Math.floor(now / 30000);
  const given = String(code || '').trim();
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, step + i);
    if (expected.length === given.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return true;
  }
  return false;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const otpauthUri = (secret, label) => `otpauth://totp/Aven:${encodeURIComponent(label)}?secret=${secret}&issuer=Aven`;

module.exports = { base32Encode, base32Decode, totpNow, verifyTotp, newSecret, otpauthUri };
