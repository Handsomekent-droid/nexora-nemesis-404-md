const config = require('../config');
const db = require('./db');
const wa = require('./wa');
const seen = require('./seen');
const ui = require('./ui');

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const isOwner = (id) => config.OWNER_IDS.includes(String(id));

const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '—');
function ago(t) {
  if (!t) return '—';
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function who(id, u = {}) {
  return `<b>${esc(u.name || 'Unknown')}</b>${u.username ? ` (@${esc(u.username)})` : ''}\n` +
    `🆔 <code>${esc(id)}</code>${u.phone ? ` · 📱 <code>+${esc(u.phone)}</code>` : ''}`;
}

const notify = (telegram, html) => Promise.allSettled(
  config.OWNER_IDS.map((id) => telegram.sendMessage(id, html, { parse_mode: 'HTML' })));

// Users that finished pairing at least once
function pairedUsers() {
  return Object.entries(db.all())
    .filter(([, u]) => u.pairedAt)
    .map(([id, u]) => ({ id, ...u, active: wa.isOnline(id) }));
}

function line(u) {
  const detail = u.active
    ? `paired ${day(u.pairedAt)}`
    : u.status === 'logged_out' ? `logged out ${ago(u.lastInactiveAt)}` : `inactive ${ago(u.lastInactiveAt)}`;
  return `${u.active ? '🟢' : '🔴'} ${who(u.id, u)}\n      ${detail}`;
}

// Telegram caps messages at 4096 chars
async function sendList(ctx, title, users) {
  if (!users.length) return ctx.reply(`${title}\n\nNobody here yet.`, { parse_mode: 'HTML' });
  const chunks = [];
  let cur = `${title} (${users.length})\n`;
  for (const u of users) {
    const l = '\n' + line(u) + '\n';
    if (cur.length + l.length > 3800) { chunks.push(cur); cur = ''; }
    cur += l;
  }
  chunks.push(cur);
  for (const c of chunks) await ctx.reply(c, { parse_mode: 'HTML' });
}

// Same chunking as sendList, but for rows that are already formatted
async function sendRows(ctx, title, rows) {
  if (!rows.length) return ctx.reply(`${title}\n\nNobody here yet.`, { parse_mode: 'HTML' });
  const chunks = [];
  let cur = `${title} (${rows.length})\n`;
  for (const r of rows) {
    const l = '\n' + r + '\n';
    if (cur.length + l.length > 3800) { chunks.push(cur); cur = ''; }
    cur += l;
  }
  chunks.push(cur);
  for (const c of chunks) await ctx.reply(c, { parse_mode: 'HTML' });
}

const COMMANDS = [
  { command: 'allusers', description: 'Everyone who ever opened the bot (paired or not)' },
  { command: 'users', description: 'All paired users' },
  { command: 'active', description: 'Users connected right now' },
  { command: 'inactive', description: 'Users that are disconnected' },
  { command: 'new', description: 'New users (default last 24h)' },
  { command: 'broadcast', description: 'Message everyone who used the bot — paired or not' },
  { command: 'ownercmds', description: 'Owner command list' },
  { command: 'stats', description: 'Bot statistics' },
  { command: 'id', description: 'Show your Telegram ID' }
];

const actions = {}; // owner actions, also reachable from the Tools buttons

function register(bot) {
  bot.command('id', (ctx) => ctx.reply(`Your Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' }));

  const ownerCmd = (name, fn) => bot.command(name, (ctx) => (isOwner(ctx.from.id) ? fn(ctx) : undefined)); // silent for non-owners

  actions.users = (ctx) => sendList(ctx, '👥 <b>Paired users</b>', pairedUsers());
  actions.active = (ctx) => sendList(ctx, '🟢 <b>Active users</b>', pairedUsers().filter((u) => u.active));
  ownerCmd('users', actions.users);
  ownerCmd('active', actions.active);
  ownerCmd('inactive', (ctx) => sendList(ctx, '🔴 <b>Inactive users</b>', pairedUsers().filter((u) => !u.active)));
  ownerCmd('allusers', (ctx) => {
    const rows = Object.entries(seen.all()).sort((a, b) => b[1].lastSeen - a[1].lastSeen);
    return sendRows(ctx, `👤 <b>Everyone who ever opened ${esc(config.BOT_NAME)}</b>`, rows.map(([id, u]) => {
      const u2 = db.get(id);
      const status = u2?.pairedAt ? (wa.isOnline(id) ? '🟢 paired · online' : '🔴 paired · offline') : '⚪ opened, not paired';
      return `${who(id, { ...u, phone: u2?.phone })}\n      ${status} · last seen ${ago(u.lastSeen)}`;
    }));
  });

  ownerCmd('new', (ctx) => {
    const days = Math.min(Math.max(parseInt((ctx.message.text || '').split(/\s+/)[1]) || 1, 1), 365);
    const since = Date.now() - days * 86400e3;
    const rows = Object.entries(seen.all()).filter(([, u]) => u.firstSeen >= since)
      .sort((a, b) => b[1].firstSeen - a[1].firstSeen);
    return sendRows(ctx, `🆕 <b>New users — last ${days} day(s)</b>`, rows.map(([id, u]) =>
      `${db.get(id)?.pairedAt ? '📱' : '👤'} ${who(id, { ...u, phone: db.get(id)?.phone })}\n      joined ${ago(u.firstSeen)}` +
      `${db.get(id)?.pairedAt ? ' · paired' : ' · not paired yet'}`));
  });

  ownerCmd('broadcast', async (ctx) => {
    const text = (ctx.message.text || '').replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
    if (!text) return ctx.reply('Usage: /broadcast <message>');
    const ids = Object.keys(seen.all());
    await ctx.reply(`📣 Sending to ${ids.length} user(s)...`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await ctx.telegram.sendMessage(id, text, ui.nav()); ok++; } catch { fail++; }
      await new Promise((r) => setTimeout(r, 60)); // stay under Telegram rate limits
    }
    await ctx.reply(`✅ Delivered: ${ok}\n❌ Failed: ${fail} (blocked the bot)`);
  });

  ownerCmd('ownercmds', (ctx) => ctx.reply(
    '<b>👑 OWNER COMMANDS</b>\n\n' + COMMANDS.map((c) => `/${c.command} — ${esc(c.description)}`).join('\n'), { parse_mode: 'HTML' }));

  actions.stats = (ctx) => {
    const all = pairedUsers();
    const active = all.filter((u) => u.active).length;
    const pending = Object.keys(db.all()).length - all.length;
    return ctx.reply(
      `📊 <b>${esc(config.BOT_NAME)} stats</b>\n\n` +
      `👥 Paired: <b>${all.length}</b>\n🟢 Active: <b>${active}</b>\n🔴 Inactive: <b>${all.length - active}</b>\n` +
      `⏳ Pairing in progress: <b>${pending}</b>\n` +
      `👤 Users who opened the bot: <b>${Object.keys(seen.all()).length}</b> (🆕 ${Object.values(seen.all()).filter((u) => Date.now() - u.firstSeen < 86400e3).length} in 24h)\n\n` +
      `💾 RAM: <b>${Math.round(process.memoryUsage().rss / 1048576)} MB</b>\n` +
      `⏱ Uptime: <b>${Math.floor(process.uptime() / 3600)}h ${Math.floor(process.uptime() / 60) % 60}m</b>`,
      { parse_mode: 'HTML' });
  };
  ownerCmd('stats', actions.stats);
}

// Owners see the extra commands in their own "/" menu; everyone else gets the basic list
const BASE_COMMANDS = [
  { command: 'start', description: 'Open the menu' },
  { command: 'reqpair', description: 'Connect a number: /reqpair 254xxxxxxxxx' },
  { command: 'delpair', description: 'Disconnect your number' },
  { command: 'session', description: 'View session count' },
  { command: 'mysession', description: 'Check my number status' },
  { command: 'addbot', description: 'Run my own bot: /addbot <token>' },
  { command: 'mybots', description: 'My added bots' },
  { command: 'owner', description: 'Contact the owner' },
  { command: 'runtime', description: 'Bot uptime' },
  { command: 'myreferral', description: 'Your referral link + points' }
];

async function publishMenus(telegram) {
  const base = BASE_COMMANDS;
  await telegram.setMyCommands(base).catch(() => {});
  for (const id of config.OWNER_IDS) {
    await telegram.setMyCommands([...base, ...COMMANDS], { scope: { type: 'chat', chat_id: Number(id) } }).catch(() => {});
  }
}

module.exports = { register, publishMenus, notify, who, isOwner, esc, actions };
