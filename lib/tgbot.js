/**
 * The Telegram side: one factory (createBot) used for the main bot AND for every sub-bot added
 * with /addbot. Pairing state, WhatsApp sessions and users are shared; only the token differs.
 */
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const config = require('../config');
const db = require('./db');
const wa = require('./wa');
const owner = require('./owner');
const seen = require('./seen');
const referral = require('./referral');
const autojoin = require('./autojoin');
const subbots = require('./subbots');
const ui = require('./ui');

const { esc } = owner;
const html = { parse_mode: 'HTML' };
const ROOT = path.join(__dirname, '..');
const readImg = (n, fallback) => { try { return fs.readFileSync(path.join(ROOT, 'assets', n)); } catch { return fallback || null; } };
const MENU_IMG = readImg('tg_menu.jpg');
const PAIR_IMG = readImg('tg_pair.jpg', MENU_IMG);
const CONNECTED_IMG = readImg('connected.jpg');

const awaitingPhone = new Set();
const pairCooldown = new Map();
const PAIR_COOLDOWN = 30 * 1000;
const INACTIVE_GRACE = 60 * 1000;
const startedAt = Date.now();

const live = new Map();       // bot id (string) -> { bot, telegram, username, token, sub }
let mainTelegram = null;      // the main bot is the one that is admin in the must-join chats

// Session keys: the first number of a Telegram user is keyed "<tgId>", the next ones "<tgId>-2" ... "<tgId>-10"
const tgIdOf = (key) => String(key).split('-')[0];
const slotKey = (tgId, n) => (n === 1 ? String(tgId) : `${tgId}-${n}`);
const keysOf = (tgId) => Object.entries(db.all())
  .filter(([k, u]) => tgIdOf(k) === String(tgId) && (u.pairedAt || u.status === 'pairing'))
  .map(([k]) => k).sort((a, b) => (Number(a.split('-')[1]) || 1) - (Number(b.split('-')[1]) || 1));
const MAX_PER_USER = Math.max(1, config.MAX_SESSIONS_PER_USER || 10);

const tgFor = (userId) => {
  const via = db.get(userId)?.viaBot;
  return (via && live.get(String(via))?.telegram) || mainTelegram;
};

