// ============================================================
// backup-crypto.js - optional password encryption for backups.
//
// Uses the Web Crypto API (built into the browser, no dependency):
//   - PBKDF2 (SHA-256, 250k iterations) derives an AES key from a passphrase;
//   - AES-GCM encrypts the backup JSON with a random IV;
//   - output is a self-describing envelope so restore can detect + decrypt.
//
// Plaintext backups remain the default. Encryption is opt-in (user supplies a
// passphrase). Pure crypto helpers - no DOM. Async (WebCrypto is promise-based).
// ============================================================

const ENVELOPE_TYPE = "casa_encrypted_backup";
const KDF_ITERATIONS = 250000;

function _enc() {
  return new TextEncoder();
}
function _dec() {
  return new TextDecoder();
}
function _b64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function _unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function _deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    _enc().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** True if `obj` is an encrypted backup envelope produced by encryptBackup(). */
export function isEncryptedBackup(obj) {
  return !!(obj && obj._type === ENVELOPE_TYPE && obj.ct && obj.iv && obj.salt);
}

/**
 * Encrypt a plain backup object with a passphrase.
 * Returns a JSON-serialisable envelope (safe to write to a .json file).
 */
export async function encryptBackup(plainObj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _deriveKey(passphrase, salt);
  const plaintext = _enc().encode(JSON.stringify(plainObj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    _type: ENVELOPE_TYPE,
    _v: 1,
    _app: "casa_portfolio_tracker",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: _b64(salt),
    iv: _b64(iv),
    ct: _b64(ct),
  };
}

/**
 * Decrypt an envelope with a passphrase. Returns the original plain object.
 * Throws on wrong passphrase / tampered data (AES-GCM auth failure).
 */
export async function decryptBackup(envelope, passphrase) {
  if (!isEncryptedBackup(envelope)) throw new Error("Not an encrypted backup.");
  const salt = _unb64(envelope.salt);
  const iv = _unb64(envelope.iv);
  const key = await _deriveKey(passphrase, salt);
  let ptBuf;
  try {
    ptBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      _unb64(envelope.ct),
    );
  } catch (e) {
    throw new Error("Wrong password or corrupted backup.");
  }
  return JSON.parse(_dec().decode(ptBuf));
}
