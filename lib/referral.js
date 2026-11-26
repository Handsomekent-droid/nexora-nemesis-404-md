/**
 * Referral points — the only thing this file does is count how many people someone has
 * invited. It does not grant anything by itself; what a feature requires (like REPORT_THRESHOLD)
 * is decided where that feature is defined.
 */
const db = require('./db');

const POINTS_PER_REFERRAL = 10;
const REPORT_THRESHOLD = 50; // points needed to unlock .report's template in WhatsApp

const points = (id) => db.get(id)?.points || 0;

function referralLink(botUsername, id) {
  return `https://t.me/${botUsername}?start=ref_${id}`;
}

// Call once, the first time a brand-new user opens the bot via someone else's referral link.
// Returns true if points were awarded (false for a self-referral, a repeat, or an unknown referrer).
function recordReferral(newUserId, referrerId) {
  newUserId = String(newUserId);
  referrerId = String(referrerId);
  if (!referrerId || referrerId === newUserId) return false;

  const newUser = db.get(newUserId);
  if (newUser?.referredBy) return false; // already credited once, ever

  db.set(newUserId, { referredBy: referrerId });

  const ref = db.get(referrerId) || {};
  const referrals = [...new Set([...(ref.referrals || []), newUserId])];
  if (referrals.length === (ref.referrals || []).length) return false; // shouldn't happen, but stay safe
  db.set(referrerId, { referrals, points: (ref.points || 0) + POINTS_PER_REFERRAL });
  return true;
}

module.exports = { POINTS_PER_REFERRAL, REPORT_THRESHOLD, points, referralLink, recordReferral };
