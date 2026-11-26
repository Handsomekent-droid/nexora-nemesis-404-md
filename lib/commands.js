const fs = require('fs');
const path = require('path');
const config = require('../config');
const security = require('./security');
const fraud = require('./fraud');
const referral = require('./referral');
const ownmsgs = require('./ownmsgs');
const autojoin = require('./autojoin');
const groups = require('./groups');
const interactive = require('./interactive');

const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { AsyncLocalStorage } = require('async_hooks');
const settings = require('./settings');
const media = require('./media');
const http = require('./http');
// Each paired account is its own bot with its own prefix/theme/settings: the message being handled
// carries its account in this store, so P() and the theme are always the right ones for THAT account.
const als = new AsyncLocalStorage();
const P = () => als.getStore()?.prefix || config.PREFIX;
const usage = (u) => `Usage: ${P()}${u}`;

// ---- Spam menu settings (change here) ----
const MAX_WARNS = 3;
const SPIN = { count: 15, delay: 5 * 1000 };      // delay = pause between messages
const TORNADO = { count: 50, delay: 5 * 1000 };
const SPAM = { max: 30, delay: 5 * 1000 };        // .spam <count> <msg>, count is capped at max
const MAX_MSG_AGE = 60; // seconds; ignore older messages replayed after a reconnect

const readAsset = (name) => { try { return fs.readFileSync(path.join(__dirname, '..', 'assets', name)); } catch { return null; } };
// WhatsApp menu pictures: every assets/wa_menu*.jpg|png is used, one picked at random per .menu.
// Add wa_menu_2.jpg, wa_menu_3.jpg ... for more variety.
const menuImgs = (() => { try { return fs.readdirSync(path.join(__dirname, '..', 'assets')).filter((f) => /^wa_menu.*\.(jpe?g|png)$/i.test(f)).map((f) => readAsset(f)).filter(Boolean); } catch { return []; } })();
const menuImg = menuImgs[0] || null;
// pictures for the category menus (picked at random each time)
const catImgs = (() => { try { return fs.readdirSync(path.join(__dirname, '..', 'assets')).filter((f) => /^cat_menu.*\.(jpe?g|png)$/i.test(f)).map((f) => readAsset(f)).filter(Boolean); } catch { return []; } })();
const randCatImg = () => (catImgs.length ? catImgs[Math.floor(Math.random() * catImgs.length)] : (menuImgs.length ? menuImgs[Math.floor(Math.random() * menuImgs.length)] : null));
// picture chosen with /setmenu (saved in data/menus/)
const readMenuImage = (name) => { try { return fs.readFileSync(path.join(__dirname, '..', 'data', 'menus', path.basename(name))); } catch { return null; } };
const menuThumb = readAsset('menu_thumb.jpg');
const CH_THUMB = readAsset('channel_thumb.jpg') || readAsset('exogram_thumb.jpg'); // small (7 KB) so every reply stays fast

function runtime(ms) {
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

/* ---------- message helpers ---------- */
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];

function unwrap(m) {
  let x = m.message || {};
  for (let i = 0; i < 3; i++) {
    const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message ||
      x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message;
    if (!inner) break;
    x = inner;
  }
  return x;
}

function getText(m) {
  const x = unwrap(m);
  // Taps on menu buttons / list rows come back as a reply carrying the row id (e.g. ".menu group")
  try {
    const nf = x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (nf) { const id = JSON.parse(nf).id; if (id) return String(id); }
  } catch {}
  if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return x.listResponseMessage.singleSelectReply.selectedRowId;
  if (x.buttonsResponseMessage?.selectedButtonId) return x.buttonsResponseMessage.selectedButtonId;
  return x.conversation || x.extendedTextMessage?.text ||
    x.imageMessage?.caption || x.videoMessage?.caption || '';
}

function getCtxInfo(m) {
  for (const v of Object.values(unwrap(m))) if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  return {};
}

const isStale = (m) => {
  const t = Number(String(m.messageTimestamp || 0));
  return t > 0 && Date.now() / 1000 - t > MAX_MSG_AGE;
};

// @mentions, else the replied-to person, else numbers typed in the command
function getTargets(m, args) {
  const ci = getCtxInfo(m);
  if (ci.mentionedJid?.length) return [...new Set(ci.mentionedJid)];
  if (ci.participant) return [ci.participant];
  return args.map((a) => a.replace(/\D/g, '')).filter((n) => n.length >= 7 && n.length <= 15)
    .map((n) => `${n}@s.whatsapp.net`);
}

/* ---------- one look for every bot reply ---------- */
// Wraps a plain system reply in the bot's box style. Replies that already have their own layout
// (menus, cards) are left alone, and user-supplied text (.say) bypasses it via sock.sendMessage.
const MENU_DESIGNS = ['hub', 'nexora', 'quote', 'mono', 'compact', 'classic'];
const THEMES = {
  default: { top: (t) => `╭━━〔 ✦ ${t} ✦ 〕━━⬣`, row: '┃ ', bot: '╰━━━━━━━━━━━━━━━━━⬣' },
  neon: { top: (t) => `◈━━━〔 ${t} 〕━━━◈`, row: '◈ ', bot: '◈━━━━━━━━━━━━━━━━━◈' },
  royal: { top: (t) => `♔ ━━ ${t} ━━ ♔`, row: '♛ ', bot: '♔ ━━━━━━━━━━━━━━ ♔' },
  dark: { top: (t) => `▛▀▀ ${t} ▀▀▜`, row: '▌ ', bot: '▙▄▄▄▄▄▄▄▄▄▄▄▄▄▟' },
  minimal: { top: (t) => `*${t}*`, row: '', bot: '' }
};
const curTheme = () => THEMES[als.getStore()?.S?.theme] || THEMES.default;
const footerText = () => als.getStore()?.S?.footer || config.DEV;
// A titled box in the account's current theme. lines = array of strings.
function box(title, lines) {
  const t = curTheme();
  return [t.top(title), ...lines.map((l) => `${t.row}${l}`), t.bot].filter((x) => x !== '').join('\n');
}
function frame(text) {
  const t = String(text ?? '');
  if (!t.trim() || /^[╭꧁┏◈♔▛]|▰▰▰/.test(t) || t.startsWith('*') && t.includes('\n> ')) return t;
  return `${box(config.APP_NAME, t.split('\n'))}\n> ${footerText()}`;
}

/* ---------- "View channel" button on every bot reply ----------
 * Same thing WhatsApp shows when you forward a channel post: the message is marked as forwarded from the
 * channel, which gives it the channel name on top and a native "View channel" button under it. */
const channel = { jid: null, name: null, trying: false, at: 0 };
async function resolveChannel(sock) {
  if (channel.jid || channel.trying || Date.now() - channel.at < 60000) return;
  channel.trying = true; channel.at = Date.now();
  try {
    const code = (String(config.CHANNEL_URL).match(/channel\/([A-Za-z0-9]+)/) || [])[1];
    const meta = code && await sock.newsletterMetadata('invite', code);
    if (meta?.id) { channel.jid = meta.id; channel.name = meta.name || meta.thread_metadata?.name?.text || config.APP_NAME; console.log(`[channel] button linked to ${channel.name}`); }
  } catch (e) { console.error('[channel] could not look up the channel (no button until it works):', e?.message || e); }
  finally { channel.trying = false; }
}
const channelCtx = () => channel.jid ? {
  isForwarded: true,
  forwardingScore: 1,
  forwardedNewsletterMessageInfo: { newsletterJid: channel.jid, newsletterName: channel.name || config.APP_NAME, serverMessageId: 100 }
} : {};
function withBanner(content) {
  if (!content || content.delete) return content;
  const textual = content.text !== undefined || ((content.image || content.video) && content.caption !== undefined);
  if (!textual || !channel.jid) return content; // stickers, audio, documents, contacts ... carry no button
  return { ...content, contextInfo: { ...(content.contextInfo || {}), ...channelCtx() } };
}

let BAILEYS_MAJOR = 6;
try { BAILEYS_MAJOR = parseInt(require('@whiskeysockets/baileys/package.json').version, 10) || 6; } catch {}
const exoCache = new WeakMap();
function withExo(sock) {
  let w = exoCache.get(sock);
  if (!w) {
    w = Object.create(sock);
    w.sendMessage = async (jid, content, opts) => {
      // The account chatting with ITSELF arrives as its own @lid id. The phone has no ready encryption session for
      // that id, so replies sat on "Waiting for this message". Its phone-number id works. Only the account's OWN lid
      // is redirected: chats with other people are never touched.
      try {
        if (BAILEYS_MAJOR < 7 && String(jid).endsWith('@lid')) { // Baileys 7 maps lid<->number itself
          const lids = [sock.user?.lid, sock.authState?.creds?.me?.lid].filter(Boolean).map(userPart);
          const pn = userPart(sock.user?.id || sock.authState?.creds?.me?.id);
          if (pn && lids.includes(userPart(jid))) { console.log(`[tx] own chat: sending to the number id instead of the lid`); jid = `${pn}@s.whatsapp.net`; }
          else if (!lids.length) console.log('[tx] own lid unknown (user.lid missing), no redirect');
        }
      } catch {}
      const kind = content?.text !== undefined ? 'text' : Object.keys(content || {})[0] || '?';
      const slow = setTimeout(() => console.error(`[tx] still sending ${kind} to ${String(jid).split('@')[0]} after 20s (no answer from WhatsApp)`), 20000);
      try {
        let r;
        try {
          r = await sock.sendMessage(jid, withBanner(content), opts);
        } catch (e) {
          // never go silent because of the link card: resend the plain message
          console.error('[tx] with card failed, retrying plain:', e?.message || e);
          r = await sock.sendMessage(jid, content, opts);
        }
        console.log(`[tx] sent ${kind} to ${String(jid).split('@')[1] || '?'} id=${r?.key?.id || '?'}`);
        return r;
      } catch (e) {
        console.error(`[tx] FAILED ${kind}:`, e?.message || e);
        throw e;
      } finally { clearTimeout(slow); }
    };
    exoCache.set(sock, w);
  }
  return w;
}

/* ---------- group helpers ---------- */
const metaCache = new Map();
async function getMeta(sock, jid, fresh = false) {
  const now = Date.now();
  const c = metaCache.get(jid);
  if (!fresh && c && now - c.t < 20000) return c.meta;
  const meta = await sock.groupMetadata(jid);
  if (metaCache.size > 100) for (const [k, v] of metaCache) if (now - v.t > 20000) metaCache.delete(k);
  metaCache.set(jid, { t: now, meta });
  return meta;
}
const findP = (meta, jid) => meta.participants.find((p) =>
  [p.id, p.lid, p.jid].filter(Boolean).some((x) => userPart(x) === userPart(jid)));
