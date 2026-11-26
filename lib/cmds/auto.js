/**
 * AUTO FEATURES (Build 26) — owner switches for the engine in lib/auto.js. Every switch is saved per paired account.
 *   autoviewstatus · autolikestatus (+statusemoji) · alwaysonline · anticall · antidelete · antiviewonce ·
 *   autorecording · autobio (+setautobio) · autosettings (panel) · tostatus (post to your own WhatsApp status)
 * autoread / autotyping / autoreact / autoreply live in owner.js.
 */
const settings = require('../settings');

module.exports = (H) => {
  const { usage, media } = H;
  const P = () => H.P();
  const onOff = (s) => ({ on: true, enable: true, '1': true, off: false, disable: false, '0': false })[String(s || '').toLowerCase()];
  const out = {};

  const toggle = (key, desc, note = '', aliases) => ({
    cat: 'owner', access: 'owner', cooldown: 2, usage: `${key} on|off`, desc, aliases,
    run: async (ctx) => {
      const S = settings.get(ctx.acct);
      const v = onOff(ctx.args[0]);
      if (v === undefined) return ctx.reply(`⚙️ *${key}* is *${S[key] ? 'ON' : 'OFF'}*${note ? `\n${note}` : ''}\n${usage(`${key} on|off`)}`);
      settings.set(ctx.acct, { [key]: v });
      if (key === 'alwaysonline') { try { await ctx.rawSock.sendPresenceUpdate(v ? 'available' : 'unavailable'); } catch {} }
      return ctx.reply(`✅ ${key} is now *${v ? 'ON' : 'OFF'}*`);
    }
  });

  out.autoviewstatus = toggle('autoviewstatus', 'automatically view everyone\'s status', 'Marks contacts\' statuses as seen a few seconds after they are posted.', ['autoview', 'autostatusview']);
  out.autolikestatus = toggle('autolikestatus', 'automatically like (react to) statuses', 'Reacts to statuses with your emoji (change it with the statusemoji command).', ['autoreactstatus', 'autostatuslike']);
  out.statusemoji = {
    cat: 'owner', access: 'owner', cooldown: 2, usage: 'statusemoji <emoji>', desc: 'emoji used by autolikestatus',
    run: async (ctx) => {
      const e = (ctx.text || '').trim();
      if (!e) return ctx.reply(`😀 Status emoji: ${settings.get(ctx.acct).statusEmoji}\n${usage('statusemoji <emoji>')}`);
      if (e.length > 8 || /[a-z0-9]/i.test(e)) return ctx.reply('⚠️ Send one emoji, for example: ' + P() + 'statusemoji 🔥');
      settings.set(ctx.acct, { statusEmoji: e });
      return ctx.reply(`✅ Status emoji set to ${e}`);
    }
  };
  out.alwaysonline = toggle('alwaysonline', 'always show as online', 'Keeps your last-seen showing "online".', ['online24', 'alwayson']);
  out.antiviewonce = toggle('antiviewonce', 'forward every view-once you receive to your own chat', 'Photos, videos and voice notes sent as view-once arrive in your own chat too (RAM copy is also what makes .vv work).', ['antivv']);
  out.antidelete = toggle('antidelete', 'send you deleted messages', 'When someone deletes a message the bot saw, a copy is sent to your own chat. Needs the bot to have been online when it arrived.', ['antidel']);
  out.autorecording = toggle('autorecording', 'show "recording audio…" in private chats', '', ['autorecord']);
  out.autobio = toggle('autobio', 'keep your About/status text updated (uptime + time)', 'Change the text with the setautobio command — placeholders {bot} {uptime} {time} {date}.');
  out.setautobio = {
    cat: 'owner', access: 'owner', cooldown: 3, usage: 'setautobio <text>', desc: 'set the autobio text',
    run: async (ctx) => {
      const t = (ctx.text || '').trim();
      if (!t) return ctx.reply(`${usage('setautobio <text>')}\nCurrent: ${settings.get(ctx.acct).autobioText}\nPlaceholders: {bot} {uptime} {time} {date}`);
      if (t.length > 120) return ctx.reply('⚠️ Keep it under 120 characters.');
      settings.set(ctx.acct, { autobioText: t });
      return ctx.reply(`✅ Saved. It updates every 5 minutes while autobio is ON.\nPreview: ${require('../auto').bioText({ autobioText: t })}`);
    }
  };

  out.anticall = {
    cat: 'owner', access: 'owner', cooldown: 2, usage: 'anticall on|off|block', desc: 'reject incoming calls (block = also block the caller)',
    run: async (ctx) => {
      const S = settings.get(ctx.acct);
      const a = (ctx.args[0] || '').toLowerCase();
      if (!a) return ctx.reply(`📵 *anticall* is *${S.anticall ? (S.anticallMode === 'block' ? 'ON (block)' : 'ON (reject)') : 'OFF'}*\n${usage('anticall on|off|block')}\nOwners and your own number are never rejected.`);
      if (a === 'block') { settings.set(ctx.acct, { anticall: true, anticallMode: 'block' }); return ctx.reply('✅ anticall is ON — callers are rejected *and blocked*.'); }
      const v = onOff(a);
      if (v === undefined) return ctx.reply(usage('anticall on|off|block'));
      settings.set(ctx.acct, { anticall: v, anticallMode: 'reject' });
      return ctx.reply(`✅ anticall is now *${v ? 'ON (reject)' : 'OFF'}*`);
    }
  };

  out.autosettings = {
    cat: 'owner', access: 'owner', cooldown: 3, usage: 'autosettings', desc: 'show every automatic feature and whether it is on', aliases: ['autostatus', 'automation'],
    run: async (ctx) => {
      const S = settings.get(ctx.acct);
      const f = (v) => (v ? '🟢 ON' : '⚪ OFF');
      await ctx.reply([
        '⚙️ *AUTOMATIC FEATURES*',
        `👁 autoread — ${f(S.autoread)}`, `⌨️ autotyping — ${f(S.autotyping)}`, `🎙 autorecording — ${f(S.autorecording)}`,
        `😀 autoreact — ${f(S.autoreact)}`, `💬 autoreply — ${f(S.autoreply?.on)}`,
        `📺 autoviewstatus — ${f(S.autoviewstatus)}`, `❤️ autolikestatus — ${f(S.autolikestatus)} (${S.statusEmoji})`,
        `🟢 alwaysonline — ${f(S.alwaysonline)}`, `📵 anticall — ${f(S.anticall)}${S.anticall ? ` (${S.anticallMode})` : ''}`,
        `🗑 antidelete — ${f(S.antidelete)}`, `👁‍🗨 antiviewonce — ${f(S.antiviewonce)}`, `📝 autobio — ${f(S.autobio)}`,
        '', `Switch any of them with ${P()}<name> on|off`
      ].join('\n'));
    }
  };

  /* ---------- .tostatus : post to YOUR OWN WhatsApp status ---------- */
  out.tostatus = {
    cat: 'owner', access: 'owner', cooldown: 10, usage: 'tostatus [text]  (or reply to a photo / video / voice note)', desc: 'post a photo, video, voice note or text to your WhatsApp status', aliases: ['poststatus', 'setstatus'],
    run: async (ctx) => {
      const caption = (ctx.text || '').trim();
      let f = null;
      try { f = await media.getMedia(ctx, ['image', 'video', 'audio']); } catch (e) { console.error('[tostatus] media:', e?.message || e); }
      if (!f && !caption) return ctx.reply(`${usage('tostatus [text]')}\nReply to a photo/video/voice note, or type text.\nExample: ${P()}tostatus Good morning everyone ☀️`);

      // who can see it: you + the people you share groups with (a status needs an explicit audience when sent from a linked device)
      const raw = ctx.rawSock;
      const audience = new Set([`${ctx.acct}@s.whatsapp.net`]);
      try {
        const groups = Object.values(await raw.groupFetchAllParticipating());
        for (const g of groups) for (const p of g.participants || []) { const j = p.jid || p.id; if (j && j.endsWith('@s.whatsapp.net')) audience.add(j); }
      } catch (e) { console.error('[tostatus] audience:', e?.message || e); }
      const statusJidList = [...audience].slice(0, 3000);

      let content;
      if (f?.kind === 'image') content = { image: f.buffer, caption };
      else if (f?.kind === 'video') content = { video: f.buffer, caption, mimetype: f.mime || 'video/mp4' };
      else if (f?.kind === 'audio') content = { audio: f.buffer, mimetype: f.mime || 'audio/ogg; codecs=opus', ptt: true };
      else content = { text: caption, backgroundColor: ['#128C7E', '#6A1B9A', '#1565C0', '#C62828', '#2E7D32', '#EF6C00'][Math.floor(Math.random() * 6)], font: Math.floor(Math.random() * 5) };
      try {
        await raw.sendMessage('status@broadcast', content, { statusJidList });
        await ctx.reply(`✅ Posted to your status (${statusJidList.length - 1} people can see it).`);
      } catch (e) {
        console.error('[tostatus]', e?.message || e);
        await ctx.reply('❌ Could not post the status. Try again, or use a smaller file.');
      }
    }
  };

  return out;
};
