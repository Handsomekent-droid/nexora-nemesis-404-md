/**
 * HUB API, part 2 (Build 29) — used by the Prime Kent Dev Hub website through lib/webpair.js (same shared secret).
 *   GET  /hub/settings?id=      read the switches of one of YOUR numbers
 *   POST /hub/settings          change them  { id, patch }
 *   POST /hub/reconnect         reconnect a number without logging it out  { id }
 *   POST /hub/post-status       post text or a photo to the number's WhatsApp status  { id, text, image(base64) }
 *   GET  /hub/admin/overview    totals (admin only)
 *   GET  /hub/admin/sessions    every session, phone numbers masked (admin only)
 *   POST /hub/admin/remove      remove any session (admin only)
 * "admin" is decided by the Vercel site (ADMIN_EMAILS) and passed as a header that only the secret holder can set.
 */
const config = require('../config');
const db = require('./db');
const wa = require('./wa');
const settings = require('./settings');

const BOOL = ['autoread', 'autotyping', 'autoreact', 'autoviewstatus', 'autolikestatus', 'alwaysonline', 'antidelete', 'antiviewonce', 'autorecording', 'autobio', 'anticall'];
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];
const mask = (ph) => (ph ? `+${ph.slice(0, 4)}${'•'.repeat(Math.max(0, ph.length - 7))}${ph.slice(-3)}` : '');
const statusAt = new Map(); // session -> last status post (cooldown)

// the settings are stored under the WhatsApp number of the account
function acctOf(id) {
  const sock = wa.getSock(id);
  return userPart(sock?.user?.id) || String(db.get(id)?.phone || '');
}

function view(acct) {
  const S = settings.get(acct);
  const o = {};
  for (const k of BOOL) o[k] = !!S[k];
  o.prefix = S.prefix || config.PREFIX;
  o.statusEmoji = S.statusEmoji;
  o.autobioText = S.autobioText;
  o.anticallMode = S.anticallMode === 'block' ? 'block' : 'reject';
  o.autoreply = { on: !!S.autoreply?.on, text: S.autoreply?.text || '' };
  o.commandsRun = S.commandsRun || 0;
  return o;
}

// only these keys, only these shapes — anything else is ignored
function clean(patch, acct) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const k of BOOL) if (typeof patch[k] === 'boolean') out[k] = patch[k];
  if (typeof patch.prefix === 'string') {
    const v = patch.prefix.trim();
    if (!v) out.prefix = null;
    else if (v.length <= 3 && !/\s/.test(v)) out.prefix = v;
  }
  if (typeof patch.statusEmoji === 'string') {
    const v = patch.statusEmoji.trim();
    if (v && v.length <= 8 && !/[a-z0-9]/i.test(v)) out.statusEmoji = v;
  }
  if (typeof patch.autobioText === 'string') {
    const v = patch.autobioText.trim();
    if (v && v.length <= 120) out.autobioText = v;
  }
  if (patch.anticallMode === 'reject' || patch.anticallMode === 'block') out.anticallMode = patch.anticallMode;
  if (patch.autoreply && typeof patch.autoreply === 'object') {
    const cur = settings.get(acct).autoreply || {};
    const text = typeof patch.autoreply.text === 'string' ? patch.autoreply.text.trim().slice(0, 300) : cur.text;
    out.autoreply = { on: typeof patch.autoreply.on === 'boolean' ? patch.autoreply.on : !!cur.on, text: text || cur.text };
  }
  return out;
}