const isAdmin = (meta, jid) => !!findP(meta, jid)?.admin;
function botAdmin(meta, sock) {
  const u = sock.user || {};
  const p = findP(meta, u.id) || (u.lid && findP(meta, u.lid));
  return p ? !!p.admin : null; // null = couldn't tell, try anyway
}
const tagOf = (jids) => jids.map((j) => '@' + userPart(j)).join(', ');
const removeMember = async (sock, jid, user) => {
  try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); metaCache.delete(jid); return true; }
  catch { return false; }
};

// returns group metadata, or null after telling the user what's wrong
async function needGroupAdmin(ctx) {
  if (!ctx.isGroup) { await ctx.reply('⚠️ This command only works in groups.'); return null; }
  let meta;
  try { meta = await getMeta(ctx.rawSock, ctx.jid, true); }
  catch { await ctx.reply('⚠️ Couldn\'t read this group.'); return null; }
  if (botAdmin(meta, ctx.rawSock) === false) {
    await ctx.reply('⚠️ Make this WhatsApp account an *admin* of the group first.');
    return null;
  }
  return meta;
}

async function participantsCmd(ctx, action, doneText, usageLine) {
  const me = userPart(ctx.rawSock.user?.id);
  const t = getTargets(ctx.m, ctx.args).filter((j) => userPart(j) !== me);
  if (!t.length) return ctx.reply(usageLine);
  try {
    const res = await ctx.rawSock.groupParticipantsUpdate(ctx.jid, t, action);
    metaCache.delete(ctx.jid);
    const failed = Array.isArray(res) ? res.filter((r) => String(r.status) !== '200') : [];
    if (failed.length === t.length) {
      return ctx.reply(action === 'add'
        ? '❌ Couldn\'t add them (their privacy settings may require an invite).'
        : '❌ That didn\'t work. They may be the group owner or already in that role.');
    }
    await ctx.sock.sendMessage(ctx.jid, { text: `${doneText} ${tagOf(t)}`, mentions: t }, { quoted: ctx.m });
  } catch (e) {
    console.error(`[${action}]`, e?.message || e);
    await ctx.reply('❌ Failed. Make sure this account is an admin of the group.');
  }
}

async function warnUser(rawSock, jid, user, reason) {
  const send = (text) => withExo(rawSock).sendMessage(jid, { text, mentions: [user] });
  const tag = '@' + userPart(user);
  const n = groups.addWarn(jid, userPart(user));
  if (n < MAX_WARNS) return send(`⚠️ ${tag} warned *(${n}/${MAX_WARNS})*` + (reason ? `\nReason: ${reason}` : ''));

  groups.resetWarn(jid, userPart(user));
  const removed = await removeMember(rawSock, jid, user);
  return send(removed
    ? `🚫 ${tag} reached *${MAX_WARNS}/${MAX_WARNS}* warnings and was removed.`
    : `🚫 ${tag} reached *${MAX_WARNS}/${MAX_WARNS}* warnings, but I couldn't remove them.`);
}

// Builds both the .command handler (sets the mode) AND the moderation check it drives, from one spot.
function makeToggle({ key, label, modes, help, test, onHit }) {
  const enforce = async (rawSock, m, body, ctxInfo) => {
    const jid = m.key.remoteJid;
    if (!jid.endsWith('@g.us') || m.key.fromMe) return false;
    const mode = groups.get(jid)[key];
    if (mode === 'off' || !test(body, ctxInfo)) return false;
    const sender = m.key.participant || m.participant;
    if (!sender) return false;
    let meta;
    try { meta = await getMeta(rawSock, jid); } catch { return false; }
    if (isAdmin(meta, sender) || botAdmin(meta, rawSock) === false) return false;
    await onHit(rawSock, jid, sender, m, mode);
    return true;
  };

  const command = {
    cat: 'group', usage: `${key} <mode>`, desc: modes.replace(/\|/g, ' | '), group: true,
    run: async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      if (!modes.split('|').includes(mode)) {
        const p = P();
        return ctx.reply(`🛡 *${label}:* ${groups.get(ctx.jid)[key].toUpperCase()}\n\n${help(p)}\n\nAdmins are never affected.`);
      }
      groups.setMode(ctx.jid, key, mode);
      let note = '';
      if (mode !== 'off') {
        try { if (botAdmin(await getMeta(ctx.rawSock, ctx.jid, true), ctx.rawSock) === false) note = '\n\n⚠️ This account is not an admin yet. Make it admin so it can act.'; } catch {}
      }
      await ctx.reply(`🛡 ${label} set to *${mode.toUpperCase()}*${note}`);
    }
  };
  return { enforce, command };
}

async function deleteOrWarnOrKick(rawSock, jid, sender, m, mode, reason) {
  try { await rawSock.sendMessage(jid, { delete: m.key }); } catch (e) { console.error(`[${reason}]`, e?.message || e); }
  if (mode === 'warn') return warnUser(rawSock, jid, sender, reason);
  if (mode === 'kick') {
    const removed = await removeMember(rawSock, jid, sender);
    await withExo(rawSock).sendMessage(jid, {
      text: `${removed ? '🚫' : '⚠️'} ${'@' + userPart(sender)} ${removed ? `was removed for ${reason.toLowerCase()}.` : `triggered "${reason}", but I couldn't remove them.`}`,
      mentions: [sender]
    });
  }
}

const antilink = makeToggle({
  key: 'antilink', label: 'Antilink', modes: 'delete|warn|kick|off',
  help: (p) => `${p}antilink delete — delete links\n${p}antilink warn — delete + warn (${MAX_WARNS} warns = kick)\n${p}antilink kick — delete + remove sender\n${p}antilink off — disable`,
  test: (body) => LINK_RE.test(body),
  onHit: (rawSock, jid, sender, m, mode) => deleteOrWarnOrKick(rawSock, jid, sender, m, mode, 'Sending links')
});

const MENTION_FLOOD = 5; // @mentions in one message that count as "group mention" spam
const antigroupmention = makeToggle({
  key: 'antigroupmention', label: 'Antigroupmention', modes: 'delete|warn|kick|off',
  help: (p) => `${p}antigroupmention delete — delete the message\n${p}antigroupmention warn — delete + warn (${MAX_WARNS} warns = kick)\n${p}antigroupmention kick — delete + remove sender\n${p}antigroupmention off — disable\n\nTriggers at ${MENTION_FLOOD}+ @mentions in one message.`,
  test: (body, ctxInfo) => (ctxInfo?.mentionedJid?.length || 0) >= MENTION_FLOOD,
  onHit: (rawSock, jid, sender, m, mode) => deleteOrWarnOrKick(rawSock, jid, sender, m, mode, 'Mass-tagging the group')
});

/* ---------- antispam: flood detection -> warn, then lock the group for 5 minutes ---------- */
const SPAM_WINDOW = 7 * 1000;   // look at the last 7s of messages...
const SPAM_LIMIT = 6;           // ...and act once someone sends 6+ in that window
const LOCK_MS = 5 * 60 * 1000;  // how long the group stays closed
const hits = new Map();         // "<group>:<sender>" -> timestamps[]
const locks = new Map();        // group -> reopen Timeout, so a lock is never stacked or lost on restart confusion

