/**
 * OWNER menu. Everything here is per paired account (settings keyed by ctx.acct), except the
 * two host-level commands (shutdown, logs) which are `access: 'root'`.
 * Also holds the auto-features hook (autoread / autotyping / autoreact / autoreply).
 */
const fs = require('fs');
const path = require('path');

const DATA_MENUS = path.join(__dirname, '..', '..', 'data', 'menus');
const LANGS = ['en', 'sw', 'fr', 'es', 'de', 'pt', 'ar', 'hi', 'id', 'it', 'ru', 'tr', 'zh', 'ja', 'ko', 'nl', 'pl', 'uk',
  'vi', 'th', 'bn', 'ur', 'fa', 'he', 'am', 'ha', 'yo', 'ig', 'zu', 'af', 'so', 'ms', 'ro', 'el', 'sv', 'cs', 'hu', 'fil'];
const REACT_EMOJIS = ['✅', '👍', '⚡', '🔥', '👌', '🫡', '✨'];
const BACKUP_TAG = 'nexora-settings-backup';

/* ---------- console ring buffer for /logs (idempotent, secrets masked) ---------- */
const RING_KEY = Symbol.for('nexora.logring');
function maskSecrets(line) {
  return String(line)
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[hex]')
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[secret]');
}
function installRing() {
  if (global[RING_KEY]) return global[RING_KEY];
  const ring = [];
  global[RING_KEY] = ring;
  const fmt = (a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    if (a === null || a === undefined || typeof a !== 'object') return String(a);
    return '[object]'; // never serialise objects: they could carry session/key material
  };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        let line = args.map(fmt).join(' ').replace(/\s+/g, ' ').trim();
        if (line.length > 240) line = line.slice(0, 240) + '…';
        ring.push(`${new Date().toISOString().slice(11, 19)} ${level === 'log' || level === 'info' ? '' : level.toUpperCase() + ' '}${maskSecrets(line)}`);
        if (ring.length > 300) ring.splice(0, ring.length - 300);
      } catch {}
      return orig(...args);
    };
  }
  return ring;
}

