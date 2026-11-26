/**
 * ✨ YOUR OWN COMMANDS GO HERE ✨
 *
 * Every command is one block inside the big `({ ... })` below. Copy a block,
 * paste it under itself (keep the comma after the closing brace), rename it, done.
 * Restart the bot and it shows up in .menu by itself.
 *
 * ── The format of a command ─────────────────────────────────────────────
 *   name: {                          // the word typed after the dot  (.name)
 *     cat: 'custom',                 // menu section: spam | admin | group | fun | tools | main | custom
 *     usage: 'name <text>',          // how it's written in .menu (no dot)
 *     desc: 'what it does',          // short text in .menu
 *     // public: true,               // anyone can use it (default: only the paired account)
 *     // group: true,                // works in groups only
 *     // admin: true,                // groups only + the paired account must be group admin (gives you ctx.meta)
 *     // aliases: ['other', 'names'],// extra names for the same command
 *     run: async (ctx) => { ... }    // what the command does — THIS is the function, nothing goes outside it
 *   },
 *
 * ── What you get inside run(ctx) ────────────────────────────────────────
 *   reply('text')   send a reply (with the EXOGRAM card)
 *   text            everything typed after the command      (.say hi there  ->  "hi there")
 *   args            the same text split by spaces           (["hi","there"])
 *   userName        WhatsApp name of whoever sent it
 *   jid             the chat id          isGroup   true/false
 *   sock            send other things:   await sock.sendMessage(jid, { text: 'hi' })
 *   rawSock         same, but without the EXOGRAM card (use for spam-style or tag-style sends)
 *   m               the original message object
 *   meta            group info (only on `admin: true` commands)
 *
 * ── Helpers you can use (listed in the first line below) ────────────────
 *   config, pick(array), sleep(ms), usageLine('x <y>'), getTargets(m, args),
 *   getMeta(sock, jid, fresh), isAdmin(meta, jid), userPart(jid), groups, P() (the prefix)
 *
 * ── Helper functions you write yourself go ABOVE module.exports, like this: ──
 *   async function myHelper() { ... }
 *   module.exports = (...) => ({ ... });   // comes AFTER all your helper functions
 */

// .play needs these two packages — they're already in package.json and install automatically on restart.
const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');

// Loaded once, not re-read from disk on every command. To change the image, replace the file
// at assets/bancheck.jpg and restart.
const BANCHECK_IMG = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'bancheck.jpg')); } catch { return null; } })();

/**
 * ⚠️ IMPORTANT ABOUT THE DOWNLOAD COMMANDS BELOW (.ytmp4, .tiktok, .instagram, .facebook)
 * This code has no internet access while it's being written, so none of these third-party API
 * URLs have been tested live — only .play's ytmp3 one (which you already had working) is known
 * good. Each download command below has its API_URL at the top of its block, clearly labeled —
 * test each one on your panel (which DOES have internet) and swap the URL for a real working
 * endpoint if it fails. The request/response shape (GET with a `url` query param, expecting
 * `{ status, download: { downloadUrl } }` back) matches your working .play endpoint's shape;
 * a different provider may use a different shape, so you may need to adjust how `data` is read.
 */
async function fetchDownloadUrl(apiUrl, mediaUrl) {
  const { data } = await axios.get(`${apiUrl}${encodeURIComponent(mediaUrl)}`, { timeout: 120000 });
  const link = data?.download?.downloadUrl || data?.data?.url || data?.result?.url || data?.url;
  if (!data?.status && !link) throw new Error('The download API did not return a usable link');
  if (!link) throw new Error('The download API responded but with an unexpected shape — check the console log');
  return link;
}
async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(res.data);
}

const { downloadAndSend } = require('./dl'); // all-in-one downloader (prexzyapis.com) — see lib/dl.js

