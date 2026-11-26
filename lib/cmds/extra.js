/**
 * EXTRA commands (Build 17).
 *   GROUP : rules, setrules, disappear, leave, top (activity board), afk
 *   TOOLS : tts, ss, lyrics, github, npm, crypto, urban, bible, prayer, anime, recipe, advice, catfact, dog, cat
 *   FUN   : rps, slot, rate  (slap/hug/kiss/pat/poke → react.js)
 * External services (all free, no API key): translate.google.com (tts), image.thum.io (ss), api.lyrics.ovh,
 * api.github.com, registry.npmjs.org, api.coingecko.com, api.urbandictionary.com, bible-api.com, api.aladhan.com,
 * api.jikan.moe, themealdb.com, api.adviceslip.com, catfact.ninja, dog.ceo, cataas.com.
 */
const axios = require('axios');
const { createStore } = require('../store');

module.exports = (H) => {
  const { http, usage, userPart, groups } = H;
  const activity = createStore('activity'); // { [jid]: { [number]: count } }  (group message counts)
  const afkStore = createStore('afk');      // { [acct|number]: { reason, at } }

  const enc = encodeURIComponent;
  const clip = (s, n = 900) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fail = (ctx, tag, e, msg) => {
    console.error(`[${tag}]`, e?.message || 'unknown error');
    return ctx.reply(`❌ ${msg || 'Could not get that right now. Please try again in a moment.'}`);
  };
  const buf = async (url) => Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 40000, maxContentLength: 25 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0' } })).data);
  const num = (n) => (Number.isFinite(+n) ? Number(n).toLocaleString('en-US') : '—');
  const tag = (jid) => '@' + userPart(jid);
  const targetsOf = (ctx) => H.getTargets(ctx.m, ctx.args);
  const pick = H.pick;

  const cmd = {};

  /* ======================= GROUP ======================= */
  cmd.rules = {
    cat: 'group', access: 'public', group: true, usage: 'rules', desc: 'show this group\'s rules', cooldown: 5,
    run: async (ctx) => {
      const r = groups.get(ctx.jid).rules;
      await ctx.reply(r ? `📜 *Group rules*\n\n${r}` : `ℹ️ No rules set yet. Admins: ${H.P()}setrules <text>`);
    }
  };
  cmd.setrules = {
    cat: 'group', group: true, admin: true, usage: 'setrules <text> | clear', desc: 'set the group rules',
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('setrules <text>')}\nUse ${H.P()}setrules clear to remove them.`);
      const clear = ctx.text.toLowerCase() === 'clear';
      groups.update(ctx.jid, (g) => { g.rules = clear ? '' : ctx.text.slice(0, 1500); });
      await ctx.reply(clear ? '🗑 Rules cleared.' : `✅ Rules saved. Members can read them with ${H.P()}rules`);
    }
  };
  cmd.disappear = {
    cat: 'group', group: true, admin: true, usage: 'disappear <24h|7d|90d|off>', desc: 'disappearing messages timer', aliases: ['ephemeral'],
    run: async (ctx) => {
      const map = { off: 0, '24h': 86400, '1d': 86400, '7d': 604800, '90d': 7776000 };
      const v = (ctx.args[0] || '').toLowerCase();
      if (!(v in map)) return ctx.reply(`${usage('disappear <24h|7d|90d|off>')}`);
      try {
        await ctx.rawSock.sendMessage(ctx.jid, { disappearingMessagesInChat: map[v] });
        await ctx.reply(map[v] ? `⏳ Disappearing messages: *${v}*` : '♾ Disappearing messages turned *off*.');
      } catch (e) { await fail(ctx, 'disappear', e, 'Failed. Make sure this account is a group admin.'); }
    }
  };
  cmd.leave = {
    cat: 'group', group: true, access: 'owner', usage: 'leave', desc: 'make the bot leave this group',
    run: async (ctx) => {
      await ctx.reply('👋 Goodbye everyone!');
      try { await ctx.rawSock.groupLeave(ctx.jid); } catch (e) { await fail(ctx, 'leave', e); }
    }
  };
  cmd.top = {
    cat: 'group', access: 'public', group: true, usage: 'top', desc: 'most active members', aliases: ['leaderboard', 'active'], cooldown: 10,
    run: async (ctx) => {
      const board = Object.entries(activity.data[ctx.jid] || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!board.length) return ctx.reply('ℹ️ No activity recorded yet — it counts messages from now on.');
      const medals = ['🥇', '🥈', '🥉'];
      const lines = board.map(([n, c], i) => `${medals[i] || `${i + 1}.`} @${n} — *${num(c)}* messages`);
      await ctx.sock.sendMessage(ctx.jid, { text: `🏆 *Most active members*\n\n${lines.join('\n')}`, mentions: board.map(([n]) => `${n}@s.whatsapp.net`) }, { quoted: ctx.m });
    }
  };
  cmd.afk = {
    cat: 'group', access: 'public', usage: 'afk [reason]', desc: 'away: the bot tells people who tag you', cooldown: 5,
    run: async (ctx) => {
      afkStore.data[`${ctx.acct}|${ctx.senderNum}`] = { reason: ctx.text.slice(0, 120) || 'busy', at: Date.now() };
      afkStore.save();
      await ctx.reply(`😴 You are now AFK: *${ctx.text.slice(0, 120) || 'busy'}*\nI will tell anyone who tags you. Send any message to come back.`);
    }
  };

  // counts group messages for .top, handles AFK in both directions
  H.hooks.message.push(async ({ jid, body, isGroup, senderNum, prefix, fromMe, m, rawSock, sock }) => {
    try {
      if (isGroup && !fromMe && senderNum) {
        const a = (activity.data[jid] ||= {});
        a[senderNum] = (a[senderNum] || 0) + 1;
        activity.save();
      }
      const acct = userPart(rawSock.user?.id);
      const mine = afkStore.data[`${acct}|${senderNum}`];
      if (mine && !fromMe0(body, prefix)) {
        delete afkStore.data[`${acct}|${senderNum}`]; afkStore.save();
        const mins = Math.max(1, Math.round((Date.now() - mine.at) / 60000));
        await sock.sendMessage(jid, { text: `👋 Welcome back @${senderNum}! You were AFK for ${mins} min.`, mentions: [`${senderNum}@s.whatsapp.net`] }, { quoted: m });
      }
      if (isGroup) {
        const mentioned = H.getCtxInfo(m).mentionedJid || [];
        for (const j of mentioned) {
          const a = afkStore.data[`${acct}|${userPart(j)}`];
          if (a) await sock.sendMessage(jid, { text: `😴 @${userPart(j)} is AFK: *${a.reason}* (${Math.max(1, Math.round((Date.now() - a.at) / 60000))} min ago)`, mentions: [j] }, { quoted: m });
        }
      }
    } catch (e) { console.error('[extra hook]', e?.message || e); }
    return false; // never consumes the message
  });
  // an .afk command itself must not cancel the AFK it just set
  function fromMe0(body, prefix) { return String(body || '').toLowerCase().startsWith(`${prefix}afk`); }

  /* ======================= TOOLS ======================= */
  cmd.tts = {
    cat: 'tools', access: 'public', usage: 'tts [lang] <text>', desc: 'text to speech voice note', aliases: ['speak'], cooldown: 6,
    run: async (ctx) => {
      let lang = 'en'; let text = ctx.text;
      const first = ctx.args[0] || '';
      if (/^[a-z]{2}(-[a-z]{2})?$/i.test(first) && ctx.args.length > 1) { lang = first.toLowerCase(); text = ctx.args.slice(1).join(' '); }
      if (!text) return ctx.reply(`${usage('tts [lang] <text>')}\nExample: ${H.P()}tts sw Habari yako`);
      try {
        const audio = await buf(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${enc(lang)}&q=${enc(text.slice(0, 200))}`);
        if (audio.length < 500) throw new Error('empty audio');
        await ctx.sock.sendMessage(ctx.jid, { audio, mimetype: 'audio/mpeg', ptt: true }, { quoted: ctx.m });
      } catch (e) { await fail(ctx, 'tts', e, 'Could not make that voice note. Check the language code (en, sw, fr, es...).'); }
    }
  };
  cmd.ss = {
    cat: 'tools', access: 'public', usage: 'ss <website link>', desc: 'screenshot of a website', aliases: ['screenshot'], cooldown: 10,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('ss <link>')}\nExample: ${H.P()}ss https://example.com`);
      try {
        const link = await http.safeUrl(/^https?:\/\//i.test(ctx.text) ? ctx.text.trim() : `https://${ctx.text.trim()}`);
        const img = await buf(`https://image.thum.io/get/width/1200/crop/800/noanimate/${link}`);
        await ctx.sock.sendMessage(ctx.jid, { image: img, caption: `🖥 ${link}` }, { quoted: ctx.m });
      } catch (e) { await fail(ctx, 'ss', e, e.message && /link|address/i.test(e.message) ? e.message : 'Could not take that screenshot.'); }
    }
  };
  cmd.lyrics = {
    cat: 'tools', access: 'public', usage: 'lyrics <artist> - <song>', desc: 'song lyrics', cooldown: 8,
    run: async (ctx) => {
      const [artist, title] = ctx.text.split(/\s+-\s+/);
      if (!artist || !title) return ctx.reply(`${usage('lyrics <artist> - <song>')}\nExample: ${H.P()}lyrics Alan Walker - Faded`);
      try {
        const d = await http.getJson(`https://api.lyrics.ovh/v1/${enc(artist.trim())}/${enc(title.trim())}`);
        if (!d?.lyrics) throw new Error('none');
        await ctx.reply(`🎤 *${artist.trim()} — ${title.trim()}*\n\n${clip(d.lyrics.trim(), 3000)}`);
      } catch (e) { await fail(ctx, 'lyrics', e, 'No lyrics found. Use the exact artist and song name: artist - song'); }
    }
  };
  cmd.github = {
    cat: 'tools', access: 'public', usage: 'github <username>', desc: 'GitHub profile info', aliases: ['gh'], cooldown: 6,
    run: async (ctx) => {
      const u = ctx.args[0];
      if (!u) return ctx.reply(usage('github <username>'));
      try {
        const d = await http.getJson(`https://api.github.com/users/${enc(u)}`);
        const text = `🐙 *${d.name || d.login}* (@${d.login})\n${d.bio ? `\n${clip(d.bio, 200)}\n` : ''}\n📦 Repos: ${d.public_repos}\n👥 Followers: ${d.followers} · Following: ${d.following}\n📍 ${d.location || '—'}\n🗓 Joined: ${String(d.created_at).slice(0, 10)}\n🔗 ${d.html_url}`;
        await ctx.sock.sendMessage(ctx.jid, d.avatar_url ? { image: { url: d.avatar_url }, caption: text } : { text }, { quoted: ctx.m });
      } catch (e) { await fail(ctx, 'github', e, 'User not found.'); }
    }
  };
  cmd.npm = {
    cat: 'tools', access: 'public', usage: 'npm <package>', desc: 'npm package info', cooldown: 6,
    run: async (ctx) => {
      const p = ctx.args[0];
      if (!p) return ctx.reply(usage('npm <package>'));
      try {
        const d = await http.getJson(`https://registry.npmjs.org/${enc(p).replace('%40', '@')}/latest`);
        await ctx.reply(`📦 *${d.name}* v${d.version}\n${clip(d.description || '', 250)}\n\n📜 License: ${d.license || '—'}\n🔗 https://www.npmjs.com/package/${d.name}\n\n⌨️ npm i ${d.name}`);
      } catch (e) { await fail(ctx, 'npm', e, 'Package not found.'); }
    }
  };
  cmd.crypto = {
    cat: 'tools', access: 'public', usage: 'crypto <coin>', desc: 'live crypto price (USD, KES)', aliases: ['coin', 'price'], cooldown: 6,
    run: async (ctx) => {
      const id = (ctx.args[0] || '').toLowerCase();
      if (!id) return ctx.reply(`${usage('crypto <coin>')}\nExample: ${H.P()}crypto bitcoin`);
      const alias = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple', doge: 'dogecoin', ada: 'cardano', usdt: 'tether', ton: 'the-open-network', trx: 'tron' };
      const coin = alias[id] || id;
      try {
        const d = (await http.getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(coin)}&vs_currencies=usd,kes&include_24hr_change=true`))[coin];
        if (!d) throw new Error('unknown');
        const ch = d.usd_24h_change;
        await ctx.reply(`💰 *${coin}*\n\n💵 USD: *$${num(d.usd)}*\n🇰🇪 KES: *${num(d.kes)}*\n${ch >= 0 ? '📈' : '📉'} 24h: ${Number.isFinite(ch) ? ch.toFixed(2) + '%' : '—'}`);
      } catch (e) { await fail(ctx, 'crypto', e, 'Coin not found. Use its full name, e.g. bitcoin, ethereum, solana.'); }
    }
  };
  cmd.urban = {
    cat: 'utilities', access: 'public', usage: 'urban <word>', desc: 'slang meaning (Urban Dictionary)', aliases: ['ud', 'slang'], cooldown: 6,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(usage('urban <word>'));
      try {
        const d = (await http.getJson(`https://api.urbandictionary.com/v0/define?term=${enc(ctx.text)}`))?.list?.[0];
        if (!d) throw new Error('none');
        await ctx.reply(`📖 *${d.word}*\n\n${clip(d.definition.replace(/[\[\]]/g, ''), 700)}\n\n_Example:_ ${clip(d.example.replace(/[\[\]]/g, ''), 300)}\n\n👍 ${d.thumbs_up}  👎 ${d.thumbs_down}`);
      } catch (e) { await fail(ctx, 'urban', e, 'No definition found.'); }
    }
  };
  cmd.bible = {
    cat: 'utilities', access: 'public', usage: 'bible <verse>', desc: 'Bible verse, e.g. John 3:16', cooldown: 6,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('bible <verse>')}\nExample: ${H.P()}bible John 3:16`);
      try {
        const d = await http.getJson(`https://bible-api.com/${enc(ctx.text)}`);
        if (!d?.text) throw new Error('none');
        await ctx.reply(`📖 *${d.reference}* (${d.translation_name || 'WEB'})\n\n${clip(d.text.trim(), 1500)}`);
      } catch (e) { await fail(ctx, 'bible', e, 'Verse not found. Example: John 3:16'); }
    }
  };
  cmd.prayer = {
    cat: 'utilities', access: 'public', usage: 'prayer <city>, <country>', desc: 'prayer times', aliases: ['salah'], cooldown: 8,
    run: async (ctx) => {
      const [city, country] = ctx.text.split(',').map((x) => x.trim());
      if (!city) return ctx.reply(`${usage('prayer <city>, <country>')}\nExample: ${H.P()}prayer Nairobi, Kenya`);
      try {
        const d = (await http.getJson(`https://api.aladhan.com/v1/timingsByCity?city=${enc(city)}&country=${enc(country || 'Kenya')}&method=2`))?.data;
        const t = d?.timings; if (!t) throw new Error('none');
        await ctx.reply(`🕌 *Prayer times — ${city}${country ? ', ' + country : ''}*\n${d.date?.readable || ''}\n\n🌅 Fajr: ${t.Fajr}\n☀️ Sunrise: ${t.Sunrise}\n🌞 Dhuhr: ${t.Dhuhr}\n🌇 Asr: ${t.Asr}\n🌆 Maghrib: ${t.Maghrib}\n🌙 Isha: ${t.Isha}`);
      } catch (e) { await fail(ctx, 'prayer', e, 'City not found. Example: prayer Mombasa, Kenya'); }
    }
  };
  cmd.anime = {
    cat: 'utilities', access: 'public', usage: 'anime <name>', desc: 'anime info', cooldown: 8,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(usage('anime <name>'));
      try {
        const { jikan } = require('../jikan');
        const d = (await jikan(`/anime?q=${enc(ctx.text)}&limit=1&sfw=true`))?.data?.[0];
        if (!d) return ctx.reply('❌ No anime found with that name. Check the spelling and try again.');
        const text = `🎌 *${d.title}*${d.title_japanese ? ` (${d.title_japanese})` : ''}\n\n⭐ Score: ${d.score ?? '—'}   📺 Episodes: ${d.episodes ?? '?'}\n📅 ${d.year || d.aired?.string || '—'}   📌 ${d.status}\n🎭 ${(d.genres || []).map((g) => g.name).join(', ') || '—'}\n\n${clip(d.synopsis || '', 600)}`;
        const img = d.images?.jpg?.image_url;
        await ctx.sock.sendMessage(ctx.jid, img ? { image: { url: img }, caption: text } : { text }, { quoted: ctx.m });
      } catch (e) { await ctx.reply(e.jikanStatus !== undefined ? e.message : `❌ ${e.message || 'Anime not found.'}`); }
    }
  };
  cmd.recipe = {
    cat: 'utilities', access: 'public', usage: 'recipe <meal>', desc: 'cooking recipe', aliases: ['meal'], cooldown: 8,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('recipe <meal>')}\nExample: ${H.P()}recipe chicken`);
      try {
        const d = (await http.getJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${enc(ctx.text)}`))?.meals?.[0];
        if (!d) throw new Error('none');
        const ing = []; for (let i = 1; i <= 20; i++) if (d[`strIngredient${i}`]?.trim()) ing.push(`• ${d[`strMeasure${i}`] || ''} ${d[`strIngredient${i}`]}`.replace(/\s+/g, ' '));
        const text = `🍽 *${d.strMeal}* (${d.strArea} · ${d.strCategory})\n\n*Ingredients*\n${ing.join('\n')}\n\n*Method*\n${clip(d.strInstructions, 1500)}`;
        await ctx.sock.sendMessage(ctx.jid, d.strMealThumb ? { image: { url: d.strMealThumb }, caption: clip(text, 3000) } : { text }, { quoted: ctx.m });
      } catch (e) { await fail(ctx, 'recipe', e, 'No recipe found for that.'); }
    }
  };
  cmd.advice = {
    cat: 'fun', access: 'public', usage: 'advice', desc: 'a random piece of advice', cooldown: 4,
    run: async (ctx) => {
      try { const d = await http.getJson('https://api.adviceslip.com/advice'); await ctx.reply(`💡 ${JSON.parse(typeof d === 'string' ? d : JSON.stringify(d)).slip.advice}`); }
      catch (e) { await fail(ctx, 'advice', e); }
    }
  };
  cmd.catfact = {
    cat: 'fun', access: 'public', usage: 'catfact', desc: 'random cat fact', cooldown: 4,
    run: async (ctx) => { try { await ctx.reply(`🐱 ${(await http.getJson('https://catfact.ninja/fact')).fact}`); } catch (e) { await fail(ctx, 'catfact', e); } }
  };
  cmd.dog = {
    cat: 'fun', access: 'public', usage: 'dog', desc: 'random dog picture', cooldown: 5,
    run: async (ctx) => {
      try { const d = await http.getJson('https://dog.ceo/api/breeds/image/random'); await ctx.sock.sendMessage(ctx.jid, { image: { url: d.message }, caption: '🐶 Woof!' }, { quoted: ctx.m }); }
      catch (e) { await fail(ctx, 'dog', e); }
    }
  };
  cmd.cat = {
    cat: 'fun', access: 'public', usage: 'cat', desc: 'random cat picture', cooldown: 5,
    run: async (ctx) => {
      try { await ctx.sock.sendMessage(ctx.jid, { image: await buf(`https://cataas.com/cat?t=${Date.now()}`), caption: '🐱 Meow!' }, { quoted: ctx.m }); }
      catch (e) { await fail(ctx, 'cat', e); }
    }
  };

  /* ======================= FUN ======================= */
  // slap / hug / kiss / pat / poke now live in react.js (with animated GIFs)
  cmd.rps = {
    cat: 'fun', access: 'public', usage: 'rps <rock|paper|scissors>', desc: 'rock paper scissors vs the bot', cooldown: 3,
    run: async (ctx) => {
      const map = { rock: '🪨', paper: '📄', scissors: '✂️', r: '🪨', p: '📄', s: '✂️' };
      const norm = { r: 'rock', p: 'paper', s: 'scissors' };
      const raw = (ctx.args[0] || '').toLowerCase(); const me = norm[raw] || raw;
      if (!['rock', 'paper', 'scissors'].includes(me)) return ctx.reply(usage('rps <rock|paper|scissors>'));
      const bot = pick(['rock', 'paper', 'scissors']);
      const win = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      const res = me === bot ? '🤝 Draw!' : win[me] === bot ? '🎉 You win!' : '😎 I win!';
      await ctx.reply(`${map[me]} You: *${me}*\n${map[bot]} Me: *${bot}*\n\n${res}`);
    }
  };
  cmd.slot = {
    cat: 'fun', access: 'public', usage: 'slot', desc: 'spin the slot machine', aliases: ['slots'], cooldown: 4,
    run: async (ctx) => {
      const s = ['🍒', '🍋', '🍇', '🔔', '⭐', '7️⃣'];
      const r = [pick(s), pick(s), pick(s)];
      const res = r[0] === r[1] && r[1] === r[2] ? '🎰 JACKPOT! 🎉' : (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) ? '✨ Two match — nice!' : '💨 No luck, spin again!';
      await ctx.reply(`🎰 [ ${r.join(' | ')} ]\n\n${res}`);
    }
  };
  cmd.rate = {
    cat: 'fun', access: 'public', usage: 'rate <anything>', desc: 'the bot rates anything out of 100', cooldown: 3,
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(usage('rate <anything>'));
      let h = 0; for (const c of ctx.text.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 101; // same thing, same score
      await ctx.reply(`📊 *${clip(ctx.text, 60)}*\n\n${'█'.repeat(Math.round(h / 10))}${'░'.repeat(10 - Math.round(h / 10))} *${h}/100*`);
    }
  };

  return cmd;
};
