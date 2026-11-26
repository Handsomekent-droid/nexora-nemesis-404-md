/**
 * Loaded FIRST, before anything else (including Baileys), in index.js. Patches console.log/
 * error/warn/info so that if ANYTHING — our own code, or something inside a library we didn't
 * write — tries to print an object shaped like WhatsApp session/key material, it gets redacted
 * instead of printed. This is a safety net underneath the message-only error logging already
 * used throughout this codebase: that stops OUR code from leaking keys, this stops a leak from
 * anywhere, including library internals we can't edit.
 */

// Property names that only ever appear on Signal-protocol session/key structures — a normal chat
// message, error message, or log line will never legitimately contain these together.
const KEY_FIELDS = [
  'registrationId', 'currentRatchet', 'ephemeralKeyPair', 'pendingPreKey', 'indexInfo',
  'rootKey', 'chainKey', 'baseKey', 'remoteIdentityKey', 'signedKeyId', 'preKeyId',
  'pubKey', 'privKey'
];

function looksLikeKeyMaterial(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return false;
  if (Buffer.isBuffer(obj)) return false;
  let hits = 0;
  for (const k of Object.keys(obj)) {
    if (KEY_FIELDS.includes(k)) hits++;
    if (hits >= 2) return true; // two or more matching fields is well past coincidence
    const v = obj[k];
    if (v && typeof v === 'object' && !Buffer.isBuffer(v) && looksLikeKeyMaterial(v, depth + 1)) return true;
  }
  return false;
}

function sanitizeArg(a) {
  try {
    if (a && typeof a === 'object' && looksLikeKeyMaterial(a)) {
      return '[redacted: this looked like WhatsApp session/key material, not printed]';
    }
  } catch { /* if the check itself fails, fall through and print normally */ }
  return a;
}

function wrap(method) {
  const orig = console[method].bind(console);
  console[method] = (...args) => orig(...args.map(sanitizeArg));
}

['log', 'error', 'warn', 'info'].forEach(wrap);