async function enforceAntispam(rawSock, m, ctxInfo) {
  const jid = m.key.remoteJid;
  if (!jid.endsWith('@g.us') || m.key.fromMe) return false;
  if (groups.get(jid).antispam === 'off') return false;
  const sender = m.key.participant || m.participant;
  if (!sender) return false;

  let meta;
  try { meta = await getMeta(rawSock, jid); } catch { return false; }
  if (isAdmin(meta, sender) || botAdmin(meta, rawSock) === false) return false;

  const key = `${jid}:${sender}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < SPAM_WINDOW);
  list.push(now);
  hits.set(key, list);
  if (list.length < SPAM_LIMIT) return false;
  hits.delete(key);

  await warnUser(rawSock, jid, sender, 'Sending messages too fast');
  if (locks.has(jid)) return true; // group is already closed from an earlier flood, don't restack the timer
  try {
    await rawSock.groupSettingUpdate(jid, 'announcement');
    await withExo(rawSock).sendMessage(jid, { text: `🔒 Group closed for *5 minutes* — flooding detected.` });
  } catch (e) {
    console.error('[antispam] could not close the group:', e?.message || e);
    return true;
  }
  locks.set(jid, setTimeout(async () => {
    locks.delete(jid);
    try {
      await rawSock.groupSettingUpdate(jid, 'not_announcement');
      await withExo(rawSock).sendMessage(jid, { text: `🔓 Group reopened.` });
    } catch (e) { console.error('[antispam] could not reopen the group:', e?.message || e); }
  }, LOCK_MS));
  return true;
}

/* ---------- fraud protection: OTP-phishing + scam-message detection (DMs and groups) ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const URL_FIND = /(https?:\/\/\S+|www\.\S+)/gi;

const fraudCooldown = new Map(); // jid -> last action time — a hard stop against any kind of repeat-fire
const FRAUD_COOLDOWN_MS = 4000;

async function enforceFraud(rawSock, m, body) {
  if (m.key.fromMe || !body) return false;
  const jid = m.key.remoteJid;
  const sender = m.key.participant || m.participant || jid;
  const inGroup = jid.endsWith('@g.us');

  if (Date.now() - (fraudCooldown.get(jid) || 0) < FRAUD_COOLDOWN_MS) return false;

  let reason = null;
  if (fraud.isOtpOn() && fraud.looksLikeOtpRequest(body)) reason = 'otp-phishing';
  else if (fraud.isScamOn() && fraud.looksLikeScam(body)) reason = 'scam-message';
  else {
    const links = body.match(URL_FIND) || [];
    if (fraud.isScamOn() && links.some((u) => fraud.linkLooksSuspicious(u))) reason = 'suspicious-link';
  }
  if (!reason) return false;

  // Never act on an admin's own message in a group — same courtesy as antilink/antigroupmention.
  if (inGroup) {
    try {
      const meta = await getMeta(rawSock, jid);
      if (isAdmin(meta, sender)) return false;
    } catch {}
  }

  fraudCooldown.set(jid, Date.now());
  const labels = { 'otp-phishing': '🔐 OTP/verification-code request', 'scam-message': '🚩 Scam message', 'suspicious-link': '🔗 Suspicious link' };
  console.error(`[fraud] ${labels[reason]} detected from ${sender} in ${jid}`);

  if (inGroup) {
    try {
      const meta = await getMeta(rawSock, jid);
      if (botAdmin(meta, rawSock) !== false) await rawSock.sendMessage(jid, { delete: m.key });
    } catch {}
  }

  const warnText =
    reason === 'otp-phishing'
      ? '🔐 *Heads up:* that message is asking for a verification/OTP code. Never share that code with anyone — not even someone claiming to be support. Sharing it lets them take over an account.'
      : reason === 'scam-message'
        ? '🚩 *Heads up:* that message matches common scam wording (prizes, guaranteed returns, urgent account threats, etc). Treat it as a scam — don\'t click links or send money/codes.'
        : '🔗 *Heads up:* that link looks suspicious (shortened or disguised as an official site). Don\'t open it or enter any details.';
  try { await withExo(rawSock).sendMessage(jid, { text: warnText }); } catch {}

  fraud.notifier.notify(
    `${labels[reason]}\n📍 Chat: <code>${esc(jid)}</code>\n👤 From: <code>${esc(userPart(sender))}</code>\n💬 "${esc(body.slice(0, 200))}"`
  ).catch(() => {});

  return true;
}

const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com\/)\S+/i;

/* ---------- repeat-message jobs (.spin / .tornado) ---------- */
function makeBlast(name, cfg) {
  const jobs = new Map(); // "<account>:<chat>" -> { stop }
  const keyOf = ({ rawSock, jid }) => `${userPart(rawSock.user?.id)}:${jid}`; // per account, so users don't clash
  return {
    async start(ctx, over = {}) {
      const { jid, reply, rawSock } = ctx;
      const text = over.text ?? ctx.text;
      const count = over.count ?? cfg.count;
      const key = keyOf(ctx);
      if (!text) return reply(`${usage(`${name} <message>`)}\nExample: ${P()}${name} hey`);
      if (text.startsWith(P())) return reply('⚠️ The message can\'t start with the command prefix.');
      if (jobs.has(key)) return reply(`⏳ A ${name} is already running here. Send ${P()}stop${name} to cancel it.`);

      const job = { stop: false };
      jobs.set(key, job);
      await reply(`🌪 *${name.toUpperCase()}* started: *${count}* messages, one every *${cfg.delay / 1000}s*.\nSend ${P()}stop${name} to cancel.`);

      let sent = 0;
      try {
        for (let i = 0; i < count && !job.stop; i++) {
          await rawSock.sendMessage(jid, { text });
          sent++;
          if (i < count - 1) await sleep(cfg.delay);
        }
      } catch (e) {
        console.error(`[${name}]`, e?.message || e);
      } finally {
        jobs.delete(key);
      }
      await reply(job.stop ? `🛑 ${name} stopped after ${sent} message(s).` : `✅ ${name} finished (${sent}/${count}).`);
    },
    stopQuiet(ctx) { // true if a job was running here
      const job = jobs.get(keyOf(ctx));
      if (job) job.stop = true;
      return !!job;
    },
    async stop(ctx) {
      const job = jobs.get(keyOf(ctx));
      if (!job) return ctx.reply(`ℹ️ No ${name} is running in this chat.`);
      job.stop = true;
      await ctx.reply('🛑 Stopping...');
    }
  };
}
const spin = makeBlast('spin', SPIN);
const tornado = makeBlast('tornado', TORNADO);
const spam = makeBlast('spam', { count: SPAM.max, delay: SPAM.delay });

/* ---------- command factories ---------- */
// admin-only group action with one success / one failure message
const groupAction = ({ usage: u, desc, aliases, needsText, act, ok, fail }) => ({
  cat: 'group', usage: u, desc, aliases, admin: true,
  run: async (ctx) => {
    if (needsText && !ctx.text) return ctx.reply(usage(u));
    try {
      const out = await act(ctx);
      await ctx.reply(typeof ok === 'function' ? ok(out) : ok);
    } catch (e) {
      console.error(`[${u.split(' ')[0]}]`, e?.message || e);
      await ctx.reply(fail);
    }
  }
});

const memberAction = (u, desc, action, doneText) => ({
  cat: 'group', usage: u, desc, admin: true,
  run: (ctx) => participantsCmd(ctx, action, doneText, `${usage(u)} (or reply to their message)`)
});

// "@user" target commands that only need a target + group
const targetCmd = (u, desc, run) => ({
  cat: 'group', usage: u, desc, group: true,
  run: async (ctx) => {
    const t = getTargets(ctx.m, ctx.args)[0];
    if (!t) return ctx.reply(`${usage(u)} (or reply to their message)`);
    await run(ctx, t);
  }
});

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- menu layout ---------- */
const CATEGORIES = [
  { key: 'download', icon: '📥', title: 'DOWNLOAD MENU' },
  { key: 'utilities', icon: '🧰', title: 'UTILITIES MENU' },
  { key: 'tools', icon: '🔧', title: 'TOOLS MENU' },
  { key: 'fun', icon: '🎮', title: 'FUN & GAMES MENU' },
  { key: 'react', icon: '🎭', title: 'REACTIONS & ANIME' },
  { key: 'anime', icon: '🎌', title: 'ANIME MENU' },
  { key: 'games', icon: '🕹️', title: 'GAME MENU' },
  { key: 'text', icon: '🔤', title: 'TEXT STYLES & CODES' },
  { key: 'math', icon: '🧮', title: 'MATH & CONVERTERS' },
  { key: 'web', icon: '🌍', title: 'WEB & FACTS' },
  { key: 'owner', icon: '👑', title: 'OWNER MENU' },
  { key: 'group', icon: '🛡️', title: 'GROUP MENU' },
  { key: 'moderation', icon: '🔨', title: 'MODERATION MENU' },
  { key: 'info', icon: '🤖', title: 'BOT INFORMATION' },
  { key: 'spam', icon: '🌪', title: 'SPAM MENU' },
  { key: 'fraud', icon: '🕵️', title: 'SCAM SHIELD' },
  { key: 'custom', icon: '✨', title: 'MORE COMMANDS' }
];

// ---- Add new commands here ----
// cat: main | group | admin | download | ai | search | convert | spam | fun | tools | fraud | music | custom
// flags: public (anyone may use) · group (groups only) · admin (groups only + account must be group admin)
const commands = {
  /* SPAM */
  spin: { cat: 'spam', usage: 'spin <msg>', desc: `repeat ${SPIN.count}x`, run: (ctx) => spin.start(ctx) },
  tornado: { cat: 'spam', usage: 'tornado <msg>', desc: `repeat ${TORNADO.count}x`, run: (ctx) => tornado.start(ctx) },
  stopspin: { cat: 'spam', usage: 'stopspin', desc: 'cancel spin', run: (ctx) => spin.stop(ctx) },
  stoptornado: { cat: 'spam', usage: 'stoptornado', desc: 'cancel tornado', run: (ctx) => tornado.stop(ctx) },
  spam: {
    cat: 'spam', usage: 'spam <count> <msg>', desc: `custom count, max ${SPAM.max}`,
    run: (ctx) => {
      const n = parseInt(ctx.args[0]);
      const text = ctx.text.slice(String(ctx.args[0] || '').length).trim();
      if (!n || n < 1 || !text) return ctx.reply(`${usage('spam <count> <message>')}\nExample: ${P()}spam 10 hey`);
      return spam.start(ctx, { count: Math.min(n, SPAM.max), text });
    }
  },
  stopspam: { cat: 'spam', usage: 'stopspam', desc: 'cancel spam', run: (ctx) => spam.stop(ctx) },
  stopall: {
    cat: 'spam', usage: 'stopall', desc: 'cancel every running job',
    run: (ctx) => {
      const n = [spin, tornado, spam].filter((b) => b.stopQuiet(ctx)).length;
      return ctx.reply(n ? `🛑 Stopping ${n} running job(s).` : 'ℹ️ Nothing is running in this chat.');
    }
  },
  tagall: {
    cat: 'group', access: 'admin', usage: 'tagall <msg>', desc: 'tag everyone', aliases: ['tag'], group: true,
    run: async ({ rawSock, jid, m, text }) => {
      const ids = (await getMeta(rawSock, jid, true)).participants.map((p) => p.id);
      const body = `📢 *${text || 'Attention everyone!'}*\n\n` + ids.map((id) => '@' + userPart(id)).join('\n');
      await rawSock.sendMessage(jid, { text: body, mentions: ids }, { quoted: m });
    }
  },

  /* ADMIN */
  kick: memberAction('kick @user', 'remove a member', 'remove', '👢 Removed'),
  add: memberAction('add <number>', 'add a member', 'add', '➕ Added'),
  promote: memberAction('promote @user', 'make admin', 'promote', '⬆️ Promoted to admin:'),
  demote: memberAction('demote @user', 'remove admin', 'demote', '⬇️ Demoted:'),
  warn: {
    cat: 'group', usage: 'warn @user [reason]', desc: `${MAX_WARNS} warns = kick`, admin: true,
    run: async (ctx) => {
      const t = getTargets(ctx.m, ctx.args)[0];
      if (!t) return ctx.reply(`${usage('warn @user [reason]')} (or reply to their message)`);
      if (isAdmin(ctx.meta, t)) return ctx.reply('⚠️ You can\'t warn an admin.');
      await warnUser(ctx.rawSock, ctx.jid, t, ctx.text.replace(/@\d+/g, '').trim());
    }
  },
  warnings: targetCmd('warnings @user', 'check warns', (ctx, t) =>
    ctx.sock.sendMessage(ctx.jid, {
      text: `📋 ${'@' + userPart(t)} has *${groups.getWarn(ctx.jid, userPart(t))}/${MAX_WARNS}* warnings.`,
      mentions: [t]
    }, { quoted: ctx.m })),
  resetwarn: targetCmd('resetwarn @user', 'clear warns', (ctx, t) => {
    groups.resetWarn(ctx.jid, userPart(t));
    return ctx.sock.sendMessage(ctx.jid, { text: `✅ Warnings cleared for ${'@' + userPart(t)}.`, mentions: [t] }, { quoted: ctx.m });
  }),
  antilink: antilink.command,
  antigroupmention: antigroupmention.command,
  antispam: {
    cat: 'group', usage: 'antispam <mode>', desc: 'on | off — flood = warn + 5min lock', group: true,
    run: async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      const on = { on: 'on', off: 'off' }[mode];
      if (!on) {
        return ctx.reply(
          `🛡 *Antispam:* ${groups.get(ctx.jid).antispam.toUpperCase()}\n\n${P()}antispam on\n${P()}antispam off\n\n` +
          `Sending ${SPAM_LIMIT}+ messages within ${SPAM_WINDOW / 1000}s warns the sender and closes the group for ${LOCK_MS / 60000} minutes. Admins are never affected.`);
      }
      groups.setMode(ctx.jid, 'antispam', on);
      let note = '';
      if (on === 'on') {
        try { if (botAdmin(await getMeta(ctx.rawSock, ctx.jid, true), ctx.rawSock) === false) note = '\n\n⚠️ This account is not an admin yet. Make it admin so it can lock the group.'; } catch {}
      }
      await ctx.reply(`🛡 Antispam set to *${on.toUpperCase()}*${note}`);
    }
  },
  antibug: {
    cat: 'owner', access: 'owner', usage: 'antibug <mode>', desc: 'on | off — blocks crash/attack payloads',
    run: async ({ reply, args }) => {
      const mode = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return reply(`🛡 *Antibug:* ${security.isEnabled() ? 'ON' : 'OFF'}\n\n${P()}antibug on\n${P()}antibug off\n\n` +
          `Silently deletes and blocks senders of known crash/attack payloads (mention-floods, invisible-character floods, oversized messages), in every chat. Runs before any command is read, and never replies to the attacker. On by default.`);
      }
      security.setEnabled(mode === 'on');
      await reply(`🛡 Antibug turned *${mode.toUpperCase()}*`);
    }
  },
  otpguard: {
    cat: 'fraud', usage: 'otpguard <mode>', desc: 'on | off — catches OTP-sharing scams',
    run: async ({ reply, args }) => {
      const mode = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return reply(`🔐 *OTP Guard:* ${fraud.isOtpOn() ? 'ON' : 'OFF'}\n\n${P()}otpguard on\n${P()}otpguard off\n\n` +
          `Watches every chat (DMs + groups) for messages asking someone to share a verification/OTP code — the #1 way WhatsApp accounts get hijacked. Warns the sender, deletes it in groups where possible, and notifies you. On by default.`);
      }
      fraud.setOtp(mode === 'on');
      await reply(`🔐 OTP Guard turned *${mode.toUpperCase()}*`);
    }
  },
  scamshield: {
    cat: 'fraud', usage: 'scamshield <mode>', desc: 'on | off — catches scam wording & links',
    run: async ({ reply, args }) => {
      const mode = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return reply(`🚩 *Scam Shield:* ${fraud.isScamOn() ? 'ON' : 'OFF'}\n\n${P()}scamshield on\n${P()}scamshield off\n\n` +
          `Watches every chat for classic scam wording (prize/lottery, guaranteed returns, urgent account threats) and disguised/shortened phishing links. Warns the sender, deletes it in groups where possible, and notifies you. On by default.`);
      }
      fraud.setScam(mode === 'on');
      await reply(`🚩 Scam Shield turned *${mode.toUpperCase()}*`);
    }
  },
  scamcheck: {
    cat: 'fraud', usage: 'scamcheck <link or text>', desc: 'check a link/message for scam signs',
    run: async ({ reply, text }) => {
      if (!text) return reply(`Usage: ${P()}scamcheck <link or message text>`);
      const links = text.match(URL_FIND) || [];
      const badLink = links.find((u) => fraud.linkLooksSuspicious(u));
      const scammy = fraud.looksLikeScam(text);
      const otpAsk = fraud.looksLikeOtpRequest(text);

      if (!badLink && !scammy && !otpAsk) {
        return reply('🟢 *Nothing obviously suspicious found.*\n\nThis only checks for known patterns — always stay cautious with links and codes regardless.');
      }
      const flags = [
        badLink && '🔗 Link looks disguised or shortened (hides the real destination)',
        scammy && '🚩 Wording matches common scam messages',
        otpAsk && '🔐 Asks for a verification/OTP code'
      ].filter(Boolean);
      await reply(`🔴 *Looks suspicious:*\n${flags.map((f) => `• ${f}`).join('\n')}\n\nDon't click, don't share codes, don't send money.`);
    }
  },
  blocklist: {
    cat: 'fraud', usage: 'blocklist add|remove|check <number> [reason]', desc: 'your own scam-number list',
    run: async ({ reply, args }) => {
      const [action, raw, ...reasonParts] = args;
      const number = (raw || '').replace(/\D/g, '');
      const reason = reasonParts.join(' ');
      if (!['add', 'remove', 'check'].includes((action || '').toLowerCase()) || !number) {
        return reply(`Usage:\n${P()}blocklist add <number> [reason]\n${P()}blocklist remove <number>\n${P()}blocklist check <number>`);
      }
      if (action === 'add') { fraud.blAdd(number, reason); return reply(`🚫 +${number} added to your scam-number list.`); }
      if (action === 'remove') { const had = fraud.blRemove(number); return reply(had ? `✅ +${number} removed.` : `ℹ️ +${number} wasn't on the list.`); }
      const hit = fraud.blCheck(number);
      await reply(hit ? `🚫 +${number} *is on your scam-number list.*\nReason: ${hit.reason}` : `🟢 +${number} is not on your list.`);
    }
  },
  points: {
    cat: 'fraud', usage: 'points', desc: 'your referral link + points', aliases: ['myreferral'],
    run: async ({ reply, rawSock }) => {
      const tgId = rawSock.__tgId;
      const pts = tgId ? referral.points(tgId) : 0;
      const username = fraud.notifier.getUsername();
      const need = Math.max(0, referral.REPORT_THRESHOLD - pts);
      const link = username ? referral.referralLink(username, tgId) : null;
      await reply(
        `⭐ *Points:* ${pts}\n` +
        (link ? `🔗 *Your link:* ${link}\n` : '') +
        `+${referral.POINTS_PER_REFERRAL} per person who joins through it.\n\n` +
        (need > 0
          ? `🔒 ${need} more to unlock ${P()}report.`
          : `✅ ${P()}report is unlocked.`)
      );
    }
  },
  reportwa: {
    cat: 'fraud', aliases: ['supportreport'], usage: 'reportwa [number] [reason]', desc: `email template — needs ${referral.REPORT_THRESHOLD} referral points`,
    run: async ({ reply, args, rawSock }) => {
      const tgId = rawSock.__tgId;
      const pts = tgId ? referral.points(tgId) : 0;
      if (pts < referral.REPORT_THRESHOLD) {
        const need = referral.REPORT_THRESHOLD - pts;
        return reply(
          `🔒 *Premium feature.*\n\nThis needs *${referral.REPORT_THRESHOLD} referral points* (you have *${pts}*, ${need} more to go).\n\n` +
          `Send *${P()}points* here, or */myreferral* on Telegram, to get your referral link. You get ` +
          `*${referral.POINTS_PER_REFERRAL} points* for every person who joins through it.`
        );
      }

      const number = (args[0] || '').replace(/\D/g, '') || '<their number with country code>';
      const reason = args.slice(1).join(' ') || '<describe what they did — e.g. scam, impersonation, harassment>';
      const template =
        `To: support@whatsapp.com\n` +
        `Subject: Reporting a user for abuse\n\n` +
        `Hello WhatsApp Support,\n\n` +
        `I would like to report the WhatsApp account +${number} for the following reason:\n\n` +
        `${reason}\n\n` +
        `I request that you investigate this account and take appropriate action under WhatsApp's Terms of Service.\n\n` +
        `Thank you,\n[Your name]`;
      await reply(
        `✅ *Unlocked.* Copy the text below, paste it into an email to WhatsApp Support, fill in the ` +
        `brackets, and send it from your own email app — WhatsApp reviews reports sent this way, nothing here sends it automatically.\n\n` +
        `━━━━━━━━━━━━━━\n${template}\n━━━━━━━━━━━━━━`
      );
    }
  },
  flaguser: {
    cat: 'fraud', usage: 'flaguser @user <reason>', desc: 'report a user to you, the owner',
    run: async ({ reply, text, args, m, jid, isGroup }) => {
      const target = getTargets(m, args)[0];
      const reason = text.replace(/@\d+/g, '').trim();
      if (!target || !reason) return reply(`Usage: ${P()}flaguser @user <reason> (or reply to their message)`);
      await fraud.notifier.notify(
        `🚩 <b>User flagged</b>\n👤 <code>${esc(userPart(target))}</code>\n📍 ${isGroup ? 'Group' : 'DM'}: <code>${esc(jid)}</code>\n📝 ${esc(reason)}`
      );
      await reply('✅ Reported to the owner for review.');
    }
  },
  safestatus: {
    cat: 'fraud', usage: 'safestatus', desc: 'this account\'s own activity load',
    run: async ({ reply, rawSock }) => {
      const acct = userPart(rawSock.user?.id);
      const sent = rawSock.__stats?.sent || 0;
      const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      const rate = (sent / mins).toFixed(1);
      const bar = (pct) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      // A real indicator built from what THIS bot has actually sent — never a guess about
      // WhatsApp's own ban algorithm, which no outside tool can see or measure.
      const level = sent > 600 ? 'high' : sent > 200 ? 'moderate' : 'normal';
      const pct = Math.min(100, Math.round((sent / 800) * 100));
      await reply(
        `🛡 *Account activity · +${acct}*\n\n` +
        `${bar(pct)} ${pct}%\n\n` +
        `📤 Messages sent this run: *${sent}*\n⏱ Rate: *${rate}/min*\n📊 Load: *${level.toUpperCase()}*\n\n` +
        `_This reflects what this bot has sent — it is NOT WhatsApp's own ban score, which nothing outside WhatsApp can see. Heavy, fast, repetitive sending (like .spin/.tornado) is what actually raises real risk._`
      );
    }
  },
  delete: {
    cat: 'group', usage: 'delete', desc: 'delete a replied msg', aliases: ['del'],
    run: async (ctx) => {
      const ci = getCtxInfo(ctx.m);
      if (!ci.stanzaId) return ctx.reply(`Usage: reply to a message with ${P()}delete`);
      const mine = userPart(ci.participant) === userPart(ctx.rawSock.user?.id);
      if (ctx.isGroup && !mine && !(await needGroupAdmin(ctx))) return;
      try {
        await ctx.rawSock.sendMessage(ctx.jid, { delete: { remoteJid: ctx.jid, fromMe: mine, id: ci.stanzaId, participant: ci.participant } });
        await ctx.rawSock.sendMessage(ctx.jid, { delete: ctx.m.key }).catch(() => {});
      } catch (e) {
        console.error('[delete]', e?.message || e);
        await ctx.reply('❌ Couldn\'t delete that message.');
      }
    }
  },
  hidetag: {
    cat: 'group', usage: 'hidetag <msg>', desc: 'tag all silently', group: true,
    run: async ({ rawSock, jid, m, text, reply }) => {
      if (!text) return reply(usage('hidetag <message>'));
      const meta = await getMeta(rawSock, jid, true);
      await rawSock.sendMessage(jid, { text, mentions: meta.participants.map((p) => p.id) }, { quoted: m });
    }
  },

  /* GROUP */
  approve: {
    cat: 'group', usage: 'approve', desc: 'accept all join requests', admin: true,
    run: async ({ sock, jid, reply }) => {
      let list;
      try {
        list = await sock.groupRequestParticipantsList(jid);
      } catch (e) {
        console.error('[approve]', e?.message || e);
        return reply('⚠️ Couldn\'t read join requests. Make sure this account is an admin of the group.');
      }
      const ids = (list || []).map((x) => x.jid).filter(Boolean);
      if (!ids.length) return reply('ℹ️ No pending join requests.');

      await reply(`⏳ Approving *${ids.length}* request(s)...`);
      let ok = 0, failed = 0;
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        try {
          const res = await sock.groupRequestParticipantsUpdate(jid, chunk, 'approve');
          if (Array.isArray(res)) res.forEach((r) => (String(r.status) === '200' ? ok++ : failed++));
          else ok += chunk.length;
        } catch (e) {
          console.error('[approve]', e?.message || e);
          failed += chunk.length;
        }
        if (i + 50 < ids.length) await sleep(1500);
      }
      await reply(`✅ Approved: *${ok}*` + (failed ? `\n❌ Failed: *${failed}*` : ''));
    }
  },
  groupinfo: {
    cat: 'group', access: 'public', usage: 'groupinfo', desc: 'group details', group: true,
    run: async ({ rawSock, jid, reply }) => {
      const g = await getMeta(rawSock, jid);
      await reply(
        `👥 *${g.subject}*\nMembers: ${g.participants.length}\nAdmins: ${g.participants.filter((x) => x.admin).length}\n` +
        `Created: ${g.creation ? new Date(g.creation * 1000).toDateString() : 'unknown'}` +
        (g.desc ? `\n\n${g.desc}` : ''));
    }
  },
  lock: groupAction({
    usage: 'lock', desc: 'only admins can chat (mute the group)', aliases: ['close', 'closegroup', 'gclose'],
    act: (c) => c.rawSock.groupSettingUpdate(c.jid, 'announcement'),
    ok: '🔒 Group closed. Only admins can send messages.', fail: '❌ Failed. Make sure this account is an admin.'
  }),
  unlock: groupAction({
    usage: 'unlock', desc: 'everyone can chat again (unmute the group)', aliases: ['open', 'opengroup', 'gopen'],
    act: (c) => c.rawSock.groupSettingUpdate(c.jid, 'not_announcement'),
    ok: '🔓 Group opened. Everyone can send messages.', fail: '❌ Failed. Make sure this account is an admin.'
  }),
  link: groupAction({
    usage: 'link', desc: 'get invite link',
    act: (c) => c.rawSock.groupInviteCode(c.jid),
    ok: (code) => `🔗 https://chat.whatsapp.com/${code}`, fail: '❌ Couldn\'t get the link.'
  }),
  revoke: groupAction({
    usage: 'revoke', desc: 'reset invite link',
    act: (c) => c.rawSock.groupRevokeInvite(c.jid),
    ok: (code) => `♻️ Link reset.\nNew link: https://chat.whatsapp.com/${code}`, fail: '❌ Couldn\'t reset the link.'
  }),
  setgname: groupAction({
    usage: 'setgname <name>', desc: 'change group name', needsText: true,
    act: (c) => c.rawSock.groupUpdateSubject(c.jid, c.text.slice(0, 100)),
    ok: '✅ Group name updated.', fail: '❌ Failed to change the name.'
  }),
  setgdesc: groupAction({
    aliases: ['setdesc'],
    usage: 'setgdesc <text>', desc: 'change description', needsText: true,
    act: (c) => c.rawSock.groupUpdateDescription(c.jid, c.text.slice(0, 2000)),
    ok: '✅ Group description updated.', fail: '❌ Failed to change the description.'
  }),

  /* FUN */
  coinflip: { cat: 'fun', aliases: ['coin'], usage: 'coinflip', desc: 'coin flip', run: ({ reply }) => reply(`🪙 ${pick(['*Heads*', '*Tails*'])}`) },
  dice: {
    cat: 'fun', usage: 'dice [sides]', desc: 'roll a dice',
    run: ({ args, reply }) => {
      const sides = Math.min(Math.max(parseInt(args[0]) || 6, 2), 1000);
      return reply(`🎲 d${sides}: *${Math.floor(Math.random() * sides) + 1}*`);
    }
  },
  '8ball': {
    cat: 'fun', usage: '8ball <question>', desc: 'magic 8-ball',
    run: ({ text, reply }) => text
      ? reply(`🎱 ${pick(['Yes.', 'No.', 'Definitely.', 'Absolutely not.', 'Maybe.', 'Ask again later.',
        'Very likely.', 'Don\'t count on it.', 'Without a doubt.', 'Signs point to yes.'])}`)
      : reply(`🎱 Ask a question, e.g. ${P()}8ball will I win?`)
  },
  choose: {
    cat: 'fun', usage: 'choose a | b | c', desc: 'pick one',
    run: ({ text, reply }) => {
      const opts = text.split(/[|,]/).map((x) => x.trim()).filter(Boolean);
      return opts.length < 2 ? reply(usage('choose option1 | option2 | option3')) : reply(`🤔 I choose: *${pick(opts)}*`);
    }
  },

  /* TOOLS */
  calculator: {
    cat: 'utilities', aliases: ['calc'], usage: 'calculator <math>', desc: 'calculator',
    run: async ({ text, reply }) => {
      const expr = text.replace(/\^/g, '**').replace(/x/gi, '*');
      if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) return reply(`${usage('calc 12*(3+4)')}\nOnly numbers and + - * / % ( ) ^ are allowed.`);
      try {
        const out = Function(`"use strict"; return (${expr})`)(); // input is whitelisted above
        if (typeof out !== 'number' || !isFinite(out)) throw new Error('bad');
        await reply(`🧮 ${text} = *${out}*`);
      } catch {
        await reply('⚠️ Invalid expression.');
      }
    }
  },
  time: {
    cat: 'utilities', usage: 'time [zone]', desc: 'e.g. Africa/Lagos',
    run: async ({ args, reply }) => {
      const tz = args[0] || 'UTC';
      try {
        await reply(`🕒 *${tz}*\n${new Date().toLocaleString('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'medium' })}`);
      } catch {
        await reply(`⚠️ Unknown timezone. Example: ${P()}time Africa/Lagos`);
      }
    }
  },
  reverse: {
    cat: 'tools', usage: 'reverse <text>', desc: 'flip text',
    run: ({ text, reply }) => reply(text ? [...text].reverse().join('') : usage('reverse <text>'))
  },
  say: {
    cat: 'tools', usage: 'say <text>', desc: 'bot says it',
    run: ({ text, reply, sock, jid, m }) => {
      if (!text) return reply(usage('say <text>'));
      if (text.startsWith(P())) return reply('⚠️ The text can\'t start with the command prefix.');
      return sock.sendMessage(jid, { text }, { quoted: m });
    }
  },

  /* MAIN */
  menu: {
    cat: 'info', usage: 'menu', desc: 'this menu', aliases: ['help'],
    run: async ({ rawSock, sock, jid, m, fromMe, args, acct }) => {
      const menuImg = menuImgs.length ? menuImgs[Math.floor(Math.random() * menuImgs.length)] : null;
      const locks = true;
      const S = settings.peek(acct) || {};
      const img = (S.menuImage && readMenuImage(S.menuImage)) || menuImg;

      // ".menu group" (or a tap on a row of the pop-up list) -> just that category
      const want = (args[0] || '').toLowerCase();
      if (want === 'all') {
        return sock.sendMessage(jid, { text: `${menuHeader(m)}\n\n${menuSections(locks)}${menuFooter()}` }, { quoted: m });
      }
      if (want) {
        const cat = CATEGORIES.find((c) => c.key === want);
        if (cat && categoryText(cat, locks)) return sendCategory({ rawSock, sock, jid, m }, cat);
        return sock.sendMessage(jid, { text: `⚠️ No menu called "${want}". Send ${P()}menu to see them all.` }, { quoted: m });
      }

      const header = menuHeader(m);
      const body = menuSections(locks) + menuFooter();

      // Picture + info + buttons ("Visit My Creator", "See all options" list), like a business menu
      if ((S.menuStyle || config.MENU_STYLE) === 'interactive') {
        try {
          const rows = CATEGORIES.map((c) => {
            const n = inCategory(c.key).length;
            return n ? { header: '', title: `${c.icon} ${c.title}`, description: `${n} commands`, id: `${P()}menu ${c.key}` } : null;
          }).filter(Boolean);
          rows.unshift({ header: '', title: '📜 ALL COMMANDS', description: 'full list in one message', id: `${P()}menu all` });
          await Promise.race([interactive.sendInteractive(rawSock, jid, {
            image: img || undefined,
            body: menuInfoBody(m),
            footer: `${config.BOT_NAME} • ${footerText()}`,
            buttons: [
              interactive.urlButton('Visit My Creator', `https://wa.me/${config.OWNER_NUMBER}`),
              interactive.listButton('See all options', [{ title: 'Menus', rows }])
            ]
          }, m), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 15s')), 15000))]);
          return;
        } catch (e) {
          console.error('[menu] interactive menu failed, using classic menu:', e?.message || e);
        }
      }

      // Main menu = picture + info + the list of category menus, always ONE message. Each category has its own
      // command (.downloadmenu, .funmenu ...) or `.menu <category>`; `.menu all` still prints everything.
      const full = `${header}\n\n${menuIndex()}${menuFooter()}`;
      const chunks = [];
      const first = full;
      let sentFirst = false;
      if (img) {
        try { await rawSock.sendMessage(jid, { image: img, caption: first, contextInfo: channelCtx() }, { quoted: m }); sentFirst = true; }
        catch (e) { console.error('[menu] picture menu failed, trying text card:', e?.message || e); }
      }
      if (!sentFirst) {
        try { await rawSock.sendMessage(jid, { text: first, contextInfo: channelCtx() }, { quoted: m }); }
        catch (e) {
          console.error('[menu] text card failed, sending plain text:', e?.message || e);
          await sock.sendMessage(jid, { text: first }, { quoted: m });
        }
      }
      for (const c of chunks) await rawSock.sendMessage(jid, { text: c }, { quoted: m }).catch((e) => console.error('[menu] part failed:', e?.message || e));
    }
  },
  ping: {
    cat: 'tools', alsoIn: ['info'], usage: 'ping', desc: 'bot speed', cooldown: 0,
    run: async ({ sock, jid, m }) => {
      // one message, sent immediately: speed = how long the message took to reach us
      const sent = Number(String(m?.messageTimestamp || 0)) * 1000;
      const lag = sent ? Date.now() - sent : -1;
      const ms = lag >= 0 && lag < 60000 ? lag : 0;
      await sock.sendMessage(jid, { text: `🏓 Pong! *${ms}ms*` }, { quoted: m });
    }
  },
  alive: {
    cat: 'info', usage: 'alive', desc: 'online check',
    run: ({ reply }) => reply(`✅ *${config.BOT_NAME}* is alive and running.\n⏱ Uptime: ${runtime(Date.now() - startedAt)}`)
  },
  runtime: { cat: 'tools', usage: 'runtime', desc: 'uptime', run: ({ reply }) => reply(`⏱ Uptime: *${runtime(Date.now() - startedAt)}*`) },
  autojoin: {
    cat: 'info', usage: 'autojoin', desc: 'join every community group + channel',
    run: async ({ reply, rawSock }) => {
      await reply('⏳ Joining...');
      const { groups, channels } = await autojoin.joinAll(rawSock);
      const line = (label, r) => `${r.ok ? '✅' : '❌'} ${label}: ${r.ok ? (r.already ? 'already in' : 'joined') : r.reason}`;
      await reply([
        ...groups.map((g, i) => line(`Group ${i + 1}`, g)),
        ...channels.map((c, i) => line(`Channel ${i + 1}`, c))
      ].join('\n'));
    }
  },
  owner: {
    cat: 'owner', alsoIn: ['info'], usage: 'owner', desc: 'contact the developer',
    run: async ({ sock, jid, m }) => {
      const nums = [...new Set([config.OWNER_NUMBER, ...(config.OWNER_NUMBERS || [])])];
      const contacts = nums.map((n, i) => ({
        vcard: 'BEGIN:VCARD\nVERSION:3.0\n' +
          `FN:${config.DEV}${i ? ` (${i + 1})` : ''}\nORG:${config.APP_NAME};\n` +
          `TEL;type=CELL;type=VOICE;waid=${n}:+${n}\nEND:VCARD`
      }));
      await sock.sendMessage(jid, { contacts: { displayName: config.DEV, contacts } }, { quoted: m });
      await sock.sendMessage(jid, { text: `👑 *${config.DEV}*\n${nums.map((n) => `📞 wa.me/${n}`).join('\n')}` });
    }
  }
};

/* ====================================================================================
 *  Command registry: built-in commands (above) + lib/custom.js + every module in lib/cmds/
 * ==================================================================================== */
const hooks = { message: [], participants: [] }; // modules add functions here (moderation, games, auto-features, welcome...)
const RANK = { user: 0, sudo: 1, owner: 2, root: 3 };

// Who is allowed to run a command. Written on the command as `access`, otherwise derived from its category.
//   public → anyone   admin → group admins (and owner/sudo)   owner → owner or sudo   root → bot host only
function accessOf(cmd) {
  if (cmd.access) return cmd.access;
  if (cmd.public === true) return 'public';
  if (cmd.ownerOnly === true) return 'owner';
  if (cmd.cat === 'group' || cmd.cat === 'moderation') return 'admin';
  if (cmd.cat === 'spam' || cmd.cat === 'owner') return 'owner';
  return 'public';
}
const LOCK = { owner: '🔒', root: '🔐', admin: '🛡' };

const VERSION = String(config.BUILD || 1);

// One bundle of everything a module needs. Modules never reach into this file directly.
const H = {
  config, P, usage, sleep, pick, userPart, getTargets, getMeta, findP, isAdmin, botAdmin, needGroupAdmin, tagOf,
  removeMember, participantsCmd, warnUser, MAX_WARNS, groups, settings, media, http, hooks, RANK, THEMES, MENU_DESIGNS,
  box, frame, sc, accessOf, getText, getCtxInfo, unwrap, withExo, startedAt, uptimeShort, VERSION, ownmsgs, security,
  commands, CATEGORIES,
  wa: () => require('./wa'),
  theme: () => curTheme(), footer: () => footerText(),
  acct: (rawSock) => userPart(rawSock.user?.id),
  // is this ctx's sender at least `level`? ('sudo' | 'owner' | 'root')
  atLeast: (ctx, level) => (RANK[ctx.level] ?? 0) >= RANK[level]
};

// your own commands live in lib/custom.js
try {
  Object.assign(commands, require('./custom')({ ...H, usageLine: usage }));
} catch (e) {
  console.error('[custom] lib/custom.js has an error and was skipped:', e.message);
}

// One file per category in lib/cmds/. A broken module is skipped (and logged) — it never stops the bot.
const MODULES = ['download', 'utilities', 'tools', 'fun', 'owner', 'group', 'moderation', 'info', 'extra', 'react', 'text', 'math', 'web', 'more', 'auto', 'famous'];
const moduleOf = {};
for (const name of MODULES) {
  try {
    const defs = require(`./cmds/${name}`)(H);
    for (const [cmdName, def] of Object.entries(defs)) {
      if (commands[cmdName]) { console.error(`[modules] ${name}: "${cmdName}" already exists, skipped`); continue; }
      commands[cmdName] = def;
      moduleOf[cmdName] = name;
    }
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(`./cmds/${name}`)) continue;
    console.error(`[modules] lib/cmds/${name}.js failed to load and was skipped:`, e?.message || e);
  }
}

