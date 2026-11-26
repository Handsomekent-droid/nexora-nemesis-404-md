/**
 * TOOLS — media converters/editors, text encoders and system info.
 * Media commands read the image/video/sticker/audio attached to the command or replied to, and
 * use ffmpeg (see lib/media.js). Nothing here touches session data or environment variables.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_INPUT = 25 * 1024 * 1024; // 25 MB
const NO_FFMPEG = 'ffmpeg is not installed on this server. Install ffmpeg (or add the ffmpeg-static package) to use this command.';

module.exports = (H) => {
  const { config, media, box, P, userPart } = H;

  /* ---------------- helpers ---------------- */
  const cmd = (def) => ({ cat: 'tools', ...def });
  const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
  const clean = (e) => String(e?.message || e || 'unknown error').replace(/\/(?:tmp|var|home|root|usr)[^\s:]*/g, '<file>').slice(0, 220);

  // text from the command, or from the message it replies to
  function quotedText(ctx) {
    const q = H.getCtxInfo(ctx.m)?.quotedMessage;
    if (!q) return '';
    const x = media.findMedia ? q : q;
    return x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption ||
      x.documentMessage?.caption || '';
  }
  const textOrQuoted = (ctx, text) => (text && text.length ? text : quotedText(ctx));

  const packDefaults = (ctx) => ({ pack: config.APP_NAME, author: H.footer() });

  // Finds + downloads the media a command needs. Replies and returns null when something is wrong.
  async function input(ctx, kinds, howTo, { ffmpeg = true } = {}) {
    if (ffmpeg && !media.hasFfmpeg()) { await ctx.reply(`⚠️ ${NO_FFMPEG}`); return null; }
    const f = media.findMedia(ctx.m);
    if (!f || !kinds.includes(f.kind)) { await ctx.reply(howTo); return null; }
    const declared = Number(f.node.fileLength) || 0;
    if (declared > MAX_INPUT) { await ctx.reply(`⚠️ That file is too big (${fmtBytes(declared)}). The limit is ${fmtBytes(MAX_INPUT)}.`); return null; }
    let m;
    try { m = await media.getMedia(ctx, kinds); } catch (e) { console.error('[tools] download failed:', clean(e)); await ctx.reply('❌ Could not download that media. Send it again and retry.'); return null; }
    if (!m?.buffer?.length) { await ctx.reply(howTo); return null; }
    if (m.buffer.length > MAX_INPUT) { await ctx.reply(`⚠️ That file is too big (${fmtBytes(m.buffer.length)}). The limit is ${fmtBytes(MAX_INPUT)}.`); return null; }
    return m;
  }

  const sendQuoted = (ctx, content) => ctx.sock.sendMessage(ctx.jid, content, { quoted: ctx.m });
  const react = (ctx, e) => ctx.rawSock.sendMessage(ctx.jid, { react: { text: e, key: ctx.m.key } }).catch(() => {});

  // wraps a run() so every failure becomes a friendly reply (never a crash)
  const safe = (name, fn) => async (ctx) => {
    try { await fn(ctx); } catch (e) {
      console.error(`[tools:${name}]`, clean(e));
      await ctx.reply(`❌ ${name} failed: ${clean(e)}`).catch(() => {});
    }
  };

  const isAnimatedSticker = (m) => m.kind === 'sticker' && m.animated;

  // ImageMagick fallback (animated webp -> gif, webp -> png)
  function magick(buffer, inExt, outExt, args = []) {
    return new Promise((resolve, reject) => {
      const inF = media.tmpPath(inExt), outF = media.tmpPath(outExt);
      const done = (fn, v) => { fs.rm(inF, { force: true }, () => {}); fs.rm(outF, { force: true }, () => {}); fn(v); };
      try { fs.writeFileSync(inF, buffer); } catch (e) { return reject(e); }
      const bin = process.platform === 'win32' ? 'magick' : 'convert';
      let p;
      try { p = spawn(bin, [inF, ...args, outF], { stdio: 'ignore' }); } catch (e) { return done(reject, new Error('ImageMagick is not installed')); }
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 60000);
      p.on('error', () => { clearTimeout(t); done(reject, new Error('ImageMagick is not installed')); });
      p.on('close', (code) => {
        clearTimeout(t);
        if (code !== 0 || !fs.existsSync(outF)) return done(reject, new Error('ImageMagick conversion failed'));
        try { done(resolve, fs.readFileSync(outF)); } catch (e) { done(reject, e); }
      });
    });
  }

  // Image result extension: png keeps transparency (stickers/png), everything else becomes jpg
  const outFor = (m) => (m.kind === 'sticker' || /png|webp|gif/.test(m.mime) ? 'png' : 'jpg');
  const qArgs = (ext) => (ext === 'jpg' ? ['-q:v', '2'] : []);

  /**
   * Runs one ffmpeg video-filter over an image/sticker and sends the result.
   * `filter` may be a function (m) => filter string. Stickers come back as stickers.
   */
  async function imageOp(ctx, name, howTo, filter, caption) {
    const m = await input(ctx, ['image', 'sticker'], howTo);
    if (!m) return;
    if (isAnimatedSticker(m)) return ctx.reply('⚠️ Animated stickers are not supported here. Use a normal image or a still sticker.');
    await react(ctx, '⏳');
    const inExt = media.extFor(m.mime, m.kind);
    const outExt = outFor(m);
    const vf = typeof filter === 'function' ? filter(m) : filter;
    let out = await media.ffmpeg({ input: m.buffer, inExt, args: ['-vf', vf, '-frames:v', '1', ...qArgs(outExt)], outExt });
    if (m.kind === 'sticker') {
      const sp = packDefaults(ctx);
      out = await media.toSticker({ buffer: out, inExt: 'png', animated: false, ...sp });
      await sendQuoted(ctx, { sticker: out });
    } else {
      await sendQuoted(ctx, { image: out, caption: `${caption || `✅ ${name}`}\n\n> ${H.footer()}` });
    }
    await react(ctx, '✅');
  }

  /* ---------------- text style data ---------------- */
  const cp = String.fromCodePoint;
  const range = (start, n) => Array.from({ length: n }, (_, i) => cp(start + i));
  function alphaMap({ up, low, dig, exc = {} }) {
    const map = {};
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { if (up) map[c] = exc[c] || cp(up + i); });
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { if (low) map[c] = exc[c] || cp(low + i); });
    '0123456789'.split('').forEach((c, i) => { if (dig) map[c] = cp(dig + i); });
    return map;
  }
  const SMALLCAPS = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
  const FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
    A: '∀', B: 'ᗺ', C: 'Ɔ', D: 'ᗡ', E: 'Ǝ', F: 'Ⅎ', G: '⅁', H: 'H', I: 'I', J: 'ſ', K: 'ʞ', L: '˥', M: 'W', N: 'N', O: 'O', P: 'Ԁ', Q: 'Q', R: 'ᴚ', S: 'S', T: '⊥', U: '∩', V: 'Λ', W: 'M', X: 'X', Y: '⅄', Z: 'Z',
    1: 'Ɩ', 2: 'ᄅ', 3: 'Ɛ', 4: 'ㄣ', 5: 'ϛ', 6: '9', 7: 'ㄥ', 8: '8', 9: '6', 0: '0', '.': '˙', ',': "'", '?': '¿', '!': '¡', "'": ',', '"': '„', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '&': '⅋', _: '‾' };
  const STYLES = {
    bold: alphaMap({ up: 0x1d400, low: 0x1d41a, dig: 0x1d7ce }),
    italic: alphaMap({ up: 0x1d434, low: 0x1d44e, exc: { h: 'ℎ' } }),
    bolditalic: alphaMap({ up: 0x1d468, low: 0x1d482 }),
    script: alphaMap({ up: 0x1d49c, low: 0x1d4b6, exc: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' } }),
    'double-struck': alphaMap({ up: 0x1d538, low: 0x1d552, dig: 0x1d7d8, exc: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' } }),
    monospace: alphaMap({ up: 0x1d670, low: 0x1d68a, dig: 0x1d7f6 }),
    fraktur: alphaMap({ up: 0x1d504, low: 0x1d51e, exc: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' } }),
    smallcaps: { ...Object.fromEntries(Object.entries(SMALLCAPS).map(([k, v]) => [k, v])), ...Object.fromEntries(Object.entries(SMALLCAPS).map(([k, v]) => [k.toUpperCase(), v])) },
    circled: { ...alphaMap({ up: 0x24b6, low: 0x24d0 }), ...Object.fromEntries('123456789'.split('').map((c, i) => [c, cp(0x2460 + i)])), 0: '⓪' },
    'bubble-black': { ...alphaMap({ up: 0x1f150, low: 0x1f150 }), ...Object.fromEntries('123456789'.split('').map((c, i) => [c, cp(0x2776 + i)])), 0: '⓿' },
    fullwidth: { ...alphaMap({ up: 0xff21, low: 0xff41, dig: 0xff10 }), ' ': '\u3000', '!': '！', '?': '？', '.': '．', ',': '，' },
    'upside-down': FLIP
  };
  // lowercase letters of bubble-black map to the same capitals
  { const b = STYLES['bubble-black']; 'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { b[c] = cp(0x1f150 + i); }); }
  const STYLE_ALIASES = { double: 'double-struck', doublestruck: 'double-struck', mono: 'monospace', bubble: 'bubble-black', bubbleblack: 'bubble-black', black: 'bubble-black', upside: 'upside-down', upsidedown: 'upside-down', flip: 'upside-down', small: 'smallcaps', cursive: 'script', gothic: 'fraktur', wide: 'fullwidth', bi: 'bolditalic', 'bold-italic': 'bolditalic', circle: 'circled' };
  const styleName = (s) => { const k = String(s || '').toLowerCase(); return STYLES[k] ? k : STYLE_ALIASES[k] || null; };
  function applyStyle(name, text) {
    const map = STYLES[name];
    const chars = Array.from(text);
    const out = chars.map((c) => (map[c] !== undefined ? map[c] : c));
    return (name === 'upside-down' ? out.reverse() : out).join('');
  }

  /* ---------------- encoders ---------------- */
  const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-', ':': '---...', "'": '.----.' };
  const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  const rot13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
  const CODECS = {
    base64: { enc: (s) => Buffer.from(s, 'utf8').toString('base64'), dec: (s) => { const t = s.replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(t) || !t) throw new Error('That is not valid base64.'); return Buffer.from(t, 'base64').toString('utf8'); } },
    hex: { enc: (s) => Buffer.from(s, 'utf8').toString('hex').replace(/(..)/g, '$1 ').trim(), dec: (s) => { const t = s.replace(/[\s]|0x/gi, ''); if (!/^([0-9a-f]{2})+$/i.test(t)) throw new Error('That is not valid hex (pairs of 0-9 a-f).'); return Buffer.from(t, 'hex').toString('utf8'); } },
    binary: { enc: (s) => Array.from(Buffer.from(s, 'utf8')).map((b) => b.toString(2).padStart(8, '0')).join(' '), dec: (s) => { const parts = s.trim().split(/\s+/); if (!parts.every((p) => /^[01]{8}$/.test(p))) throw new Error('Binary must be groups of 8 bits separated by spaces.'); return Buffer.from(parts.map((p) => parseInt(p, 2))).toString('utf8'); } },
    url: { enc: (s) => encodeURIComponent(s), dec: (s) => { try { return decodeURIComponent(s); } catch { throw new Error('That is not a valid URL-encoded string.'); } } },
    morse: { enc: (s) => s.toLowerCase().split('').map((c) => (c === ' ' ? '/' : MORSE[c] || '')).filter((x) => x !== '').join(' '), dec: (s) => s.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((c) => { if (!UNMORSE[c]) throw new Error(`"${c}" is not valid morse (use . - and / between words).`); return UNMORSE[c]; }).join('')).join(' ') },
    rot13: { enc: rot13, dec: rot13 },
    reverse: { enc: (s) => Array.from(s).reverse().join(''), dec: (s) => Array.from(s).reverse().join('') }
  };
  const CODEC_NAMES = Object.keys(CODECS).join(', ');
  const CODEC_ALIAS = { b64: 'base64', binary: 'binary', bin: 'binary', uri: 'url', rot: 'rot13', morsecode: 'morse' };

  async function codecCmd(ctx, mode) {
    const [typeRaw, ...rest] = ctx.args;
    const type = CODECS[(typeRaw || '').toLowerCase()] ? (typeRaw || '').toLowerCase() : CODEC_ALIAS[(typeRaw || '').toLowerCase()];
    if (!type) return ctx.reply(`Usage: ${P()}${mode} <type> <text>\nTypes: ${CODEC_NAMES}\nExample: ${P()}${mode} base64 hello\n(or reply to a message with ${P()}${mode} <type>)`);
    const afterType = ctx.text.replace(new RegExp(`^${typeRaw}\\s*`, 'i'), '');
    const text = textOrQuoted(ctx, afterType);
    if (!text) return ctx.reply(`⚠️ Give me some text or reply to a message.\nExample: ${P()}${mode} ${type} hello`);
    if (text.length > 3000) return ctx.reply('⚠️ That text is too long (max 3000 characters).');
    try {
      const out = CODECS[type][mode === 'encode' ? 'enc' : 'dec'](text);
      if (!out) return ctx.reply('⚠️ Nothing came out of that. Check the input.');
      return ctx.reply(`🔤 *${type}* ${mode}d:\n\n${out.slice(0, 3500)}`);
    } catch (e) {
      return ctx.reply(`❌ ${clean(e)}`);
    }
  }

  /* ---------------- drawtext helpers (caption) ---------------- */
  let fontCache;
  function findFont() {
    if (fontCache !== undefined) return fontCache;
    const known = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
      '/Library/Fonts/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/system/fonts/Roboto-Bold.ttf'
    ];
    fontCache = known.find((f) => fs.existsSync(f)) || null;
    if (!fontCache) { // last resort: first .ttf found under the usual font folders (shallow search)
      const walk = (dir, depth) => {
        if (depth > 3 || fontCache) return;
        let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of list) {
          if (fontCache) return;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (/\.ttf$/i.test(e.name)) fontCache = p;
        }
      };
      ['/usr/share/fonts', '/usr/local/share/fonts'].forEach((d) => walk(d, 0));
    }
    return fontCache;
  }
  function wrap(text, width = 20) {
    const words = String(text).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > width && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) lines.push(cur);
    return lines.join('\n');
  }

  /* =============================== commands =============================== */
  return {
    /* ---------- stickers & conversions ---------- */
    sticker: cmd({
      usage: 'sticker [pack|author]', desc: 'image/video/gif → sticker', aliases: ['s', 'stiker'], cooldown: 5,
      run: safe('sticker', async (ctx) => {
        const m = await input(ctx, ['image', 'video', 'sticker'], `Reply to an image, video or gif with ${P()}sticker (or send one with ${P()}sticker as caption).\nOptional: ${P()}sticker My Pack|My Name   ·   ${P()}sticker crop for a square crop`);
        if (!m) return;
        const crop = /^crop\b/i.test(ctx.text);
        const rest = crop ? ctx.text.replace(/^crop\s*/i, '') : ctx.text;
        const [pk, au] = rest.split('|').map((x) => x.trim());
        const sp = packDefaults(ctx);
        const pack = pk || sp.pack, author = au || sp.author;
        if (m.kind === 'video' && m.seconds > 20) return ctx.reply('⚠️ Videos longer than 20 seconds cannot become stickers. Trim it first.');
        await react(ctx, '⏳');
        let out;
        if (m.kind === 'sticker') out = media.webpWithExif(m.buffer, pack, author);
        else out = await media.toSticker({ buffer: m.buffer, inExt: media.extFor(m.mime, m.kind), animated: m.kind === 'video' || m.animated, pack, author, crop });
        await sendQuoted(ctx, { sticker: out });
        await react(ctx, '✅');
      })
    }),

    take: cmd({
      usage: 'take [pack|author]', desc: 'steal a sticker with your own pack name', aliases: ['steal', 'wm'], cooldown: 4,
      run: safe('take', async (ctx) => {
        const m = await input(ctx, ['sticker'], `Reply to a sticker with ${P()}take <pack>|<author>\nExample: ${P()}take My Pack|Kent`, { ffmpeg: false });
        if (!m) return;
        const [pk, au] = ctx.text.split('|').map((x) => x.trim());
        const pack = pk || ctx.userName || config.APP_NAME;
        const author = au || config.APP_NAME;
        await sendQuoted(ctx, { sticker: media.webpWithExif(m.buffer, pack, author) });
      })
    }),

    toimg: cmd({
      usage: 'toimg', desc: 'sticker → image', aliases: ['toimage', 'topng'], cooldown: 4,
      run: safe('toimg', async (ctx) => {
        const m = await input(ctx, ['sticker'], `Reply to a sticker with ${P()}toimg`, { ffmpeg: false });
        if (!m) return;
        let out;
        try {
          if (!media.hasFfmpeg()) throw new Error('no ffmpeg');
          out = await media.ffmpeg({ input: m.buffer, inExt: 'webp', args: ['-frames:v', '1'], outExt: 'png' });
        } catch (e) {
          try { out = await magick(m.buffer, 'webp', 'png', ['-coalesce', '-delete', '1--1']); } // first frame
          catch { throw new Error(media.hasFfmpeg() ? 'could not convert that sticker (animated stickers need ImageMagick on this server)' : NO_FFMPEG); }
        }
        await sendQuoted(ctx, { image: out, caption: `✅ Sticker → image\n\n> ${H.footer()}` });
      })
    }),

    tovideo: cmd({
      usage: 'tovideo', desc: 'gif/video/animated sticker → mp4', aliases: ['tomp4', 'togif'], cooldown: 8,
      run: safe('tovideo', async (ctx) => {
        const m = await input(ctx, ['video', 'sticker'], `Reply to a video, gif or animated sticker with ${P()}tovideo`);
        if (!m) return;
        await react(ctx, '⏳');
        const args = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'];
        let out;
        if (m.kind === 'sticker') {
          if (!m.animated) return ctx.reply(`⚠️ That sticker is not animated. Use ${P()}toimg for stills.`);
          try {
            out = await media.ffmpeg({ input: m.buffer, inExt: 'webp', args: [...args, '-an'], outExt: 'mp4', timeout: 120000 });
          } catch {
            let gif;
            try { gif = await magick(m.buffer, 'webp', 'gif', ['-coalesce']); }
            catch { return ctx.reply('⚠️ Animated stickers need ImageMagick on this server to be converted, and it is not installed. Ask the host to install ImageMagick (`convert`).'); }
            out = await media.ffmpeg({ input: gif, inExt: 'gif', args: [...args, '-an'], outExt: 'mp4', timeout: 120000 });
          }
        } else {
          out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, 'video'), args, outExt: 'mp4', timeout: 120000 });
        }
        await sendQuoted(ctx, { video: out, mimetype: 'video/mp4', caption: `✅ Converted\n\n> ${H.footer()}` });
        await react(ctx, '✅');
      })
    }),

    toaudio: cmd({
      usage: 'toaudio', desc: 'video/audio → mp3 audio', aliases: ['toaud'], cooldown: 8,
      run: safe('toaudio', async (ctx) => {
        const m = await input(ctx, ['video', 'audio'], `Reply to a video or audio with ${P()}toaudio`);
        if (!m) return;
        await react(ctx, '⏳');
        const out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, m.kind), args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k'], outExt: 'mp3', timeout: 120000 });
        await sendQuoted(ctx, { audio: out, mimetype: 'audio/mpeg', ptt: false });
        await react(ctx, '✅');
      })
    }),

    tomp3: cmd({
      usage: 'tomp3', desc: 'video/audio → mp3 file', cooldown: 8,
      run: safe('tomp3', async (ctx) => {
        const m = await input(ctx, ['video', 'audio'], `Reply to a video or audio with ${P()}tomp3`);
        if (!m) return;
        await react(ctx, '⏳');
        const out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, m.kind), args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'], outExt: 'mp3', timeout: 120000 });
        await sendQuoted(ctx, { document: out, mimetype: 'audio/mpeg', fileName: `${config.APP_NAME.replace(/[^\w-]+/g, '_') || 'audio'}.mp3` });
        await react(ctx, '✅');
      })
    }),

    /* ---------- image editing ---------- */
    resize: cmd({
      usage: 'resize <width> | <WxH>', desc: 'change image size', cooldown: 4,
      run: safe('resize', async (ctx) => {
        const arg = (ctx.args[0] || '').toLowerCase();
        const mm = arg.match(/^(\d{1,4})(?:x(\d{1,4}))?$/);
        const how = `Reply to an image with ${P()}resize 512  (width, keeps shape)  or  ${P()}resize 800x600`;
        if (!mm) return ctx.reply(how);
        const w = +mm[1], h = mm[2] ? +mm[2] : -1;
        if (w < 16 || w > 4096 || (h !== -1 && (h < 16 || h > 4096))) return ctx.reply('⚠️ Size must be between 16 and 4096 pixels.');
        await imageOp(ctx, 'Resized', how, `scale=${w}:${h === -1 ? '-2' : h}`, `✅ Resized to ${h === -1 ? `${w}px wide` : `${w}x${h}`}`);
      })
    }),

    compress: cmd({
      usage: 'compress [quality 1-100]', desc: 'shrink image/video file size', cooldown: 8,
      run: safe('compress', async (ctx) => {
        const q = Math.min(100, Math.max(1, parseInt(ctx.args[0], 10) || 55));
        const m = await input(ctx, ['image', 'video'], `Reply to an image or video with ${P()}compress  (optional quality 1-100, default 55)`);
        if (!m) return;
        await react(ctx, '⏳');
        if (m.kind === 'video') {
          const crf = 18 + Math.round((100 - q) * 0.3);
          const out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, 'video'), args: ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'], outExt: 'mp4', timeout: 150000 });
          await sendQuoted(ctx, { video: out, mimetype: 'video/mp4', caption: `✅ Compressed ${fmtBytes(m.buffer.length)} → ${fmtBytes(out.length)}\n\n> ${H.footer()}` });
        } else {
          const qv = Math.min(31, Math.max(2, Math.round(31 - q * 0.29)));
          const out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, 'image'), args: ['-frames:v', '1', '-q:v', String(qv)], outExt: 'jpg' });
          await sendQuoted(ctx, { image: out, caption: `✅ Compressed ${fmtBytes(m.buffer.length)} → ${fmtBytes(out.length)} (quality ${q})\n\n> ${H.footer()}` });
        }
        await react(ctx, '✅');
      })
    }),

    blur: cmd({
      usage: 'blur [1-30]', desc: 'blur an image', cooldown: 4,
      run: safe('blur', async (ctx) => {
        const n = Math.min(30, Math.max(1, parseInt(ctx.args[0], 10) || 8));
        await imageOp(ctx, 'Blurred', `Reply to an image with ${P()}blur  (optional strength 1-30, default 8)`, `boxblur=lr='min(${n},min(w,h)/4)':lp=2`, `✅ Blurred (strength ${n})`);
      })
    }),

    enhance: cmd({
      usage: 'enhance', desc: 'sharpen + boost colours', aliases: ['hd', 'sharpen'], cooldown: 4,
      run: safe('enhance', async (ctx) => {
        await imageOp(ctx, 'Enhanced', `Reply to an image with ${P()}enhance`, 'unsharp=5:5:1.1:5:5:0.0,eq=contrast=1.08:saturation=1.15:brightness=0.02', '✅ Enhanced (sharper, richer colours)');
      })
    }),

    crop: cmd({
      usage: 'crop square | 16:9 | WxH', desc: 'crop an image', cooldown: 4,
      run: safe('crop', async (ctx) => {
        const a = (ctx.args[0] || '').toLowerCase();
        const how = `Reply to an image with:\n${P()}crop square\n${P()}crop 16:9   (any ratio)\n${P()}crop 500x500   (exact size, from the centre)`;
        let f;
        if (a === 'square' || a === '1:1') f = "crop=w='min(iw,ih)':h='min(iw,ih)'";
        else if (/^\d{1,2}:\d{1,2}$/.test(a)) {
          const [A, B] = a.split(':').map(Number);
          if (!A || !B) return ctx.reply(how);
          f = `crop=w='if(gt(iw/ih,${A}/${B}),ih*${A}/${B},iw)':h='if(gt(iw/ih,${A}/${B}),ih,iw*${B}/${A})'`;
        } else if (/^\d{2,4}x\d{2,4}$/.test(a)) {
          const [W, Hh] = a.split('x').map(Number);
          if (W > 4096 || Hh > 4096) return ctx.reply('⚠️ Max crop size is 4096x4096.');
          f = `crop=w='min(iw,${W})':h='min(ih,${Hh})'`;
        } else return ctx.reply(how);
        await imageOp(ctx, 'Cropped', how, f, `✅ Cropped (${a})`);
      })
    }),

    flip: cmd({
      usage: 'flip [h|v]', desc: 'mirror an image (h = left/right, v = up/down)', cooldown: 4,
      run: safe('flip', async (ctx) => {
        const a = (ctx.args[0] || 'h').toLowerCase();
        const vf = ['v', 'vertical', 'up', 'down'].includes(a) ? 'vflip' : 'hflip';
        await imageOp(ctx, 'Flipped', `Reply to an image or sticker with ${P()}flip h  or  ${P()}flip v\n(for heads/tails use ${P()}coinflip)`, vf, `✅ Flipped ${vf === 'vflip' ? 'vertically' : 'horizontally'}`);
      })
    }),

    rotate: cmd({
      usage: 'rotate 90|180|270|<degrees>', desc: 'rotate an image', cooldown: 4,
      run: safe('rotate', async (ctx) => {
        const how = `Reply to an image with ${P()}rotate 90  (or 180, 270, or any angle like -30)`;
        const deg = Number(ctx.args[0]);
        if (!ctx.args[0] || !Number.isFinite(deg)) return ctx.reply(how);
        const d = ((deg % 360) + 360) % 360;
        let vf;
        if (d === 0) vf = 'null';
        else if (d === 90) vf = 'transpose=1';
        else if (d === 180) vf = 'hflip,vflip';
        else if (d === 270) vf = 'transpose=2';
        else vf = `format=rgba,rotate=${d}*PI/180:ow='rotw(${d}*PI/180)':oh='roth(${d}*PI/180)':c=black@0`;
        await imageOp(ctx, 'Rotated', how, (m) => (['transpose=1', 'hflip,vflip', 'transpose=2', 'null'].includes(vf) || m.kind === 'sticker' || /png|webp/.test(m.mime) ? vf : vf.replace('c=black@0', 'c=black')), `✅ Rotated ${d}°`);
      })
    }),

    removebg: cmd({
      usage: 'removebg', desc: 'remove an image background (needs REMOVEBG_KEY)', aliases: ['rmbg', 'nobg'], cooldown: 15,
      run: safe('removebg', async (ctx) => {
        const key = process.env.REMOVEBG_KEY;
        const m = await input(ctx, ['image'], `Reply to an image with ${P()}removebg`, { ffmpeg: false });
        if (!m) return;
        if (!key) return ctx.reply('⚠️ This command needs a remove.bg API key.\nGet a free one at https://www.remove.bg/api and set it on the server as *REMOVEBG_KEY* (in the .env file), then restart.');
        await react(ctx, '⏳');
        const axios = require('axios');
        const form = new FormData();
        form.append('size', 'auto');
        form.append('image_file', new Blob([m.buffer], { type: m.mime || 'image/jpeg' }), 'image.jpg');
        let res;
        try {
          res = await axios.post('https://api.remove.bg/v1.0/removebg', form, { headers: { 'X-Api-Key': key }, responseType: 'arraybuffer', timeout: 60000, maxBodyLength: MAX_INPUT * 2 });
        } catch (e) {
          const status = e?.response?.status;
          if (status === 403 || status === 401) throw new Error('remove.bg rejected the API key. Check REMOVEBG_KEY.');
          if (status === 402) throw new Error('the remove.bg account is out of credits.');
          if (status === 429) throw new Error('remove.bg rate limit reached, try again in a minute.');
          throw new Error('the remove.bg service did not respond. Try again later.');
        }
        const out = Buffer.from(res.data);
        await sendQuoted(ctx, { document: out, mimetype: 'image/png', fileName: 'no-background.png', caption: `✅ Background removed\n\n> ${H.footer()}` });
        await sendQuoted(ctx, { image: out });
        await react(ctx, '✅');
      })
    }),

    caption: cmd({
      usage: 'caption top text | bottom text', desc: 'put meme text on an image', aliases: ['meme2', 'memetext'], cooldown: 6,
      run: safe('caption', async (ctx) => {
        const how = `Reply to an image with:\n${P()}caption top text | bottom text\n(one text only = bottom caption)`;
        if (!ctx.text) return ctx.reply(how);
        const parts = ctx.text.split('|').map((x) => x.trim());
        const top = parts.length > 1 ? parts[0] : '';
        const bottom = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        if (!top && !bottom) return ctx.reply(how);
        if (top.length + bottom.length > 200) return ctx.reply('⚠️ Keep the text under 200 characters.');
        const m = await input(ctx, ['image'], how, { ffmpeg: false });
        if (!m) return;
        const plain = async (why) => sendQuoted(ctx, { image: m.buffer, caption: `${[top, bottom].filter(Boolean).join('\n')}\n\n_(${why})_` });
        if (!media.hasFfmpeg()) return plain('text could not be drawn on the picture: ffmpeg is missing on this server');
        const font = findFont();
        if (!font) return plain('text could not be drawn on the picture: no font file found on this server');
        await react(ctx, '⏳');
        const files = [];
        const mk = (t) => { const f = media.tmpPath('txt'); fs.writeFileSync(f, wrap(t, 20)); files.push(f); return f; };
        try {
          const dt = (file, y) => `drawtext=fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}':textfile='${file.replace(/\\/g, '/').replace(/:/g, '\\:')}':fontcolor=white:borderw=3:bordercolor=black:fontsize=w/14:line_spacing=4:x=(w-text_w)/2:y=${y}`;
          const chain = [];
          if (top) chain.push(dt(mk(top), 'h/28'));
          if (bottom) chain.push(dt(mk(bottom), 'h-text_h-h/28'));
          const out = await media.ffmpeg({ input: m.buffer, inExt: media.extFor(m.mime, 'image'), args: ['-vf', chain.join(','), '-frames:v', '1', '-q:v', '2'], outExt: 'jpg' });
          await sendQuoted(ctx, { image: out, caption: `> ${H.footer()}` });
          await react(ctx, '✅');
        } catch (e) {
          console.error('[tools:caption] drawtext failed:', clean(e));
          await plain('could not draw the text on the picture on this server');
        } finally { files.forEach((f) => fs.rm(f, { force: true }, () => {})); }
      })
    }),

    emojimix: cmd({
      usage: 'emojimix 😀+😎', desc: 'mix two emojis into a sticker', aliases: ['emix'], cooldown: 6,
      run: safe('emojimix', async (ctx) => {
        const how = `Usage: ${P()}emojimix 😀+😎`;
        const seg = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(ctx.text), (x) => x.segment) : Array.from(ctx.text);
        const emojis = seg.filter((g) => /\p{Extended_Pictographic}/u.test(g));
        if (emojis.length !== 2) return ctx.reply(`${how}\nSend exactly two emojis.`);
        if (!media.hasFfmpeg()) return ctx.reply(`⚠️ ${NO_FFMPEG}`);
        await react(ctx, '⏳');
        let img;
        try {
          img = await H.http.getBuffer(`https://emojik.vercel.app/s/${encodeURIComponent(emojis[0])}_${encodeURIComponent(emojis[1])}?size=512`, { maxBytes: 5 * 1024 * 1024, timeout: 30000 });
          if (!/image/.test(img.mime) && img.buffer.length < 200) throw new Error('bad response');
        } catch (e) {
          return ctx.reply('❌ That emoji combination is not available (or the emoji service is down). Try different emojis.');
        }
        const sp = packDefaults(ctx);
        const out = await media.toSticker({ buffer: img.buffer, inExt: media.extFor(img.mime, 'image'), animated: false, ...sp });
        await sendQuoted(ctx, { sticker: out });
        await react(ctx, '✅');
      })
    }),

    /* ---------- text tools ---------- */
    font: cmd({
      usage: 'font <style> <text>', desc: 'fancy text styles (font list)', aliases: ['fancy', 'style'],
      run: safe('font', async (ctx) => {
        const names = Object.keys(STYLES);
        const first = (ctx.args[0] || '').toLowerCase();
        if (first === 'list') return ctx.reply(`🔠 *Styles*\n${names.map((n) => `▸ ${n}`).join('\n')}\n\nUse: ${P()}font bold Hello\nOr ${P()}font Hello to see them all.`);
        const st = styleName(first);
        if (st) {
          const text = textOrQuoted(ctx, ctx.text.replace(/^\S+\s*/, ''));
          if (!text) return ctx.reply(`Usage: ${P()}font ${st} <text>`);
          if (text.length > 500) return ctx.reply('⚠️ Max 500 characters.');
          return ctx.reply(applyStyle(st, text));
        }
        const text = textOrQuoted(ctx, ctx.text);
        if (!text) return ctx.reply(`Usage: ${P()}font <style> <text>\nStyles: ${names.join(', ')}\nOr just ${P()}font <text> to see every style.`);
        if (text.length > 200) return ctx.reply('⚠️ Max 200 characters when showing all styles.');
        return ctx.reply(names.map((n) => `*${n}*\n${applyStyle(n, text)}`).join('\n\n'));
      })
    }),

    base64: cmd({
      usage: 'base64 encode|decode <text>', desc: 'base64 encode/decode', aliases: ['b64'],
      run: safe('base64', async (ctx) => {
        const sub = (ctx.args[0] || '').toLowerCase();
        let mode = 'encode', body = ctx.text;
        if (['encode', 'enc', 'decode', 'dec'].includes(sub)) { mode = sub.startsWith('d') ? 'decode' : 'encode'; body = ctx.text.replace(/^\S+\s*/, ''); }
        const text = textOrQuoted(ctx, body);
        if (!text) return ctx.reply(`Usage: ${P()}base64 encode <text>\n       ${P()}base64 decode <base64>\n(or reply to a message)`);
        if (text.length > 3000) return ctx.reply('⚠️ That text is too long (max 3000 characters).');
        try { return ctx.reply(`🔤 *base64* ${mode}d:\n\n${CODECS.base64[mode === 'encode' ? 'enc' : 'dec'](text).slice(0, 3500)}`); } catch (e) { return ctx.reply(`❌ ${clean(e)}`); }
      })
    }),

    encode: cmd({ usage: 'encode <type> <text>', desc: `types: ${CODEC_NAMES}`, run: safe('encode', (ctx) => codecCmd(ctx, 'encode')) }),
    decode: cmd({ usage: 'decode <type> <text>', desc: `types: ${CODEC_NAMES}`, run: safe('decode', (ctx) => codecCmd(ctx, 'decode')) }),

    json: cmd({
      usage: 'json <json text>', desc: 'validate + pretty-print JSON (json min to compress)', aliases: ['jsonfmt'],
      run: safe('json', async (ctx) => {
        let body = ctx.text, min = false;
        if (/^(min|minify|compact)\b/i.test(body)) { min = true; body = body.replace(/^\S+\s*/, ''); }
        const text = textOrQuoted(ctx, body).trim();
        if (!text) return ctx.reply(`Usage: ${P()}json {"name":"x","list":[1,2]}\n${P()}json min <json>  → compress\n(or reply to a message that contains JSON)`);
        if (text.length > 20000) return ctx.reply('⚠️ That JSON is too long (max 20000 characters).');
        let val;
        try { val = JSON.parse(text); } catch (e) {
          const msg = String(e.message);
          let pos = Number((msg.match(/position (\d+)/) || [])[1]);
          let line, col;
          const lc = msg.match(/line (\d+) column (\d+)/);
          if (lc) { line = +lc[1]; col = +lc[2]; }
          else if (Number.isFinite(pos)) { const before = text.slice(0, pos).split('\n'); line = before.length; col = before[before.length - 1].length + 1; }
          if (!Number.isFinite(pos) && line) { const ls = text.split('\n'); pos = ls.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) + col - 1; }
          const snip = Number.isFinite(pos) ? `\n\n…${text.slice(Math.max(0, pos - 20), pos)}⟦here⟧${text.slice(pos, pos + 20)}…` : '';
          return ctx.reply(`❌ *Invalid JSON*\n${line ? `Line ${line}, column ${col}\n` : ''}${msg.replace(/^JSON\.parse: /, '').slice(0, 160)}${snip}`);
        }
        const out = min ? JSON.stringify(val) : JSON.stringify(val, null, 2);
        return ctx.reply(`✅ *Valid JSON*\n\n${out.length > 3300 ? out.slice(0, 3300) + '\n…(truncated)' : out}`);
      })
    }),

    /* ---------- system info ---------- */
    system: cmd({
      usage: 'system', desc: 'server info (cpu, ram, node)', aliases: ['sys', 'sysinfo'], cooldown: 5,
      run: safe('system', async (ctx) => {
        const cpus = os.cpus() || [];
        const total = os.totalmem(), free = os.freemem(), mu = process.memoryUsage();
        const load = os.loadavg().map((x) => x.toFixed(2)).join(' / ');
        return ctx.reply(box('SYSTEM', [
          `🖥 *OS:* ${os.type()} ${os.release()} (${os.arch()})`,
          `🟢 *Node:* ${process.version}`,
          `⚙️ *CPU:* ${(cpus[0]?.model || 'unknown').replace(/\s+/g, ' ').trim()}`,
          `🧮 *Cores:* ${cpus.length || '?'}`,
          `📈 *Load (1/5/15m):* ${load}`,
          `🧠 *RAM:* ${fmtBytes(total - free)} / ${fmtBytes(total)}`,
          `📦 *Bot memory:* ${fmtBytes(mu.rss)} (heap ${fmtBytes(mu.heapUsed)})`,
          `🎞 *ffmpeg:* ${media.hasFfmpeg() ? 'available' : 'not installed'}`,
          `⏱ *Bot uptime:* ${H.uptimeShort(process.uptime() * 1000)}`
        ].join('\n').split('\n')));
      })
    }),

    uptime: cmd({
      usage: 'uptime', desc: 'bot + server uptime',
      run: safe('uptime', async (ctx) => {
        const f = (s) => { s = Math.floor(s); const d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${Math.floor(s / 3600) % 24}h ${Math.floor(s / 60) % 60}m ${s % 60}s`; };
        return ctx.reply(box('UPTIME', [`🤖 *Bot:* ${f(process.uptime())}`, `🖥 *Server:* ${f(os.uptime())}`, `🕒 *Started:* ${new Date(Date.now() - process.uptime() * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`]));
      })
    }),

    device: cmd({
      usage: 'device', desc: 'info about the linked WhatsApp account/device',
      run: safe('device', async (ctx) => {
        const u = ctx.rawSock.user || {};
        const id = String(u.id || '');
        const num = userPart(id);
        const devMatch = id.match(/:(\d+)@/);
        const kind = id.endsWith('@lid') ? 'lid' : id.endsWith('@s.whatsapp.net') ? 'phone (s.whatsapp.net)' : 'unknown';
        return ctx.reply(box('DEVICE', [
          `📱 *Account:* +${num}`,
          `🔖 *Name:* ${u.name || 'not set'}`,
          `🔗 *Linked device #:* ${devMatch ? devMatch[1] : '0 (primary)'}`,
          `🆔 *JID type:* ${kind}${u.lid ? ' + lid' : ''}`,
          `🤖 *Bot:* ${config.APP_NAME} build ${H.VERSION}`,
          `⚙️ *Prefix:* ${P()}`,
          `🟢 *Node:* ${process.version}`,
          `🎞 *ffmpeg:* ${media.hasFfmpeg() ? 'available' : 'not installed'}`
        ]));
      })
    })
  };
};