function normalizePhone(input) {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = config.DEFAULT_CC + d.slice(1);
  else if (d.length === 9 && /^[71]/.test(d)) d = config.DEFAULT_CC + d;
  return d.length >= 10 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

const fmtUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m ${s % 60}s`;
};

/* ---------- must-join gate (always checked through the MAIN bot: it is admin in the chats) ---------- */
async function statuses(userId) {
  if (owner.isOwner(userId)) return config.TG_CHATS.map((chat) => ({ chat, ok: true }));
  const checker = mainTelegram;
  return Promise.all(config.TG_CHATS.map(async (chat) => {
    try {
      const m = await checker.getChatMember(chat.id, userId);
      const ok = ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member);
      return { chat, ok };
    } catch (e) {
      console.error(`[gate] cannot check ${chat.id}: ${e.message} (is the main bot an admin there?)`);
      return { chat, ok: false };
    }
  }));
}
const missingFrom = (st) => st.filter((x) => !x.ok).map((x) => x.chat);

/* ---------- screens ---------- */
const infoBox = () => ui.quote(ui.box('BOT INFO', [`BOT : ${esc(config.BOT_NAME)}`, `BUILD : ${config.BUILD}`, `DEV : ${esc(config.DEV)}`]));
const cmdBox = () => ui.quote(ui.box('COMMANDS', [
  '/reqpair 254××× - connect a number (up to 10)',
  '/delpair 254××× - disconnect a number (or /delpair all)',
  '/session - view session count',
  '/mysession - check my number status',
  '/addbot token - use this bot as your own',
  '/owner - contact the owner',
  '/runtime - bot uptime'
]));

async function sendPhoto(ctx, caption, markup) {
  // Telegram limits photo captions to 1024 characters; fall back to picture + text if ever exceeded
  const plain = (t) => String(t).replace(/<[^>]+>/g, '');
  try {
    if (MENU_IMG && caption.length <= 1000) return await ctx.replyWithPhoto({ source: MENU_IMG }, { caption, ...html, ...markup });
    if (MENU_IMG) await ctx.replyWithPhoto({ source: MENU_IMG }).catch(() => {});
    return await ctx.reply(caption, { ...html, ...markup });
  } catch (e) {
    // never leave /start silent: if Telegram rejects the formatting, send it again as plain text
    console.error('[tg] home screen failed, retrying as plain text:', e?.message || e);
    return ctx.reply(plain(caption), { ...(markup || {}), parse_mode: undefined });
  }
}

async function showHome(ctx) {
  const st = await statuses(ctx.from.id);
  const missing = missingFrom(st);
  const name = esc(ctx.from.first_name || 'there');
  if (missing.length) {
    const caption =
      ui.quote(ui.box('ACCESS LOCKED', ['join every channel & group below', 'then tap I HAVE JOINED'])) + '\n' +
      st.map((x) => (x.ok ? `✅ ${esc(x.chat.label)}` : `❌ ${esc(x.chat.label)} – not joined`)).join('\n') +
      `\n\n<i>access opens the moment you have joined them all. leave one and it locks again.</i>`;
    return sendPhoto(ctx, caption, ui.gateKb(st));
  }
  return sendPhoto(ctx, `👋 Welcome <b>${name}</b>\n${infoBox()}\n${cmdBox()}`, ui.homeKb());
}

async function requireJoined(ctx) {
  const missing = missingFrom(await statuses(ctx.from.id));
  if (missing.length) { await showHome(ctx); return false; }
  return true;
}

/* ---------- WhatsApp session hooks ---------- */
const inactiveTimers = new Map();
const inactiveNotified = new Set();

function hooksFor(id, extra = {}) {
  const isWeb = String(id).startsWith('web'); // web-paired sessions have no Telegram chat to message
  const toUser = (text, opts = {}) => (isWeb ? Promise.resolve() : tgFor(id).sendMessage(tgIdOf(id), text, { ...html, ...ui.nav(), ...opts }).catch(() => {}));
  const notify = (t) => owner.notify(mainTelegram, t);
  return {
    ...extra,
    onState(state) {
      const u = db.get(id);
      if (!u?.pairedAt) return;
      if (state === 'active') {
        db.set(id, { status: 'active', lastActiveAt: Date.now() });
        clearTimeout(inactiveTimers.get(id));
        inactiveTimers.delete(id);
        if (inactiveNotified.delete(id)) notify(`🟢 <b>Active again</b>\n${owner.who(id, db.get(id))}`);
      } else {
        db.set(id, { status: 'inactive', lastInactiveAt: Date.now() });
        if (inactiveTimers.has(id) || inactiveNotified.has(id)) return;
        inactiveTimers.set(id, setTimeout(() => {
          inactiveTimers.delete(id);
          inactiveNotified.add(id);
          notify(`🔴 <b>User inactive</b>\n${owner.who(id, db.get(id))}`);
        }, INACTIVE_GRACE));
      }
    },
    onLoggedOut() {
      clearTimeout(inactiveTimers.get(id));
      inactiveTimers.delete(id);
      inactiveNotified.delete(id);
      db.set(id, { status: 'logged_out', lastInactiveAt: Date.now() });
      notify(`⚠️ <b>WhatsApp logged out</b>\n${owner.who(id, db.get(id))}`);
      toUser('⚠️ Your WhatsApp was logged out. Tap /start and pair again.');
    }
  };
}

/* ---------- pairing ---------- */
async function startPairing(ctx, phone, botKey) {
  const uid = ctx.from.id;
  const wait = PAIR_COOLDOWN - (Date.now() - (pairCooldown.get(uid) || 0));
  if (wait > 0) return ctx.reply(`⏳ Please wait ${Math.ceil(wait / 1000)}s before requesting another code.`);
  if (!(await requireJoined(ctx))) return;

  // which of this person's sessions is this? same number -> re-pair that one, otherwise the next free slot (max 10)
  const mine = keysOf(uid);
  const same = mine.find((k) => db.get(k)?.phone === phone);
  if (same && wa.isLive(same) && wa.isOnline(same) && db.get(same)?.pairedAt) {
    return ctx.reply(`✅ +${phone} is already paired. Send <code>${config.PREFIX}menu</code> in WhatsApp.\nUse /delpair ${phone} to remove it first.`, html);
  }
  let id = same;
  if (!id) {
    if (mine.length >= MAX_PER_USER) {
      return ctx.reply(`⚠️ You already have ${mine.length}/${MAX_PER_USER} sessions — that is the maximum.\nRemove one with /delpair 254××× to add another.`, html);
    }
    for (let n = 1; n <= MAX_PER_USER && !id; n++) { const k = slotKey(uid, n); if (!mine.includes(k) && !wa.hasSession(k)) id = k; }
    if (!id) return ctx.reply(`⚠️ You already have the maximum of ${MAX_PER_USER} sessions.`);
  }
  if (!wa.hasSession(id) && wa.sessionIds().length >= config.MAX_SESSIONS) {
    return ctx.reply('⚠️ This bot is full right now. Please try again later or ask the owner for another instance.');
  }

  pairCooldown.set(uid, Date.now());
  await ctx.reply('⏳ Generating your pairing code...');
  await wa.stop(id);
  db.set(id, {
    phone, pairedAt: null, status: 'pairing', viaBot: botKey,
    name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    username: ctx.from.username || null, tg: String(uid)
  });

  const tg = ctx.telegram;
  const toUser = (text, opts = {}) => tg.sendMessage(uid, text, { ...html, ...ui.nav(), ...opts }).catch(() => {});
  wa.start(id, hooksFor(String(id), {
    phone,
    onCode: async (code) => {
      const caption =
        `<b>╭━━〔 🔑 PAIRING CODE 〕━━⬣</b>\n┃\n┃  <code>${code}</code>\n┃\n╰━━━━━━━━━━━━━━━━⬣\n\n` +
        `1️⃣ Open WhatsApp\n2️⃣ Settings → Linked Devices → Link a Device\n` +
        `3️⃣ Tap <b>Link with phone number instead</b>\n4️⃣ Enter the code above\n\n` +
        `<i>Expires in a few minutes — if it does, send /reqpair again.</i>`;
      try {
        if (!PAIR_IMG) throw new Error('no pairing image');
        await tg.sendPhoto(uid, { source: PAIR_IMG }, { caption, ...html, ...ui.nav() });
      } catch { await toUser(caption); } // the code always gets through, picture or not
    },
    onOpen: (sock) => {
      db.set(id, { pairedAt: Date.now(), status: 'active', lastActiveAt: Date.now() });
      const num = String(sock?.user?.id || '').split('@')[0].split(':')[0];
      if (num && CONNECTED_IMG) {
        sock.sendMessage(`${num}@s.whatsapp.net`, {
          image: CONNECTED_IMG,
          caption: `✅ *${config.BOT_NAME} connected!*\n\nSend *${config.PREFIX}menu* in any chat to see every command.\n\n> ${config.DEV}`
        }).catch((e) => console.error('[wa] welcome message failed:', e?.message || e));
      }
      // staggered auto-join (8-20s after connecting, one at a time) — see lib/autojoin.js
      setTimeout(() => {
        autojoin.joinAll(sock).then(({ groups, channels }) => {
          groups.forEach((g) => { if (!g.ok) console.error(`[autojoin] ${id} group join failed (${g.link}):`, g.reason); });
          channels.forEach((c) => { if (!c.ok) console.error(`[autojoin] ${id} channel join failed (${c.link}):`, c.reason); });
        }).catch((e) => console.error('[autojoin]', id, e?.message || e));
      }, 8000 + Math.random() * 12000);
      toUser(`<b>╭━━〔 ✅ CONNECTED 〕━━⬣</b>\n┃ WhatsApp is linked.\n╰━━━━━━━━━━━━━━⬣\n\nOpen WhatsApp and send <code>${config.PREFIX}menu</code> to any chat.`);
      owner.notify(mainTelegram, `🆕 <b>New paired user</b>\n${owner.who(id, db.get(id))}`);
    },
    onFail: (msg) => {
      if (!db.get(id)?.pairedAt) db.del(id);
      toUser(`❌ ${esc(msg)}`);
    }
  })).catch((e) => {
    console.error('[start]', e?.message || e);
    db.del(id);
    toUser('❌ Failed to start pairing. Try again in a moment.');
  });
}

async function removeSession(key) {
  const u = db.get(key);
  clearTimeout(inactiveTimers.get(String(key)));
  inactiveTimers.delete(String(key));
  inactiveNotified.delete(String(key));
  await wa.stop(key, { logout: true });
  db.del(key);
  if (u?.pairedAt) owner.notify(mainTelegram, `🗑 <b>User unpaired</b>\n${owner.who(key, u)}`);
}

// /delpair            -> removes your session (asks which one when you have several)
// /delpair 2547....   -> removes that number      /delpair all -> removes every session of yours
async function unpair(ctx, argRaw) {
  const uid = ctx.from.id;
  awaitingPhone.delete(uid);
  const arg = String(argRaw ?? (ctx.message?.text || '').replace(/^\/\w+(@\w+)?\s*/, '')).trim().toLowerCase();
  const mine = keysOf(uid);
  if (!mine.length) return ctx.reply('📂 You have no session to remove.');
  if (arg === 'all') { for (const k of mine) await removeSession(k); return ctx.reply(`🗑 Removed all ${mine.length} of your sessions.`); }
  let key = null;
  if (!arg && mine.length === 1) key = mine[0];
  else if (arg) { const d = arg.replace(/\D/g, ''); key = mine.find((k) => db.get(k)?.phone === d) || (/^\d{1,2}$/.test(arg) ? mine[Number(arg) - 1] : null); }
  if (!key) {
    return ctx.reply(`🗑 <b>Which one?</b>\n${mine.map((k, i) => `${i + 1}. +${esc(db.get(k)?.phone || '?')}`).join('\n')}\n\nSend <code>/delpair 254××××××××</code> (or <code>/delpair all</code>).`, html);
  }
  const phone = db.get(key)?.phone;
  await removeSession(key);
  await ctx.reply(`🗑 Session${phone ? ` +${esc(phone)}` : ''} removed. You have ${mine.length - 1}/${MAX_PER_USER} left in use.`, html);
}

/* ---------- small screens used by both commands and buttons ---------- */
const PAIR_HELP = `📱 <b>Add a session</b> (up to ${MAX_PER_USER} numbers)\nSend:\n<code>/reqpair 254××××××××</code>\n\nYour WhatsApp number with country code, digits only.`;

const sessionCount = (ctx) => {
  const ids = wa.sessionIds();
  const online = ids.filter((i) => wa.isOnline(i)).length;
  return ctx.reply(ui.quote(ui.box('SESSIONS', [`TOTAL : ${ids.length} / ${config.MAX_SESSIONS}`, `ONLINE : ${online}`, `OFFLINE : ${ids.length - online}`])), html);
};

const mySession = async (ctx) => {
  const keys = keysOf(ctx.from.id);
  if (!keys.length) return ctx.reply(`📂 You have no session yet.\n\n${PAIR_HELP}`, html);
  const rows = keys.map((k, i) => {
    const u = db.get(k) || {};
    const state = wa.isOnline(k) ? '🟢 Connected' : u.status === 'pairing' ? '⏳ Waiting for pairing' : '🔴 Not connected';
    return `${i + 1}. ${u.phone ? '+' + esc(u.phone) : '—'} — ${state}`;
  });
  return ctx.reply(
    ui.quote(ui.box('MY SESSIONS', [`USED : ${keys.length} / ${MAX_PER_USER}`, ...rows])) +
    `\nAdd another: /reqpair 254××××××××\nRemove one: /delpair 254××××××××`,
    { ...html, ...ui.kb([[ui.cb('🗑 DELPAIR', 'unpair', 'danger')], [ui.menuBtn(), ui.ownerBtn()]]) });
};

const runtime = (ctx) => ctx.reply(`⏱ <b>BOT UPTIME</b>\n${ui.quote(`THE BOT HAS BEEN ACTIVE SINCE:\n<b>${fmtUptime(Date.now() - startedAt)}</b>`)}`, html);

const ownerInfo = (ctx) => ctx.reply(
  `👑 <b>OWNER</b>\n${ui.quote(`${esc(config.DEV)}\n@${config.OWNER_TG}\nwa.me/${config.OWNER_NUMBER}`)}`, html);

const addBotHelp = (ctx) => ctx.reply(
  `🤖 <b>Use this bot as your own</b>\n\n1️⃣ Open @BotFather and create a bot, copy its token\n2️⃣ Send:\n<code>/addbot 123456:ABC-your-token</code>\n\n` +
  `Your bot starts running on this system right away. Your token message is deleted for safety.`, html);

/* ---------- sub-bots ---------- */
const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

async function addBot(ctx, tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token) return addBotHelp(ctx);
  ctx.deleteMessage().catch(() => {}); // the token must not stay in the chat
  if (!(await requireJoined(ctx))) return;
  if (!TOKEN_RE.test(token)) return ctx.reply('⚠️ That does not look like a bot token. Copy it from @BotFather (format 123456:ABC...).');
  if (token === config.BOT_TOKEN) return ctx.reply('⚠️ That is already the main bot.');
  if (!owner.isOwner(ctx.from.id) && subbots.byOwner(ctx.from.id).length >= config.MAX_SUBBOTS) {
    return ctx.reply(`⚠️ You reached the limit of ${config.MAX_SUBBOTS} bots.`);
  }
  let me;
  try { me = await new Telegraf(token).telegram.getMe(); } catch { return ctx.reply('❌ Telegram rejected that token. Check it and try again.'); }
  if (live.has(String(me.id))) return ctx.reply(`⚠️ @${esc(me.username)} is already running here.`, html);
  try {
    subbots.add(me.id, { token, username: me.username, addedBy: String(ctx.from.id), addedAt: Date.now() });
    await launchBot(token, { sub: true });
  } catch (e) {
    subbots.del(me.id);
    console.error('[addbot]', e?.message || e);
    return ctx.reply('❌ Could not start that bot. Make sure it is not running anywhere else, then try again.');
  }
  owner.notify(mainTelegram, `🤖 <b>New sub-bot</b>\n@${esc(me.username)} added by ${owner.who(ctx.from.id, { name: ctx.from.first_name, username: ctx.from.username })}`);
  return ctx.reply(`✅ <b>@${esc(me.username)}</b> is live and running on ${esc(config.APP_NAME)}.\nOpen it and send /start.`, html);
}

async function myBots(ctx) {
  const list = owner.isOwner(ctx.from.id) ? Object.entries(subbots.all()).map(([id, v]) => ({ id, ...v })) : subbots.byOwner(ctx.from.id);
  if (!list.length) return ctx.reply('🤖 You have no added bots.\n\nUse /addbot <token> to add one.');
  return ctx.reply(ui.quote(ui.box('BOTS', list.map((v) => `@${esc(v.username)}${owner.isOwner(ctx.from.id) ? ` (by ${esc(v.addedBy)})` : ''}`))) + '\nRemove one: /delbot @username', html);
}

async function delBot(ctx, name) {
  const id = subbots.findByName(name || '');
  if (!id) return ctx.reply('Usage: /delbot @username (one of your bots, see /mybots)');
  const v = subbots.get(id);
  if (!owner.isOwner(ctx.from.id) && String(v.addedBy) !== String(ctx.from.id)) return ctx.reply('⚠️ That is not your bot.');
  const entry = live.get(String(id));
  if (entry) { try { entry.bot.stop('removed'); } catch {} live.delete(String(id)); }
  subbots.del(id);
  return ctx.reply(`🗑 @${esc(v.username)} was stopped and removed.`, html);
}

/* ---------- the bot itself ---------- */
function createBot(token, { sub = false } = {}) {
  const bot = new Telegraf(token);
  const botKey = () => String(bot.botInfo?.id || '');

  // Every reply gets the 🏠 MENU / 👑 OWNER buttons unless it brings its own keyboard
  bot.use((ctx, next) => {
    const wrap = (fn) => (...args) => {
      const extra = { ...(args[1] || {}) };
      if (!extra.reply_markup) Object.assign(extra, ui.nav());
      return fn(args[0], extra);
    };
    const r = ctx.reply.bind(ctx);
    ctx.reply = (text, extra) => wrap((t, e) => r(t, e))(text, extra);
    return next();
  });

  bot.use((ctx, next) => {
    if (ctx.from && !ctx.from.is_bot && ctx.chat?.type === 'private') seen.touch(ctx.from);
    return next();
  });

  // Must-join lock: checked live on EVERY update, so leaving any channel/group locks the bot
  // again on the user's next tap or command until they rejoin. Only the entry points stay open.
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot || ctx.chat?.type !== 'private') return next();
    if (owner.isOwner(ctx.from.id)) return next();
    const data = ctx.callbackQuery?.data;
    const text = ctx.message?.text || '';
    if (data === 'menu' || data === 'verify') return next();
    if (/^\/(start|menu|help|version)(@\w+)?(\s|$)/i.test(text)) return next();
    const isCmd = text.startsWith('/');
    if (!data && !isCmd && !awaitingPhone.has(ctx.from.id)) return next(); // plain chatter, nothing to protect
    if (!missingFrom(await statuses(ctx.from.id)).length) return next();
    awaitingPhone.delete(ctx.from.id);
    if (data) await ctx.answerCbQuery('🔒 Join the channels first', { show_alert: false }).catch(() => {});
    return showHome(ctx);
  });

  owner.register(bot);

  bot.start(async (ctx) => {
    awaitingPhone.delete(ctx.from.id);
    const payload = ctx.startPayload || '';
    if (payload.startsWith('ref_')) {
      const referrerId = payload.slice(4);
      if (referral.recordReferral(ctx.from.id, referrerId)) {
        const pts = referral.points(referrerId);
        tgFor(referrerId).sendMessage(referrerId,
          `🎉 <b>Someone joined using your referral link!</b>\nYou now have <b>${pts}</b> points.\n` +
          (pts >= referral.REPORT_THRESHOLD
            ? `✅ You've unlocked the <code>${config.PREFIX}report</code> template in WhatsApp!`
            : `Need ${referral.REPORT_THRESHOLD - pts} more to unlock the ${config.PREFIX}report template in WhatsApp.`),
          { ...html, ...ui.nav() }).catch(() => {});
      }
    }
    await showHome(ctx);
  });
  bot.command(['menu', 'help'], showHome);
  bot.command('version', (ctx) => ctx.reply(`🔖 ${esc(config.APP_NAME)}\nBuild ${config.BUILD}`, html));

  bot.command('reqpair', async (ctx) => {
    const arg = (ctx.message.text || '').replace(/^\/reqpair(@\w+)?\s*/i, '').trim();
    if (!arg) { awaitingPhone.add(ctx.from.id); return ctx.reply(PAIR_HELP, html); }
    const phone = normalizePhone(arg);
    if (!phone) return ctx.reply(`⚠️ That doesn't look right.\n\n${PAIR_HELP}`, html);
    return startPairing(ctx, phone, botKey());
  });
  bot.command('pair', (ctx) => { awaitingPhone.add(ctx.from.id); return ctx.reply(PAIR_HELP, html); });
  bot.command(['delpair', 'unpair'], unpair);
  bot.command('session', sessionCount);
  bot.command('mysession', mySession);
  bot.command('runtime', runtime);
  bot.command('owner', ownerInfo);
  bot.command('addbot', (ctx) => addBot(ctx, (ctx.message.text || '').replace(/^\/addbot(@\w+)?\s*/i, '')));
  bot.command('mybots', myBots);
  bot.command('delbot', (ctx) => delBot(ctx, (ctx.message.text || '').replace(/^\/delbot(@\w+)?\s*/i, '')));

  bot.command(['myreferral', 'referral', 'points'], async (ctx) => {
    const username = ctx.botInfo?.username;
    if (!username) return ctx.reply('⚠️ Referral link isn\'t ready yet — try again in a moment.');
    const pts = referral.points(ctx.from.id);
    const link = referral.referralLink(username, ctx.from.id);
    await ctx.reply(
      `<b>🔗 Your referral link</b>\n<code>${link}</code>\n\n⭐ Points: <b>${pts}</b> (+${referral.POINTS_PER_REFERRAL} per person who joins through your link)\n` +
      (pts >= referral.REPORT_THRESHOLD
        ? `✅ You've unlocked <code>${config.PREFIX}report</code> in WhatsApp.`
        : `🔒 ${referral.REPORT_THRESHOLD - pts} more point(s) to unlock <code>${config.PREFIX}report</code> in WhatsApp.`), html);
  });

  /* ----- buttons ----- */
  const answer = (ctx, text, alert) => ctx.answerCbQuery(text, alert ? { show_alert: true } : undefined).catch(() => {});
  const act = (name, fn, { gate = true, ownerOnly = false } = {}) => bot.action(name, async (ctx) => {
    if (ownerOnly && !owner.isOwner(ctx.from.id)) return answer(ctx, '🔒 Owner only', true);
    await answer(ctx);
    if (gate && !(await requireJoined(ctx))) return;
    return fn(ctx);
  });

  bot.action('verify', async (ctx) => {
    const missing = missingFrom(await statuses(ctx.from.id));
    if (missing.length) return answer(ctx, `❌ You haven't joined: ${missing.map((c) => c.label).join(', ')}`, true);
    await answer(ctx, '✅ Verified!');
    await ctx.deleteMessage().catch(() => {});
    await showHome(ctx);
  });
  bot.action('menu', async (ctx) => { await answer(ctx); await showHome(ctx); });
  act('session', (ctx) => { awaitingPhone.add(ctx.from.id); return ctx.reply(PAIR_HELP, html); });
  act('mysessions', mySession);
  act('unpair', (ctx) => unpair(ctx, ''));
  act('tools', (ctx) => ctx.reply(
    `🛠 <b>TOOLS</b>\n${ui.quote(ui.box('TOOLS', [
      '/runtime - bot uptime', '/addbot token - use this bot as your own', '/mybots - bots you added',
      '/broadcast msg - owner only', '/users - owner only', '/active - owner only', '/stats - owner only'
    ]))}`, { ...html, ...ui.toolsKb() }), { gate: true });
  act('runtime', runtime, { gate: false });
  act('addbot_help', addBotHelp);
  act('mybots', myBots);
  act('referral', (ctx) => ctx.reply('🔗 Send /myreferral to get your referral link and points.'));
  act('o_users', owner.actions.users, { gate: false, ownerOnly: true });
  act('o_active', owner.actions.active, { gate: false, ownerOnly: true });
  act('o_stats', owner.actions.stats, { gate: false, ownerOnly: true });
  act('o_broadcast', (ctx) => ctx.reply('📣 Send:\n<code>/broadcast your message</code>\n\nIt goes to everyone who ever opened the bot.', html), { gate: false, ownerOnly: true });

  bot.on('text', async (ctx) => {
    const id = ctx.from.id;
    if (!awaitingPhone.has(id)) return;
    const phone = normalizePhone(ctx.message.text);
    if (!phone) return ctx.reply(`⚠️ That doesn't look right.\n\n${PAIR_HELP}`, html);
    awaitingPhone.delete(id);
    return startPairing(ctx, phone, botKey());
  });

  bot.catch((err) => console.error('[telegraf]', err?.message || err));
  return bot;
}

