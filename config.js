require('dotenv').config();

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  // Trim stray quotes/spaces — a common cause of a "401 Unauthorized" that looks like a bad token but isn't
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim().replace(/^['"]|['"]$/g, ''),
  PREFIX: process.env.PREFIX || '.',
  PUBLIC_MODE: process.env.PUBLIC_MODE === 'true',
  // Telegram numeric user IDs allowed to use owner commands (comma separated). Send /id to the bot to get yours.
  // The main owner's Telegram ID is built in; OWNER_ID in .env can add more.
  OWNER_IDS: [...new Set(['8195349331', ...list(process.env.OWNER_ID)])],
  REPO_URL: process.env.REPO_URL || '', // shown by the repository command (empty = says the source is private)
  OWNER_TG: 'Handsomeprimekillerkent', // Telegram username behind the OWNER button
  MAX_SUBBOTS: parseInt(process.env.MAX_SUBBOTS || '10', 10), // sub-bots (/addbot) one person may add (owners: unlimited)
  MAX_SESSIONS_PER_USER: parseInt(process.env.MAX_SESSIONS_PER_USER || '10', 10), // WhatsApp numbers one Telegram user may pair (across the main bot and all sub-bots)

  // Build number of this zip — bump it every time a new zip is made (shown in .menu, Telegram /start and /version)
  BUILD: 49,
  BOT_NAME: '『𖤍』𝐍Ξ𝐗𝐎𝐑𝐀 𝐍Ξ𝐌Ξ𝐒𝐈𝐒 ⁴⁰⁴ ᴹᴰ',
  // Short name used on link cards / buttons
  APP_NAME: '𝐍Ξ𝐗𝐎𝐑𝐀 𝐍Ξ𝐌Ξ𝐒𝐈𝐒 ⁴⁰⁴',
  // Developer name — every message/menu/vcard reads it from this one line
  DEV: '『𖤍ᴏᴠ』𝟑ˣ𝟑ᴄᴜ́ᴛᴏʀ_⁴⁰⁴_ᴋᴇɴᴛ',
  // Max WhatsApp sessions this instance will accept in total (pairing is refused beyond this). 1000 by default; RAM is the real limit.
  MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS || '1000', 10),
  // Main contact first; the others are shown too by .owner
  OWNER_NUMBER: '254784747151',
  OWNER_NUMBERS: ['254784747151'],
  TIMEZONE: process.env.TIMEZONE || 'Africa/Nairobi',
  // 'interactive' = picture + buttons + pop-up list menu; 'classic' = plain picture/text menu
  MENU_STYLE: process.env.MENU_STYLE || 'classic', // 'interactive' = business-style buttons; WhatsApp drops these silently on many normal accounts
  // Used when someone types a local number like 0712345678 or 712345678
  DEFAULT_CC: (process.env.DEFAULT_COUNTRY_CODE || '254').replace(/\D/g, ''),
  // YouTube (.play .song .video .ytmp3 .ytmp4) — AlwaysRizz API. Put the key in the panel/.env, NOT in this file:
  //   RIZZ_KEY=...   RIZZ_USER=...
  RIZZ_API: process.env.RIZZ_API || 'https://api.rizzpedia.ai.id/api/download/aio',
  RIZZ_KEY: process.env.RIZZ_KEY || '',
  RIZZ_USER: process.env.RIZZ_USER || '',
  CHANNEL_URL: 'https://whatsapp.com/channel/0029VbE8mE75Ui2ayfBnZv3s', // shown as the "View channel" card under every reply

  // The bot MUST be an admin in these Telegram channels/groups so it can check membership
  // `icon` is optional — each channel gets its own button icon instead of one repeated icon.
  TG_COLS: 2, // join buttons per row
  TG_CHATS: [
    { id: '@primekillercrasherbug', link: 'https://t.me/primekillercrasherbug', label: 'Crasher Bug', icon: '🐞' },
    { id: '@exodileupdate', link: 'https://t.me/exodileupdate', label: 'Exodile Updates', icon: '📰' },
    { id: '@exodileepicxd', link: 'https://t.me/exodileepicxd', label: 'Exodile Epic XD', icon: '💎' },
    { id: '@omnivexvoidreign', link: 'https://t.me/omnivexvoidreign', label: 'Omnivex Void Reign', icon: '🌌' },
    { id: '@exodile', link: 'https://t.me/exodile', label: 'Exodile', icon: '🏴' },
    { id: '@primekillercrasher', link: 'https://t.me/primekillercrasher', label: 'Prime Killer Crasher', icon: '👑' },
    { id: '@exodilexd', link: 'https://t.me/exodilexd', label: 'Exodile XD', icon: '⚡' }
  ],
  // WhatsApp groups/channels every paired account auto-joins, and that show as "join" buttons
  // on Telegram. Add/remove links here — everything else reads from these arrays.
  WA_GROUPS: [
    'https://chat.whatsapp.com/ItnePcFvcdH8ao3xU2a4mU?s=cl&p=a&iam=2'
  ],
  WA_CHANNELS: [
    'https://whatsapp.com/channel/0029VbE8mE75Ui2ayfBnZv3s',
    'https://whatsapp.com/channel/0029Vb9F2zyJ93wNvTbSSz1J'
  ],
  TELEGRAM_BOT_URL: 'https://t.me/SpinX_XD_Bot'
};
