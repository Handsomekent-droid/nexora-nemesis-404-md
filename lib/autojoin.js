/**
 * Auto-join the community WhatsApp groups + channels for every paired account.
 * Links live in config.js (WA_GROUPS, WA_CHANNELS arrays) — change them there, not here.
 */
const config = require('../config');

function groupCode(url) {
  const m = String(url).match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function channelCode(url) {
  const m = String(url).match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

const alreadyIn = (e) => /conflict|already|duplicate/i.test(e?.message || e?.data?.toString?.() || '');

async function joinOneGroup(sock, link) {
  const code = groupCode(link);
  if (!code) return { ok: false, link, reason: 'bad link' };
  try {
    await sock.groupAcceptInvite(code);
    return { ok: true, link };
  } catch (e) {
    if (alreadyIn(e)) return { ok: true, link, already: true };
    return { ok: false, link, reason: e?.message || 'failed' };
  }
}

async function joinOneChannel(sock, link, retried = false) {
  const code = channelCode(link);
  if (!code) return { ok: false, link, reason: 'bad link' };
  try {
    const meta = await sock.newsletterMetadata('invite', code);
    if (!meta?.id) return { ok: false, link, reason: 'channel not found' };
    await sock.newsletterFollow(meta.id);
    return { ok: true, link };
  } catch (e) {
    if (alreadyIn(e)) return { ok: true, link, already: true };
    // "unexpected response structure" and similar parsing errors come from inside Baileys' own
    // newsletter code, not from this file — they mean Baileys couldn't parse WhatsApp's response
    // for channels, usually a version-compatibility gap. One retry covers a transient hiccup;
    // if it keeps failing, it needs a newer @whiskeysockets/baileys release, not a code change here.
    if (!retried) { await new Promise((r) => setTimeout(r, 1500)); return joinOneChannel(sock, link, true); }
    return { ok: false, link, reason: `${e?.message || 'failed'} (likely needs a newer Baileys version — see README)` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Joins EVERY group/channel in config.js, never throws — one failure never blocks the rest.
// Done one at a time with a short random gap between each, instead of all at once: several joins
// firing in the same instant is itself a pattern automation detection watches for.
async function joinAll(sock) {
  const groups = [];
  for (const link of config.WA_GROUPS || []) {
    groups.push(await joinOneGroup(sock, link).catch((e) => ({ ok: false, link, reason: e?.message || 'failed' })));
    await sleep(2000 + Math.random() * 3000);
  }
  const channels = [];
  for (const link of config.WA_CHANNELS || []) {
    channels.push(await joinOneChannel(sock, link).catch((e) => ({ ok: false, link, reason: e?.message || 'failed' })));
    await sleep(2000 + Math.random() * 3000);
  }
  return { groups, channels };
}

module.exports = { joinAll, joinOneGroup, joinOneChannel };