/* ---------- launching ---------- */
async function launchBot(token, { sub = false } = {}) {
  const bot = createBot(token, { sub });
  const info = await bot.telegram.getMe();
  bot.botInfo = info;
  const key = String(info.id);
  const entry = { bot, telegram: bot.telegram, username: info.username, token, sub };
  live.set(key, entry);
  if (!sub) {
    mainTelegram = bot.telegram;
    require('./notifier').set(bot.telegram);
    require('./notifier').setUsername(info.username);
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    bot.launch(() => {
      console.log(`✅ ${sub ? 'sub-bot' : config.BOT_NAME} @${info.username} is running`);
      owner.publishMenus(bot.telegram);
      settled = true; resolve();
    }).catch((e) => { if (!settled) { live.delete(key); reject(e); } else console.error('[telegraf]', e?.message || e); });
  });
  return entry;
}

// Main bot with retry; never exits the process on failure (WhatsApp sessions must stay up)
async function bootMain() {
  const attempt = async () => {
    try {
      mainTelegram = new Telegraf(config.BOT_TOKEN).telegram; // so the gate/hook code has a telegram even before launch finishes
      await launchBot(config.BOT_TOKEN);
    } catch (e) {
      const code = e?.response?.error_code;
      if (code === 404 || code === 401 || /\b(404|401)\b/.test(e?.message || '')) {
        console.error(`\n❌ TELEGRAM COULD NOT START: BOT_TOKEN is invalid or was revoked (Telegram replied ${code || e?.message}).\n` +
          '   Fix it in .env (BOT_TOKEN=...) and restart. Paired WhatsApp sessions keep working meanwhile.\n');
        return;
      }
      console.error('❌ Telegram launch failed:', e?.message || e, '\n   Retrying in 30s...');
      setTimeout(attempt, 30000);
    }
  };
  attempt();
}

async function bootSubs() {
  for (const [id, v] of Object.entries(subbots.all())) {
    launchBot(v.token, { sub: true }).catch((e) => console.error(`[subbot] @${v.username} failed to start:`, e?.message || e));
    await new Promise((r) => setTimeout(r, 500));
  }
}

function stopAllBots(signal) {
  for (const { bot } of live.values()) { try { bot.stop(signal); } catch {} }
}

module.exports = { bootMain, bootSubs, hooksFor, stopAllBots, _live: live, _web: { keysOf, hooksFor, removeSession, slotKey, normalizePhone, MAX_PER_USER, CONNECTED_IMG, getMain: () => mainTelegram }, _t: { startPairing, unpair, mySession, keysOf, setMain: (t) => { mainTelegram = t; } } };
