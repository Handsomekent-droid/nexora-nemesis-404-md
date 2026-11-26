/**
 * MORE (Build 19): view-once opener, profile helpers, group schedule, owner helpers and a pack of fun commands.
 *   TOOLS  : vv, getpp, getbio, whoami, jid
 *   GROUP  : opentime, closetime
 *   OWNER  : join, groups, online
 *   FUN    : pickup, fortune, neverhaveiever, thisorthat, horoscope, compatibility, nickname, tonguetwister,
 *            proverb, affirmation, motivate, wish, luck, iq
 */
const crypto = require('crypto');

module.exports = (H) => {
  const { usage, userPart, pick, media } = H;
  const P = () => H.P();
  const out = {};
  const hashNum = (s, mod) => { let h = 0; for (const c of String(s).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % mod; };

  /* ======================= TOOLS ======================= */
  // .vv  — reply to a view-once photo / video / voice note. The bot keeps a RAM copy of every view-once it receives
  // while it is online (lib/auto.js), because WhatsApp strips the media from the quoted copy once it has been opened.
  // Recognizes every shape WhatsApp has used for view-once: the 3 wrapper messages (viewOnceMessage,
  // viewOnceMessageV2, viewOnceMessageV2Extension) AND the newer direct `.viewOnce: true` flag on the media itself.
  const extractViewOnce = (quotedMsg) => {
    if (!quotedMsg) return null;
    const hasViewOnce =
      !!quotedMsg.viewOnceMessageV2 || !!quotedMsg.viewOnceMessageV2Extension || !!quotedMsg.viewOnceMessage ||
      !!quotedMsg.viewOnce || !!quotedMsg.imageMessage?.viewOnce || !!quotedMsg.videoMessage?.viewOnce || !!quotedMsg.audioMessage?.viewOnce;
    if (!hasViewOnce) return null;
    let actualMsg = null, mtype = null;
    if (quotedMsg.viewOnceMessageV2Extension?.message) { actualMsg = quotedMsg.viewOnceMessageV2Extension.message; mtype = Object.keys(actualMsg)[0]; }
    else if (quotedMsg.viewOnceMessageV2?.message) { actualMsg = quotedMsg.viewOnceMessageV2.message; mtype = Object.keys(actualMsg)[0]; }
    else if (quotedMsg.viewOnceMessage?.message) { actualMsg = quotedMsg.viewOnceMessage.message; mtype = Object.keys(actualMsg)[0]; }
    else if (quotedMsg.imageMessage?.viewOnce) { actualMsg = { imageMessage: quotedMsg.imageMessage }; mtype = 'imageMessage'; }
    else if (quotedMsg.videoMessage?.viewOnce) { actualMsg = { videoMessage: quotedMsg.videoMessage }; mtype = 'videoMessage'; }
    else if (quotedMsg.audioMessage?.viewOnce) { actualMsg = { audioMessage: quotedMsg.audioMessage }; mtype = 'audioMessage'; }
    if (!actualMsg || !mtype || !actualMsg[mtype]) return null;
    const kind = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' ? 'video' : 'audio';
    return { node: actualMsg[mtype], kind };
  };
  const openVV = async (ctx, toDm) => {
    try {
      const auto = require('../auto');
      const ci = H.getCtxInfo(ctx.m) || {};

      if (!ci.stanzaId || !ci.quotedMessage) {
        return ctx.reply(`${usage(toDm ? 'vv2' : 'vv')}\n🗑️ Reply to a *view-once* photo/video/voice note with ${P()}${toDm ? 'vv2' : 'vv'}.`);
      }

      // 1) RAM cache first — recovers it even after WhatsApp has stripped the quoted copy, as long
      //    as the bot was online when it first arrived.
      let f = auto.viewOnceFor(ctx.acct, ci.stanzaId);

      // 2) not cached: try downloading straight from the quoted message (works if it's still fresh
      //    and WhatsApp hasn't wiped the media key yet).
      if (!f) {
        const vo = extractViewOnce(ci.quotedMessage);
        if (!vo) return ctx.reply('❌ That reply is not a view-once message.');
        try {
          const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
          const stream = await downloadContentFromMessage(vo.node, vo.kind);
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          f = { kind: vo.kind, buffer, mime: vo.node.mimetype || '', caption: vo.node.caption || '', from: ci.participant || ctx.senderNum };
        } catch (e) {
          console.error('[vv] direct download failed:', e?.message || e);
          return ctx.reply('❌ Could not recover that one — WhatsApp has already wiped it, and the bot wasn\'t online when it first arrived to keep a copy.');
        }
      }

      const dest = `${ctx.senderNum}@s.whatsapp.net`;
      const to = toDm ? dest : ctx.jid;
      const cap = '👁 Opened by ' + H.config.BOT_NAME + (f.caption ? `\n\n${f.caption}` : '');
      const opts = toDm ? {} : { quoted: ctx.m };
      if (f.kind === 'image') await ctx.rawSock.sendMessage(to, { image: f.buffer, caption: cap }, opts);
      else if (f.kind === 'video') await ctx.rawSock.sendMessage(to, { video: f.buffer, caption: cap, mimetype: f.mime || 'video/mp4' }, opts);
      else await ctx.rawSock.sendMessage(to, { audio: f.buffer, mimetype: f.mime || 'audio/ogg; codecs=opus', ptt: true }, opts);
      if (toDm && dest !== ctx.jid) await ctx.reply('✅ Sent to your DM.');
    } catch (e) {
      console.error('[vv]', e?.message || e);
      await ctx.reply('❌ Error processing that view-once message: ' + (e?.message || 'unknown error'));
    }
  };
  out.vv = {
    cat: 'tools', access: 'public', cooldown: 5, usage: 'vv  (reply to a view-once photo/video/voice note)', desc: 'open a view-once message and keep it', aliases: ['viewonce', 'readviewonce', 'rvo'],
    run: (ctx) => openVV(ctx, false)
  };
  out.vv2 = {
    cat: 'tools', access: 'public', cooldown: 5, usage: 'vv2  (reply to a view-once photo/video/voice note)', desc: 'open a view-once message and send it to your own DM', aliases: ['vvdm', 'secretvv'],
    run: (ctx) => openVV(ctx, true)
  };
  const target = (ctx) => H.getTargets(ctx.m, ctx.args)[0] || `${ctx.senderNum}@s.whatsapp.net`;
  out.getpp = {
    cat: 'tools', access: 'public', cooldown: 6, usage: 'getpp [@user]', desc: "someone's profile picture", aliases: ['pp2', 'profilepic'],
    run: async (ctx) => {
      const jid = target(ctx);
      try {
        const url = await ctx.rawSock.profilePictureUrl(jid, 'image');
        await ctx.sock.sendMessage(ctx.jid, { image: { url }, caption: `🖼 @${userPart(jid)}`, mentions: [jid] }, { quoted: ctx.m });
      } catch { await ctx.reply('❌ No profile picture found (they may have no picture or have hidden it).'); }
    }
  };
  out.getbio = {
    cat: 'tools', access: 'public', cooldown: 6, usage: 'getbio [@user]', desc: "someone's About/status text", aliases: ['about2'],
    run: async (ctx) => {
      const jid = target(ctx);
      try {
        const r = await ctx.rawSock.fetchStatus(jid); const s = Array.isArray(r) ? r[0] : r;
        const text = s?.status?.status ?? s?.status;
        if (!text) throw new Error('none');
        await ctx.sock.sendMessage(ctx.jid, { text: `📝 *@${userPart(jid)}*\n\n${text}`, mentions: [jid] }, { quoted: ctx.m });
      } catch { await ctx.reply('❌ No About text found (they may have hidden it).'); }
    }
  };
  out.whoami = {
    cat: 'tools', access: 'public', cooldown: 4, usage: 'whoami', desc: 'your number, name and access level', aliases: ['me'],
    run: async (ctx) => ctx.reply(`👤 *You*\nNumber: +${ctx.senderNum}\nName: ${ctx.userName || ctx.m.pushName || '—'}\nAccess: *${ctx.level}*\nChat: ${ctx.isGroup ? 'group' : 'private'}`)
  };
  out.jid = {
    cat: 'tools', access: 'public', cooldown: 3, usage: 'jid [@user]', desc: 'WhatsApp id of this chat / a person', aliases: ['chatid'],
    run: async (ctx) => {
      const t = H.getTargets(ctx.m, ctx.args)[0];
      await ctx.reply(t ? `🆔 User: ${t}` : `🆔 Chat: ${ctx.jid}\nYou: ${ctx.senderNum}@s.whatsapp.net`);
    }
  };

  /* ======================= GROUP: scheduled lock ======================= */
  const timers = new Map(); // jid|mode -> timer
  const schedule = (mode, setting, doneText) => ({
    cat: 'group', group: true, admin: true, usage: `${mode} <minutes>`, desc: mode === 'closetime' ? 'lock the group for N minutes, then open it' : 'open the group for N minutes, then lock it',
    run: async (ctx) => {
      const n = parseInt(ctx.args[0], 10);
      if (!Number.isFinite(n) || n < 1 || n > 1440) return ctx.reply(`${usage(`${mode} <minutes>`)}\nExample: ${P()}${mode} 30`);
      const back = setting === 'announcement' ? 'not_announcement' : 'announcement';
      try {
        await ctx.rawSock.groupSettingUpdate(ctx.jid, setting);
        const key = `${ctx.acct}|${ctx.jid}`;
        clearTimeout(timers.get(key));
        const raw = ctx.rawSock; const jid = ctx.jid;
        timers.set(key, setTimeout(async () => {
          timers.delete(key);
          try { await raw.groupSettingUpdate(jid, back); await raw.sendMessage(jid, { text: doneText }); } catch (e) { console.error(`[${mode}]`, e?.message || e); }
        }, n * 60000));
        await ctx.reply(setting === 'announcement' ? `🔒 Group locked for *${n} min*. It opens automatically after that.` : `🔓 Group open for *${n} min*. It locks automatically after that.`);
      } catch { await ctx.reply('❌ Failed. Make sure this account is a group admin.'); }
    }
  });
  out.closetime = schedule('closetime', 'announcement', '🔓 Time is up — the group is open again.');
  out.opentime = schedule('opentime', 'not_announcement', '🔒 Time is up — the group is locked again (only admins can chat).');

  /* ======================= OWNER ======================= */
  out.join = {
    cat: 'owner', access: 'owner', cooldown: 6, usage: 'join <group invite link>', desc: 'make the bot join a group',
    run: async (ctx) => {
      const code = (ctx.text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]{10,})/) || [])[1];
      if (!code) return ctx.reply(`${usage('join <group invite link>')}`);
      try { const id = await ctx.rawSock.groupAcceptInvite(code); await ctx.reply(`✅ Joined${id ? ` (${id})` : ''}.`); }
      catch (e) { await ctx.reply('❌ Could not join. The link may be invalid, revoked, or the group needs approval.'); }
    }
  };
  out.groups = {
    cat: 'owner', access: 'owner', cooldown: 10, usage: 'groups', desc: 'list the groups this account is in', aliases: ['mygroups', 'gclist'],
    run: async (ctx) => {
      try {
        const all = Object.values(await ctx.rawSock.groupFetchAllParticipating());
        if (!all.length) return ctx.reply('ℹ️ Not in any group.');
        const list = all.sort((a, b) => b.participants.length - a.participants.length).slice(0, 40);
        await ctx.reply(`👥 *Groups (${all.length})*\n\n${list.map((g, i) => `${i + 1}. ${g.subject} — ${g.participants.length}`).join('\n')}${all.length > 40 ? `\n…and ${all.length - 40} more` : ''}`);
      } catch { await ctx.reply('❌ Could not read the group list right now.'); }
    }
  };
  out.online = {
    cat: 'group', access: 'public', group: true, cooldown: 8, usage: 'online', desc: 'who is in this group right now (admins + members count)', aliases: ['listadmins2'],
    run: async (ctx) => {
      const meta = await H.getMeta(ctx.rawSock, ctx.jid);
      const adm = meta.participants.filter((p) => p.admin);
      await ctx.sock.sendMessage(ctx.jid, { text: `👥 *${meta.subject}*\nMembers: ${meta.participants.length}\nAdmins: ${adm.length}\n\n${adm.map((a) => '🛡 @' + userPart(a.jid || a.id)).join('\n')}`, mentions: adm.map((a) => a.jid || a.id) }, { quoted: ctx.m });
    }
  };

  /* ======================= FUN (static lists) ======================= */
  const list = (name, desc, items, prefix, extra = {}) => {
    out[name] = { cat: 'fun', access: 'public', cooldown: 3, usage: name, desc, aliases: extra.aliases, run: (ctx) => ctx.reply(`${prefix} ${pick(items)}`) };
  };
  list('pickup', 'a cheesy pickup line', ['Are you Wi-Fi? Because I feel a connection.', 'Do you have a map? I keep getting lost in your eyes.', 'Is your name Google? Because you have everything I have been searching for.', 'Are you a magician? Whenever I look at you, everyone else disappears.', 'Do you believe in love at first sight, or should I text again?', 'If you were a vegetable you would be a cute-cumber.', 'Are you a campfire? Because you are hot and I want s’more.', 'Is your dad a baker? Because you are a cutie pie.'], '💘', { aliases: ['pickupline', 'rizz'] });
  list('fortune', 'your fortune', ['A pleasant surprise is waiting for you.', 'Your hard work will soon be rewarded.', 'Someone is thinking of you right now.', 'A new opportunity is closer than you think.', 'Patience will bring you something great.', 'You will meet someone who changes your plans.', 'Money comes to those who keep going.', 'Today is a good day to start something new.'], '🔮', { aliases: ['fortunecookie'] });
  list('neverhaveiever', 'Never Have I Ever question', ['Never have I ever fallen asleep in class.', 'Never have I ever sent a message to the wrong person.', 'Never have I ever pretended to be sick to skip something.', 'Never have I ever laughed so hard I cried in public.', 'Never have I ever forgotten someone’s name right after meeting them.', 'Never have I ever eaten food off the floor.', 'Never have I ever lied about my age.', 'Never have I ever stayed up all night on my phone.'], '🍻', { aliases: ['nhie'] });
  list('thisorthat', 'This or That question', ['Tea ☕ or Coffee ☕?', 'Beach 🏖 or Mountains ⛰?', 'Pizza 🍕 or Burger 🍔?', 'Day 🌞 or Night 🌙?', 'Texting 💬 or Calling 📞?', 'Rain 🌧 or Sun ☀️?', 'Football ⚽ or Basketball 🏀?', 'Chapati or Rice?', 'Early bird 🐦 or Night owl 🦉?', 'Cats 🐱 or Dogs 🐶?'], '🤔', { aliases: ['tot'] });
  list('tonguetwister', 'a tongue twister', ['She sells seashells by the seashore.', 'Peter Piper picked a peck of pickled peppers.', 'How much wood would a woodchuck chuck if a woodchuck could chuck wood?', 'Red lorry, yellow lorry.', 'Fuzzy Wuzzy was a bear, Fuzzy Wuzzy had no hair.', 'I scream, you scream, we all scream for ice cream.', 'Betty Botter bought some butter but she said the butter’s bitter.'], '👅', { aliases: ['twister'] });
  list('proverb', 'a wise proverb', ['Haraka haraka haina baraka. (Haste has no blessing.)', 'A journey of a thousand miles begins with a single step.', 'Where there is a will, there is a way.', 'He who learns, teaches.', 'Patience is the key to paradise.', 'Unity is strength.', 'The best time to plant a tree was 20 years ago. The second best time is now.', 'Mti hauendi bila matawi. (A tree does not grow without branches.)'], '📜', { aliases: ['wisdom'] });
  list('affirmation', 'a positive affirmation', ['I am capable of achieving great things.', 'I choose peace over worry today.', 'I am growing a little every day.', 'I deserve good things.', 'My effort is enough.', 'I am stronger than my challenges.', 'Good things are coming my way.'], '🌟', { aliases: ['positive'] });
  list('motivate', 'a motivational line', ['Do it now. Sometimes “later” becomes “never”.', 'Small steps every day add up to big results.', 'Your only limit is you.', 'Discipline beats motivation.', 'Dream big, start small, act now.', 'Fall seven times, stand up eight.', 'Success is the sum of small efforts repeated daily.'], '🔥', { aliases: ['motivation'] });

  out.horoscope = {
    cat: 'fun', access: 'public', cooldown: 4, usage: 'horoscope <sign>', desc: "today's horoscope (for fun)", aliases: ['hscope'],
    run: async (ctx) => {
      const signs = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
      const s = (ctx.args[0] || '').toLowerCase();
      if (!signs.includes(s)) return ctx.reply(`${usage('horoscope <sign>')}\nSigns: ${signs.join(', ')}`);
      const day = new Date().toISOString().slice(0, 10);
      const lines = ['Focus on one goal today — progress will follow.', 'A conversation clears up an old confusion.', 'Money matters improve if you stay patient.', 'Someone close needs your support.', 'Trust your instincts on a decision.', 'A small risk may pay off.', 'Rest is productive today.', 'Good news arrives by message or call.'];
      const lucky = hashNum(s + day, 99) + 1;
      await ctx.reply(`♈ *${s[0].toUpperCase() + s.slice(1)}* — ${day}\n\n${lines[hashNum(s + day, lines.length)]}\n\n🍀 Lucky number: ${lucky}\n❤️ Love: ${hashNum(s + day + 'l', 5) + 1}/5   💼 Work: ${hashNum(s + day + 'w', 5) + 1}/5\n_For entertainment only._`);
    }
  };
  out.compatibility = {
    cat: 'fun', access: 'public', cooldown: 4, usage: 'compatibility <name1> & <name2>', desc: 'how compatible are two names', aliases: ['compat'],
    run: async (ctx) => {
      const [a, b] = ctx.text.split(/\s*(?:&|\+|\band\b|,)\s*/i);
      if (!a || !b) return ctx.reply(`${usage('compatibility <name1> & <name2>')}\nExample: ${P()}compatibility Brian & Faith`);
      const pair = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join('|');
      const n = hashNum(pair, 101);
      await ctx.reply(`💞 *${a.trim()}* + *${b.trim()}*\n\n${'❤️'.repeat(Math.round(n / 20))}${'🤍'.repeat(5 - Math.round(n / 20))}\n*${n}%* compatible\n${n > 80 ? 'Perfect match! 😍' : n > 55 ? 'Looking good 😊' : n > 30 ? 'Needs work 😅' : 'Maybe just friends 😬'}\n_Just for fun._`);
    }
  };
  out.nickname = {
    cat: 'fun', access: 'public', cooldown: 3, usage: 'nickname [name]', desc: 'a funny nickname', aliases: ['nick'],
    run: async (ctx) => {
      const a = ['Captain', 'Sir', 'Lord', 'Professor', 'King', 'Queen', 'Master', 'Doctor', 'Agent', 'Big', 'Lil', 'Mighty'];
      const b = ['Chapati', 'Thunder', 'Wi-Fi', 'Banana', 'Ninja', 'Mango', 'Rocket', 'Sauce', 'Dragon', 'Cheetah', 'Turbo', 'Pilau'];
      await ctx.reply(`😎 ${ctx.text ? ctx.text + ' the ' : ''}*${pick(a)} ${pick(b)}*`);
    }
  };
  out.wish = {
    cat: 'fun', access: 'public', cooldown: 4, usage: 'wish <name>', desc: 'a birthday wish message', aliases: ['birthday', 'bday'],
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('wish <name>')}`);
      const w = [`🎂 Happy Birthday, *${ctx.text}*! May this new year bring you joy, health and success. Enjoy your day! 🎉`, `🥳 Many happy returns, *${ctx.text}*! Wishing you a year full of blessings and good news. 🎁`, `🎈 It's your day, *${ctx.text}*! May all your wishes come true today and always. Happy Birthday! 🍰`];
      await ctx.reply(pick(w));
    }
  };
  out.luck = {
    cat: 'fun', access: 'public', cooldown: 3, usage: 'luck', desc: 'your luck today', aliases: ['lucky'],
    run: async (ctx) => { const n = hashNum(ctx.senderNum + new Date().toISOString().slice(0, 10), 101); await ctx.reply(`🍀 Your luck today: *${n}%*\n${n > 75 ? 'Great day to try something new!' : n > 40 ? 'An average day — stay positive.' : 'Take it slow today and stay safe.'}`); }
  };
  out.iq = {
    cat: 'fun', access: 'public', cooldown: 3, usage: 'iq [@user]', desc: 'a made-up IQ score (for fun)', aliases: ['iqtest'],
    run: async (ctx) => { const t = H.getTargets(ctx.m, ctx.args)[0] || `${ctx.senderNum}@s.whatsapp.net`; const n = 70 + hashNum(userPart(t) + 'iq' + new Date().toISOString().slice(0, 10), 90); await ctx.sock.sendMessage(ctx.jid, { text: `🧠 @${userPart(t)}'s IQ today: *${n}*\n_Totally scientific. Just for fun._`, mentions: [t] }, { quoted: ctx.m }); }
  };

  return out;
};