// name/alias -> command
const lookup = {};
for (const [name, c] of Object.entries(commands)) {
  c.name = name;
  lookup[name] = c;
}
for (const [name, c] of Object.entries(commands)) {
  (c.aliases || []).forEach((a) => { if (lookup[a] && lookup[a] !== c) console.error(`[modules] alias "${a}" of ${name} clashes with ${lookup[a].name}, ignored`); else lookup[a] = c; });
}

// Extra names people type from other famous bots, pointed at the command that already does the job
const ALIAS_EXTRA = { igdl: 'instagram', igdownload: 'instagram', fbdl: 'facebook', tiktokdl: 'tiktok', ytdl: 'download', ssweb: 'ss', toqr: 'qr',
  shorten: 'shorturl', ghstalk: 'github', gcinfo: 'groupinfo', resetlink: 'revoke', listadmin: 'admins', lyric: 'lyrics', pp2: 'getpp', everyone: 'tagall', getid: 'jid' };
for (const [alias, target] of Object.entries(ALIAS_EXTRA)) {
  if (lookup[target] && !lookup[alias]) { lookup[alias] = lookup[target]; (lookup[target].aliases = lookup[target].aliases || []).push(alias); }
}

// commands shown in a category (a command can also appear in other menus via `alsoIn`)
const inCategory = (key) => Object.values(commands).filter((c) => c.cat === key || (c.alsoIn || []).includes(key));