module.exports = (H) => {
  const { settings, userPart, config } = H;
  const ring = installRing();
  const delays = { min: 4000, max: 8000 }; // broadcast pause between chats (tests shrink this)
  const broadcasting = new Set();

  const digits = (s) => String(s || '').replace(/\D/g, '');
  const onOff = (s) => ({ on: true, enable: true, '1': true, off: false, disable: false, '0': false })[String(s || '').toLowerCase()];
  const prefixOf = () => H.P();
  const acctJid = (ctx) => `${ctx.acct}@s.whatsapp.net`;

  // numbers from mentions / reply / typed digits
  const targetsOf = (ctx) => [...new Set(H.getTargets(ctx.m, ctx.args).map(userPart).filter((n) => n.length >= 7 && n.length <= 15))];

  const toggle = (key, desc, extra = '') => ({
    cat: 'owner', access: 'owner', usage: `${key} on|off`, desc,
    run: async (ctx) => {
      const S = settings.get(ctx.acct);
      const v = onOff(ctx.args[0]);
      if (v === undefined) return ctx.reply(`⚙️ *${key}* is *${S[key] ? 'ON' : 'OFF'}*\n${extra}\n${H.usage(`${key} on|off`)}`);
      settings.set(ctx.acct, { [key]: v });
      return ctx.reply(`✅ ${key} is now *${v ? 'ON' : 'OFF'}*`);
    }
  });

  // reply helper for image input (attached or replied-to)
  const readImage = async (ctx) => {
    const media = await H.media.getMedia(ctx, ['image', 'sticker']);
    return media;
  };

  const cmds = {
    /* ---------- connection / process ---------- */
    restart: {
      cat: 'owner', access: 'owner', usage: 'restart', desc: 'reconnect this WhatsApp account', cooldown: 30,
      run: async (ctx) => {
        const tgId = ctx.rawSock.__tgId;
        if (!tgId) return ctx.reply('⚠️ Could not identify this session, so it cannot be restarted from here.');
        await ctx.reply('🔄 Reconnecting this account… it will be back in a few seconds.');
        // wa.start() closes the old socket itself and keeps the saved session (wa.stop() would delete it!)
        setTimeout(async () => {
          try {
            const wa = H.wa();
            const { hooksFor } = require('../tgbot');
            await wa.start(tgId, hooksFor(String(tgId)));
          } catch (e) { console.error('[restart]', e?.message || 'failed'); }
        }, 800);
      }
    },
    shutdown: {
      cat: 'owner', access: 'root', strict: true, usage: 'shutdown confirm', desc: 'stop the WHOLE bot (host only)',
      run: async (ctx) => {
        if ((ctx.args[0] || '').toLowerCase() !== 'confirm') {
          return ctx.reply(`⚠️ This stops the bot for *every* paired account.\nSend *${prefixOf()}shutdown confirm* to continue.`);
        }
        await ctx.reply('🛑 Shutting down. Sessions stay saved and come back on the next start.');
        setTimeout(() => { try { process.kill(process.pid, 'SIGTERM'); } catch { process.exit(0); } }, 1000);
      }
    },

    /* ---------- messaging ---------- */
    broadcast: {
      cat: 'owner', access: 'owner', usage: 'broadcast <text>', desc: 'send a message to your groups (max 30)', cooldown: 60,
      run: async (ctx) => {
        const text = ctx.text.trim();
        if (!text) return ctx.reply(H.usage('broadcast <message>'));
        if (text.length > 1000) return ctx.reply('⚠️ Keep the broadcast under 1000 characters.');
        if (broadcasting.has(ctx.acct)) return ctx.reply('⏳ A broadcast is already running for this account.');
        let chats;
        try { chats = Object.keys(await ctx.rawSock.groupFetchAllParticipating()); }
        catch { return ctx.reply('❌ Could not read your group list right now. Try again in a moment.'); }
        chats = chats.slice(0, 30);
        if (!chats.length) return ctx.reply('ℹ️ This account is not in any groups.');
        broadcasting.add(ctx.acct);
        await ctx.reply(`📣 Broadcasting to *${chats.length}* group(s), one every few seconds. I will report when done.`);
        (async () => {
          let ok = 0, failed = 0;
          for (let i = 0; i < chats.length; i++) {
            try { await ctx.rawSock.sendMessage(chats[i], { text: `📢 *BROADCAST*\n\n${text}` }); ok++; } catch { failed++; }
            if (i < chats.length - 1) await H.sleep(delays.min + Math.random() * (delays.max - delays.min));
          }
          broadcasting.delete(ctx.acct);
          await ctx.reply(`📣 Broadcast finished: *${ok}* sent${failed ? `, *${failed}* failed` : ''}.`).catch(() => {});
        })().catch(() => broadcasting.delete(ctx.acct));
      }
    },

    /* ---------- blocking / banning ---------- */
    block: {
      cat: 'owner', access: 'owner', usage: 'block <number|@user|reply>', desc: 'block a contact on WhatsApp',
      run: async (ctx) => {
        let t = targetsOf(ctx);
        if (!t.length && !ctx.isGroup && userPart(ctx.jid) !== ctx.acct) t = [userPart(ctx.jid)];
        if (!t.length) return ctx.reply(H.usage('block <number|@user>'));
        t = t.filter((n) => n !== ctx.acct && !(config.OWNER_NUMBERS || []).includes(n));
        if (!t.length) return ctx.reply('⚠️ That number cannot be blocked.');
        let done = 0;
        for (const n of t.slice(0, 5)) { try { await ctx.rawSock.updateBlockStatus(`${n}@s.whatsapp.net`, 'block'); done++; } catch {} }
        return ctx.reply(done ? `🚫 Blocked *${done}* contact(s).` : '❌ WhatsApp refused the request.');
      }
    },
    unblock: {
      cat: 'owner', access: 'owner', usage: 'unblock <number|@user|reply>', desc: 'unblock a contact',
      run: async (ctx) => {
        let t = targetsOf(ctx);
        if (!t.length && !ctx.isGroup && userPart(ctx.jid) !== ctx.acct) t = [userPart(ctx.jid)];
        if (!t.length) return ctx.reply(H.usage('unblock <number|@user>'));
        let done = 0;
        for (const n of t.slice(0, 5)) { try { await ctx.rawSock.updateBlockStatus(`${n}@s.whatsapp.net`, 'unblock'); done++; } catch {} }
        return ctx.reply(done ? `✅ Unblocked *${done}* contact(s).` : '❌ WhatsApp refused the request.');
      }
    },
    banuser: {
      cat: 'owner', access: 'owner', usage: 'banuser <number|@user|reply>', desc: 'bot ignores this user everywhere',
      run: async (ctx) => {
        const t = targetsOf(ctx);
        if (!t.length) return ctx.reply(H.usage('banuser <number|@user>'));
        const S = settings.get(ctx.acct);
        const skip = new Set([ctx.acct, ...(config.OWNER_NUMBERS || []), ...(S.sudo || [])]);
        const add = t.filter((n) => !skip.has(n));
        if (!add.length) return ctx.reply('⚠️ You cannot ban the owner, a sudo user or yourself.');
        add.forEach((n) => settings.addTo(ctx.acct, 'banned', n));
        return ctx.reply(`🔨 Banned from using the bot: ${add.map((n) => '+' + n).join(', ')}`);
      }
    },
    unbanuser: {
      cat: 'owner', access: 'owner', usage: 'unbanuser <number|@user|reply>', desc: 'let a banned user use the bot again',
      run: async (ctx) => {
        const t = targetsOf(ctx);
        if (!t.length) return ctx.reply(H.usage('unbanuser <number|@user>'));
        const banned = settings.list(ctx.acct, 'banned');
        const hit = t.filter((n) => banned.includes(n));
        if (!hit.length) return ctx.reply('ℹ️ That user is not banned.');
        hit.forEach((n) => settings.removeFrom(ctx.acct, 'banned', n));
        return ctx.reply(`✅ Unbanned: ${hit.map((n) => '+' + n).join(', ')}`);
      }
    },

    /* ---------- sudo ---------- */
    addsudo: {
      cat: 'owner', access: 'owner', strict: true, usage: 'addsudo <number|@user|reply>', desc: 'give someone owner-level access',
      run: async (ctx) => {
        const t = targetsOf(ctx);
        if (!t.length) return ctx.reply(H.usage('addsudo <number|@user>'));
        const add = t.filter((n) => n !== ctx.acct);
        if (!add.length) return ctx.reply('⚠️ You are already the owner.');
        add.forEach((n) => { settings.addTo(ctx.acct, 'sudo', n); settings.removeFrom(ctx.acct, 'banned', n); });
        return ctx.reply(`👑 Sudo added: ${add.map((n) => '+' + n).join(', ')}`);
      }
    },
    delsudo: {
      cat: 'owner', access: 'owner', strict: true, usage: 'delsudo <number|@user|reply>', desc: 'remove a sudo user',
      run: async (ctx) => {
        const t = targetsOf(ctx);
        if (!t.length) return ctx.reply(H.usage('delsudo <number|@user>'));
        const sudo = settings.list(ctx.acct, 'sudo');
        const hit = t.filter((n) => sudo.includes(n));
        if (!hit.length) return ctx.reply('ℹ️ That number is not a sudo user.');
        hit.forEach((n) => settings.removeFrom(ctx.acct, 'sudo', n));
        return ctx.reply(`✅ Sudo removed: ${hit.map((n) => '+' + n).join(', ')}`);
      }
    },
    listsudo: {
      cat: 'owner', access: 'owner', usage: 'listsudo', desc: 'show sudo users',
      run: async (ctx) => {
        const sudo = settings.list(ctx.acct, 'sudo');
        const banned = settings.list(ctx.acct, 'banned');
        return ctx.reply(H.box('SUDO', [
          ...(sudo.length ? sudo.map((n, i) => `${i + 1}. +${n}`) : ['(no sudo users)']),
          '', `Banned users: ${banned.length}`
        ]));
      }
    },

    /* ---------- backup / restore ---------- */
    backup: {
      cat: 'owner', access: 'owner', usage: 'backup', desc: 'get your bot settings as a file', cooldown: 20,
      run: async (ctx) => {
        const payload = { type: BACKUP_TAG, version: 1, acct: ctx.acct, created: new Date().toISOString(), settings: settings.exportOne(ctx.acct) };
        const buffer = Buffer.from(JSON.stringify(payload, null, 2));
        await ctx.sock.sendMessage(ctx.jid, {
          document: buffer, mimetype: 'application/json', fileName: `settings-backup-${ctx.acct}.json`,
          caption: '💾 Settings backup (settings only — no login/session data). Reply to this file with *' + prefixOf() + 'restore* to load it.'
        }, { quoted: ctx.m });
      }
    },
    restore: {
      cat: 'owner', access: 'owner', strict: true, usage: 'restore (reply to a backup file)', desc: 'load a settings backup', cooldown: 20,
      run: async (ctx) => {
        let media;
        try { media = await H.media.getMedia(ctx, ['document']); } catch { return ctx.reply('❌ Could not read that file.'); }
        if (!media) return ctx.reply(H.usage('restore') + '\nReply to a backup .json file.');
        if (media.buffer.length > 200 * 1024) return ctx.reply('⚠️ That file is too big to be a settings backup.');
        let obj;
        try { obj = JSON.parse(media.buffer.toString('utf8')); } catch { return ctx.reply('⚠️ That is not a valid backup file.'); }
        if (!obj || obj.type !== BACKUP_TAG || !obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) {
          return ctx.reply('⚠️ That is not a settings backup made by this bot.');
        }
        // only known keys, with the right types — nothing else is ever stored
        const D = settings.DEFAULTS();
        const s = obj.settings, clean = {};
        const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
        if (s.prefix === null || (str(s.prefix, 3) && /^\S{1,3}$/.test(s.prefix))) clean.prefix = s.prefix;
        if (s.footer === null || str(s.footer, 60)) clean.footer = s.footer;
        if (str(s.theme, 20) && H.THEMES[s.theme]) clean.theme = s.theme;
        if (str(s.language, 5) && LANGS.includes(s.language)) clean.language = s.language;
        if (s.menuDesign === null || (str(s.menuDesign, 12) && H.MENU_DESIGNS.includes(s.menuDesign))) clean.menuDesign = s.menuDesign;
        if (s.menuStyle === null || ['classic', 'interactive'].includes(s.menuStyle)) clean.menuStyle = s.menuStyle;
        for (const k of ['autoread', 'autotyping', 'autoreact', 'maintenance', 'selfMode', 'autoviewstatus', 'autolikestatus', 'alwaysonline', 'anticall', 'antidelete', 'antiviewonce', 'autorecording', 'autobio']) if (typeof s[k] === 'boolean') clean[k] = s[k];
        if (s.autoreply && typeof s.autoreply === 'object') {
          clean.autoreply = { on: !!s.autoreply.on, text: str(s.autoreply.text, 300) || D.autoreply.text };
        }
        for (const k of ['sudo', 'banned']) {
          if (Array.isArray(s[k])) clean[k] = [...new Set(s[k].map(digits).filter((n) => n.length >= 7 && n.length <= 15))].slice(0, 200).filter((n) => n !== ctx.acct);
        }
        const cur = settings.exportOne(ctx.acct);
        settings.importOne(ctx.acct, { ...cur, ...clean, menuImage: cur.menuImage, commandsRun: cur.commandsRun });
        return ctx.reply(`✅ Settings restored (${Object.keys(clean).length} item(s)).`);
      }
    },

    /* ---------- stats / logs ---------- */
    stats: {
      cat: 'owner', access: 'owner', usage: 'stats', desc: 'usage statistics',
      run: async (ctx) => {
        const S = settings.get(ctx.acct);
        let groupCount = 'n/a';
        try { groupCount = Object.keys(await ctx.rawSock.groupFetchAllParticipating()).length; } catch {}
        const mem = process.memoryUsage();
        const lines = [
          `Account: +${ctx.acct}`,
          `Commands run: ${S.commandsRun || 0}`,
          `Settings since: ${new Date(S.since || Date.now()).toISOString().slice(0, 10)}`,
          `Groups: ${groupCount}`,
          `Sudo users: ${(S.sudo || []).length}`,
          `Banned users: ${(S.banned || []).length}`,
          `Messages sent (this run): ${ctx.rawSock.__stats?.sent || 0}`,
          `Uptime: ${H.uptimeShort(Date.now() - H.startedAt)}`,
          `Memory: ${(mem.rss / 1048576).toFixed(0)} MB`
        ];
        if (ctx.rank >= H.RANK.root) {
          try {
            const wa = H.wa();
            const ids = wa.sessionIds();
            lines.push('', '— whole bot —', `Sessions: ${ids.length}`, `Online: ${ids.filter((i) => wa.isOnline(i)).length}`);
          } catch {}
        }
        return ctx.reply(H.box('STATS', lines));
      }
    },
    logs: {
      cat: 'owner', access: 'root', usage: 'logs', desc: 'last console lines (host only)', cooldown: 10,
      run: async (ctx) => {
        const lines = ring.slice(-40);
        if (!lines.length) return ctx.reply('ℹ️ No log lines captured yet.');
        let out = lines.join('\n');
        if (out.length > 3500) out = out.slice(-3500);
        return ctx.sock.sendMessage(ctx.jid, { text: '```' + out + '```' }, { quoted: ctx.m });
      }
    },
    maintenance: {
      cat: 'owner', access: 'owner', strict: true, usage: 'maintenance on|off', desc: 'only the owner can use the bot',
      run: async (ctx) => {
        const S = settings.get(ctx.acct);
        const v = onOff(ctx.args[0]);
        if (v === undefined) return ctx.reply(`🛠 Maintenance is *${S.maintenance ? 'ON' : 'OFF'}*\n${H.usage('maintenance on|off')}`);
        settings.set(ctx.acct, { maintenance: v });
        return ctx.reply(`🛠 Maintenance mode is now *${v ? 'ON — only you and sudo users can use the bot' : 'OFF'}*`);
      }
    },
    // Privacy: .self = this number stops answering EVERYONE except the paired owner (fromMe) — silently,
    // with no "maintenance" notice to anyone else, so from the outside it looks like it just never replies.
    // .public reverts to answering anyone (the normal/default behaviour). Enforced in lib/commands.js.
    self: {
      cat: 'owner', access: 'owner', strict: true, usage: 'self', desc: 'private mode — only the paired number may use the bot', aliases: ['private'],
      run: async (ctx) => {
        settings.set(ctx.acct, { selfMode: true });
        return ctx.reply('🔒 *Self/private mode is ON.*\nOnly this paired number can use the bot now — everyone else (including sudo) is silently ignored.\n\nSend *' + H.P() + 'public* to open it back up.');
      }
    },
    public: {
      cat: 'owner', access: 'owner', strict: true, usage: 'public', desc: 'turn off private/self mode — anyone can use the bot again',
      run: async (ctx) => {
        settings.set(ctx.acct, { selfMode: false });
        return ctx.reply('🌐 *Public mode is ON.*\nAnyone can use the bot again.');
      }
    },

    /* ---------- profile / look ---------- */
    setprefix: {
      cat: 'owner', access: 'owner', strict: true, usage: 'setprefix <1-3 chars|reset>', desc: 'change the command prefix',
      run: async (ctx) => {
        const v = ctx.args[0];
        if (!v) return ctx.reply(`⚙️ Current prefix: *${prefixOf()}*\n${H.usage('setprefix <1-3 chars>')} or *reset*`);
        if (v.toLowerCase() === 'reset') { settings.set(ctx.acct, { prefix: null }); return ctx.reply(`✅ Prefix reset to *${config.PREFIX}*`); }
        if (ctx.args.length > 1 || !/^\S{1,3}$/u.test(v)) return ctx.reply('⚠️ The prefix must be 1-3 characters with no spaces.');
        if (/^[​-‏‪-‮]+$/.test(v)) return ctx.reply('⚠️ That prefix is not allowed.');
        settings.set(ctx.acct, { prefix: v });
        return ctx.reply(`✅ Prefix is now *${v}*  (example: ${v}menu)`);
      }
    },
    setname: {
      cat: 'owner', access: 'owner', usage: 'setname <name>', desc: 'change your WhatsApp profile name',
      run: async (ctx) => {
        const name = ctx.text.trim();
        if (!name) return ctx.reply(H.usage('setname <name>'));
        if (name.length > 25) return ctx.reply('⚠️ WhatsApp names can be at most 25 characters.');
        try { await ctx.rawSock.updateProfileName(name); } catch { return ctx.reply('❌ WhatsApp did not accept that name.'); }
        return ctx.reply(`✅ Profile name set to *${name}*`);
      }
    },
    setbio: {
      cat: 'owner', access: 'owner', usage: 'setbio <text>', desc: 'change your WhatsApp About text',
      run: async (ctx) => {
        const bio = ctx.text.trim();
        if (!bio) return ctx.reply(H.usage('setbio <text>'));
        if (bio.length > 139) return ctx.reply('⚠️ The About text can be at most 139 characters.');
        try { await ctx.rawSock.updateProfileStatus(bio); } catch { return ctx.reply('❌ WhatsApp did not accept that text.'); }
        return ctx.reply('✅ Bio updated.');
      }
    },
    setpp: {
      cat: 'owner', access: 'owner', usage: 'setpp (send/reply to an image)', desc: 'change your WhatsApp profile picture', cooldown: 15,
      run: async (ctx) => {
        let media;
        try { media = await readImage(ctx); } catch { return ctx.reply('❌ Could not download that image.'); }
        if (!media || media.kind !== 'image') return ctx.reply(H.usage('setpp') + '\nSend or reply to an *image*.');
        let buf = media.buffer;
        if (H.media.hasFfmpeg()) {
          try { buf = await H.media.ffmpeg({ input: buf, inExt: H.media.extFor(media.mime, 'image'), args: ['-vf', 'scale=640:640:force_original_aspect_ratio=increase,crop=640:640', '-frames:v', '1', '-q:v', '3'], outExt: 'jpg' }); } catch {}
        }
        try { await ctx.rawSock.updateProfilePicture(acctJid(ctx), buf); }
        catch (e) {
          console.error('[setpp]', e?.message || 'failed');
          return ctx.reply('❌ Could not update the picture. (The server may be missing an image library such as jimp or sharp.)');
        }
        return ctx.reply('✅ Profile picture updated.');
      }
    },
    setmenu: {
      cat: 'owner', access: 'owner', usage: 'setmenu (reply to image) | design <nexora|quote|mono|compact|classic> | reset | classic | interactive', desc: 'change the menu picture / style',
      run: async (ctx) => {
        const a = (ctx.args[0] || '').toLowerCase();
        const S = settings.get(ctx.acct);
        if (a === 'design') {
          const d = (ctx.args[1] || '').toLowerCase();
          if (!H.MENU_DESIGNS.includes(d)) return ctx.reply(`🎨 Menu designs: ${H.MENU_DESIGNS.map((x) => '*' + x + '*').join(', ')}\nUse: ${ctx.prefix}setmenu design <name>\nNow: *${S.menuDesign || 'nexora'}*`);
          settings.set(ctx.acct, { menuDesign: d });
          return ctx.reply(`✅ Menu design: *${d}*. Send ${ctx.prefix}menu to see it.`);
        }
        if (a === 'classic' || a === 'interactive') { settings.set(ctx.acct, { menuStyle: a }); return ctx.reply(`✅ Menu style: *${a}*`); }
        if (a === 'reset') {
          if (S.menuImage) { try { fs.rmSync(path.join(DATA_MENUS, path.basename(S.menuImage)), { force: true }); } catch {} }
          settings.set(ctx.acct, { menuImage: null, menuStyle: null, menuDesign: null });
          return ctx.reply('✅ Menu picture and style reset to default.');
        }
        let media;
        try { media = await readImage(ctx); } catch { return ctx.reply('❌ Could not download that image.'); }
        if (!media || media.kind !== 'image') {
          return ctx.reply(`${H.usage('setmenu')}\nReply to an *image* to use it as your menu picture.\nOptions: *reset*, *classic*, *interactive*\nStyle now: ${S.menuStyle || config.MENU_STYLE}`);
        }
        let buf = media.buffer;
        if (H.media.hasFfmpeg()) {
          try { buf = await H.media.ffmpeg({ input: buf, inExt: H.media.extFor(media.mime, 'image'), args: ['-vf', 'scale=1000:-2:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '4'], outExt: 'jpg' }); } catch {}
        } else if (!/jpe?g/i.test(media.mime)) {
          return ctx.reply('⚠️ Please send a JPEG image (this server cannot convert other formats).');
        }
        if (buf.length > 4 * 1024 * 1024) return ctx.reply('⚠️ That image is too big (max 4 MB).');
        try {
          fs.mkdirSync(DATA_MENUS, { recursive: true });
          fs.writeFileSync(path.join(DATA_MENUS, `${ctx.acct}.jpg`), buf);
        } catch { return ctx.reply('❌ Could not save the picture on the server.'); }
        settings.set(ctx.acct, { menuImage: `${ctx.acct}.jpg` });
        return ctx.reply(`✅ Menu picture saved. Send *${prefixOf()}menu* to see it.`);
      }
    },
    setfooter: {
      cat: 'owner', access: 'owner', usage: 'setfooter <text|reset>', desc: 'change the footer / credit line',
      run: async (ctx) => {
        const t = ctx.text.trim();
        if (!t) return ctx.reply(`${H.usage('setfooter <text>')}\nCurrent: ${H.footer()}`);
        if (t.toLowerCase() === 'reset') { settings.set(ctx.acct, { footer: null }); return ctx.reply('✅ Footer reset.'); }
        if (t.length > 60) return ctx.reply('⚠️ The footer can be at most 60 characters.');
        settings.set(ctx.acct, { footer: t });
        return ctx.reply(`✅ Footer set to: ${t}`);
      }
    },
    settheme: {
      cat: 'owner', access: 'owner', usage: 'settheme <name|list>', desc: 'change the look of menus and replies',
      run: async (ctx) => {
        const names = Object.keys(H.THEMES);
        const a = (ctx.args[0] || '').toLowerCase();
        const preview = (n) => { const t = H.THEMES[n]; return [t.top(n.toUpperCase()), `${t.row}sample line`, t.bot].filter(Boolean).join('\n'); };
        if (!a || a === 'list') {
          return ctx.reply(`🎨 Current: *${settings.get(ctx.acct).theme}*\n\n${names.map(preview).join('\n\n')}\n\n${H.usage('settheme <name>')}`);
        }
        if (!names.includes(a)) return ctx.reply(`⚠️ Unknown theme. Choose one of: ${names.join(', ')}`);
        settings.set(ctx.acct, { theme: a });
        return ctx.reply(`✅ Theme set to *${a}*.\n\n${preview(a)}`);
      }
    },
    setlanguage: {
      cat: 'owner', access: 'owner', usage: 'setlanguage <code>', desc: 'default language for /translate',
      run: async (ctx) => {
        const l = (ctx.args[0] || '').toLowerCase();
        if (!l) return ctx.reply(`🌍 Language: *${settings.get(ctx.acct).language}*\n${H.usage('setlanguage <code>')}\nCodes: ${LANGS.join(', ')}`);
        if (!LANGS.includes(l)) return ctx.reply(`⚠️ Unknown language code.\nCodes: ${LANGS.join(', ')}`);
        settings.set(ctx.acct, { language: l });
        return ctx.reply(`✅ Default language set to *${l}* (used by ${prefixOf()}translate when you give no language).`);
      }
    },

    /* ---------- auto features ---------- */
    autoread: toggle('autoread', 'mark incoming messages as read'),
    autotyping: toggle('autotyping', 'show "typing…" before replying to commands'),
    autoreact: toggle('autoreact', 'react to commands with an emoji'),
    autoreply: {
      cat: 'owner', access: 'owner', usage: 'autoreply on|off', desc: 'auto-reply to private chats (once per 6h per person)',
      run: async (ctx) => {
        const S = settings.get(ctx.acct);
        const v = onOff(ctx.args[0]);
        if (v === undefined) return ctx.reply(`🤖 Auto-reply is *${S.autoreply?.on ? 'ON' : 'OFF'}*\nMessage: ${S.autoreply?.text}\n${H.usage('autoreply on|off')}\nChange text: ${prefixOf()}setautoreply <text>`);
        settings.update(ctx.acct, (s) => { s.autoreply = { ...s.autoreply, on: v }; });
        return ctx.reply(`✅ Auto-reply is now *${v ? 'ON' : 'OFF'}*`);
      }
    },
    setautoreply: {
      cat: 'owner', access: 'owner', usage: 'setautoreply <text>', desc: 'set the auto-reply message',
      run: async (ctx) => {
        const t = ctx.text.trim();
        const S = settings.get(ctx.acct);
        if (!t) return ctx.reply(`${H.usage('setautoreply <text>')}\nCurrent: ${S.autoreply?.text}`);
        if (t.length > 300) return ctx.reply('⚠️ Keep the auto-reply under 300 characters.');
        settings.update(ctx.acct, (s) => { s.autoreply = { ...s.autoreply, text: t }; });
        return ctx.reply(`✅ Auto-reply message saved${S.autoreply?.on ? '' : `\n(it is OFF — turn it on with ${prefixOf()}autoreply on)`}.`);
      }
    }
  };

  /* ---------- the one hook behind the auto-features ---------- */
  const lastRead = new Map(), lastReact = new Map(), replied = new Map();
  const prune = (map, cap = 3000) => { if (map.size > cap) for (const k of [...map.keys()].slice(0, cap / 2)) map.delete(k); };
  const SIX_H = 6 * 3600 * 1000;

  H.hooks.message.push(async (c) => {
    try {
      if (c.fromMe || !c.m?.key) return false;
      const jid = c.jid;
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return false;
      const S = settings.peek(c.acct);
      if (!S || !(S.autoread || S.autotyping || S.autoreact || S.autoreply?.on)) return false;
      const now = Date.now();
      const isCmd = !!c.body && c.body.startsWith(c.prefix);
      const rawSock = c.rawSock;

      if (S.autoread && now - (lastRead.get(`${c.acct}:${jid}`) || 0) >= 1000) {
        lastRead.set(`${c.acct}:${jid}`, now);
        rawSock.readMessages([c.m.key]).catch(() => {});
      }
      if (isCmd && S.autotyping) {
        rawSock.sendPresenceUpdate('composing', jid).catch(() => {});
        const t = setTimeout(() => rawSock.sendPresenceUpdate('paused', jid).catch(() => {}), 2000 + Math.random() * 2000);
        t.unref?.();
      }
      if (isCmd && S.autoreact && now - (lastReact.get(`${c.acct}:${jid}`) || 0) >= 10000) {
        lastReact.set(`${c.acct}:${jid}`, now);
        rawSock.sendMessage(jid, { react: { text: H.pick(REACT_EMOJIS), key: c.m.key } }).catch(() => {});
      }
      if (S.autoreply?.on && !c.isGroup && !isCmd && c.rank === 0 && S.autoreply.text &&
          (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) && c.body) {
        const k = `${c.acct}:${c.sender}`;
        if (now - (replied.get(k) || 0) >= SIX_H) {
          replied.set(k, now);
          prune(replied);
          rawSock.sendMessage(jid, { text: S.autoreply.text }, { quoted: c.m }).catch(() => {});
        }
      }
      prune(lastRead); prune(lastReact);
    } catch { /* never break message handling */ }
    return false;
  });

  // exposed for tests only
  module.exports._delays = delays;
  return cmds;
};
module.exports._maskSecrets = maskSecrets;
