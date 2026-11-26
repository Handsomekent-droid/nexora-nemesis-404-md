/**
 * Auto-features engine (Build 26): works on raw WhatsApp events, per paired account, switched by the
 * owner commands in lib/cmds/auto.js (all settings are saved per account in data/settings.json).
 *   autoviewstatus · autolikestatus · alwaysonline · anticall · antidelete · antiviewonce · autorecording · autobio
 * It also keeps a SMALL in-memory copy (RAM only, never written to disk) of view-once photos/videos/voice notes that
 * arrive while the bot is online, so `.vv` can open them even after the sender's copy has been "opened".
 */
const config = require('../config');
const settings = require('./settings');

const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const silentLogger = { level: 'silent', info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return this; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- unwrap helpers ---------- */
function unwrap(msg) {
  let x = msg || {};
  for (let i = 0; i < 4; i++) {
    const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.viewOnceMessageV2Extension?.message || x.documentWithCaptionMessage?.message;
    if (!inner) break;
    x = inner;
  }
  return x;
}
const wasViewOnce = (msg) => !!(msg?.viewOnceMessage || msg?.viewOnceMessageV2 || msg?.viewOnceMessageV2Extension ||
  msg?.ephemeralMessage?.message?.viewOnceMessage || msg?.ephemeralMessage?.message?.viewOnceMessageV2 ||
  ['imageMessage', 'videoMessage', 'audioMessage'].some((k) => msg?.[k]?.viewOnce));
const MEDIA = [['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'audio']];

/* ---------- RAM caches ---------- */
const VO_MAX_ITEMS = 25, VO_MAX_BYTES = 40 * 1024 * 1024, VO_TTL = 3 * 3600 * 1000;
const vo = new Map(); // `${acct}:${id}` -> { kind, buffer, mime, from, chat, at }
let voBytes = 0;
function voPut(key, item) {
  vo.set(key, item); voBytes += item.buffer.length;
  while (vo.size > VO_MAX_ITEMS || voBytes > VO_MAX_BYTES) { const k = vo.keys().next().value; voBytes -= vo.get(k).buffer.length; vo.delete(k); }
}
const viewOnceFor = (acct, id) => {
  const it = vo.get(`${acct}:${id}`);
  if (it && Date.now() - it.at > VO_TTL) { voBytes -= it.buffer.length; vo.delete(`${acct}:${id}`); return null; }
  return it || null;
};

const MSG_CAP = 1500;
const msgs = new Map(); // `${acct}:${id}` -> { m, at }   (for antidelete; message objects only, no media bytes)
const remember = (acct, m) => { msgs.set(`${acct}:${m.key.id}`, { m, at: Date.now() }); if (msgs.size > MSG_CAP) for (const k of [...msgs.keys()].slice(0, 300)) msgs.delete(k); };

async function download(sock, m, message) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  return downloadMediaMessage({ key: m.key, message }, 'buffer', {}, { logger: silentLogger, reuploadRequest: sock.updateMediaMessage });
}

/* ---------- per-socket registry (presence / bio timers) ---------- */
const socks = new Map(); // acct -> sock
const startedAt = Date.now();
const uptime = () => { const s = Math.floor((Date.now() - startedAt) / 1000); return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`; };

function onOpen(sock) {
  const acct = num(sock.user?.id);
  if (acct) socks.set(acct, sock);
  const S = settings.peek(acct);
  if (S?.alwaysonline) sock.sendPresenceUpdate('available').catch(() => {});
}
function onClose(sock) { const acct = num(sock.user?.id); if (acct && socks.get(acct) === sock) socks.delete(acct); }

let lastBio = new Map();
const timer = setInterval(() => {
  for (const [acct, sock] of socks) {
    const S = settings.peek(acct); if (!S) continue;
    if (S.alwaysonline) sock.sendPresenceUpdate('available').catch(() => {});
    if (S.autobio && Date.now() - (lastBio.get(acct) || 0) >= 5 * 60 * 1000) { lastBio.set(acct, Date.now()); setBio(sock, S).catch(() => {}); }
  }
}, 25 * 1000);
timer.unref?.();

function bioText(S) {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: config.TIMEZONE }).format(now);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: config.TIMEZONE }).format(now);
  return String(S.autobioText || '🤖 {bot} • up {uptime} • {time}').replace(/\{bot\}/g, 'Nexora Nemesis').replace(/\{uptime\}/g, uptime()).replace(/\{time\}/g, time).replace(/\{date\}/g, date).slice(0, 139);
}
const setBio = (sock, S) => sock.updateProfileStatus(bioText(S));

/* ---------- messages ---------- */
const isOwnerJid = (S, acct, jid) => { const n = num(jid); return n === acct || (config.OWNER_NUMBERS || []).includes(n) || (S?.sudo || []).includes(n); };

/* --- view-once: keep a RAM copy so .vv works (also for ones you sent yourself), forward when antiviewonce is on --- */
async function keepViewOnce(sock, m, S, acct, chat) {
  if (!wasViewOnce(m.message)) return;
  const inner = unwrap(m.message);
  const found = MEDIA.find(([k]) => inner[k]);
  if (!found) return;
  try {
    const buffer = await download(sock, m, inner);
    const from = m.key.fromMe ? `${acct}@s.whatsapp.net` : (m.key.participant || chat);
    const item = { kind: found[1], buffer, mime: inner[found[0]].mimetype || '', caption: inner[found[0]].caption || '', from, chat, at: Date.now() };
    voPut(`${acct}:${m.key.id}`, item);
    if (S?.antiviewonce && !m.key.fromMe) await sendKept(sock, `${acct}@s.whatsapp.net`, item, `👁 View-once from @${num(from)}${chat.endsWith('@g.us') ? ' (group)' : ''}`);
  } catch (e) { console.error('[viewonce] could not copy:', e?.message || 'failed'); }
}

async function onMessage(sock, m, type) {
  if (!m?.key || !m.message) return;
  const acct = num(sock.user?.id);
  const S = settings.peek(acct);
  const chat = m.key.remoteJid;

  /* --- statuses --- */
  if (chat === 'status@broadcast') {
    if (m.key.fromMe || !S || type !== 'notify') return;
    const poster = m.key.participant || m.participant;
    if (!poster) return;
    if (S.autoviewstatus) { await sleep(1500 + Math.random() * 3500); await sock.readMessages([m.key]).catch(() => {}); }
    if (S.autolikestatus) {
      await sleep(2500 + Math.random() * 4000);
      await sock.sendMessage('status@broadcast', { react: { text: S.statusEmoji || '❤️', key: m.key } }, { statusJidList: [poster, sock.user.id] }).catch(() => {});
    }
    return;
  }
  if (m.key.fromMe) { await keepViewOnce(sock, m, S, acct, chat); return; }

  /* --- deleted messages (antidelete) --- */
  const proto = m.message.protocolMessage;
  if (proto && proto.type === 0 && proto.key?.id) {
    if (!S?.antidelete) return;
    const old = msgs.get(`${acct}:${proto.key.id}`);
    if (old) await forwardDeleted(sock, acct, old.m, m).catch((e) => console.error('[antidelete]', e?.message || 'failed'));
    return;
  }

  await keepViewOnce(sock, m, S, acct, chat);
  if (type === 'notify' && S?.nexoraAI) require('./nexoraai').maybeReply(sock, m, S, acct, chat).catch((e) => console.error('[nexora-ai]', e?.message || 'failed'));

  /* --- remember for antidelete / autorecording --- */
  if (S?.antidelete) remember(acct, m);
  if (S?.autorecording && (chat.endsWith('@s.whatsapp.net') || chat.endsWith('@lid'))) {
    sock.sendPresenceUpdate('recording', chat).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate('paused', chat).catch(() => {}), 3500).unref?.();
  }
}

async function sendKept(sock, to, item, caption) {
  const mentions = [item.from].filter(Boolean);
  const cap = item.caption ? `${caption}\n\n${item.caption}` : caption;
  if (item.kind === 'image') return sock.sendMessage(to, { image: item.buffer, caption: cap, mentions });
  if (item.kind === 'video') return sock.sendMessage(to, { video: item.buffer, caption: cap, mentions, mimetype: item.mime || 'video/mp4' });
  await sock.sendMessage(to, { text: cap, mentions });
  return sock.sendMessage(to, { audio: item.buffer, mimetype: item.mime || 'audio/ogg; codecs=opus', ptt: true });
}

async function forwardDeleted(sock, acct, old, revoke) {
  const to = `${acct}@s.whatsapp.net`;
  const chat = old.key.remoteJid;
  const who = old.key.participant || chat;
  const head = `🗑 *Deleted message*\nFrom: @${num(who)}${chat.endsWith('@g.us') ? '\nGroup: ' + chat : ''}`;
  const inner = unwrap(old.message);
  const text = inner.conversation || inner.extendedTextMessage?.text;
  if (text) return sock.sendMessage(to, { text: `${head}\n\n${text}`, mentions: [who] });
  const found = [...MEDIA, ['stickerMessage', 'sticker'], ['documentMessage', 'document']].find(([k]) => inner[k]);
  if (!found) return sock.sendMessage(to, { text: `${head}\n\n_(${Object.keys(inner)[0] || 'unknown'} message)_`, mentions: [who] });
  const buffer = await download(sock, old, inner);
  const [k, kind] = found;
  const cap = `${head}${inner[k].caption ? '\n\n' + inner[k].caption : ''}`;
  if (kind === 'sticker') { await sock.sendMessage(to, { text: head, mentions: [who] }); return sock.sendMessage(to, { sticker: buffer }); }
  if (kind === 'audio') { await sock.sendMessage(to, { text: head, mentions: [who] }); return sock.sendMessage(to, { audio: buffer, mimetype: inner[k].mimetype || 'audio/ogg; codecs=opus', ptt: !!inner[k].ptt }); }
  if (kind === 'document') return sock.sendMessage(to, { document: buffer, mimetype: inner[k].mimetype, fileName: inner[k].fileName || 'file', caption: cap, mentions: [who] });
  return sock.sendMessage(to, { [kind]: buffer, caption: cap, mentions: [who] });
}

/* ---------- calls ---------- */
async function onCall(sock, calls) {
  const acct = num(sock.user?.id);
  const S = settings.peek(acct);
  if (!S?.anticall) return;
  for (const c of calls || []) {
    if (c.status !== 'offer' || !c.from || c.isGroup) continue;
    if (isOwnerJid(S, acct, c.from)) continue;
    try {
      await sock.rejectCall(c.id, c.from);
      await sock.sendMessage(c.from, { text: S.anticallMsg || '📵 Calls are not accepted on this number. Please send a message instead.' });
      if (S.anticallMode === 'block') await sock.updateBlockStatus(c.from, 'block');
    } catch (e) { console.error('[anticall]', e?.message || 'failed'); }
  }
}

module.exports = { onOpen, onClose, onMessage, onCall, viewOnceFor, sendKept, setBio, bioText, num, _vo: vo };