/* ---------- menu look ---------- */
const SMALLCAPS = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', y: 'ʏ', z: 'ᴢ' }; // x stays x
// Only plain A-Z letters are converted — fancy characters (𝐍Ξ𝐗, 『』…) are left exactly as written
function sc(str) { return String(str).replace(/[A-Za-z]/g, (c) => SMALLCAPS[c.toLowerCase()] || c.toLowerCase()); }

function uptimeShort(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m ${s % 60}s`;
}

const designOf = () => { const d = als.getStore()?.S?.menuDesign; return MENU_DESIGNS.includes(d) ? d : 'hub'; };

function menuInfo(m) {
  const sent = Number(String(m?.messageTimestamp || 0)) * 1000;
  const lag = sent ? Date.now() - sent : -1;
  const speed = lag >= 0 && lag < 20000 ? `${lag} ms` : '—'; // ignore nonsense when clocks disagree
  return [
    ['👑', 'owner', config.DEV],
    ['📞', 'contact', config.OWNER_NUMBER],
    ['🌐', 'mode', config.PUBLIC_MODE ? sc('public') : sc('private')],
    ['⚙️', 'prefix', P()],
    ['⏱', 'uptime', uptimeShort(Date.now() - startedAt)],
    ['📶', 'speed', speed],
    ['📦', 'commands', Object.keys(commands).length]
  ];
}

function menuHeader(m) {
  const info = menuInfo(m);
  const d = designOf();
  if (d === 'hub') return hubHeader(m);
  if (d === 'quote') {
    return [`*${sc(config.BOT_NAME)}* · ${VERSION}`, '', ...info.map(([i, k, v]) => `> ${i} *${sc(k)}* ➜ ${v}`)].join('\n');
  }
  if (d === 'mono') {
    return ['```', ` ${config.APP_NAME} · ${VERSION}`, ' ──────────────────────', ...info.map(([i, k, v]) => ` ${i} ${k.padEnd(9)}: ${v}`), '```'].join('\n');
  }
  if (d === 'compact') {
    return [`✦ *${sc(config.BOT_NAME)}* ✦`, `${sc('build')} ${VERSION}`, '', info.map(([i, k, v]) => `${i} ${v}`).join('  ⟡  ')].join('\n');
  }
  if (d === 'classic') {
    return [`꧁༺ *${sc(config.BOT_NAME)}* ༻꧂`, `${sc('build')} ${VERSION}`, '▰▰▰▰▰▰▰▰▰▰▰▰▰',
      ...info.map(([i, k, v]) => `${i} *${sc(k)}* ▸ ${v}`), '▰▰▰▰▰▰▰▰▰▰▰▰▰'].join('\n');
  }
  // nexora (default): uses every WhatsApp text format — bold, italic, strike, monospace, quotes
  const hour = (() => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: config.TIMEZONE }).format(new Date())); } catch { return 12; } })();
  const greet = hour < 12 ? 'ɢᴏᴏᴅ ᴍᴏʀɴɪɴɢ 🌅' : hour < 17 ? 'ɢᴏᴏᴅ ᴀꜰᴛᴇʀɴᴏᴏɴ ☀️' : 'ɢᴏᴏᴅ ᴇᴠᴇɴɪɴɢ 🌙';
  const who = m?.pushName ? ` _${m.pushName}_` : '';
  return [
    '*╔═════════════════════⬣*',
    `*║* ⚡ *${config.BOT_NAME}* ⚡`,
    `*║* ☠️ ~──────~ _${sc('build')} ${VERSION}_ ~──────~ ☠️`,
    '*╚═════════════════════⬣*',
    '',
    `> 👋 *${greet}*${who}`,
    `> _${sc('fast · stylish · always online')}_`,
    '',
    '```ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ```',
    '┏━━━━━━━━━━━━━━━━━━━⬣',
    ...info.map(([i, k, v]) => `┃ ${i} *${sc(k)}* ⌁ ${v}`),
    '┗━━━━━━━━━━━━━━━━━━━⬣',
    '',
    `> 💡 ${sc('tip')}: _${P()}funmenu, ${P()}toolsmenu …_ ${sc('open one list')}`
  ].join('\n');
}


/* ---- "hub" design: framed panels (INFO BOT / MAIN HUB) ---- */
const mono2 = (str) => String(str).replace(/[A-Za-z0-9]/g, (c) => {
  if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1D670 + c.charCodeAt(0) - 65);
  if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1D68A + c.charCodeAt(0) - 97);
  return String.fromCodePoint(0x1D7F6 + c.charCodeAt(0) - 48);
});
function hubPanel(title, lines) {
  return ['┌┄┄〔 *' + mono2(title) + '* 〕', '│𖤍 ╭────────ϟ', ...lines.map((l) => (l.startsWith('→') ? `│𖤍 ${l}` : `│𖤍 ➣ ${l}`)), '│𖤍 ╰────────ϟ', '╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈文'].join('\n');
}
function hubHeader(m) {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: config.TIMEZONE }).format(new Date());
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: config.TIMEZONE }).format(new Date());
  return hubPanel('INFO BOT', [
    `*${mono2('OWNER')}:* ${config.DEV}`, `*${mono2('VERSION')}:* ${VERSION}.0`, `*${mono2('PREFIX')}:* ${P()}`,
    `*${mono2('TODAY')}:* ${day}`, `*${mono2('DATE')}:* ${date}`, `*${mono2('UPTIME')}:* ${runtime(Date.now() - startedAt)}`,
    `*${mono2('RUNTIME')}:* ${process.version}`, `*${mono2('MODE')}:* ${config.PUBLIC_MODE ? '🌍 Public' : '🔒 Private'}`,
    `*${mono2('COMMANDS')}:* ${Object.keys(commands).length}`
  ]);
}
function hubIndex() {
  const rows = CATEGORIES.map((c) => ({ c, n: inCategory(c.key).length })).filter((x) => x.n)
    .map(({ c }) => `${P()}${menuCmdName(c.key).replace('menu', '-menu')}`);
  return hubPanel('NEXORA NEMESIS 404', ['→ ```MAIN HUB```', `${P()}all-menu`, ...rows]);
}

const lockLegend = () => `${LOCK.admin} group admin · ${LOCK.owner} owner/sudo · ${LOCK.root} bot host`;
function menuFooter() {
  const d = designOf();
  if (d === 'hub') return `\n\n> _${sc('developed by')}_ *${footerText()}* 👑`;
  const ch = '';
  if (d === 'quote') return `\n\n> ${lockLegend()}\n\n_${sc('developed by')} ${footerText()}_ 👑`;
  if (d === 'mono') return `\n\n${lockLegend()}${ch}\n_${sc('developed by')} ${footerText()}_ 👑`;
  if (d === 'compact') return `\n\n${lockLegend()}${ch}\n✦ ${sc('developed by')} ${footerText()} 👑`;
  if (d === 'classic') return `\n\n${lockLegend()}${ch}\n▰▰▰▰▰▰▰▰▰▰▰▰▰\n✦ *${sc(config.BOT_NAME)}* ✦\n${sc('developed by')}\n${sc(footerText())} 👑`;
  return `\n\n${lockLegend()}\n\n_${sc('developed by')}_ *${footerText()}* 👑`;
}

// One category as text, in the account's current design.
function categoryText(c, showLocks = true) {
  const list = inCategory(c.key);
  if (!list.length) return '';
  const d = designOf();
  const lk = (cmd) => (showLocks && LOCK[accessOf(cmd)] ? ' ' + LOCK[accessOf(cmd)] : '');
  const nm = (cmd) => `${P()}${cmd.name || cmd.usage}`;
  const title = `${c.icon} ${sc(c.key === 'custom' ? 'more' : c.key)}`;
  if (d === 'hub') return hubPanel(c.title.replace(' MENU', '') + ' · ' + list.length, list.map((cmd) => `${nm(cmd)}${lk(cmd)}`));
  if (d === 'quote') return `*${title}* ⟨${list.length}⟩\n` + list.map((cmd) => `> ${nm(cmd)}${lk(cmd)}`).join('\n');
  if (d === 'mono') return '```\n' + `┌─ ${c.icon} ${(c.key === 'custom' ? 'more' : c.key).toUpperCase()} (${list.length})\n` + list.map((cmd) => `│ ${nm(cmd)}${lk(cmd)}`).join('\n') + '\n└──────────────\n```';
  if (d === 'compact') return `*${title}* ⟨${list.length}⟩\n` + list.map((cmd) => '`' + nm(cmd) + '`' + lk(cmd)).join('  ');
  if (d === 'classic') return box(`${title} ${sc('menu')} ⟨${list.length}⟩`, list.map((cmd) => `✦ ${nm(cmd)}${lk(cmd)}`));
  return [`*╭──❮ ${title} ❯──⬣* ⟨${list.length}⟩`, ...list.map((cmd) => `│ ⌁ \`${nm(cmd)}\`${lk(cmd)}`), '*╰──────────────⬣*'].join('\n');
}

