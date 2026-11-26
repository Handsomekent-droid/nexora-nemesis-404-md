/**
 * REACTIONS & ANIME (cat react): animated action GIFs and anime pictures.
 *   Source: nekos.best (keyless), with waifu.pics as the backup. GIFs are converted to mp4 with ffmpeg because
 *   WhatsApp only plays "gif" messages as short mp4 videos; without ffmpeg the reaction is sent as text.
 *   Use: .hug @user  (or reply to someone). With nobody tagged it is a solo reaction.
 */
module.exports = (H) => {
  const { http, usage, userPart, media } = H;
  const axios = require('axios');

  // name: [emoji, "with a target", "alone"]   ({a} = you, {b} = target)
  const ACTIONS = {
    baka: ['😤', '{a} calls {b} a baka!', '{a} is being a baka'],
    bite: ['😬', '{a} bit {b}!', '{a} bites the air'],
    blush: ['😊', '{a} blushes at {b}', '{a} is blushing'],
    bored: ['😑', '{a} is bored of {b}', '{a} is bored'],
    cry: ['😭', '{a} cries because of {b}', '{a} is crying'],
    cuddle: ['🥰', '{a} cuddles {b}', '{a} wants a cuddle'],
    dance: ['💃', '{a} dances with {b}', '{a} is dancing'],
    facepalm: ['🤦', '{a} facepalms at {b}', '{a} facepalms'],
    feed: ['🍙', '{a} feeds {b}', '{a} is hungry'],
    handhold: ['🤝', '{a} holds hands with {b}', '{a} wants to hold hands'],
    handshake: ['🤝', '{a} shakes hands with {b}', '{a} offers a handshake'],
    happy: ['😄', '{a} is happy with {b}', '{a} is happy'],
    highfive: ['🙌', '{a} high-fives {b}', '{a} wants a high five'],
    hug: ['🤗', '{a} hugs {b}', '{a} needs a hug'],
    kiss: ['😘', '{a} kisses {b}', '{a} blows a kiss'],
    laugh: ['😂', '{a} laughs at {b}', '{a} is laughing'],
    lurk: ['👀', '{a} lurks near {b}', '{a} is lurking'],
    nod: ['😌', '{a} nods at {b}', '{a} nods'],
    nom: ['😋', '{a} noms {b}', '{a} noms'],
    nope: ['🙅', '{a} says nope to {b}', '{a} says nope'],
    pat: ['🫶', '{a} pats {b}', '{a} wants a pat'],
    peck: ['😚', '{a} pecks {b}', '{a} sends a peck'],
    poke: ['👉', '{a} pokes {b}', '{a} pokes the air'],
    pout: ['😒', '{a} pouts at {b}', '{a} is pouting'],
    punch: ['👊', '{a} punches {b}', '{a} punches the air'],
    run: ['🏃', '{a} runs from {b}', '{a} runs away'],
    shoot: ['🔫', '{a} shoots {b}', '{a} fires into the air'],
    shrug: ['🤷', '{a} shrugs at {b}', '{a} shrugs'],
    slap: ['👋', '{a} slaps {b}', '{a} slaps the air'],
    sleep: ['😴', '{a} sleeps next to {b}', '{a} is sleeping'],
    smile: ['😊', '{a} smiles at {b}', '{a} smiles'],
    smug: ['😏', '{a} is smug at {b}', '{a} looks smug'],
    stare: ['😳', '{a} stares at {b}', '{a} stares'],
    think: ['🤔', '{a} thinks about {b}', '{a} is thinking'],
    thumbsup: ['👍', '{a} gives {b} a thumbs up', '{a} gives a thumbs up'],
    tickle: ['🤭', '{a} tickles {b}', '{a} giggles'],
    wave: ['👋', '{a} waves at {b}', '{a} waves'],
    wink: ['😉', '{a} winks at {b}', '{a} winks'],
    yawn: ['🥱', '{a} yawns at {b}', '{a} yawns'],
    yeet: ['🚀', '{a} yeets {b}', '{a} yeets themselves']
  };

  async function gifUrl(name) {
    try { const u = (await http.getJson(`https://nekos.best/api/v2/${name}`))?.results?.[0]?.url; if (u) return u; } catch {}
    try { const u = (await http.getJson(`https://api.waifu.pics/sfw/${name}`))?.url; if (u) return u; } catch {}
    return null;
  }
  const download = async (url) => Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 15 * 1024 * 1024 })).data);

  async function action(ctx, name) {
    const [emoji, withB, alone] = ACTIONS[name];
    const me = `${ctx.senderNum}@s.whatsapp.net`;
    const targets = H.getTargets(ctx.m, ctx.args).filter((j) => userPart(j) !== ctx.senderNum).slice(0, 1);
    const line = (targets.length ? withB : alone).replace('{a}', '@' + ctx.senderNum).replace('{b}', targets[0] ? '@' + userPart(targets[0]) : '');
    const text = `${emoji} ${line}`;
    const mentions = [me, ...targets];
    try {
      const url = await gifUrl(name);
      if (!url) throw new Error('no gif');
      let video = await download(url);
      if (!/\.mp4(\?|$)/i.test(url)) {
        video = await media.ffmpeg({ input: video, inExt: 'gif', args: ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'], outExt: 'mp4', timeout: 40000 });
      }
      return await ctx.sock.sendMessage(ctx.jid, { video, gifPlayback: true, caption: text, mentions }, { quoted: ctx.m });
    } catch (e) {
      console.error(`[react:${name}]`, e?.message || e); // never leave the user without an answer
      return ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.m });
    }
  }

  const out = {};
  for (const name of Object.keys(ACTIONS)) {
    out[name] = {
      cat: 'react', access: 'public', cooldown: 4, usage: `${name} [@user]`, desc: `${name} GIF — tag or reply to someone`,
      run: (ctx) => action(ctx, name)
    };
  }

  // anime pictures (safe-for-work)
  for (const [name, desc] of [['waifu', 'random waifu picture'], ['neko', 'random neko picture'], ['megumin', 'random Megumin picture'], ['shinobu', 'random Shinobu picture']]) {
    out[name] = {
      cat: 'react', access: 'public', cooldown: 5, usage: name, desc,
      run: async (ctx) => {
        try {
          const u = (await http.getJson(`https://api.waifu.pics/sfw/${name}`))?.url;
          if (!u) throw new Error('no image');
          await ctx.sock.sendMessage(ctx.jid, { image: { url: u }, caption: `✨ ${name}` }, { quoted: ctx.m });
        } catch (e) { console.error(`[${name}]`, e?.message || e); await ctx.reply('❌ Could not get a picture right now. Try again in a moment.'); }
      }
    };
  }
  return out;
};
