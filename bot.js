// Boot file: starts the WhatsApp sessions, the main Telegram bot and any sub-bots added with /addbot.
// All the Telegram logic lives in lib/tgbot.js, the look of it in lib/ui.js.
const config = require('./config');
const db = require('./lib/db');
const wa = require('./lib/wa');
const tgbot = require('./lib/tgbot');

// A Telegram control bot is optional: BOT_TOKEN missing just means "run WhatsApp only",
// not an error. The console-pairing prompt below covers that case for self-hosters.
const HAS_TELEGRAM = !!config.BOT_TOKEN;
if (!HAS_TELEGRAM) console.log('[boot] No BOT_TOKEN set — running WhatsApp-only (no Telegram control bot). See .env.example.');

// Printed as message/stack only, never the raw error object — a decrypt failure from the
// WhatsApp session layer can throw an object carrying actual key material as properties.
const safeErr = (e) => (e instanceof Error ? e.stack || e.message : e?.message || String(e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', safeErr(e)));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', safeErr(e)));

// Sessions paired before owner tracking existed count as paired
for (const id of wa.sessionIds()) {
  if (!db.get(id)?.pairedAt) db.set(id, { pairedAt: Date.now(), status: 'inactive' });
}

if (HAS_TELEGRAM) {
  tgbot.bootMain();
  setTimeout(() => tgbot.bootSubs(), 5000); // after the main bot is up
}
require('./lib/webpair').start(); // pairing website (only when WEB_PORT/PORT is set)
// Telegram must be ready before sessions reconnect (their hooks notify through it)
setTimeout(() => wa.restoreAll((id) => (HAS_TELEGRAM ? tgbot.hooksFor(id) : {})).catch((e) => console.error('[restore]', e)), 2000);
// Self-hosters with nothing paired yet: ask for a WhatsApp number right in the console.
setTimeout(() => require('./lib/consolepair').offer({ wa, db, config }).catch((e) => console.error('[consolepair]', e?.message || e)), 2500);

function shutdown(signal) {
  tgbot.stopAllBots(signal);
  wa.stopAll(); // keep sessions on disk so they restore on next start
  setTimeout(() => process.exit(0), 300);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
