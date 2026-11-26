/**
 * FAMOUS-BOT commands (Build 37): the ones people expect from other well-known WhatsApp bots.
 *   AUDIO  : bass, nightcore, slow, fast, reverseaudio, robot, deep, earrape, chipmunk   (reply to a voice note / audio / video)
 *   IMAGE  : grayscale, invert, blurimg, mirror, cropcircle                            (reply to a photo / sticker)
 *   AI     : ai (gpt, chatgpt, gemini, ask), imagine (dalle, aiimage)             (free, no key: pollinations.ai)
 *   OTHER  : readmore, gitclone, totalmember
 * Everything needing ffmpeg says so politely when it is missing; nothing here can stop the bot from starting.
 */
const axios = require('axios');

module.exports = (H) => {
  const { usage, media } = H;
  const P = () => H.P();
  const enc = encodeURIComponent;
  const out = {};

  const failMsg = (ctx, tag, e, msg) => {
    console.error(`[${tag}]`, e?.message || 'unknown error');
    return ctx.reply(`❌ ${msg || e?.message || 'That did not work. Try again in a moment.'}`);
  };
  const sendQ = (ctx, content) => ctx.sock.sendMessage(ctx.jid, content, { quoted: ctx.m });

  /* ---------- audio effects ---------- */
  const AUDIO = {
    bass: ['equalizer=f=54:width_type=o:width=2:g=18,volume=1.3', 'adds heavy bass'],
    nightcore: ['asetrate=44100*1.3,aresample=44100', 'faster and higher (nightcore)'],
    slow: ['atempo=0.7', 'slows the audio down'],
    fast: ['atempo=1.6', 'speeds the audio up'],
    reverseaudio: ['areverse', 'plays the audio backwards'],
    robot: ["afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75", 'robot voice'],
    deep: ['asetrate=44100*0.78,aresample=44100,atempo=1.2', 'deep voice'],
    earrape: ['volume=14,acompressor=threshold=0.05:ratio=20', 'very loud (careful!)'],
    chipmunk: ['asetrate=44100*1.5,aresample=44100,atempo=0.9', 'chipmunk voice']
  };
  for (const [name, [filter, desc]] of Object.entries(AUDIO)) {
    out[name] = {
      cat: 'tools', access: 'public', cooldown: 8, usage: `${name}  (reply to audio / voice note)`, desc, aliases: name === 'reverseaudio' ? ['areverse'] : [],
      run: async (ctx) => {
        try {
          if (!media.hasFfmpeg()) return ctx.reply('❌ ffmpeg is not installed on this server, so audio effects are off.');
          const g = await media.getMedia(ctx, ['audio', 'video']).catch(() => null);
          if (!g) return ctx.reply(`${usage(name)}\nReply to a voice note, audio or video with ${P()}${name}.`);
          if (g.buffer.length > 25 * 1024 * 1024) return ctx.reply('⚠️ That file is too big (max 25 MB).');
          const buf = await media.ffmpeg({ input: g.buffer, inExt: media.extFor(g.mime, g.kind), args: ['-vn', '-af', filter, '-b:a', '128k'], outExt: 'mp3', timeout: 120000 });
          await sendQ(ctx, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
        } catch (e) { await failMsg(ctx, name, e, 'Could not change that audio.'); }
      }
    };
  }

  /* ---------- image effects ---------- */
  const IMAGE = {
    grayscale: ['hue=s=0', 'jpg', 'black & white photo', ['greyscale', 'bw']],
    invert: ['negate', 'jpg', 'invert the colours', ['negative']],
    blurimg: ['boxblur=12:3', 'jpg', 'blur a photo', ['blurpic']],
    mirror: ['hflip', 'jpg', 'mirror a photo left-right', []],
    sepia: ['colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0', 'jpg', 'old-photo brown tone', ['vintage']],
    pixelate: ['scale=iw/20:-2,scale=iw*20:-2:flags=neighbor', 'jpg', 'pixel-art effect', ['pixel']],
    sketch: ['format=gray,edgedetect=low=0.08:high=0.25,negate', 'jpg', 'pencil-sketch look', ['drawing']],
    cropcircle: ["format=rgba,geq=lum='p(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(hypot(X-W/2,Y-H/2),min(W,H)/2),255,0)'", 'png', 'round profile-picture crop', ['round']]
  };
  for (const [name, [vf, ext, desc, aliases]] of Object.entries(IMAGE)) {
    out[name] = {
      cat: 'tools', access: 'public', cooldown: 6, usage: `${name}  (reply to a photo)`, desc, aliases,
      run: async (ctx) => {
        try {
          if (!media.hasFfmpeg()) return ctx.reply('❌ ffmpeg is not installed on this server, so image effects are off.');
          const g = await media.getMedia(ctx, ['image', 'sticker']).catch(() => null);
          if (!g) return ctx.reply(`${usage(name)}\nReply to a photo with ${P()}${name}.`);
          const buf = await media.ffmpeg({ input: g.buffer, inExt: media.extFor(g.mime, g.kind), args: ['-frames:v', '1', '-vf', vf], outExt: ext });
          await sendQ(ctx, { image: buf, caption: `✅ ${name}\n\n> ${H.footer()}` });
        } catch (e) { await failMsg(ctx, name, e, 'Could not edit that picture.'); }
      }
    };
  }

  /* ---------- AI (free, no key) ---------- */
  const promptOf = (ctx) => {
    if (ctx.text) return ctx.text;
    try {
      const q = H.unwrap(H.getCtxInfo(ctx.m)?.quotedMessage || {});
      return q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || '';
    } catch { return ''; }
  };
  out.ai = {
    cat: 'tools', access: 'public', cooldown: 8, usage: 'ai <question>', desc: 'ask the AI anything', aliases: ['gpt', 'chatgpt', 'gemini', 'ask', 'openai'],
    run: async (ctx) => {
      const q = promptOf(ctx).slice(0, 1500);
      if (!q) return ctx.reply(`${usage('ai <question>')}\nExample: ${P()}ai explain black holes in two lines`);
      try {
        const sys = `You are ${H.config.BOT_NAME || 'Nexora Nemesis'}, a friendly WhatsApp assistant. Keep answers short and clear.`;
        const r = await axios.get(`https://text.pollinations.ai/${enc(q)}`, { params: { model: 'openai', system: sys }, timeout: 60000, responseType: 'text', transformResponse: (d) => d });
        let t = String(r.data || '').trim();
        try { const j = JSON.parse(t); t = j.content || j.text || j.response || t; } catch {}
        if (!t) throw new Error('empty');
        await ctx.reply(t.slice(0, 3500));
      } catch (e) { await failMsg(ctx, 'ai', e, 'The AI service did not answer. Try again in a moment.'); }
    }
  };
  out.imagine = {
    cat: 'tools', access: 'public', cooldown: 15, usage: 'imagine <describe the picture>', desc: 'AI picture from your words', aliases: ['dalle', 'aiimage', 'draw'],
    run: async (ctx) => {
      const q = promptOf(ctx).slice(0, 500);
      if (!q) return ctx.reply(`${usage('imagine <description>')}\nExample: ${P()}imagine a purple dragon over a neon city`);
      try {
        await ctx.reply('🎨 Drawing... this takes up to a minute.');
        const r = await axios.get(`https://image.pollinations.ai/prompt/${enc(q)}`, { params: { width: 1024, height: 1024, nologo: true, seed: Math.floor(Math.random() * 1e6) }, responseType: 'arraybuffer', timeout: 120000, maxContentLength: 15 * 1024 * 1024 });
        const buf = Buffer.from(r.data);
        if (buf.length < 2000) throw new Error('tiny response');
        await sendQ(ctx, { image: buf, caption: `🎨 ${q.slice(0, 200)}\n\n> ${H.footer()}` });
      } catch (e) { await failMsg(ctx, 'imagine', e, 'The picture service did not answer. Try a shorter description or try again.'); }
    }
  };

  /* ---------- other ---------- */
  out.readmore = {
    cat: 'text', access: 'public', cooldown: 3, usage: 'readmore first part | hidden part', desc: 'message with a "Read more" fold', aliases: ['spoiler'],
    run: async (ctx) => {
      const [a, ...rest] = ctx.text.split('|');
      const b = rest.join('|').trim();
      if (!a?.trim() || !b) return ctx.reply(`${usage('readmore first part | hidden part')}\nExample: ${P()}readmore Spoiler alert | the hero wins`);
      await ctx.sock.sendMessage(ctx.jid, { text: `${a.trim()}${'‎'.repeat(4001)}${b}` }, { quoted: ctx.m });
    }
  };
  out.gitclone = {
    cat: 'download', access: 'public', cooldown: 15, usage: 'gitclone <github repo link>', desc: 'download a GitHub repo as a zip', aliases: ['gitdl', 'repozip'],
    run: async (ctx) => {
      const mm = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(ctx.args[0] || '');
      if (!mm) return ctx.reply(`${usage('gitclone <github repo link>')}\nExample: ${P()}gitclone https://github.com/WhiskeySockets/Baileys`);
      try {
        const r = await axios.get(`https://api.github.com/repos/${mm[1]}/${mm[2]}/zipball`, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 50 * 1024 * 1024, maxRedirects: 5, headers: { 'User-Agent': 'nexora-bot' } });
        await sendQ(ctx, { document: Buffer.from(r.data), mimetype: 'application/zip', fileName: `${mm[2]}.zip`, caption: `📦 ${mm[1]}/${mm[2]}\n\n> ${H.footer()}` });
      } catch (e) { await failMsg(ctx, 'gitclone', e, e?.response?.status === 404 ? 'Repo not found (or private).' : 'Could not download that repo (it may be over 50 MB).'); }
    }
  };
  out.totalmember = {
    cat: 'group', access: 'public', group: true, cooldown: 5, usage: 'totalmember', desc: 'how many members this group has', aliases: ['membercount'],
    run: async (ctx) => {
      try {
        const meta = await H.getMeta(ctx.rawSock, ctx.jid);
        const ps = meta.participants || [];
        const admins = ps.filter((p) => p.admin).length;
        await ctx.reply(`👥 *${meta.subject}*\n\nMembers: *${ps.length}*\nAdmins: *${admins}*`);
      } catch (e) { await failMsg(ctx, 'totalmember', e, 'Could not read the member list.'); }
    }
  };


  /* ---------- 🚔 JAIL: every message a jailed member sends is deleted until an admin frees them ---------- */
  const { groups, getMeta, isAdmin, botAdmin, getTargets, userPart } = H;
  const jailOf = (jid) => groups.get(jid)?.jail || {};
  const DUR = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const parseDur = (a) => { const mm = /^(\d{1,3})([smhd])$/i.exec(a || ''); return mm ? Number(mm[1]) * DUR[mm[2].toLowerCase()] : 0; };
  const humanDur = (ms) => (ms >= 86400000 ? `${Math.round(ms / 86400000)} day(s)` : ms >= 3600000 ? `${Math.round(ms / 3600000)} hour(s)` : `${Math.max(1, Math.round(ms / 60000))} min`);
  // every id a person might appear under (phone number AND lid), so the jail works in both kinds of groups
  const idsOf = (meta, target) => {
    const ids = new Set([userPart(target)]);
    const p = (meta?.participants || []).find((x) => [x.id, x.lid, x.jid, x.phoneNumber].filter(Boolean).some((v) => userPart(v) === userPart(target)));
    if (p) for (const v of [p.id, p.lid, p.jid, p.phoneNumber]) if (v) ids.add(userPart(v));
    return [...ids];
  };
  out.jail = {
    cat: 'group', group: true, cooldown: 3, usage: 'jail @user [10m|2h|1d] [reason]', desc: 'jail a member: all their messages are auto-deleted', aliases: ['prison', 'lockup'],
    run: async (ctx) => {
      const meta = await H.needGroupAdmin(ctx); if (!meta) return;
      const me = userPart(ctx.rawSock.user?.id);
      const targets = getTargets(ctx.m, ctx.args).filter((j) => userPart(j) !== me);
      if (!targets.length) return ctx.reply(`${usage('jail @user [10m|2h|1d] [reason]')}\nExample: ${P()}jail @john 1h spamming\nFree them with ${P()}unjail @john`);
      const dur = ctx.args.map(parseDur).find(Boolean) || 0;
      const reason = ctx.args.filter((a) => !a.startsWith('@') && !/^\d{7,}$/.test(a) && !parseDur(a)).join(' ').slice(0, 80);
      const done = [], skipped = [];
      for (const t of targets) {
        if (isAdmin(meta, t)) { skipped.push(t); continue; }
        const rec = { at: Date.now(), by: ctx.senderNum, until: dur ? Date.now() + dur : 0, reason };
        groups.update(ctx.jid, (g) => { g.jail = g.jail || {}; for (const id of idsOf(meta, t)) g.jail[id] = rec; });
        done.push(t);
      }
      if (!done.length) return ctx.reply("⚠️ You can't jail an admin.");
      const note = skipped.length ? `\n(Admins can't be jailed: ${H.tagOf(skipped)})` : '';
      await ctx.sock.sendMessage(ctx.jid, { text: `🚔 ${H.tagOf(done)} ${done.length > 1 ? 'have' : 'has'} been *JAILED*${dur ? ` for ${humanDur(dur)}` : ''}${reason ? `\n📝 Reason: ${reason}` : ''}\n\nEvery message they send will be deleted until an admin uses ${P()}unjail.${note}`, mentions: [...done, ...skipped] }, { quoted: ctx.m });
    }
  };
  out.unjail = {
    cat: 'group', group: true, cooldown: 3, usage: 'unjail @user', desc: 'free a jailed member', aliases: ['free', 'release'],
    run: async (ctx) => {
      const meta = await H.needGroupAdmin(ctx); if (!meta) return;
      const targets = getTargets(ctx.m, ctx.args);
      if (!targets.length) return ctx.reply(usage('unjail @user'));
      const freed = [];
      for (const t of targets) {
        const ids = idsOf(meta, t);
        if (!ids.some((id) => jailOf(ctx.jid)[id])) continue;
        groups.update(ctx.jid, (g) => { for (const id of ids) delete g.jail?.[id]; });
        freed.push(t);
      }
      if (!freed.length) return ctx.reply('ℹ️ That person is not in jail.');
      await ctx.sock.sendMessage(ctx.jid, { text: `🔓 ${H.tagOf(freed)} ${freed.length > 1 ? 'have' : 'has'} been *released* from jail. Behave! 😅`, mentions: freed }, { quoted: ctx.m });
    }
  };
  out.jailed = {
    cat: 'group', group: true, access: 'public', cooldown: 5, usage: 'jailed', desc: "who's in jail right now", aliases: ['jaillist', 'prisoners'],
    run: async (ctx) => {
      const J = jailOf(ctx.jid); const seen = new Set(); const rows = [];
      for (const [id, r] of Object.entries(J)) {
        if (r.until && r.until < Date.now()) continue;
        const key = `${r.at}`; if (seen.has(key + r.by)) continue; seen.add(key + r.by);
        rows.push(`🚔 @${id}${r.until ? ` (${humanDur(r.until - Date.now())} left)` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
      }
      if (!rows.length) return ctx.reply('🕊 The jail is empty.');
      await ctx.sock.sendMessage(ctx.jid, { text: `🚔 *Jailed members*\n\n${rows.join('\n')}`, mentions: Object.keys(J).map((id) => `${id}@s.whatsapp.net`) }, { quoted: ctx.m });
    }
  };
  // the guard: runs on every group message, deletes anything a jailed member sends
  H.hooks.message.push(async ({ rawSock, m, jid, isGroup, sender, senderNum, fromMe, rank, acct }) => {
    if (!isGroup || fromMe || rank > 0 || senderNum === acct) return false;
    const J = groups.get(jid)?.jail; if (!J) return false;
    const r = J[senderNum] || J[userPart(sender)];
    if (!r) return false;
    if (r.until && r.until < Date.now()) { groups.update(jid, (g) => { for (const k of Object.keys(g.jail || {})) if (g.jail[k].at === r.at) delete g.jail[k]; }); return false; }
    try {
      const meta = await getMeta(rawSock, jid);
      if (isAdmin(meta, sender) || botAdmin(meta, rawSock) === false) return false;
      await rawSock.sendMessage(jid, { delete: m.key });
    } catch {}
    return true;
  });

  /* ---------- 🎌 more anime (free, no key: Jikan / MyAnimeList) ---------- */
  const { jikan } = require('../jikan');
  const clip = (t, n) => (String(t || '').length > n ? String(t).slice(0, n).trim() + '…' : String(t || ''));
  const sendCard = (ctx, text, img) => ctx.sock.sendMessage(ctx.jid, img ? { image: { url: img }, caption: `${text}\n\n> ${H.footer()}` } : { text }, { quoted: ctx.m });
  // jikan() already throws a human message distinguishing rate-limited / down / unreachable; "not found"
  // (a real, empty search result) gets its own distinct message instead of reusing that same text.
  out.manga = {
    cat: 'anime', access: 'public', cooldown: 8, usage: 'manga <name>', desc: 'manga info and rating',
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('manga <name>')}\nExample: ${P()}manga one piece`);
      try {
        const d = (await jikan(`/manga?q=${enc(ctx.text)}&limit=1&sfw=true`))?.data?.[0];
        if (!d) return ctx.reply('❌ No manga found with that name. Check the spelling and try again.');
        await sendCard(ctx, `📖 *${d.title}*${d.title_japanese ? ` (${d.title_japanese})` : ''}\n\n⭐ ${d.score ?? '—'}   📚 Chapters: ${d.chapters ?? '?'}   📌 ${d.status}\n🎭 ${(d.genres || []).map((g) => g.name).join(', ') || '—'}\n\n${clip(d.synopsis, 600)}`, d.images?.jpg?.image_url);
      } catch (e) { await ctx.reply(e.jikanStatus !== undefined ? e.message : `❌ ${e.message || 'Could not reach the anime database.'}`); }
    }
  };
  out.animechar = {
    cat: 'anime', access: 'public', cooldown: 8, usage: 'animechar <name>', desc: 'anime character profile', aliases: ['character2', 'acharacter'],
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('animechar <name>')}\nExample: ${P()}animechar gojo`);
      try {
        const d = (await jikan(`/characters?q=${enc(ctx.text)}&limit=1&order_by=favorites&sort=desc`))?.data?.[0];
        if (!d) return ctx.reply('❌ No character found with that name. Check the spelling and try again.');
        await sendCard(ctx, `🎭 *${d.name}*${d.name_kanji ? ` (${d.name_kanji})` : ''}\n❤️ Favorites: ${d.favorites ?? 0}\n\n${clip(d.about, 700)}`, d.images?.jpg?.image_url);
      } catch (e) { await ctx.reply(e.jikanStatus !== undefined ? e.message : `❌ ${e.message || 'Could not reach the anime database.'}`); }
    }
  };
  out.topanime = {
    cat: 'anime', access: 'public', cooldown: 10, usage: 'topanime', desc: 'top 10 anime of all time', aliases: ['animetop'],
    run: async (ctx) => {
      try {
        const rows = ((await jikan('/top/anime?limit=10&sfw=true'))?.data || []).map((a, i) => `${i + 1}. *${a.title}* — ⭐ ${a.score ?? '—'}`);
        if (!rows.length) return ctx.reply('❌ The anime database returned no results just now. Try again shortly.');
        await ctx.reply(`🏆 *Top anime*\n\n${rows.join('\n')}\n\nDetails: ${P()}anime <name>`);
      } catch (e) { await ctx.reply(e.jikanStatus !== undefined ? e.message : `❌ ${e.message || 'Could not reach the anime database.'}`); }
    }
  };
  out.randomanime = {
    cat: 'anime', access: 'public', cooldown: 8, usage: 'randomanime', desc: 'a random anime to watch', aliases: ['animerandom', 'recommendanime'],
    run: async (ctx) => {
      try {
        const d = (await jikan('/random/anime?sfw=true'))?.data;
        if (!d) return ctx.reply('❌ The anime database returned no results just now. Try again shortly.');
        await sendCard(ctx, `🎲 *${d.title}*\n⭐ ${d.score ?? '—'}   📺 Episodes: ${d.episodes ?? '?'}   📅 ${d.year || '—'}\n🎭 ${(d.genres || []).map((g) => g.name).join(', ') || '—'}\n\n${clip(d.synopsis, 450)}`, d.images?.jpg?.image_url);
      } catch (e) { await ctx.reply(e.jikanStatus !== undefined ? e.message : `❌ ${e.message || 'Could not reach the anime database.'}`); }
    }
  };
  out.animequote = {
    cat: 'anime', access: 'public', cooldown: 6, usage: 'animequote', desc: 'a random anime quote', aliases: ['aquote'],
    run: async (ctx) => {
      try {
        const d = (await axios.get('https://api.animechan.io/v1/quotes/random', { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } })).data?.data;
        if (!d?.content) throw new Error('empty');
        await ctx.reply(`💬 "${d.content}"\n\n— *${d.character?.name || 'Unknown'}*, ${d.anime?.name || ''}`);
      } catch (e) {
        const status = e?.response?.status;
        await failMsg(ctx, 'animequote', e, status === 429 ? '⏳ The quote service is rate-limiting us. Wait a bit and try again.' : status >= 500 ? '🛠 The quote service is down right now. Try again later.' : 'The quote service could not be reached.');
      }
    }
  };


  /* ================= BATCH 2 (Build 40) ================= */
  const crypto = require('crypto');
  const hashNum = (str, mod) => { const h = crypto.createHash('md5').update(String(str)).digest(); return h.readUInt32BE(0) % mod; };
  const today = () => new Date().toISOString().slice(0, 10);
  const mentionOrSelf = (ctx) => getTargets(ctx.m, ctx.args)[0] || `${ctx.senderNum}@s.whatsapp.net`;

  // fun meters: the same person gets the same number all day
  const METERS = {
    cute: ['😍', 'cute', ['cuteness']], handsome: ['😎', 'handsome', ['hot']], beautiful: ['💖', 'beautiful', ['pretty', 'gorgeous']],
    simp: ['🥺', 'a simp', ['simpmeter']], genius: ['🧠', 'a genius', ['smart']], rich: ['💰', 'rich', ['wealthy']]
  };
  for (const [name, [emo, word, aliases]] of Object.entries(METERS)) {
    if (H.commands[name]) continue; // never shadow an existing command
    out[name] = {
      cat: 'fun', access: 'public', cooldown: 4, usage: `${name} [@user]`, desc: `how ${word.replace('a ', '')} are you today?`, aliases: aliases.filter((a) => !H.commands[a]),
      run: async (ctx) => {
        const t = mentionOrSelf(ctx);
        const pct = hashNum(`${name}:${userPart(t)}:${today()}`, 101);
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
        await ctx.sock.sendMessage(ctx.jid, { text: `${emo} @${userPart(t)} is *${pct}%* ${word}\n${bar}`, mentions: [t] }, { quoted: ctx.m });
      }
    };
  }
  out.couple = {
    cat: 'fun', group: true, access: 'public', cooldown: 8, usage: 'couple', desc: 'pick a random couple from the group', aliases: ['pairup', 'matchmaker'],
    run: async (ctx) => {
      try {
        const meta = await getMeta(ctx.rawSock, ctx.jid);
        const me = userPart(ctx.rawSock.user?.id);
        const ids = (meta.participants || []).map((p) => p.phoneNumber || p.jid || p.id).filter((j) => j && userPart(j) !== me);
        if (ids.length < 2) return ctx.reply('⚠️ Not enough members.');
        const a = ids.splice(Math.floor(Math.random() * ids.length), 1)[0];
        const b = ids[Math.floor(Math.random() * ids.length)];
        await ctx.sock.sendMessage(ctx.jid, { text: `💘 *Couple of the moment*\n\n@${userPart(a)}  ❤️  @${userPart(b)}\n\nCompatibility: *${60 + Math.floor(Math.random() * 41)}%*`, mentions: [a, b] }, { quoted: ctx.m });
      } catch (e) { await failMsg(ctx, 'couple', e, 'Could not read the member list.'); }
    }
  };
  const LINES = ['Are you a magician? Because whenever I look at you, everyone else disappears. ✨', 'Do you have a map? I keep getting lost in your eyes. 🗺️', 'Is your name Wi-Fi? Because I am feeling a connection. 📶', 'If you were a fruit you would be a fine-apple. 🍍', 'Are you a campfire? Because you are hot and I want s’more. 🔥', 'Do you believe in love at first text? Or should I message again? 😏'];
  out.flirt = {
    cat: 'fun', access: 'public', cooldown: 4, usage: 'flirt [@user]', desc: 'a cheesy pick-up line', aliases: ['flirtline'],
    run: async (ctx) => {
      const t = getTargets(ctx.m, ctx.args)[0];
      await ctx.sock.sendMessage(ctx.jid, { text: `${t ? `@${userPart(t)} ` : ''}${LINES[Math.floor(Math.random() * LINES.length)]}`, mentions: t ? [t] : [] }, { quoted: ctx.m });
    }
  };

  // text tools
  const FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', '?': '¿', '!': '¡', '.': '˙', ',': '\'', '(': ')', ')': '(' };
  out.fliptext = {
    cat: 'text', access: 'public', cooldown: 3, usage: 'fliptext <text>', desc: 'upside-down text', aliases: ['upsidedown'],
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(usage('fliptext <text>'));
      await ctx.reply([...ctx.text.toLowerCase()].reverse().map((c) => FLIP[c] || c).join(''));
    }
  };
  out.hash = {
    cat: 'tools', access: 'public', cooldown: 3, usage: 'hash <md5|sha1|sha256|sha512> <text>', desc: 'hash some text', aliases: ['checksum'],
    run: async (ctx) => {
      const algo = (ctx.args[0] || '').toLowerCase(); const text = ctx.args.slice(1).join(' ');
      if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo) || !text) return ctx.reply(`${usage('hash <md5|sha1|sha256|sha512> <text>')}\nExample: ${P()}hash sha256 hello`);
      await ctx.reply(`🔑 *${algo.toUpperCase()}*\n\`\`\`${crypto.createHash(algo).update(text).digest('hex')}\`\`\``);
    }
  };
  out.timezone = {
    cat: 'tools', access: 'public', cooldown: 4, usage: 'timezone <city or zone>', desc: 'current time in another place', aliases: ['timein'],
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('timezone <city>')}\nExample: ${P()}timezone Nairobi   or   ${P()}timezone Europe/London`);
      const q = ctx.text.trim().toLowerCase().replace(/\s+/g, '_');
      let zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch {}
      const hits = zones.filter((z) => z.toLowerCase().includes(q)).slice(0, 4);
      if (!hits.length) return ctx.reply('❌ Place not found. Try a big city or a zone name like Asia/Dubai.');
      const rows = hits.map((z) => `🕒 *${z.replace(/_/g, ' ')}*: ${new Intl.DateTimeFormat('en-GB', { timeZone: z, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}`);
      await ctx.reply(rows.join('\n'));
    }
  };

  // warnings
  out.warns = {
    cat: 'group', group: true, access: 'public', cooldown: 4, usage: 'warns [@user]', desc: "how many warnings someone has", aliases: ['checkwarn'],
    run: async (ctx) => {
      const t = mentionOrSelf(ctx);
      const n = groups.getWarn(ctx.jid, userPart(t));
      await ctx.sock.sendMessage(ctx.jid, { text: `⚠️ @${userPart(t)} has *${n}/${H.MAX_WARNS}* warning(s).`, mentions: [t] }, { quoted: ctx.m });
    }
  };
  out.unwarn = {
    cat: 'group', group: true, cooldown: 3, usage: 'unwarn @user', desc: 'remove one warning from a member', aliases: ['removewarn'],
    run: async (ctx) => {
      const t = getTargets(ctx.m, ctx.args)[0];
      if (!t) return ctx.reply(usage('unwarn @user'));
      const u = userPart(t);
      const n = groups.getWarn(ctx.jid, u);
      if (!n) return ctx.reply('ℹ️ That member has no warnings.');
      groups.update(ctx.jid, (g) => { if (n <= 1) delete g.warns[u]; else g.warns[u] = n - 1; });
      await ctx.sock.sendMessage(ctx.jid, { text: `✅ One warning removed from @${u}. Now: *${n - 1}/${H.MAX_WARNS}*`, mentions: [t] }, { quoted: ctx.m });
    }
  };

  // lookups (free, no key)
  out.whois = {
    cat: 'tools', access: 'public', cooldown: 8, usage: 'whois <domain>', desc: 'who registered a website and when', aliases: ['domaininfo'],
    run: async (ctx) => {
      const d = (ctx.args[0] || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return ctx.reply(`${usage('whois <domain>')}\nExample: ${P()}whois google.com`);
      try {
        const r = (await axios.get(`https://rdap.org/domain/${d}`, { timeout: 20000 })).data;
        const ev = (a) => (r.events || []).find((e) => e.eventAction === a)?.eventDate?.slice(0, 10) || '—';
        const reg = (r.entities || []).find((e) => (e.roles || []).includes('registrar'));
        const regName = reg?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] || '—';
        await ctx.reply(`🌐 *${r.ldhName || d}*\n\n🏢 Registrar: ${regName}\n📅 Registered: ${ev('registration')}\n♻️ Expires: ${ev('expiration')}\n🔄 Updated: ${ev('last changed')}\n📌 Status: ${(r.status || []).slice(0, 3).join(', ') || '—'}`);
      } catch (e) { await failMsg(ctx, 'whois', e, e?.response?.status === 404 ? 'Domain not found.' : 'The lookup service did not answer. Try again.'); }
    }
  };
  out.quran = {
    cat: 'info', access: 'public', cooldown: 6, usage: 'quran <surah:ayah>', desc: 'a Quran verse with English meaning', aliases: ['ayah'],
    run: async (ctx) => {
      const ref = /^(\d{1,3}):(\d{1,3})$/.exec(ctx.args[0] || '');
      if (!ref) return ctx.reply(`${usage('quran <surah:ayah>')}\nExample: ${P()}quran 2:255`);
      try {
        const d = (await axios.get(`https://api.alquran.cloud/v1/ayah/${ref[1]}:${ref[2]}/editions/quran-uthmani,en.asad`, { timeout: 20000 })).data?.data;
        if (!d?.[0]) throw new Error('none');
        await ctx.reply(`📖 *${d[0].surah.englishName}* (${ref[1]}:${ref[2]})\n\n${d[0].text}\n\n_${d[1]?.text || ''}_`);
      } catch (e) { await failMsg(ctx, 'quran', e, 'Verse not found. Use the form surah:ayah, like 2:255.'); }
    }
  };
  out.search = {
    cat: 'info', access: 'public', cooldown: 8, usage: 'search <question>', desc: 'quick answer from DuckDuckGo', aliases: ['google', 'ddg', 'answer'],
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`${usage('search <question>')}\nExample: ${P()}search capital of Kenya`);
      try {
        const d = (await axios.get('https://api.duckduckgo.com/', { params: { q: ctx.text, format: 'json', no_html: 1, skip_disambig: 1 }, timeout: 20000 })).data;
        const a = d.AbstractText || d.Answer || d.Definition || (d.RelatedTopics || []).find((x) => x.Text)?.Text;
        if (!a) return ctx.reply(`🔎 No quick answer found for "${ctx.text.slice(0, 60)}". Try ${P()}ai ${ctx.text.slice(0, 80)} for a full answer.`);
        await ctx.reply(`🔎 *${d.Heading || ctx.text}*\n\n${String(a).slice(0, 900)}${d.AbstractURL ? `\n\n🔗 ${d.AbstractURL}` : ''}`);
      } catch (e) { await failMsg(ctx, 'search', e, 'The search service did not answer. Try again.'); }
    }
  };

  out.nexora = {
    cat: 'owner', usage: 'nexora on|off|status|dm on|dm off|clear', desc: 'Nexora AI: chats with anyone who says its name or tags this number',
    aliases: ['nexoraai', 'aichat'], cooldown: 3,
    run: async (ctx) => {
      const S = H.settings.get(ctx.acct);
      const a = (ctx.args[0] || 'status').toLowerCase(), b = (ctx.args[1] || '').toLowerCase();
      const ai = require('../nexoraai');
      if (a === 'on' || a === 'enable') { H.settings.set(ctx.acct, { nexoraAI: true }); return ctx.reply(`🤖 *Nexora AI is ON*\nI will chat with anyone who says "Nexora", tags this number, or replies to my messages.\nEveryone in DMs too: ${P()}nexora dm on\nTurn off: ${P()}nexora off`); }
      if (a === 'off' || a === 'disable') { H.settings.set(ctx.acct, { nexoraAI: false }); return ctx.reply('🤖 *Nexora AI is OFF.*'); }
      if (a === 'dm') {
        if (!['on', 'off'].includes(b)) return ctx.reply(usage('nexora dm on|off'));
        H.settings.set(ctx.acct, { nexoraDM: b === 'on' });
        return ctx.reply(b === 'on' ? '🤖 Nexora will now answer *every* DM sent to this number (not commands). Use only if this number is just for the bot.' : '🤖 In DMs, Nexora now answers only when its name is used.');
      }
      if (a === 'clear' || a === 'reset') { ai.clear(ctx.acct); return ctx.reply('🧹 Nexora forgot all conversations.'); }
      return ctx.reply(`🤖 *Nexora AI*\nStatus: ${S.nexoraAI ? '✅ ON' : '❌ OFF'}\nAnswer every DM: ${S.nexoraDM ? 'yes' : 'no'}\n\n${P()}nexora on / off\n${P()}nexora dm on / off\n${P()}nexora clear`);
    }
  };

  return out;
};
