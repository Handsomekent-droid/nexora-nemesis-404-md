/**
 * PAIRING (Build 45): .pair <number> — pair a WhatsApp number straight from a chat with the bot, the
 * same way the console/Telegram/website flows do (lib/consolepair.js, lib/tgbot.js, lib/webpair.js).
 * No panel access, no Telegram, no website needed — just message any already-running copy of the bot.
 *
 * Safety: this only ever pairs a NUMBER THAT ISN'T ALREADY CONNECTED, or re-pairs the number that is
 * ASKING (i.e. you can always re-link your own number). It never lets one person stop/kick another
 * person's already-connected session — without that check, anyone could type `.pair <someone else's
 * number>` to forcibly log that person's bot out and steal their pairing slot.
 */
module.exports = (H) => {
  const { usage, config } = H;
  const P = () => H.P();
  const out = {};

  out.pair = {
    cat: 'tools', access: 'public', cooldown: 60, usage: 'pair 254xxxxxxxxx', desc: 'link your own WhatsApp number to this bot', aliases: ['pairme', 'linkme', 'reqpair'],
    run: async (ctx) => {
      const wa = H.wa();
      const db = require('../db');
      const raw = (ctx.args[0] || '').replace(/[^\d]/g, '');

      if (raw.length < 7 || raw.length > 15) {
        return ctx.reply(`${usage('pair 254xxxxxxxxx')}\nSend the number with its country code, digits only (no + or spaces).\n\nExample: ${P()}pair 254712345678`);
      }
      if (raw === ctx.acct) return ctx.reply('ℹ️ That is this bot\'s own number — it is already connected here.');

      // Already connected: only the SAME number re-pairing itself may continue (e.g. it needs re-linking).
      // Anyone else trying to pair a number that's already live is refused, so `.pair` can't be used to
      // kick someone else's session offline.
      if (wa.hasSession(raw) && raw !== ctx.senderNum) {
        return ctx.reply(wa.isOnline(raw)
          ? `❌ +${raw} already has an active session here. Only that number itself can re-pair (by sending ${P()}pair ${raw} FROM that WhatsApp number).`
          : `❌ +${raw} already has a session here (currently offline). Only that number itself can re-pair it.`);
      }

      if (!wa.hasSession(raw) && wa.sessionIds().length >= config.MAX_SESSIONS) {
        return ctx.reply(`⚠️ This bot is full right now (${config.MAX_SESSIONS} session limit). Please try again later.`);
      }

      await ctx.reply(`⏳ Generating a pairing code for +${raw}...`);
      try { await wa.stop(raw); } catch {}
      db.set(raw, { phone: raw, pairedAt: null, status: 'pairing', viaBot: 'whatsapp-cmd', requestedBy: ctx.senderNum });

      wa.start(raw, {
        phone: raw,
        onCode: (code) => {
          ctx.reply(
            `🔑 *Pairing code for +${raw}*\n\n*${code}*\n\n` +
            `1️⃣ Open WhatsApp on that phone\n2️⃣ Settings → Linked Devices → Link a Device\n` +
            `3️⃣ Tap "Link with phone number instead"\n4️⃣ Enter the code above\n\n` +
            `⏳ Expires in a few minutes — if it does, send ${P()}pair ${raw} again.`
          ).catch(() => {});
        },
        onOpen: (sock) => {
          db.set(raw, { pairedAt: Date.now(), status: 'active', lastActiveAt: Date.now() });
          sock.sendMessage(`${raw}@s.whatsapp.net`, {
            text: `✅ *${config.BOT_NAME} is connected!*\n\nSend *${config.PREFIX}menu* in any chat to see every command.\n\n> ${config.DEV}`
          }).catch(() => {});
          try {
            setTimeout(() => require('../autojoin').joinAll(sock).catch(() => {}), 8000 + Math.random() * 12000);
          } catch {}
        },
        onFail: (msg) => {
          ctx.reply(`❌ Pairing failed: ${msg || 'unknown error'}`).catch(() => {});
          if (!db.get(raw)?.pairedAt) db.del(raw);
        },
        onLoggedOut: () => {
          ctx.reply('❌ WhatsApp logged that session out. Try pairing again.').catch(() => {});
        },
        onState: () => {}
      }).catch((e) => {
        console.error('[pair]', e?.message || e);
        ctx.reply(`❌ Could not start pairing: ${e?.message || 'unknown error'}`).catch(() => {});
        if (!db.get(raw)?.pairedAt) db.del(raw);
      });
    }
  };

  return out;
};