// A category menu: random picture, INFO BOT panel, the command list and a back line - all in ONE message.
async function sendCategory(ctx, c) {
  const { rawSock, sock, jid, m } = ctx;
  const list = categoryText(c, true);
  if (!list) return sock.sendMessage(jid, { text: '⚠️ Nothing in this menu yet.' }, { quoted: m });
  const back = `\n\n↩️ *${sc('back')}* ➜ ${P()}menu`;
  const caption = `${menuHeader(m)}\n\n${list}${back}${menuFooter()}`;
  const img = randCatImg();
  const CAP = 3500; // WhatsApp cuts longer captions
  try {
    if (img && caption.length <= CAP) return await rawSock.sendMessage(jid, { image: img, caption, contextInfo: channelCtx() }, { quoted: m });
    if (img) { // very long list: the picture carries the info panel, the list is sent right after
      await rawSock.sendMessage(jid, { image: img, caption: menuHeader(m), contextInfo: channelCtx() }, { quoted: m });
      return await rawSock.sendMessage(jid, { text: `${list}${back}${menuFooter()}` }, { quoted: m });
    }
  } catch (e) { console.error('[menu] category picture failed, sending text:', e?.message || e); }
  return sock.sendMessage(jid, { text: caption }, { quoted: m });
}

function menuIndex() {
  const d = designOf();
  if (d === 'hub') return hubIndex();
  const rows = CATEGORIES.map((c) => ({ c, n: inCategory(c.key).length })).filter((x) => x.n)
    .map(({ c, n }) => `${c.icon} ${P()}${menuCmdName(c.key)}  ⟨${n}⟩`);
  if (d === 'quote') return `*${sc('categories')}*\n` + rows.map((r) => `> ${r}`).join('\n');
  if (d === 'mono') return '```\n' + rows.join('\n') + '\n```';
  if (d === 'compact') return `*${sc('categories')}*\n` + rows.join('\n');
  return [`*╭──❮ 📂 ${sc('choose a menu')} ❯──⬣*`, ...rows.map((r) => `│ ${r}`), `│ 📜 ${P()}menu all  ⟨${Object.keys(commands).length}⟩`, '*╰──────────────⬣*'].join('\n');
}
const menuCmdName = (key) => (key === 'custom' ? 'more' : key) + 'menu';

