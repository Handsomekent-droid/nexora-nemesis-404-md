/**
 * Fraud & scam protection — the opposite of a spam toolkit.
 * Two always-available global toggles (in-memory, default ON every start):
 *   .otpguard on|off    — catches messages asking someone to share a verification/OTP code
 *   .scamshield on|off  — catches classic scam-message wording (prize/lottery/investment/etc.)
 * Both run automatically on every incoming message, in DMs and groups alike, before any command
 * is read. A non-admin's message gets deleted in groups when possible; the sender is warned either
 * way, and the owner is notified so patterns across many chats are visible from one place.
 */
const notifier = require('./notifier');
const { createStore } = require('./store');

let otpOn = true;
let scamOn = true;
const setOtp = (v) => (otpOn = v);
const setScam = (v) => (scamOn = v);
const isOtpOn = () => otpOn;
const isScamOn = () => scamOn;

// A real verification code is 4-8 digits, almost always paired with "code", "OTP", "verify",
// "verification" nearby — this avoids false-triggering on every random number someone types.
const OTP_WORDS = /\b(otp|verification code|verify code|confirmation code|security code|auth code|one[-\s]?time (code|password)|access code)\b/i;
const OTP_DIGITS = /\b\d{4,8}\b/;
const OTP_ASK = /\b(send|share|give|forward|tell|reply|dm|whatsapp)\s+(me\s+)?(the\s+|your\s+|that\s+)?(otp|code)\b/i;

function looksLikeOtpRequest(body) {
  if (!body) return false;
  return (OTP_WORDS.test(body) && OTP_DIGITS.test(body)) || OTP_ASK.test(body);
}

// Common scam-message wording — kept to the pattern level (phrases), not a line-by-line
// playbook, so this stays a recognizer rather than a template.
const SCAM_PATTERNS = [
  /\byou(’|'|)ve\s+won\b/i,
  /\bclaim\s+your\s+(prize|reward|winnings?)\b/i,
  /\bcongratulations?\b.{0,30}\b(won|selected|winner)\b/i,
  /\bguaranteed\s+(returns?|profit|income)\b/i,
  /\bdouble\s+your\s+(money|investment|btc|crypto)\b/i,
  /\binvest\s+\$?\d+.{0,20}\b(return|profit|daily)\b/i,
  /\b(bitcoin|crypto|forex)\s+(investment|trading)\s+(opportunity|expert|guru)\b/i,
  /\bwork\s+from\s+home\b.{0,30}\$\d+.{0,10}(day|week)\b/i,
  /\bclick\s+(this|the)\s+link\s+(now|immediately|urgently)\b/i,
  /\byour\s+account\s+(has\s+been|will\s+be)\s+(suspended|locked|blocked)\b/i,
  /\bverify\s+your\s+account\s+(now|immediately|within)\b/i,
  /\bact\s+now\s+or\s+lose\b/i,
  /\bwestern\s+union\b.{0,20}\b(send|transfer)\b/i,
  /\binheritance\s+of\s+\$?[\d,]+/i,
  /\b(usdt|btc|eth)\s+giveaway\b/i
];
function looksLikeScam(body) {
  if (!body || body.length < 8) return false;
  return SCAM_PATTERNS.some((re) => re.test(body));
}

// ---- known-scam-number list the owner curates (persisted) ----
const { data: blocklist, save: saveBlocklist } = createStore('blocklist');
function blAdd(number, reason) {
  blocklist[number] = { reason: reason || 'reported', addedAt: Date.now() };
  saveBlocklist();
}
function blRemove(number) {
  const had = !!blocklist[number];
  delete blocklist[number];
  if (had) saveBlocklist();
  return had;
}
const blCheck = (number) => blocklist[number] || null;

// ---- obvious phishing-link patterns ----
const SUSPICIOUS_LINK = [
  /\.(tk|ml|ga|cf|gq)\//i,                      // free domains heavily abused for phishing
  /bit\.ly|tinyurl\.com|t\.co\/|cutt\.ly/i,     // shorteners hiding the real destination
  /wa\.me.{0,5}(verify|support|official)/i,     // fake "official WhatsApp support" links
  /whatsapp-?(verify|support|help)\./i,
  /(paypal|bank|amazon|netflix)-?(verify|secure|login|update)\./i // brand name + action word in the domain itself
];
function linkLooksSuspicious(url) {
  return SUSPICIOUS_LINK.some((re) => re.test(url));
}

module.exports = {
  setOtp, setScam, isOtpOn, isScamOn,
  looksLikeOtpRequest, looksLikeScam, linkLooksSuspicious,
  blAdd, blRemove, blCheck, blocklist,
  notifier
};
