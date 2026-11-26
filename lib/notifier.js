/**
 * Lets WhatsApp-side code (lib/commands.js, lib/custom.js, lib/fraud.js) message the Telegram
 * owner(s) without needing a direct reference to the Telegraf bot instance. bot.js calls set()
 * once at startup; everything else just calls notify(html).
 */
const config = require('../config');

let telegram = null;
let username = null;
const set = (tg) => { telegram = tg; };
const setUsername = (u) => { username = u; };
const getUsername = () => username;

async function notify(html) {
  if (!telegram || !config.OWNER_IDS.length) return;
  await Promise.allSettled(config.OWNER_IDS.map((id) => telegram.sendMessage(id, html, { parse_mode: 'HTML' })));
}

module.exports = { set, notify, setUsername, getUsername };