function menuSections(showLocks = true) {
  return CATEGORIES.map((c) => categoryText(c, showLocks)).filter(Boolean).join('\n\n');
}

// Body text of the interactive menu card (greeting + bot info), like the business-style menu
function menuInfoBody(m) {
  let hour = 12, time = '';
  try {
    const now = new Date();
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: config.TIMEZONE }).format(now));
    time = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: config.TIMEZONE }).format(now);
  } catch { time = new Date().toLocaleTimeString(); }
  const greet = hour < 12 ? 'Good Morning 🌅' : hour < 17 ? 'Good Afternoon ☀️' : 'Good Evening 🌇';
  const who = m?.pushName ? ` *${m.pushName}*` : '';
  return [
    `*${config.BOT_NAME}*`, '',
    `${greet}${who}`,
    'I can help you with several things within WhatsApp.', '',
    '```INFORMATION BOT```',
    `👑 *Creator:* ${footerText()}`,
    `🤖 *Name:* ${config.APP_NAME}`,
    `🔖 *Version:* ${VERSION}`,
    `⚙️ *Prefix:* ${P()}`,
    `🌐 *Mode:* ${config.PUBLIC_MODE ? 'Public' : 'Private'}`,
    `⏱ *Uptime:* ${uptimeShort(Date.now() - startedAt)}`,
    `📦 *Commands:* ${Object.keys(commands).length}`,
    `🕒 *Time:* ${time}`, '',
    'Tap *See all options* to open a menu.'
  ].join('\n');
}

/* ---------- who is talking ---------- */
function levelOf(m, acct, S, senderNum) {
  const roots = config.OWNER_NUMBERS || [config.OWNER_NUMBER];
  if (roots.includes(senderNum) || (m.key.fromMe && roots.includes(acct))) return 'root';
  if (m.key.fromMe) return 'owner';
  if ((S.sudo || []).includes(senderNum)) return 'sudo';
  return 'user';
}

