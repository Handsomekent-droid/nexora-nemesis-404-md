/**
 * TEXT STYLES & CODES (cat text) — everything works offline, no API.
 * Give the text after the command, or reply to a message and send just the command.
 *   Styles : bold italic bolditalic script fraktur mono sans sansbold sansitalic bubble squared blacksquare wide double
 *            smallcaps upside vapor strike underline mock clap spaced zalgo
 *   Case   : upper lower title sentence snake camel kebab slug
 *   Codes  : morse unmorse binary unbinary hex unhex rot13 atbash caesar urlencode urldecode ascii unascii leet piglatin
 *   Hash   : md5 sha1 sha256 sha512 uuid
 *   Tools  : palindrome anagram vowels charcount textstats emojify repeat sortwords uniquewords longestword initials
 *            lorem randomnumber
 */
const crypto = require('crypto');

module.exports = (H) => {
  const { usage, pick } = H;
  const P = () => H.P();

  const quotedText = (ctx) => {
    const q = H.unwrap(ctx.m);
    const ci = Object.values(q).find((v) => v && typeof v === 'object' && v.contextInfo)?.contextInfo;
    const qm = ci?.quotedMessage ? H.unwrap({ message: ci.quotedMessage }) : {};
    return (qm.conversation || qm.extendedTextMessage?.text || qm.imageMessage?.caption || qm.videoMessage?.caption || '').trim();
  };
  const input = (ctx) => (ctx.text || quotedText(ctx)).slice(0, 2000);

  const out = {};
  // define(name, usageArgs, description, fn(text, ctx) -> string | Promise<string>, {aliases, needs})
  const define = (name, u, desc, fn, extra = {}) => {
    out[name] = {
      cat: 'text', access: 'public', cooldown: 2, usage: `${name} ${u}`.trim(), desc, aliases: extra.aliases,
      run: async (ctx) => {
        const t = input(ctx);
        if (!t) return ctx.reply(`${usage(`${name} ${u}`.trim())}\n_or reply to a message with ${P()}${name}_`);
        try {
          const r = await fn(t, ctx);
          if (r === null || r === undefined || r === '') return ctx.reply('❌ Could not do that with this input.');
          await ctx.sock.sendMessage(ctx.jid, { text: String(r) }, { quoted: ctx.m });
        } catch (e) { await ctx.reply(`❌ ${e?.message || 'Could not do that with this input.'}`); }
      }
    };
  };

  /* ---------------- fancy alphabets ---------------- */
  const range = (U, L, D, special = {}) => (s) => [...s].map((ch) => {
    if (special[ch]) return special[ch];
    const c = ch.codePointAt(0);
    if (U && c >= 65 && c <= 90) return String.fromCodePoint(U + c - 65);
    if (L && c >= 97 && c <= 122) return String.fromCodePoint(L + c - 97);
    if (D && c >= 48 && c <= 57) return String.fromCodePoint(D + c - 48);
    return ch;
  }).join('');
  const FONTS = {
    bold: [range(0x1D400, 0x1D41A, 0x1D7CE), 'bold letters'],
    italic: [range(0x1D434, 0x1D44E, 0, { h: 'ℎ' }), 'italic letters'],
    bolditalic: [range(0x1D468, 0x1D482), 'bold italic letters'],
    script: [range(0x1D4D0, 0x1D4EA), 'script (cursive) letters'],
    fraktur: [range(0x1D56C, 0x1D586), 'gothic letters'],
    mono: [range(0x1D670, 0x1D68A, 0x1D7F6), 'monospace letters'],
    sans: [range(0x1D5A0, 0x1D5BA, 0x1D7E2), 'sans-serif letters'],
    sansbold: [range(0x1D5D4, 0x1D5EE, 0x1D7EC), 'bold sans-serif letters'],
    sansitalic: [range(0x1D608, 0x1D622), 'italic sans-serif letters'],
    bubble: [range(0x24B6, 0x24D0), 'bubble letters'],
    squared: [range(0x1F130, 0x1F130), 'squared letters'],
    blacksquare: [range(0x1F170, 0x1F170), 'black squared letters'],
    wide: [range(0xFF21, 0xFF41, 0xFF10), 'wide letters'],
    double: [range(0x1D538, 0x1D552, 0x1D7D8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' }), 'double-struck letters']
  };
  for (const [name, [fn, desc]] of Object.entries(FONTS)) define(name, '<text>', desc, (t) => fn(t));

  const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
  define('smallcaps', '<text>', 'ꜱᴍᴀʟʟ ᴄᴀᴘꜱ', (t) => [...t.toLowerCase()].map((c) => SMALL[c] || c).join(''), { aliases: ['sc'] });
  const UP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', '?': '¿', '!': '¡', '.': '˙', ',': "'" };
  define('upside', '<text>', 'upside-down text', (t) => [...t.toLowerCase()].map((c) => UP[c] || c).reverse().join(''), { aliases: ['flipside'] });
  define('vapor', '<text>', 'ｖａｐｏｒｗａｖｅ', (t) => FONTS.wide[0]([...t].join(' ')), { aliases: ['vaporwave'] });
  define('strike', '<text>', 'S̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶', (t) => [...t].map((c) => (c === ' ' ? c : c + '̶')).join(''), { aliases: ['strikethrough'] });
  define('underline', '<text>', 'U̲n̲d̲e̲r̲l̲i̲n̲e̲', (t) => [...t].map((c) => (c === ' ' ? c : c + '̲')).join(''));
  define('mock', '<text>', 'mOcKiNg TeXt', (t) => [...t].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''), { aliases: ['spongebob'] });
  define('clap', '<text>', 'put 👏 between 👏 words', (t) => t.trim().split(/\s+/).join(' 👏 ') + ' 👏');
  define('spaced', '<text>', 's p a c e d   t e x t', (t) => [...t].join(' '));
  const ZALGO = ['̀', '́', '̂', '̃', '̈', '̊', '̕', '̛', '̣', '̤', '̥', '̦', '̭', '̮', '̰', '̱'];
  define('zalgo', '<text>', 'c̷̢̛r̶̨͝a̵̛͜z̶͜y̷͝ glitch text', (t) => [...t.slice(0, 300)].map((c) => c + Array.from({ length: 3 }, () => pick(ZALGO)).join('')).join(''), { aliases: ['glitch'] });

  /* ---------------- case ---------------- */
  const words = (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  define('upper', '<text>', 'UPPERCASE', (t) => t.toUpperCase(), { aliases: ['uppercase'] });
  define('lower', '<text>', 'lowercase', (t) => t.toLowerCase(), { aliases: ['lowercase'] });
  define('title', '<text>', 'Title Case', (t) => t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), { aliases: ['titlecase'] });
  define('sentence', '<text>', 'Sentence case', (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase()), { aliases: ['sentencecase'] });
  define('snake', '<text>', 'snake_case', (t) => words(t).join('_').toLowerCase(), { aliases: ['snakecase'] });
  define('camel', '<text>', 'camelCase', (t) => words(t).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''), { aliases: ['camelcase'] });
  define('kebab', '<text>', 'kebab-case', (t) => words(t).join('-').toLowerCase(), { aliases: ['kebabcase'] });
  define('slug', '<text>', 'url-friendly-slug', (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

  /* ---------------- codes ---------------- */
  const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-' };
  const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  define('morse', '<text>', 'text to morse code', (t) => [...t.toLowerCase()].map((c) => (c === ' ' ? '/' : MORSE[c] || '')).filter(Boolean).join(' '));
  define('unmorse', '<morse>', 'morse code to text', (t) => t.trim().split(/\s+/).map((c) => (c === '/' ? ' ' : UNMORSE[c] || '?')).join(''));
  define('binary', '<text>', 'text to binary', (t) => [...Buffer.from(t, 'utf8')].map((b) => b.toString(2).padStart(8, '0')).join(' '));
  define('unbinary', '<binary>', 'binary to text', (t) => { const parts = t.trim().split(/\s+/); if (!parts.every((p) => /^[01]{8}$/.test(p))) throw new Error('Send groups of 8 bits, e.g. 01001000 01101001'); return Buffer.from(parts.map((p) => parseInt(p, 2))).toString('utf8'); });
  define('hex', '<text>', 'text to hex', (t) => Buffer.from(t, 'utf8').toString('hex'));
  define('unhex', '<hex>', 'hex to text', (t) => { const h = t.replace(/\s|0x/g, ''); if (!/^([0-9a-f]{2})+$/i.test(h)) throw new Error('That is not valid hex.'); return Buffer.from(h, 'hex').toString('utf8'); });
  const rot = (t, n) => t.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + n + 26) % 26) + b); });
  define('rot13', '<text>', 'ROT13 cipher (run again to decode)', (t) => rot(t, 13));
  define('atbash', '<text>', 'Atbash cipher (a↔z)', (t) => t.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(b + 25 - (c.charCodeAt(0) - b)); }));
  out.caesar = {
    cat: 'text', access: 'public', cooldown: 2, usage: 'caesar <shift> <text>', desc: 'Caesar cipher (negative shift decodes)',
    run: async (ctx) => {
      const n = parseInt(ctx.args[0], 10); const t = (ctx.args.slice(1).join(' ') || quotedText(ctx)).slice(0, 2000);
      if (!Number.isFinite(n) || !t) return ctx.reply(`${usage('caesar <shift> <text>')}\nExample: ${P()}caesar 3 hello`);
      await ctx.reply(rot(t, ((n % 26) + 26) % 26));
    }
  };
  define('urlencode', '<text>', 'percent-encode for links', (t) => encodeURIComponent(t));
  define('urldecode', '<text>', 'decode %20 style text', (t) => decodeURIComponent(t));
  define('ascii', '<text>', 'text to character codes', (t) => [...t].map((c) => c.codePointAt(0)).join(' '));
  define('unascii', '<codes>', 'character codes to text', (t) => String.fromCodePoint(...t.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 0x110000)));
  const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', b: '8', g: '9', l: '1' };
  define('leet', '<text>', '1337 5p34k', (t) => [...t.toLowerCase()].map((c) => LEET[c] || c).join(''), { aliases: ['1337'] });
  define('piglatin', '<text>', 'ig-pay atin-lay', (t) => t.replace(/[A-Za-z]+/g, (w) => (/^[aeiou]/i.test(w) ? w + 'way' : w.replace(/^([^aeiou]+)(.*)$/i, '$2$1ay'))).toLowerCase());

  /* ---------------- hashes ---------------- */
  for (const algo of ['md5', 'sha1', 'sha256', 'sha512']) define(algo, '<text>', `${algo.toUpperCase()} hash`, (t) => crypto.createHash(algo).update(t).digest('hex'));
  out.uuid = { cat: 'text', access: 'public', cooldown: 2, usage: 'uuid', desc: 'random unique id', run: (ctx) => ctx.reply(crypto.randomUUID()) };

  /* ---------------- little text tools ---------------- */
  define('palindrome', '<text>', 'is it a palindrome?', (t) => { const c = t.toLowerCase().replace(/[^a-z0-9]/g, ''); return c && c === [...c].reverse().join('') ? `✅ "${t}" is a palindrome!` : `❌ "${t}" is not a palindrome.`; });
  out.anagram = {
    cat: 'text', access: 'public', cooldown: 2, usage: 'anagram <word1> <word2>', desc: 'are two words anagrams?',
    run: async (ctx) => {
      const [a, b] = ctx.args; if (!a || !b) return ctx.reply(usage('anagram <word1> <word2>'));
      const n = (s) => [...s.toLowerCase().replace(/[^a-z0-9]/g, '')].sort().join('');
      await ctx.reply(n(a) === n(b) ? `✅ "${a}" and "${b}" are anagrams!` : `❌ "${a}" and "${b}" are not anagrams.`);
    }
  };
  define('vowels', '<text>', 'count vowels and consonants', (t) => { const v = (t.match(/[aeiou]/gi) || []).length; const l = (t.match(/[a-z]/gi) || []).length; return `🔤 Vowels: *${v}*\nConsonants: *${l - v}*`; });
  define('charcount', '<text>', 'count characters', (t) => `🔢 Characters: *${[...t].length}*\nWithout spaces: *${[...t.replace(/\s/g, '')].length}*`);
  define('textstats', '<text>', 'words, sentences, reading time', (t) => { const w = t.trim().split(/\s+/).length; return `📊 Words: *${w}*\nCharacters: *${[...t].length}*\nSentences: *${(t.match(/[.!?]+/g) || []).length || 1}*\nReading time: *${Math.max(1, Math.round(w / 200 * 60))}s*`; });
  const EMOJI = { love: '❤️', happy: '😊', sad: '😢', fire: '🔥', cool: '😎', money: '💰', music: '🎵', star: '⭐', sun: '☀️', moon: '🌙', food: '🍔', dog: '🐶', cat: '🐱', car: '🚗', home: '🏠', phone: '📱', heart: '❤️', king: '👑', queen: '👸', win: '🏆', good: '👍', bad: '👎', laugh: '😂', time: '⏰', world: '🌍', fast: '⚡', beer: '🍺', pizza: '🍕', football: '⚽', book: '📖', gift: '🎁', ghost: '👻', angry: '😡', sleep: '😴', party: '🎉', ok: '👌', hi: '👋', hello: '👋', bye: '👋', thanks: '🙏', pray: '🙏', cry: '😭', kiss: '😘' };
  define('emojify', '<text>', 'add emojis to words', (t) => t.split(/\s+/).map((w) => { const e = EMOJI[w.toLowerCase().replace(/[^a-z]/g, '')]; return e ? `${w} ${e}` : w; }).join(' '));
  out.repeat = {
    cat: 'text', access: 'public', cooldown: 3, usage: 'repeat <times> <text>', desc: 'repeat text (max 20)',
    run: async (ctx) => {
      const n = Math.min(20, parseInt(ctx.args[0], 10)); const t = ctx.args.slice(1).join(' ');
      if (!Number.isFinite(n) || n < 1 || !t) return ctx.reply(`${usage('repeat <times> <text>')}\nExample: ${P()}repeat 3 hello`);
      await ctx.sock.sendMessage(ctx.jid, { text: Array(n).fill(t).join('\n').slice(0, 3000) }, { quoted: ctx.m });
    }
  };
  define('sortwords', '<words>', 'sort words A→Z', (t) => t.trim().split(/\s+/).sort((a, b) => a.localeCompare(b)).join(' '));
  define('uniquewords', '<text>', 'remove repeated words', (t) => [...new Set(t.trim().split(/\s+/))].join(' '));
  define('longestword', '<text>', 'the longest word', (t) => { const w = t.trim().split(/\s+/).sort((a, b) => b.length - a.length)[0]; return `📏 *${w}* (${w.length} letters)`; });
  define('initials', '<name>', 'initials of a name', (t) => t.trim().split(/\s+/).map((w) => w[0].toUpperCase()).join('.') + '.');
  const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur'.split(' ');
  out.lorem = {
    cat: 'text', access: 'public', cooldown: 3, usage: 'lorem [words]', desc: 'placeholder text (max 150 words)',
    run: async (ctx) => {
      const n = Math.max(5, Math.min(150, parseInt(ctx.args[0], 10) || 30));
      const w = Array.from({ length: n }, () => pick(LOREM)); w[0] = w[0][0].toUpperCase() + w[0].slice(1);
      await ctx.reply(w.join(' ') + '.');
    }
  };
  out.randomnumber = {
    cat: 'text', access: 'public', cooldown: 2, usage: 'randomnumber [min] [max]', desc: 'random number (default 1-100)', aliases: ['rn', 'random'],
    run: async (ctx) => {
      let a = parseInt(ctx.args[0], 10); let b = parseInt(ctx.args[1], 10);
      if (!Number.isFinite(a)) { a = 1; b = 100; } else if (!Number.isFinite(b)) { b = a; a = 1; }
      if (a > b) [a, b] = [b, a];
      await ctx.reply(`🎲 *${crypto.randomInt(a, b + 1)}*  (${a}–${b})`);
    }
  };
  return out;
};
