// server/crypto-util.js — minimal AES-256-GCM helpers for opaque token storage
// Storage format (Buffer):
// [ver=0x01][iv:12][tag:16][ciphertext:N]

const crypto = require('crypto');

function normalizeKey(input){
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Try base64
  try {
    const b64 = Buffer.from(s, 'base64');
    if (b64.length === 32) return b64;
  } catch {}
  // Try hex
  try {
    const hex = Buffer.from(s, 'hex');
    if (hex.length === 32) return hex;
  } catch {}
  // Fallback to utf8 bytes
  const utf8 = Buffer.from(s, 'utf8');
  if (utf8.length === 32) return utf8;
  return null;
}

function getKeyOrThrow(){
  const raw = process.env.ENCRYPTION_KEY || '';
  const key = normalizeKey(raw);
  if (!key) throw new Error('ENCRYPTION_KEY_MISSING');
  return key;
}

function hasKey(){
  try { return !!getKeyOrThrow(); } catch { return false; }
}

function encryptToBuffer(plaintext){
  if (plaintext == null) throw new Error('ENCRYPT_DATA_MISSING');
  const key = getKeyOrThrow();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Build buffer: 1 byte version + iv(12) + tag(16) + ciphertext
  const out = Buffer.concat([Buffer.from([1]), iv, tag, ct]);
  return out; // suitable for bytea
}

function decryptFromBuffer(buf){
  if (!Buffer.isBuffer(buf)) throw new Error('DECRYPT_INPUT_INVALID');
  if (buf.length < 1 + 12 + 16) throw new Error('DECRYPT_INPUT_TOO_SHORT');
  const ver = buf.readUInt8(0);
  if (ver !== 1) throw new Error('DECRYPT_UNSUPPORTED_VERSION');
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const key = getKeyOrThrow();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function maskToken(token){
  try {
    const s = String(token || '');
    if (s.length <= 8) return '••••';
    return s.slice(0, 4) + '••••' + s.slice(-4);
  } catch { return '••••'; }
}

module.exports = {
  getKeyOrThrow,
  hasKey,
  encryptToBuffer,
  decryptFromBuffer,
  maskToken,
};

