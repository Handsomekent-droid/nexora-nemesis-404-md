/**
 * Telegram look: coloured inline buttons + quoted boxes. Every screen of the bot builds its
 * buttons here so they all match. Button colour uses Telegram's native `style`
 * (success = green, primary = blue, danger = red); clients that don't know it show the default colour.
 */
const config = require('../config');

const b = (text, extra, style) => ({ text, ...extra, ...(style ? { style } : {}) });
const url = (text, link, style) => b(text, { url: link }, style);
const cb = (text, data, style) => b(text, { callback_data: data }, style);
const rows = (list, n) => { const o = []; for (let i = 0; i < list.length; i += n) o.push(list.slice(i, i + n)); return o; };
const kb = (r) => ({ reply_markup: { inline_keyboard: r } });

const ownerBtn = () => url('👑 OWNER', `https://t.me/${config.OWNER_TG}`, 'success');
const menuBtn = () => cb('🏠 MENU', 'menu', 'primary');

// Under every plain reply
const nav = () => kb([[menuBtn(), ownerBtn()]]);

// statuses = [{ chat, ok }] — joined chats are green with a tick, missing ones are blue
const joinRows = (statuses) => rows(
  statuses.map(({ chat, ok }) => ok
    ? url(`✅ ${chat.label}`, chat.link, 'success')
    : url(`${chat.icon || '📢'} ${chat.label}`, chat.link, 'primary')),
  config.TG_COLS || 2);

const gateKb = (statuses) => kb([
  ...joinRows(statuses),
  [cb('✅ I HAVE JOINED', 'verify', 'success')],
  [ownerBtn()]
]);

// join buttons live only on the lock screen (gateKb); once verified the menu doesn't show them
const homeKb = () => kb([
  [cb('➕ SESSION', 'session', 'primary'), cb('📂 MY SESSIONS', 'mysessions', 'primary')],
  [cb('🛠 TOOLS', 'tools', 'primary')],
  [ownerBtn()]
]);

const toolsKb = () => kb([
  [cb('⏱ RUNTIME', 'runtime', 'primary'), cb('🤖 ADD BOT', 'addbot_help', 'primary')],
  [cb('👥 USERS 🔒', 'o_users', 'danger'), cb('📣 BROADCAST 🔒', 'o_broadcast', 'danger')],
  [cb('📊 STATS 🔒', 'o_stats', 'danger'), cb('🟢 ACTIVE 🔒', 'o_active', 'danger')],
  [cb('🤖 MY BOTS', 'mybots', 'primary'), cb('🔗 REFERRAL', 'referral', 'primary')],
  [menuBtn(), ownerBtn()]
]);

const quote = (s) => `<blockquote>${s}</blockquote>`;
const box = (title, lines) => `┏━━━〔 ${title} 〕━━━┓\n${lines.map((l) => `┃ ➣ ${l}`).join('\n')}\n┗━━━━━━━━━━━━━━━━┛`;

module.exports = { url, cb, rows, kb, ownerBtn, menuBtn, nav, joinRows, gateKb, homeKb, toolsKb, quote, box };