module.exports = ({ config, pick, sleep, usageLine, getTargets, getMeta, isAdmin, userPart, groups, P }) => ({

  // ▼▼▼ WORKING EXAMPLE — copy this block to make a new command ▼▼▼
  hello: {
    cat: 'custom',
    usage: 'hello [name]',
    desc: 'say hello',
    run: async ({ reply, text, userName }) => {
      await reply(`👋 Hello ${text || userName || 'there'}!`);
    }
  },
  // ▲▲▲ END OF EXAMPLE ▲▲▲

  tagadmin: {
    cat: 'group',
    usage: 'tagadmin [msg]',
    desc: 'tag all admins',
    group: true,
    run: async ({ reply, text, rawSock, jid, m }) => {
      const meta = await getMeta(rawSock, jid, true);
      const admins = meta.participants.filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return reply('⚠️ No admins found.');
      const body = `👑 *${text || 'Attention admins!'}*\n\n` + admins.map((id) => '@' + userPart(id)).join('\n');
      await rawSock.sendMessage(jid, { text: body, mentions: admins }, { quoted: m });
    }
  },

  sendlinks: {
    cat: 'tools',
    usage: 'sendlinks <number> <link1> | <link2>',
    desc: 'send links to a number',
    run: async ({ reply, text, sock }) => {
      const [numberPart, ...rest] = text.split(' ');
      const links = rest.join(' ').split('|').map((x) => x.trim()).filter(Boolean);
      const number = (numberPart || '').replace(/\D/g, '');

      if (!number || !links.length) {
        return reply('Usage: .sendlinks <number> <link1> | <link2>\nExample: .sendlinks 254712345678 https://a.com | https://b.com');
      }

      const target = `${number}@s.whatsapp.net`;
      await reply(`📤 Sending ${links.length} link(s) to +${number}...`);

      for (const link of links) {
        await sock.sendMessage(target, { text: link });
      }

      await reply(`✅ Finished sending to +${number}.`);
    }
  },

  // Example (uncomment to try): a command that needs text and a group admin
  // announce: {
  //   cat: 'admin', usage: 'announce <text>', desc: 'post an announcement',
  //   admin: true,
  //   run: async ({ reply, text, sock, jid, m }) => {
  //     if (!text) return reply(usageLine('announce <text>'));
  //     await sock.sendMessage(jid, { text: `📢 *ANNOUNCEMENT*\n\n${text}` }, { quoted: m });
  //   }
  // },

  play: {
    cat: 'download',
    usage: 'play <song name or youtube link>',
    desc: 'download and send a song',
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      if (!text) return reply(`Example: ${P()}play Faded by Alan Walker`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '🎵', key: m.key } }); } catch {}

      try {
        let video, videoUrl;
        if (text.includes('youtu')) {
          videoUrl = text;
          const id = text.split('v=')[1]?.split('&')[0] || text.split('/').pop();
          video = (await yts({ videoId: id }));
        } else {
          video = (await yts(text)).videos[0];
          if (!video) throw new Error('No results found for that search');
          videoUrl = video.url;
        }

        if (video) {
          const caption =
            `╭━━━━━━━━━\n┃ *${config.BOT_NAME} · DOWNLOADER*\n\n` +
            `> *Title:* ${video.title}\n\n` +
            `┃ *Views:* ${video.views}\n┃ *Duration:* ${video.timestamp}\n┃ *Uploaded:* ${video.ago}\n` +
            `╰━━━━━━━━━━━━━━━━━━┈⊷\n> ${config.DEV}`;
          await sock.sendMessage(jid, { image: { url: video.thumbnail }, caption }, { quoted: m });
        }

        const yt = require('./yt');
        const au = await yt.media('mp3', videoUrl);
        try { await sock.sendMessage(jid, { ...yt.payload('audio', au), mimetype: au.mime, fileName: `${video?.title || 'song'}.mp3` }, { quoted: m }); } finally { yt.release(au); }

        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[play]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  ytmp4: {
    cat: 'download',
    usage: 'ytmp4 <song name or youtube link>',
    desc: 'download and send a video',
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      // ⚠️ Same provider as .play, guessed endpoint (/ytmp4 mirroring the working /ytmp3) — TEST THIS.
      const API_URL = 'https://eliteprotech-apis.zone.id/download/ytmp4?url=';
      if (!text) return reply(`Example: ${P()}ytmp4 Faded by Alan Walker`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '🎬', key: m.key } }); } catch {}

      try {
        let video, videoUrl;
        if (text.includes('youtu')) {
          videoUrl = text;
          const id = text.split('v=')[1]?.split('&')[0] || text.split('/').pop();
          video = await yts({ videoId: id });
        } else {
          video = (await yts(text)).videos[0];
          if (!video) throw new Error('No results found for that search');
          videoUrl = video.url;
        }

        const yt = require('./yt');
        const r = await yt.media('mp4', videoUrl);
        try {
          await sock.sendMessage(jid, { ...yt.payload('video', r), caption: `🎬 *${video?.title || 'video'}*\n\n> ${config.DEV}`, fileName: `${video?.title || 'video'}.mp4` }, { quoted: m });
        } finally { yt.release(r); }
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[ytmp4]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  download: {
    cat: 'download', usage: 'download <link>', desc: 'all-in-one: any social link', aliases: ['dl', 'aio'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      if (!text) return reply(`Usage: ${P()}download <link>\nWorks with TikTok, Instagram, Facebook, X/Twitter, Pinterest, Threads and more — one link, auto-detected.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '📥', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `📥 Download\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[download]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  tiktok: {
    cat: 'download', usage: 'tiktok <link>', desc: 'download a TikTok', aliases: ['tt'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('tiktok.com');
      if (!text || !ok) return reply(`Usage: ${P()}tiktok <link>\nSend a public TikTok link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '🎵', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `🎵 TikTok\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[tiktok]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  instagram: {
    cat: 'download', usage: 'instagram <link>', desc: 'download an Instagram reel/post', aliases: ['ig'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('instagram.com');
      if (!text || !ok) return reply(`Usage: ${P()}instagram <link>\nSend a public Instagram link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '📸', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `📸 Instagram\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[instagram]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  facebook: {
    cat: 'download', usage: 'facebook <link>', desc: 'download a Facebook video', aliases: ['fb'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('facebook.com') || text.includes('fb.watch') || text.includes('fb.com');
      if (!text || !ok) return reply(`Usage: ${P()}facebook <link>\nSend a public Facebook link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '📘', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `📘 Facebook\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[facebook]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  twitter: {
    cat: 'download', usage: 'twitter <link>', desc: 'download an X/Twitter video', aliases: ['x', 'tw'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('twitter.com') || text.includes('x.com') || text.includes('t.co');
      if (!text || !ok) return reply(`Usage: ${P()}twitter <link>\nSend a public X / Twitter link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '🐦', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `🐦 X / Twitter\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[twitter]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  pinterest: {
    cat: 'download', usage: 'pinterest <link>', desc: 'download a Pinterest pin', aliases: ['pin'],
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('pinterest.') || text.includes('pin.it');
      if (!text || !ok) return reply(`Usage: ${P()}pinterest <link>\nSend a public Pinterest link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '📌', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `📌 Pinterest\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[pinterest]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  threads: {
    cat: 'download', usage: 'threads <link>', desc: 'download a Threads post', 
    run: async ({ reply, text, sock, rawSock, jid, m }) => {
      const ok = text.includes('threads.net') || text.includes('threads.com');
      if (!text || !ok) return reply(`Usage: ${P()}threads <link>\nSend a public Threads link.`);
      await reply('⏳ *Processing...*');
      try { await rawSock.sendMessage(jid, { react: { text: '🧵', key: m.key } }); } catch {}
      try {
        await downloadAndSend({ link: text.trim().split(/\s+/)[0], sock, jid, m, caption: `🧵 Threads\n\n> ${config.DEV}` });
        try { await rawSock.sendMessage(jid, { react: { text: '✅', key: m.key } }); } catch {}
      } catch (e) {
        console.error('[threads]', e?.message || e);
        await reply(`❌ ${e.message}`);
        try { await rawSock.sendMessage(jid, { react: { text: '❌', key: m.key } }); } catch {}
      }
    }
  },

  bancheck: {
    cat: 'tools',
    usage: 'bancheck <number>',
    desc: 'check if a number is on WhatsApp',
    run: async ({ reply, text, sock, jid, m, rawSock }) => {
      const number = (text || '').replace(/\D/g, '');
      if (!number) return reply('Usage: .bancheck <number>\nExample: .bancheck 254712345678');

      try {
        const [result] = await rawSock.onWhatsApp(`${number}@s.whatsapp.net`);
        const caption = result?.exists
          ? `✅ This user is *not banned* yet — the number is active on WhatsApp.`
          : `🚫 This user *appears banned/deleted* — the number isn't registered on WhatsApp.`;
        if (BANCHECK_IMG) await sock.sendMessage(jid, { image: BANCHECK_IMG, caption }, { quoted: m });
        else await reply(caption);
      } catch (e) {
        console.error('[bancheck]', e?.message || e);
        await reply('⚠️ Couldn\'t check that number right now.');
      }
    }
  },

  /* ════════════════════════════════════════════════════════════════════
     👇👇👇  START ADDING YOUR OWN COMMANDS BELOW THIS LINE  👇👇👇
     Paste a new block here, in the same shape as "hello", "tagadmin" or "sendlinks" above.
     ════════════════════════════════════════════════════════════════════ */



  /* ════════════════════════════════════════════════════════════════════
     👆👆👆  STOP — DO NOT ADD COMMANDS BELOW THIS LINE  👆👆👆
     ════════════════════════════════════════════════════════════════════ */

});
