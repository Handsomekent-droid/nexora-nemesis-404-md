/**
 * 📥 DOWNLOAD commands (new ones): song, video, ytsearch, ytmp3, spotify, mediafire, gdrive, url.
 * The older ones (play, ytmp4, download/dl/aio, tiktok, instagram, facebook, twitter, pinterest,
 * threads) live in lib/custom.js and lib/dl.js and are untouched.
 *
 * Every link a user types goes through H.http.safeUrl (no localhost / private networks), and
 * redirects are followed by hand so a public link can't bounce us onto an internal address.
 *
 * External services (none need a key):
 *   YouTube audio/video : eliteprotech-apis.zone.id (override with YTMP3_API / YTMP4_API in .env) + yt-search
 *   Spotify             : open.spotify.com/oembed (link -> title) + iTunes Search API (30s preview only)
 *   MediaFire / GDrive  : the public pages themselves
 */
const axios = require('axios');

const MAX_BYTES = 60 * 1024 * 1024;          // largest file we will download and send
const MAX_MB = MAX_BYTES / 1024 / 1024;
const MAX_VIDEO_SECONDS = (Number(process.env.MAX_VIDEO_MIN) || 150) * 60; // longest YouTube video we accept (default 2h30m; set MAX_VIDEO_MIN in .env)
const YTMP3_API = process.env.YTMP3_API || 'https://eliteprotech-apis.zone.id/download/ytmp3?url=';
const YTMP4_API = process.env.YTMP4_API || 'https://eliteprotech-apis.zone.id/download/ytmp4?url=';


// Free public hosts, no key. catbox.moe first, uguu.se as the backup. Files over 100 MB are refused.
async function uploadToHost(buffer, name, mime) {
  if (buffer.length > 100 * 1024 * 1024) throw new Error('That file is over 100 MB.');
  const tries = [
    async () => {
      const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('fileToUpload', new Blob([buffer], { type: mime || 'application/octet-stream' }), name);
      const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
      const t = (await r.text()).trim(); if (!/^https?:\/\//.test(t)) throw new Error('catbox said: ' + t.slice(0, 80)); return t;
    },
    async () => {
      const fd = new FormData(); fd.append('files[]', new Blob([buffer], { type: mime || 'application/octet-stream' }), name);
      const r = await fetch('https://uguu.se/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
      const j = await r.json(); const u = j?.files?.[0]?.url; if (!u) throw new Error('uguu gave no link'); return u;
    }
  ];
  let last;
  for (const t of tries) { try { return await t(); } catch (e) { last = e; } }
  throw new Error('The upload sites did not answer. Try again in a minute.' + (last ? ` (${String(last.message).slice(0, 60)})` : ''));
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  apk: 'application/vnd.android.package-archive', txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', mkv: 'video/x-matroska',
  webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif'
};

const fmtSize = (n) => {
  if (!Number.isFinite(n) || n <= 0) return 'unknown size';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const compact = (n) => { try { return new Intl.NumberFormat('en', { notation: 'compact' }).format(Number(n) || 0); } catch { return String(n || 0); } };
const extOf = (name) => (String(name).split('?')[0].match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase() || '';
const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'file';

function nameFromHeaders(headers = {}, url = '') {
  const cd = String(headers['content-disposition'] || '');
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return cleanName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))); } catch {} }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) return cleanName(plain[1]);
  try { const p = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); if (p) return cleanName(p); } catch {}
  return 'file';
}