// WhatsApp now shows many people (and your own account) as an opaque id (...@lid) instead of a phone number.
// Resolve it to the real number so owner/sudo checks work: the key's phone-number fields first, then our own
// account's lid, then Baileys' lid->number map, then the group's member list.
async function senderNumber(rawSock, jid, sender, isGroup, m) {
  const num = userPart(sender);
  if (!String(sender).endsWith('@lid')) return num;
  const k = m?.key || {};
  const alt = isGroup ? (k.participantAlt || k.participantPn) : (k.remoteJidAlt || k.senderPn);
  if (alt && !String(alt).endsWith('@lid')) return userPart(alt);
  const own = rawSock.user || {};
  if (own.lid && userPart(own.lid) === num) return userPart(own.id);
  try {
    const pn = await rawSock.signalRepository?.lidMapping?.getPNForLID?.(sender);
    if (pn) return userPart(pn);
  } catch {}
  if (isGroup) {
    try {
      const meta = await getMeta(rawSock, jid);
      const p = meta.participants.find((x) => [x.id, x.lid].filter(Boolean).includes(sender));
      const real = p?.jid || p?.phoneNumber;
      if (real) return userPart(real);
    } catch {}
  }
  return num;
}

const cooldowns = new Map();   // acct:sender:command -> time
const floods = new Map();      // acct:sender -> [timestamps]
const maintNotice = new Map(); // acct -> last time we said "maintenance"
function pruneMap(map, cap = 5000) { if (map.size > cap) for (const k of [...map.keys()].slice(0, cap / 2)) map.delete(k); }

async function handleMessage(rawSock, m, type = 'notify') {
  if (!m.message || !m.key?.remoteJid || m.key.remoteJid === 'status@broadcast') return;
  // A message any of OUR OWN paired sessions sent — including one seen by a DIFFERENT paired
  // session in a shared group — is never processed again. Fixes bot-vs-bot warning loops.
  if (ownmsgs.isOurs(m.key.id)) return;
  // Live messages ('notify') always count. Only replayed/history ones ('append') are dropped when old.
  if (type !== 'notify' && isStale(m)) return;
  if (!channel.jid) await Promise.race([resolveChannel(rawSock), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  const acct = userPart(rawSock.user?.id);
  const S = settings.peek(acct) || settings.DEFAULTS();
  const store = { acct, S, prefix: S.prefix || config.PREFIX };
  return als.run(store, () => processMessage(rawSock, m, store));
}

async function processMessage(rawSock, m, store) {
  const { acct, S } = store;
  const body = getText(m).trim();
  const ctxInfo = getCtxInfo(m);

  // Owner protection runs on EVERY message, before anything else is parsed — in groups and DMs alike.
  if (await security.guard(rawSock, m, body, ctxInfo)) return;

  if (body) {
    // Fraud protection runs in DMs AND groups, before the group-only checks below.
    if (await enforceFraud(rawSock, m, body)) return;
    // These run on every group message, not just commands, and each can stop the message here.
    if (await antilink.enforce(rawSock, m, body, ctxInfo)) return;
    if (await antigroupmention.enforce(rawSock, m, body, ctxInfo)) return;
    if (await enforceAntispam(rawSock, m, ctxInfo)) return;
  }

  const fromMe = !!m.key.fromMe;
  const jid = m.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');
  const sender = fromMe ? (rawSock.user?.id || jid) : (isGroup ? (m.key.participant || m.participant || jid) : jid);
  const senderNum = fromMe ? acct : await senderNumber(rawSock, jid, sender, isGroup, m);
  const level = levelOf(m, acct, S, senderNum);
  const rank = RANK[level];
  const sock = withExo(rawSock);
  const prefix = P();

  // Modules (moderation filters, games, auto-reply/auto-read ...) see every message first.
  // Banned users never reach them. A hook returns true to say "handled, stop here".
  if (rank === 0 && (S.banned || []).includes(senderNum)) return;
  if (hooks.message.length) {
    const hctx = { rawSock, sock, m, jid, body, ctxInfo, isGroup, sender, senderNum, fromMe, level, rank, acct, prefix,
      reply: (t) => sock.sendMessage(jid, { text: frame(t) }, { quoted: m }) };
    for (const h of hooks.message) {
      try { if (await h(hctx)) return; } catch (e) { console.error('[hook]', e?.message || 'unknown error'); }
    }
  }

  if (!body || !body.startsWith(prefix)) return;
  const [cmdRaw, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const command = lookup[(cmdRaw || '').toLowerCase()];
  if (!command) { console.log(`[cmd] ${acct}: unknown command "${(cmdRaw || '').slice(0, 20)}"`); return; }
  const reply = (t) => sock.sendMessage(jid, { text: frame(t) }, { quoted: m });

  // self/private mode: only the paired owner (fromMe) gets through — silently, no notice to anyone else,
  // so the bot looks like it simply never replies to them. Sudo users are NOT exempt here (unlike
  // maintenance below) — "self" means only the paired number itself, nobody else at all.
  if (S.selfMode && rank < 2) return;

  // maintenance mode: only the owner and sudo users get through
  if (S.maintenance && rank < 1) {
    const last = maintNotice.get(acct) || 0;
    if (Date.now() - last > 60000) { maintNotice.set(acct, Date.now()); await reply('🛠 The bot is in maintenance mode. Please try again later.').catch(() => {}); }
    return;
  }

  // permission check
  const access = accessOf(command);
  const publicOk = config.PUBLIC_MODE && (command.cat === 'spam');
  let denied = null;
  if (access === 'root' && rank < 3) denied = '🔐 This command is only for the bot host.';
  else if (access === 'owner' && rank < (command.strict ? 2 : 1) && !publicOk) denied = '🔒 This command is for the account owner only.';
  else if (access === 'admin' && rank < 1) {
    if (!isGroup) denied = '⚠️ This command only works in groups.';
    else {
      try {
        const meta = await getMeta(rawSock, jid);
        if (!isAdmin(meta, sender) && !publicOk) denied = '🛡 Only group admins can use this command.';
      } catch { denied = '⚠️ Could not read this group. Try again in a moment.'; }
    }
  }
  if (denied) {
    console.log(`[cmd] ${acct}: denied ${prefix}${cmdRaw} (${access})`);
    await reply(denied).catch(() => {});
    return;
  }

  // cooldowns (owners are exempt): per user per command, plus a flood limit per user
  if (rank < 1) {
    const now = Date.now();
    const fk = `${acct}:${senderNum}`;
    const recent = (floods.get(fk) || []).filter((t) => now - t < 10000);
    recent.push(now);
    floods.set(fk, recent);
    if (recent.length > 8) return; // more than 8 commands in 10 seconds: ignore silently
    const ck = `${fk}:${command.name}`;
    const wait = (command.cooldown ? command.cooldown * 1000 : 1500) - (now - (cooldowns.get(ck) || 0));
    if (wait > 0) {
      if (command.cooldown && wait > 1500) await reply(`⏳ Slow down — try again in ${Math.ceil(wait / 1000)}s.`).catch(() => {});
      return;
    }
    cooldowns.set(ck, now);
    pruneMap(cooldowns); pruneMap(floods);
  }

  console.log(`[cmd] ${acct}: ${prefix}${cmdRaw} (${level})`);
  try { settings.get(acct).commandsRun++; } catch {}

  const ctx = {
    sock, rawSock, m, jid, args, fromMe, isGroup, acct, sender, senderNum, level, rank, prefix, access,
    text: body.slice(prefix.length).trim().slice(cmdRaw.length).trim(),
    userName: m.pushName, reply
  };

  try {
    if (command.admin) {
      ctx.meta = await needGroupAdmin(ctx);
      if (!ctx.meta) return;
    } else if (command.group && !isGroup) {
      return await reply('⚠️ This command only works in groups.');
    }
    await command.run(ctx);
  } catch (e) {
    console.error(`[cmd:${cmdRaw}]`, e?.message || e?.stack || 'unknown error');
    await reply('❌ Something went wrong running that command.').catch(() => {});
  }
}

// Group join/leave events (welcome / goodbye / ban-list checks live in modules)
async function onGroupParticipants(rawSock, ev) {
  const acct = userPart(rawSock.user?.id);
  const S = settings.peek(acct) || settings.DEFAULTS();
  return als.run({ acct, S, prefix: S.prefix || config.PREFIX }, async () => {
    for (const h of hooks.participants) {
      try { await h({ rawSock, sock: withExo(rawSock), ev, acct }); } catch (e) { console.error('[group-event]', e?.message || 'unknown error'); }
    }
  });
}

// A short, safe one-line description of a message, for the console's clean message feed only —
// text if there is any, otherwise the message type. Never includes key/session data, just content.
function preview(m) {
  const text = getText(m).trim();
  if (text) return text.length > 120 ? text.slice(0, 120) + '…' : text;
  const type = Object.keys(unwrap(m))[0] || 'message';
  return `[${type.replace(/Message$/, '')}]`;
}

// Dedicated Anime and Game menus: existing commands are listed there too (they keep working from their old menus)
const ALSO = {
  anime: ['waifu', 'neko', 'megumin', 'shinobu', 'anime', 'manga', 'animechar', 'topanime', 'randomanime', 'animequote', 'hug', 'kiss', 'pat', 'slap', 'cuddle', 'cry', 'smile', 'wave', 'dance', 'poke', 'bite', 'blush'],
  games: ['tictactoe', 'hangman', 'trivia', 'quiz', 'riddle', 'numbergame', 'guess', 'roll', 'wouldyourather', 'truth', 'dare', 'rps', 'slot', '8ball', 'coinflip', 'dice', 'neverhaveiever', 'thisorthat', 'ship', 'love', 'rate', 'jail', 'unjail']
};
for (const [menu, names] of Object.entries(ALSO)) {
  for (const n of names) { const c = commands[n]; if (c && c.cat !== menu) c.alsoIn = [...new Set([...(c.alsoIn || []), menu])]; }
}

// _resetLimits is only used by the automated tests (clears cooldown/flood counters)
// one shortcut command per category: .downloadmenu .funmenu .groupmenu ...
for (const c of CATEGORIES) {
  const nm = menuCmdName(c.key);
  if (commands[nm]) continue;
  commands[nm] = { cat: 'menus', usage: nm, desc: `${c.title} list`, run: (ctx) => sendCategory(ctx, c) };
  commands[nm].name = nm; lookup[nm] = commands[nm]; lookup[nm.replace('menu', '-menu')] = commands[nm];
}

if (commands.allmenu) lookup['all-menu'] = commands.allmenu;

module.exports = { handleMessage, onGroupParticipants, preview, commands, H, _resetLimits: () => { cooldowns.clear(); floods.clear(); } };