async function handle({ req, res, p, url, who, T, json, readBody, jobs }) {
  const mine = (id) => T.keysOf(who.oid).includes(String(id));

  if (req.method === 'GET' && p === '/hub/settings') {
    const id = url.searchParams.get('id') || '';
    if (!mine(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    const acct = acctOf(id);
    if (!acct) return json(res, 409, { ok: false, msg: 'This number is not ready yet. Finish pairing first.' });
    return json(res, 200, { ok: true, state: wa.isOnline(id) ? 'connected' : 'offline', phone: mask(acct), settings: view(acct) });
  }

  if (req.method === 'POST' && p === '/hub/settings') {
    let b; try { b = await readBody(req, 4096); } catch { return json(res, 400, { ok: false, msg: 'Bad request.' }); }
    const id = String(b.id || '');
    if (!mine(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    const acct = acctOf(id);
    if (!acct) return json(res, 409, { ok: false, msg: 'This number is not ready yet.' });
    const patch = clean(b.patch, acct);
    if (!Object.keys(patch).length) return json(res, 400, { ok: false, msg: 'Nothing valid to change.' });
    settings.set(acct, patch);
    if ('alwaysonline' in patch) { try { await wa.getSock(id)?.sendPresenceUpdate(patch.alwaysonline ? 'available' : 'unavailable'); } catch {} }
    return json(res, 200, { ok: true, settings: view(acct) });
  }

  if (req.method === 'POST' && p === '/hub/reconnect') {
    let b; try { b = await readBody(req, 1024); } catch { return json(res, 400, { ok: false }); }
    const id = String(b.id || '');
    if (!mine(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    if (!wa.hasSession(id)) return json(res, 409, { ok: false, msg: 'This number is not paired yet. Pair it first.' });
    try { await wa.restart(id, T.hooksFor(id)); } catch (e) { console.error('[hub] reconnect', id, e?.message || e); return json(res, 500, { ok: false, msg: 'Could not reconnect. Try again in a minute.' }); }
    return json(res, 200, { ok: true, msg: 'Reconnecting… give it about a minute.' });
  }

  if (req.method === 'POST' && p === '/hub/post-status') {
    let b; try { b = await readBody(req, 5 * 1024 * 1024); } catch { return json(res, 400, { ok: false, msg: 'That was too big. Use a smaller picture.' }); }
    const id = String(b.id || '');
    if (!mine(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    const sock = wa.getSock(id);
    if (!sock || !wa.isOnline(id)) return json(res, 409, { ok: false, msg: 'This number is offline right now.' });
    if (Date.now() - (statusAt.get(id) || 0) < 20000) return json(res, 429, { ok: false, msg: 'Slow down. Wait a few seconds.' });
    const text = String(b.text || '').trim().slice(0, 700);
    let img = null;
    if (typeof b.image === 'string' && b.image) {
      try { img = Buffer.from(b.image.replace(/^data:image\/\w+;base64,/, ''), 'base64'); } catch { img = null; }
      const jpg = img && img[0] === 0xff && img[1] === 0xd8, png = img && img[0] === 0x89 && img[1] === 0x50;
      if (!img || img.length > 3 * 1024 * 1024 || !(jpg || png)) return json(res, 400, { ok: false, msg: 'Use a JPG or PNG picture under 3 MB.' });
    }
    if (!img && !text) return json(res, 400, { ok: false, msg: 'Type something or choose a picture.' });
    statusAt.set(id, Date.now());

    const audience = new Set([`${acctOf(id)}@s.whatsapp.net`]);
    try {
      const groups = Object.values(await sock.groupFetchAllParticipating());
      for (const g of groups) for (const x of g.participants || []) { const j = x.jid || x.id; if (j && j.endsWith('@s.whatsapp.net')) audience.add(j); }
    } catch (e) { console.error('[hub] status audience:', e?.message || e); }
    const statusJidList = [...audience].slice(0, 3000);
    const content = img
      ? { image: img, caption: text }
      : { text, backgroundColor: ['#128C7E', '#6A1B9A', '#1565C0', '#C62828', '#2E7D32', '#EF6C00'][Math.floor(Math.random() * 6)], font: Math.floor(Math.random() * 5) };
    try {
      await sock.sendMessage('status@broadcast', content, { statusJidList });
      return json(res, 200, { ok: true, msg: `Posted to your status (${statusJidList.length - 1} people can see it).` });
    } catch (e) {
      console.error('[hub] status post:', e?.message || e);
      return json(res, 502, { ok: false, msg: 'WhatsApp refused the status. Try again, or use a smaller picture.' });
    }
  }

  /* ---------- admin ---------- */
  if (p.startsWith('/hub/admin/')) {
    if (!who.admin) return json(res, 403, { ok: false, msg: 'Admins only.' });
    if (req.method === 'GET' && p === '/hub/admin/overview') {
      const ids = wa.sessionIds();
      return json(res, 200, {
        ok: true, build: config.BUILD, name: config.BOT_NAME,
        sessions: ids.length, online: ids.filter((i) => wa.isOnline(i)).length,
        web: ids.filter((i) => i.startsWith('web')).length, telegram: ids.filter((i) => !i.startsWith('web')).length,
        max: config.MAX_SESSIONS, uptime: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576)
      });
    }
    if (req.method === 'GET' && p === '/hub/admin/sessions') {
      const rows = wa.sessionIds().slice(0, 1500).map((i) => {
        const u = db.get(i) || {};
        return { id: i, source: i.startsWith('web') ? 'web' : 'telegram', phone: mask(String(u.phone || '')), online: wa.isOnline(i), pairedAt: u.pairedAt || null };
      });
      return json(res, 200, { ok: true, sessions: rows });
    }
    if (req.method === 'POST' && p === '/hub/admin/remove') {
      let b; try { b = await readBody(req, 1024); } catch { return json(res, 400, { ok: false }); }
      const id = String(b.id || '');
      if (!wa.sessionIds().includes(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
      await T.removeSession(id); jobs.delete(id);
      return json(res, 200, { ok: true });
    }
  }
  return false;
}

module.exports = { handle, _clean: clean, _view: view };