module.exports = (H) => {
  const yts = require('yt-search');
  const { http } = H;

  const usage = (u) => H.usage(u);
  const footer = () => `> ${H.footer()}`;

  /* ---------- safe download (manual redirects, size cap) ---------- */
  async function safeFetch(startUrl, { maxBytes = MAX_BYTES, timeout = 120000, text = false } = {}) {
    let url = await http.safeUrl(startUrl);
    for (let hop = 0; hop < 6; hop++) {
      let res;
      try {
        res = await axios.get(url, {
          responseType: text ? 'text' : 'arraybuffer', timeout, maxRedirects: 0, validateStatus: () => true,
          maxContentLength: maxBytes, maxBodyLength: maxBytes, headers: { 'User-Agent': http.UA }
        });
      } catch (e) {
        if (/maxContentLength|exceeded/i.test(e?.message || '')) throw new Error(`That file is bigger than ${MAX_MB} MB, which is the most I can send.`);
        throw new Error('Could not download that link right now.');
      }
      const status = res.status || 200;
      if (status >= 300 && status < 400 && res.headers?.location) {
        url = await http.safeUrl(new URL(res.headers.location, url).toString());
        continue;
      }
      if (status >= 400) throw new Error(`The server answered ${status} for that link.`);
      return {
        buffer: text ? null : Buffer.from(res.data), text: text ? String(res.data) : null,
        mime: String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase(), headers: res.headers || {}, finalUrl: url
      };
    }
    throw new Error('That link redirects too many times.');
  }

  // Send a buffer as the most fitting WhatsApp message type
  async function sendFile(ctx, { buffer, mime, name, caption, forceDocument = false }) {
    const ext = extOf(name);
    let type = mime || MIME_BY_EXT[ext] || 'application/octet-stream';
    if (type === 'application/octet-stream' && MIME_BY_EXT[ext]) type = MIME_BY_EXT[ext];
    const opts = { quoted: ctx.m };
    const base = type.split('/')[0];
    if (!forceDocument && ['image/jpeg', 'image/png', 'image/webp'].includes(type)) return ctx.sock.sendMessage(ctx.jid, { image: buffer, caption }, opts);
    if (!forceDocument && ['video/mp4', 'video/webm', 'video/quicktime'].includes(type)) return ctx.sock.sendMessage(ctx.jid, { video: buffer, caption, mimetype: type === 'video/webm' ? 'video/webm' : 'video/mp4' }, opts);
    if (!forceDocument && base === 'audio') return ctx.sock.sendMessage(ctx.jid, { audio: buffer, mimetype: type }, opts);
    return ctx.sock.sendMessage(ctx.jid, { document: buffer, mimetype: type, fileName: name, caption }, opts);
  }

  // wrap a command body: usage check, friendly errors, no stack traces to users
  const guard = (name, fn) => async (ctx) => {
    try { return await fn(ctx); } catch (e) {
      console.error(`[${name}]`, e?.message || 'unknown error');
      await ctx.reply(`❌ ${e?.message || 'Something went wrong.'}`).catch(() => {});
    }
  };

  /* ---------- YouTube ---------- */
  const YT_ID = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/;
  async function ytResolve(text) {
    const q = text.trim();
    if (/^https?:\/\//i.test(q)) {
      const id = q.match(YT_ID)?.[1];
      if (!/youtu/i.test(q) || !id) throw new Error('Send a YouTube link or just the song name.');
      const video = await yts({ videoId: id });
      if (!video) throw new Error('Could not find that video.');
      return { video, url: `https://www.youtube.com/watch?v=${id}` };
    }
    const video = (await yts(q))?.videos?.[0];
    if (!video) throw new Error('No results found for that search.');
    return { video, url: video.url };
  }
  async function ytMedia(kind, url) { return require('../yt').media(kind, url); } // -> { buffer, mime }
  const tooLong = (video) => Number(video?.seconds) > MAX_VIDEO_SECONDS && `That video is ${video.timestamp || Math.round(video.seconds / 60) + ' min'} long. The limit is ${MAX_VIDEO_SECONDS / 60} minutes.`;
  const ytCard = (video, label) => `*${video.title}*\n\n⏱ ${video.timestamp || '—'}  👁 ${compact(video.views)}\n📺 ${video.author?.name || '—'}\n🗓 ${video.ago || '—'}\n\n${label}\n${footer()}`;

  /* ---------- the commands ---------- */
  return {
    song: {
      cat: 'download', usage: 'song <name or youtube link>', desc: 'song with cover + playable audio', cooldown: 8,
      run: guard('song', async (ctx) => {
        if (!ctx.text) return ctx.reply(`${usage('song <name or link>')}\nExample: ${H.P()}song Faded Alan Walker`);
        await ctx.reply('⏳ *Finding your song...*');
        const { video, url } = await ytResolve(ctx.text);
        const long = tooLong(video);
        if (long) return ctx.reply(`⚠️ ${long}`);
        if (video.thumbnail) await ctx.sock.sendMessage(ctx.jid, { image: { url: video.thumbnail }, caption: ytCard(video, '🎵 Sending audio...') }, { quoted: ctx.m }).catch(() => {});
        const yt = require('../yt');
        const au = await ytMedia('mp3', url);
        try { await ctx.sock.sendMessage(ctx.jid, { ...yt.payload('audio', au), mimetype: au.mime, fileName: `${cleanName(video.title)}.mp3` }, { quoted: ctx.m }); } finally { yt.release(au); }
      })
    },

    video: {
      cat: 'download', usage: 'video <name or youtube link>', desc: 'YouTube video (mp4)', cooldown: 10,
      run: guard('video', async (ctx) => {
        if (!ctx.text) return ctx.reply(`${usage('video <name or link>')}\nExample: ${H.P()}video Alan Walker Faded`);
        await ctx.reply('⏳ *Finding your video...*');
        const { video, url } = await ytResolve(ctx.text);
        const long = tooLong(video);
        if (long) return ctx.reply(`⚠️ ${long}`);
        const yt = require('../yt');
        const r = await ytMedia('mp4', url);
        if (r.file) await ctx.reply(`📦 Big file (${Math.round(r.size / 1048576)} MB) — uploading, this can take a few minutes...`);
        try {
          await ctx.sock.sendMessage(ctx.jid, { ...yt.payload('video', r), caption: ytCard(video, '🎬 Enjoy!'), mimetype: 'video/mp4', fileName: `${cleanName(video.title)}.mp4` }, { quoted: ctx.m });
        } finally { yt.release(r); }
      })
    },

    ytmp3: {
      cat: 'download', usage: 'ytmp3 <youtube link or name>', desc: 'YouTube to mp3 file', cooldown: 8,
      run: guard('ytmp3', async (ctx) => {
        if (!ctx.text) return ctx.reply(`${usage('ytmp3 <youtube link>')}\nExample: ${H.P()}ytmp3 https://youtu.be/...`);
        await ctx.reply('⏳ *Converting to mp3...*');
        const { video, url } = await ytResolve(ctx.text);
        const long = tooLong(video);
        if (long) return ctx.reply(`⚠️ ${long}`);
        const yt = require('../yt');
        const au = await ytMedia('mp3', url);
        try { await ctx.sock.sendMessage(ctx.jid, {
          ...yt.payload('document', au), mimetype: 'audio/mpeg', fileName: `${cleanName(video.title)}.mp3`, caption: `🎧 *${video.title}*\n${footer()}`
        }, { quoted: ctx.m }); } finally { yt.release(au); }
      })
    },

    ytsearch: {
      cat: 'download', usage: 'ytsearch <query>', desc: 'search YouTube', aliases: ['yts'], cooldown: 5,
      run: guard('ytsearch', async (ctx) => {
        if (!ctx.text) return ctx.reply(`${usage('ytsearch <query>')}\nExample: ${H.P()}ytsearch lofi beats`);
        const r = await yts(ctx.text);
        const list = (r?.videos || []).slice(0, 8);
        if (!list.length) return ctx.reply('🔎 Nothing found for that search.');
        const lines = [];
        list.forEach((v, i) => {
          lines.push(`${i + 1}. *${v.title}*`, `   ⏱ ${v.timestamp || '—'} · 👁 ${compact(v.views)} · ${v.author?.name || '—'}`, `   ${v.url}`);
        });
        await ctx.sock.sendMessage(ctx.jid, {
          text: `${H.box(`🔎 ${ctx.text.slice(0, 30)}`, lines)}\n\nUse ${H.P()}song or ${H.P()}video with a link.\n${footer()}`
        }, { quoted: ctx.m });
      })
    },

    spotify: {
      cat: 'download', usage: 'spotify <song name or spotify link>', desc: 'track info + 30s preview', cooldown: 8,
      run: guard('spotify', async (ctx) => {
        if (!ctx.text) return ctx.reply(`${usage('spotify <song name or link>')}\nExample: ${H.P()}spotify Blinding Lights`);
        let term = ctx.text.trim();
        let spotifyUrl = null;
        if (/^https?:\/\//i.test(term)) {
          const u = new URL(await http.safeUrl(term));
          if (!/(^|\.)spotify\.com$/i.test(u.hostname)) throw new Error('That is not a Spotify link. Send a Spotify track link or a song name.');
          if (!/\/track\//.test(u.pathname)) throw new Error('Only Spotify track links are supported (not albums or playlists).');
          spotifyUrl = `${u.origin}${u.pathname}`;
          let oe;
          try { oe = await http.getJson('https://open.spotify.com/oembed', { params: { url: spotifyUrl }, timeout: 20000 }); } catch { throw new Error('Could not read that Spotify link.'); }
          term = String(oe?.title || '').trim();
          if (!term) throw new Error('Could not read that Spotify link.');
        }
        await ctx.reply('⏳ *Looking it up...*');
        let res;
        try { res = await http.getJson('https://itunes.apple.com/search', { params: { term, media: 'music', entity: 'song', limit: 5 }, timeout: 20000 }); } catch { throw new Error('The music lookup service did not answer. Try again in a moment.'); }
        const hit = (res?.results || []).find((x) => x.previewUrl) || res?.results?.[0];
        if (!hit) return ctx.reply('🎵 No track found for that. Try the artist and song name.');
        const mins = hit.trackTimeMillis ? `${Math.floor(hit.trackTimeMillis / 60000)}:${String(Math.floor(hit.trackTimeMillis / 1000) % 60).padStart(2, '0')}` : '—';
        const caption = `🎵 *${hit.trackName}*\n👤 ${hit.artistName}\n💿 ${hit.collectionName || '—'}\n⏱ ${mins}  🗓 ${String(hit.releaseDate || '').slice(0, 4) || '—'}\n` +
          `${spotifyUrl ? `🔗 ${spotifyUrl}\n` : hit.trackViewUrl ? `🔗 ${hit.trackViewUrl}\n` : ''}\n` +
          `ℹ️ This is the official *30-second preview*, not the full song.\n${footer()}`;
        let art = null;
        if (hit.artworkUrl100) {
          try { art = (await safeFetch(hit.artworkUrl100.replace('100x100', '600x600'), { maxBytes: 5 * 1024 * 1024, timeout: 30000 })).buffer; } catch {}
        }
        if (art) await ctx.sock.sendMessage(ctx.jid, { image: art, caption }, { quoted: ctx.m });
        else await ctx.sock.sendMessage(ctx.jid, { text: caption }, { quoted: ctx.m });
        if (!hit.previewUrl) return ctx.reply('ℹ️ No preview is available for this track.');
        const prev = await safeFetch(hit.previewUrl, { maxBytes: 8 * 1024 * 1024, timeout: 60000 });
        await ctx.sock.sendMessage(ctx.jid, { audio: prev.buffer, mimetype: 'audio/mp4', fileName: `${cleanName(hit.trackName)} (preview).m4a` }, { quoted: ctx.m });
      })
    },

    mediafire: {
      cat: 'download', usage: 'mediafire <link>', desc: 'download a MediaFire file', cooldown: 10,
      run: guard('mediafire', async (ctx) => {
        const link = ctx.args[0];
        if (!link) return ctx.reply(`${usage('mediafire <link>')}\nExample: ${H.P()}mediafire https://www.mediafire.com/file/...`);
        const page = new URL(await http.safeUrl(link));
        if (!/(^|\.)mediafire\.com$/i.test(page.hostname)) throw new Error('That is not a MediaFire link.');
        await ctx.reply('⏳ *Reading MediaFire...*');
        const { text: html } = await safeFetch(page.toString(), { text: true, maxBytes: 3 * 1024 * 1024, timeout: 45000 });

        let direct = null;
        const scrambled = html.match(/data-scrambled-url="([^"]+)"/i)?.[1];
        if (scrambled) { try { direct = Buffer.from(scrambled, 'base64').toString('utf8'); } catch {} }
        direct ||= html.match(/aria-label="Download file"[^>]*href="([^"]+)"/i)?.[1] || html.match(/href="(https?:\/\/download[\w-]*\.mediafire\.com\/[^"]+)"/i)?.[1] ||
          html.match(/id="downloadButton"[^>]*href="([^"]+)"/i)?.[1];
        if (!direct || !/^https?:\/\//i.test(direct)) throw new Error('Could not find the download link. The file may be removed or private.');
        direct = direct.replace(/&amp;/g, '&');
        if (!/(^|\.)mediafire\.com$/i.test(new URL(direct).hostname)) throw new Error('MediaFire returned an unexpected link, so I stopped.');

        const name = cleanName(html.match(/<div class="filename">\s*([^<]+?)\s*<\/div>/i)?.[1] || html.match(/class="dl-btn-label"[^>]*title="([^"]+)"/i)?.[1] || nameFromHeaders({}, direct));
        const sz = html.match(/Download\s*\(\s*([\d.,]+)\s*([KMG]B)\s*\)/i) || html.match(/<span>\s*([\d.,]+)\s*([KMG]B)\s*<\/span>/i);
        if (sz) {
          const bytes = parseFloat(sz[1].replace(',', '.')) * ({ KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[sz[2].toUpperCase()]);
          if (bytes > MAX_BYTES) throw new Error(`${name} is ${sz[1]} ${sz[2]}. I can only send files up to ${MAX_MB} MB.`);
        }
        const f = await safeFetch(direct, { timeout: 240000 });
        if (f.mime === 'text/html') throw new Error('MediaFire did not give the file (it may need a password or is private).');
        await sendFile(ctx, { buffer: f.buffer, mime: MIME_BY_EXT[extOf(name)] || f.mime, name, caption: `📁 *${name}*\n📦 ${fmtSize(f.buffer.length)}\n${footer()}`, forceDocument: true });
      })
    },

    gdrive: {
      cat: 'download', usage: 'gdrive <link>', desc: 'download a public Google Drive file', aliases: ['drive'], cooldown: 10,
      run: guard('gdrive', async (ctx) => {
        const link = ctx.args[0];
        if (!link) return ctx.reply(`${usage('gdrive <link>')}\nExample: ${H.P()}gdrive https://drive.google.com/file/d/ID/view`);
        const u = new URL(await http.safeUrl(link));
        if (!/(^|\.)(drive|docs)\.google\.com$/i.test(u.hostname)) throw new Error('That is not a Google Drive link.');
        if (/\/folders\//.test(u.pathname)) throw new Error('Folders are not supported. Send a link to one file.');
        const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] || u.searchParams.get('id');
        if (!id || !/^[\w-]{10,}$/.test(id)) throw new Error('Could not find the file id in that link.');
        await ctx.reply('⏳ *Downloading from Google Drive...*');

        let f = await safeFetch(`https://drive.google.com/uc?export=download&id=${id}`, { timeout: 240000 });
        if (f.mime === 'text/html') {
          // big files: Google shows a "can't scan for viruses" page with a hidden form — follow it once
          const html = f.buffer.toString('utf8');
          const inputs = {};
          for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
            const n = m[0].match(/name="([^"]+)"/)?.[1]; const v = m[0].match(/value="([^"]*)"/)?.[1];
            if (n) inputs[n] = v ?? '';
          }
          const params = new URLSearchParams({ id, export: 'download', confirm: inputs.confirm || 't' });
          if (inputs.uuid) params.set('uuid', inputs.uuid);
          if (!/Virus scan warning|confirm=|download-form/i.test(html)) throw new Error('This file is not public, or Google blocked the download (too many downloads). Make sure "Anyone with the link" can view it.');
          f = await safeFetch(`https://drive.usercontent.google.com/download?${params}`, { timeout: 300000 });
          if (f.mime === 'text/html') throw new Error('Google Drive would not give the file. It may be private or over its download quota.');
        }
        const name = nameFromHeaders(f.headers, '') === 'file' ? `drive-${id.slice(0, 8)}` : nameFromHeaders(f.headers, '');
        await sendFile(ctx, { buffer: f.buffer, mime: MIME_BY_EXT[extOf(name)] || f.mime, name, caption: `📁 *${name}*\n📦 ${fmtSize(f.buffer.length)}\n${footer()}`, forceDocument: true });
      })
    },

    url: {
      cat: 'download', usage: 'url <direct link>  |  reply to a photo/video/file with url', desc: 'reply to media for a link, or download a public file link', aliases: ['fetchurl', 'tourl', 'upload', 'tolink'], cooldown: 8,
      run: guard('url', async (ctx) => {
        // Media attached to / replied to: upload it and give back a public link (like "tourl" in other bots)
        if (!ctx.args[0]) {
          const g = await H.media.getMedia(ctx).catch(() => null);
          if (g) {
            await ctx.reply('⏳ *Uploading...*');
            const ext = (g.mime.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
            const link = await uploadToHost(g.buffer, g.fileName || `nexora.${ext}`, g.mime);
            return ctx.reply(`🔗 *Your link*\n${link}\n\n📦 ${fmtSize(g.buffer.length)}\n${footer()}`);
          }
        }
        const link = ctx.args[0];
        if (!link) return ctx.reply(`${usage('url <direct link>')}\nExample: ${H.P()}url https://example.com/photo.jpg`);
        const safe = await http.safeUrl(link); // refuses localhost / private addresses with a friendly message
        const info = await http.headInfo(safe);
        if (info.size && info.size > MAX_BYTES) throw new Error(`That file is ${fmtSize(info.size)}. I can only send files up to ${MAX_MB} MB.`);
        await ctx.reply(`⏳ *Downloading...*${info.size ? ` (${fmtSize(info.size)})` : ''}`);
        const f = await safeFetch(safe);
        if (f.mime === 'text/html') throw new Error('That link is a web page, not a file. Send a direct link to a file (image, video, pdf, zip...).');
        const name = nameFromHeaders(f.headers, f.finalUrl);
        await sendFile(ctx, { buffer: f.buffer, mime: f.mime, name, caption: `📁 *${name}*\n📦 ${fmtSize(f.buffer.length)}\n${footer()}` });
      })
    }
  };
};
