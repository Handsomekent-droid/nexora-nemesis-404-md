/**
 * UTILITIES: weather, translate, currency, date, shorturl, qr, readqr, password, define, wiki,
 * country, ipinfo, unitconvert, count, poll, reminder, timer.
 * (calculator and time already live in lib/commands.js.)
 * External services used (all free, no API key): Open-Meteo, MyMemory, open.er-api.com, TinyURL/is.gd,
 * api.qrserver.com, dictionaryapi.dev, Wikipedia REST, restcountries.com, ipwho.is.
 */
const crypto = require('crypto');
const { createStore } = require('../store');

module.exports = (H) => {
  const { http, config, usage } = H;
  const store = createStore('reminders'); // { [acct]: [{ id, jid, at, text, by }] }

  const quotedText = (ctx) => {
    const q = H.unwrap(ctx.m);
    const ci = Object.values(q).find((v) => v && typeof v === 'object' && v.contextInfo)?.contextInfo;
    const qm = ci?.quotedMessage ? H.unwrap({ message: ci.quotedMessage }) : {};
    return (qm.conversation || qm.extendedTextMessage?.text || qm.imageMessage?.caption || qm.videoMessage?.caption || '').trim();
  };
  const fail = (ctx, tag, e, msg) => {
    console.error(`[${tag}]`, e?.message || 'unknown error');
    return ctx.reply(`❌ ${msg || 'Something went wrong. Please try again in a moment.'}`);
  };
  const clip = (s, n = 900) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /* ---------------- unit tables ---------------- */
  const UNITS = {
    length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, ft: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254 },
    mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, lbs: 0.45359237, oz: 0.028349523125, t: 1000, ton: 1000 },
    volume: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375, m3: 1000 },
    speed: { 'm/s': 1, ms: 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, kn: 0.514444, knot: 0.514444 },
    data: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5, bit: 0.125 },
    temp: { c: 1, f: 1, k: 1 }
  };
  const alias = { celsius: 'c', fahrenheit: 'f', kelvin: 'k', '°c': 'c', '°f': 'f', litre: 'l', liter: 'l', liters: 'l', litres: 'l', meter: 'm', meters: 'm', metre: 'm', kilometer: 'km', kilometers: 'km', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', foot: 'ft', inches: 'in', 'fl oz': 'floz' };
  const kindOf = (u) => Object.keys(UNITS).find((k) => Object.prototype.hasOwnProperty.call(UNITS[k], u));
  function convertUnit(v, from, to) {
    from = alias[from] || from; to = alias[to] || to;
    const kind = kindOf(from);
    if (!kind || kindOf(to) !== kind) return null;
    if (kind === 'temp') {
      const c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    }
    return (v * UNITS[kind][from]) / UNITS[kind][to];
  }
  const num = (n) => (Number.isFinite(n) ? String(+n.toPrecision(10)) : 'n/a');

  /* ---------------- duration parsing ---------------- */
  const MULT = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  function parseDur(str) {
    const mt = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)?$/i.exec(String(str || '').trim());
    if (!mt) return null;
    const u = (mt[2] || 's')[0].toLowerCase();
    return Math.round(Number(mt[1]) * MULT[u]);
  }
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000);
    const parts = [[Math.floor(s / 86400), 'd'], [Math.floor(s / 3600) % 24, 'h'], [Math.floor(s / 60) % 60, 'm'], [s % 60, 's']].filter(([n]) => n);
    return parts.length ? parts.map(([n, u]) => n + u).join(' ') : '0s';
  };

  /* ---------------- timers + reminders ---------------- */
  const MAX_TIMERS = 20;
  const live = new Map();          // `${acct}:${id}` -> Timeout   (reminders)
  const quickTimers = new Map();   // acct -> Set<Timeout>         (timer command)
  const socks = new Map();         // acct -> latest rawSock
  const armedAccts = new Set();
  const list = (acct) => (store.data[acct] ||= []);
  const activeCount = (acct) => list(acct).length + (quickTimers.get(acct)?.size || 0);

  function fire(acct, r, late) {
    live.delete(`${acct}:${r.id}`);
    store.data[acct] = list(acct).filter((x) => x.id !== r.id);
    store.save();
    const sock = socks.get(acct);
    if (!sock) return;
    sock.sendMessage(r.jid, { text: `⏰ *Reminder${late ? ' (was due while the bot was offline)' : ''}*\n${r.text}`, mentions: r.by ? [r.by] : [] })
      .catch((e) => console.error('[reminder] send failed:', e?.message || 'unknown error'));
  }
  function arm(acct, r) {
    const key = `${acct}:${r.id}`;
    clearTimeout(live.get(key));
    const wait = Math.max(0, r.at - Date.now());
    const t = setTimeout(() => fire(acct, r, wait === 0 && Date.now() - r.at > 5000), Math.min(wait, 2 ** 31 - 1));
    t.unref?.();
    live.set(key, t);
  }
  // re-arm saved reminders the first time an account is seen after a restart
  H.hooks.message.push(async (hctx) => {
    socks.set(hctx.acct, hctx.rawSock);
    if (!armedAccts.has(hctx.acct)) {
      armedAccts.add(hctx.acct);
      for (const r of list(hctx.acct)) if (!live.has(`${hctx.acct}:${r.id}`)) arm(hctx.acct, r);
    }
    return false;
  });

  const defs = {
    /* ---------- weather ---------- */
    weather: {
      cat: 'utilities', usage: 'weather <city>', desc: 'current weather + 3-day forecast', cooldown: 4,
      run: async (ctx) => {
        if (!ctx.text) return ctx.reply(usage('weather Nairobi'));
        try {
          const geo = await http.getJson('https://geocoding-api.open-meteo.com/v1/search', { params: { name: ctx.text, count: 1, language: 'en' } });
          const p = geo?.results?.[0];
          if (!p) return ctx.reply(`⚠️ I couldn't find a place called "${clip(ctx.text, 60)}".`);
          const w = await http.getJson('https://api.open-meteo.com/v1/forecast', { params: {
            latitude: p.latitude, longitude: p.longitude, timezone: 'auto', forecast_days: 3,
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' } });
          const c = w.current;
          const code = (x) => ({ 0: 'Clear ☀️', 1: 'Mostly clear 🌤', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫', 48: 'Fog 🌫', 51: 'Drizzle 🌦', 53: 'Drizzle 🌦', 55: 'Drizzle 🌦', 61: 'Rain 🌧', 63: 'Rain 🌧', 65: 'Heavy rain 🌧', 71: 'Snow 🌨', 73: 'Snow 🌨', 75: 'Heavy snow ❄️', 80: 'Showers 🌦', 81: 'Showers 🌦', 82: 'Violent showers ⛈', 95: 'Thunderstorm ⛈', 96: 'Thunderstorm ⛈', 99: 'Thunderstorm ⛈' }[x] || '—');
          const days = (w.daily?.time || []).map((d, i) => `${d}: ${code(w.daily.weather_code[i])} ${w.daily.temperature_2m_min[i]}–${w.daily.temperature_2m_max[i]}°C · rain ${w.daily.precipitation_probability_max[i] ?? '?'}%`);
          return ctx.reply(`🌍 *${p.name}${p.admin1 ? ', ' + p.admin1 : ''}, ${p.country || ''}*\n${code(c.weather_code)}\n🌡 ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)\n💧 Humidity ${c.relative_humidity_2m}%\n💨 Wind ${c.wind_speed_10m} km/h\n\n*Next days*\n${days.join('\n')}`);
        } catch (e) { return fail(ctx, 'weather', e, 'Could not get the weather right now.'); }
      }
    },

    /* ---------- translate ---------- */
    translate: {
      cat: 'utilities', aliases: ['tr'], usage: 'translate <lang> <text>', desc: 'translate text (or a replied message)', cooldown: 4,
      run: async (ctx) => {
        const def = String(H.settings.get(ctx.acct).language || 'en').toLowerCase();
        let lang = def; let text = ctx.text;
        const first = ctx.args[0] || '';
        if (/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(first) && (ctx.args.length > 1 || quotedText(ctx))) { lang = first.toLowerCase(); text = ctx.text.slice(first.length).trim(); }
        if (!text) text = quotedText(ctx);
        if (!text) return ctx.reply(`${usage('translate sw Good morning')}\nOr reply to a message with ${ctx.prefix}translate <lang>.\nDefault language: ${def}`);
        if (text.length > 450) return ctx.reply('⚠️ Please keep the text under 450 characters.');
        try {
          const r = await http.getJson('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `autodetect|${lang}` } });
          let out = r?.responseData?.translatedText;
          if (!out || r.responseStatus === 403 || /INVALID|PLEASE SELECT/i.test(String(out))) {
            const r2 = await http.getJson('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `en|${lang}` } });
            out = r2?.responseData?.translatedText;
          }
          if (!out || /INVALID|PLEASE SELECT/i.test(String(out))) return ctx.reply(`⚠️ Could not translate that. Check the language code (like en, sw, fr, es, ar).`);
          return ctx.reply(`🌐 *Translation → ${lang}*\n${out}`);
        } catch (e) { return fail(ctx, 'translate', e, 'The translation service is not answering right now.'); }
      }
    },

    /* ---------- currency ---------- */
    currency: {
      cat: 'utilities', aliases: ['convert'], usage: 'currency <amount> <from> <to>', desc: 'e.g. currency 100 usd kes', cooldown: 4,
      run: async (ctx) => {
        const [a, f, t] = ctx.args;
        const amount = Number(String(a || '').replace(/,/g, ''));
        if (!a || !f || !t || !Number.isFinite(amount) || amount < 0) return ctx.reply(usage('currency 100 usd kes'));
        const from = f.toUpperCase(); const to = t.toUpperCase();
        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return ctx.reply('⚠️ Use 3-letter currency codes, like USD, KES, EUR.');
        try {
          const r = await http.getJson(`https://open.er-api.com/v6/latest/${from}`);
          const rate = r?.rates?.[to];
          if (r?.result !== 'success' || !rate) return ctx.reply(`⚠️ I don't know the currency ${rate === undefined && r?.rates ? to : from}.`);
          return ctx.reply(`💱 *${amount.toLocaleString('en-US')} ${from}* = *${(amount * rate).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${to}*\nRate: 1 ${from} = ${rate} ${to}`);
        } catch (e) { return fail(ctx, 'currency', e, 'Could not get exchange rates right now.'); }
      }
    },

    /* ---------- date ---------- */
    date: {
      cat: 'utilities', usage: 'date [timezone]', desc: 'today\'s date, e.g. date Africa/Lagos',
      run: async (ctx) => {
        const tz = ctx.args[0] || config.TIMEZONE || 'UTC';
        try {
          const d = new Date();
          const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
          const start = Date.UTC(d.getUTCFullYear(), 0, 0);
          const day = Math.floor((d - start) / 86400000);
          return ctx.reply(`📅 *${f}*\n🌍 ${tz}\n📆 Day ${day} of the year`);
        } catch { return ctx.reply(`⚠️ Unknown timezone "${clip(tz, 40)}". Example: ${ctx.prefix}date Africa/Lagos`); }
      }
    },

    /* ---------- shorturl ---------- */
    shorturl: {
      cat: 'utilities', aliases: ['short', 'tinyurl'], usage: 'shorturl <link>', desc: 'shorten a link', cooldown: 4,
      run: async (ctx) => {
        const link = ctx.args[0] || quotedText(ctx).split(/\s+/).find((x) => /^https?:\/\//i.test(x));
        if (!link) return ctx.reply(usage('shorturl https://example.com/very/long/link'));
        try { await http.safeUrl(link); } catch (e) { return ctx.reply(`⚠️ ${e.message}`); }
        try {
          let out = '';
          try { out = String(await http.getText('https://tinyurl.com/api-create.php', { params: { url: link } })).trim(); } catch {}
          if (!/^https?:\/\//.test(out)) {
            const r = await http.getJson('https://is.gd/create.php', { params: { format: 'json', url: link } });
            out = r?.shorturl || '';
          }
          if (!/^https?:\/\//.test(out)) return ctx.reply('⚠️ The link shortener refused that link.');
          return ctx.reply(`🔗 *Short link*\n${out}`);
        } catch (e) { return fail(ctx, 'shorturl', e, 'Could not shorten that link right now.'); }
      }
    },

    /* ---------- qr ---------- */
    qr: {
      cat: 'utilities', usage: 'qr <text or link>', desc: 'make a QR code', cooldown: 4,
      run: async (ctx) => {
        const text = ctx.text || quotedText(ctx);
        if (!text) return ctx.reply(usage('qr https://example.com'));
        if (text.length > 900) return ctx.reply('⚠️ That is too long for a QR code (max 900 characters).');
        try {
          const { buffer } = await http.getBuffer('https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=' + encodeURIComponent(text), { maxBytes: 5 * 1024 * 1024, timeout: 30000 });
          return ctx.sock.sendMessage(ctx.jid, { image: buffer, caption: `✅ QR code\n> ${H.footer()}` }, { quoted: ctx.m });
        } catch (e) { return fail(ctx, 'qr', e, 'Could not make the QR code right now.'); }
      }
    },

    /* ---------- readqr ---------- */
    readqr: {
      cat: 'utilities', aliases: ['scanqr'], usage: 'readqr (reply to a QR image)', desc: 'read a QR code from an image', cooldown: 5,
      run: async (ctx) => {
        let media;
        try { media = await H.media.getMedia(ctx, ['image']); } catch (e) { return fail(ctx, 'readqr', e, 'Could not download that image.'); }
        if (!media) return ctx.reply(`Reply to (or send with the caption) a QR image: ${ctx.prefix}readqr`);
        if (media.buffer.length > 4 * 1024 * 1024) return ctx.reply('⚠️ That image is too large (max 4 MB).');
        try {
          const form = new FormData();
          form.append('file', new Blob([media.buffer], { type: media.mime || 'image/jpeg' }), 'qr.jpg');
          const axios = require('axios');
          const res = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, { timeout: 30000, headers: { 'User-Agent': http.UA } });
          const sym = res.data?.[0]?.symbol?.[0];
          if (!sym || sym.error || !sym.data) return ctx.reply('⚠️ No readable QR code found in that image.');
          return ctx.reply(`📷 *QR content*\n${clip(sym.data, 1500)}`);
        } catch (e) { return fail(ctx, 'readqr', e, 'Could not read that QR code right now.'); }
      }
    },

    /* ---------- password ---------- */
    password: {
      cat: 'utilities', aliases: ['pass', 'genpass'], usage: 'password [length 8-64]', desc: 'strong random password', cooldown: 3,
      run: async (ctx) => {
        const n = ctx.args[0] === undefined ? 16 : Number(ctx.args[0]);
        if (!Number.isInteger(n) || n < 8 || n > 64) return ctx.reply(`${usage('password 20')}\nLength must be a whole number from 8 to 64.`);
        const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*()-_=+?'];
        const all = sets.join('');
        const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
        while (chars.length < n) chars.push(all[crypto.randomInt(all.length)]);
        for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
        return ctx.reply(`🔐 *Generated password*\n\`\`\`${chars.join('')}\`\`\`\n⚠️ Everyone in this chat can see this message${ctx.isGroup ? ' — generate it in a private chat instead' : ''}. Delete it after copying.`);
      }
    },

    /* ---------- define ---------- */
    define: {
      cat: 'utilities', aliases: ['dictionary', 'meaning'], usage: 'define <word>', desc: 'dictionary definition', cooldown: 3,
      run: async (ctx) => {
        const w = ctx.args[0];
        if (!w) return ctx.reply(usage('define serendipity'));
        if (ctx.args.length > 1 || !/^[\p{L}'-]{1,40}$/u.test(w)) return ctx.reply('⚠️ Please give a single word.');
        try {
          const r = await http.getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`);
          const e = Array.isArray(r) ? r[0] : null;
          if (!e) return ctx.reply(`⚠️ No definition found for "${w}".`);
          const lines = e.meanings.slice(0, 3).map((m) => {
            const d = m.definitions[0];
            return `*${m.partOfSpeech}* — ${d.definition}${d.example ? `\n   _"${d.example}"_` : ''}`;
          });
          return ctx.reply(`📖 *${e.word}* ${e.phonetic || ''}\n\n${lines.join('\n\n')}`);
        } catch (e) {
          if (e?.response?.status === 404) return ctx.reply(`⚠️ No definition found for "${w}".`);
          return fail(ctx, 'define', e, 'The dictionary is not answering right now.');
        }
      }
    },

    /* ---------- wiki ---------- */
    wiki: {
      cat: 'utilities', aliases: ['wikipedia'], usage: 'wiki <topic>', desc: 'Wikipedia summary', cooldown: 4,
      run: async (ctx) => {
        if (!ctx.text) return ctx.reply(usage('wiki Mount Kilimanjaro'));
        try {
          const title = encodeURIComponent(ctx.text.trim().replace(/\s+/g, '_'));
          let r;
          try { r = await http.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, { params: { redirect: true } }); }
          catch (e) {
            if (e?.response?.status !== 404) throw e;
            const s = await http.getJson('https://en.wikipedia.org/w/api.php', { params: { action: 'opensearch', search: ctx.text, limit: 1, format: 'json' } });
            const t = s?.[1]?.[0];
            if (!t) return ctx.reply(`⚠️ Nothing found on Wikipedia for "${clip(ctx.text, 60)}".`);
            r = await http.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/\s+/g, '_'))}`);
          }
          if (!r?.extract) return ctx.reply(`⚠️ Nothing found on Wikipedia for "${clip(ctx.text, 60)}".`);
          return ctx.reply(`📚 *${r.title}*\n${r.description ? `_${r.description}_\n` : ''}\n${clip(r.extract, 1100)}\n\n${r.content_urls?.desktop?.page || ''}`);
        } catch (e) { return fail(ctx, 'wiki', e, 'Could not reach Wikipedia right now.'); }
      }
    },

    /* ---------- country ---------- */
    country: {
      cat: 'utilities', aliases: ['countryinfo'], usage: 'country <name>', desc: 'facts about a country', cooldown: 4,
      run: async (ctx) => {
        if (!ctx.text) return ctx.reply(usage('country Kenya'));
        try {
          const r = await http.getJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(ctx.text)}`, { params: { fields: 'name,capital,region,subregion,population,area,languages,currencies,flag,idd,tld,timezones' } });
          const c = Array.isArray(r) ? r[0] : null;
          if (!c) return ctx.reply(`⚠️ I couldn't find a country called "${clip(ctx.text, 60)}".`);
          const cur = Object.values(c.currencies || {}).map((x) => `${x.name} (${x.symbol || ''})`).join(', ');
          const phone = c.idd?.root ? c.idd.root + (c.idd.suffixes?.length === 1 ? c.idd.suffixes[0] : '') : '—';
          return ctx.reply(`${c.flag || '🌍'} *${c.name.common}*\n${c.name.official}\n\n🏛 Capital: ${(c.capital || ['—']).join(', ')}\n🌍 Region: ${c.region}${c.subregion ? ' · ' + c.subregion : ''}\n👥 Population: ${Number(c.population).toLocaleString('en-US')}\n📐 Area: ${Number(c.area).toLocaleString('en-US')} km²\n🗣 Languages: ${Object.values(c.languages || {}).join(', ') || '—'}\n💰 Currency: ${cur || '—'}\n📞 Calling code: ${phone}\n🌐 Domain: ${(c.tld || []).join(', ') || '—'}`);
        } catch (e) {
          if (e?.response?.status === 404) return ctx.reply(`⚠️ I couldn't find a country called "${clip(ctx.text, 60)}".`);
          return fail(ctx, 'country', e, 'Could not get country data right now.');
        }
      }
    },

    /* ---------- ipinfo ---------- */
    ipinfo: {
      cat: 'utilities', aliases: ['ip'], usage: 'ipinfo <ip address>', desc: 'where an IP address is', cooldown: 4,
      run: async (ctx) => {
        const ip = ctx.args[0];
        const net = require('net');
        if (!ip) return ctx.reply(usage('ipinfo 8.8.8.8'));
        if (!net.isIP(ip)) return ctx.reply('⚠️ That is not a valid IP address.');
        if (http.isPrivateIp(ip)) return ctx.reply('⚠️ That is a private/local address — nothing public to look up.');
        try {
          const r = await http.getJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
          if (!r?.success) return ctx.reply(`⚠️ No information found for ${ip}.`);
          return ctx.reply(`🌐 *${r.ip}* (${r.type})\n📍 ${[r.city, r.region, r.country].filter(Boolean).join(', ')} ${r.flag?.emoji || ''}\n🏢 ${r.connection?.isp || r.connection?.org || '—'}\n🔢 ASN: ${r.connection?.asn || '—'}\n🕒 Timezone: ${r.timezone?.id || '—'}\n🧭 ${r.latitude}, ${r.longitude}`);
        } catch (e) { return fail(ctx, 'ipinfo', e, 'Could not look up that IP right now.'); }
      }
    },

    /* ---------- unitconvert ---------- */
    unitconvert: {
      cat: 'utilities', aliases: ['unit', 'uconvert'], usage: 'unitconvert <value> <from> <to>', desc: 'e.g. unitconvert 10 km mi',
      run: async (ctx) => {
        const [v, f, t] = ctx.args;
        const value = Number(v);
        if (!v || !f || !t || !Number.isFinite(value)) {
          return ctx.reply(`${usage('unitconvert 10 km mi')}\n\n*Units*\n📏 m km cm mm mi yd ft in\n⚖️ kg g mg lb oz t\n🧪 l ml gal qt pt cup floz tbsp tsp\n🚗 m/s km/h mph kn\n💾 b kb mb gb tb pb\n🌡 c f k`);
        }
        const from = f.toLowerCase(); const to = t.toLowerCase();
        const out = convertUnit(value, from, to);
        if (out === null) return ctx.reply('⚠️ I can\'t convert between those units (they must be the same kind, e.g. km → mi). Send the command with no arguments to see the unit list.');
        return ctx.reply(`🔄 *${num(value)} ${f}* = *${num(out)} ${t}*`);
      }
    },

    /* ---------- count ---------- */
    count: {
      cat: 'utilities', aliases: ['wordcount'], usage: 'count <text> (or reply to a message)', desc: 'words, characters, lines',
      run: async (ctx) => {
        const text = ctx.text || quotedText(ctx);
        if (!text) return ctx.reply(usage('count some text here'));
        const words = text.split(/\s+/).filter(Boolean).length;
        const lines = text.split(/\r?\n/).length;
        const noSpace = text.replace(/\s/g, '').length;
        return ctx.reply(`🔢 *Count*\n📝 Words: ${words}\n🔤 Characters: ${[...text].length}\n🔡 Without spaces: ${noSpace}\n📄 Lines: ${lines}\n⏱ Reading time: ~${Math.max(1, Math.round(words / 200))} min`);
      }
    },

    /* ---------- poll ---------- */
    poll: {
      cat: 'utilities', alsoIn: ['group'], usage: 'poll <question> | <option1> | <option2> ...', desc: 'start a WhatsApp poll (2-12 options)', cooldown: 5,
      run: async (ctx) => {
        const parts = ctx.text.split('|').map((x) => x.trim()).filter(Boolean);
        if (parts.length < 3) return ctx.reply(`${usage('poll Best day? | Friday | Saturday | Sunday')}\nA question and at least 2 options, separated by |.`);
        const [name, ...values] = parts;
        if (values.length > 12) return ctx.reply('⚠️ A poll can have at most 12 options.');
        if (name.length > 250 || values.some((v) => v.length > 100)) return ctx.reply('⚠️ The question or an option is too long.');
        if (new Set(values.map((v) => v.toLowerCase())).size !== values.length) return ctx.reply('⚠️ Every option must be different.');
        try {
          await ctx.sock.sendMessage(ctx.jid, { poll: { name, values, selectableCount: 1 } }, { quoted: ctx.m });
        } catch (e) { return fail(ctx, 'poll', e, 'Could not create the poll.'); }
      }
    },

    /* ---------- reminder ---------- */
    reminder: {
      cat: 'utilities', aliases: ['remind', 'remindme'], usage: 'reminder <10m|2h|1d> <text>', desc: 'remind me later (also: reminder list / cancel <n>)', cooldown: 3,
      run: async (ctx) => {
        const acct = ctx.acct;
        const sub = (ctx.args[0] || '').toLowerCase();
        const mine = list(acct).filter((r) => r.by === ctx.sender || ctx.rank >= 1);
        if (sub === 'list') {
          const rows = mine.sort((a, b) => a.at - b.at).slice(0, 20).map((r, i) => `${i + 1}. in ${fmtDur(r.at - Date.now())} — ${clip(r.text, 60)}`);
          return ctx.reply(rows.length ? `⏰ *Your reminders*\n${rows.join('\n')}\n\nCancel with ${ctx.prefix}reminder cancel <number>` : 'You have no reminders.');
        }
        if (sub === 'cancel' || sub === 'delete') {
          const sorted = mine.sort((a, b) => a.at - b.at);
          const r = sorted[Number(ctx.args[1]) - 1];
          if (!r) return ctx.reply(`⚠️ Give the number from ${ctx.prefix}reminder list.`);
          clearTimeout(live.get(`${acct}:${r.id}`)); live.delete(`${acct}:${r.id}`);
          store.data[acct] = list(acct).filter((x) => x.id !== r.id); store.save();
          return ctx.reply('🗑 Reminder cancelled.');
        }
        const ms = parseDur(ctx.args[0]);
        const text = ctx.args.slice(1).join(' ').trim() || quotedText(ctx);
        if (ms === null || !text) return ctx.reply(`${usage('reminder 30m call mum')}\nUnits: s, m, h, d (max 7d).`);
        if (ms < 5000) return ctx.reply('⚠️ The shortest reminder is 5 seconds.');
        if (ms > 7 * 86400000) return ctx.reply('⚠️ The longest reminder is 7 days.');
        if (activeCount(acct) >= MAX_TIMERS) return ctx.reply(`⚠️ This bot already has ${MAX_TIMERS} active reminders/timers. Wait for one to finish or cancel one.`);
        const r = { id: crypto.randomBytes(5).toString('hex'), jid: ctx.jid, at: Date.now() + ms, text: clip(text, 500), by: ctx.sender };
        list(acct).push(r); store.save();
        socks.set(acct, ctx.rawSock); armedAccts.add(acct);
        arm(acct, r);
        return ctx.reply(`⏰ Okay, I'll remind you in *${fmtDur(ms)}*:\n${r.text}`);
      }
    },

    /* ---------- timer ---------- */
    timer: {
      cat: 'utilities', usage: 'timer <90s|5m|1h>', desc: 'countdown timer (max 6h)', cooldown: 3,
      run: async (ctx) => {
        const ms = parseDur(ctx.args[0]);
        if (ms === null) return ctx.reply(usage('timer 5m'));
        if (ms < 1000) return ctx.reply('⚠️ The shortest timer is 1 second.');
        if (ms > 6 * 3600000) return ctx.reply('⚠️ The longest timer is 6 hours.');
        const acct = ctx.acct;
        if (activeCount(acct) >= MAX_TIMERS) return ctx.reply(`⚠️ This bot already has ${MAX_TIMERS} active timers/reminders. Try again shortly.`);
        const set = quotedTimers(acct);
        const label = ctx.args.slice(1).join(' ');
        const jid = ctx.jid; const sock = ctx.rawSock; const by = ctx.sender;
        const t = setTimeout(() => {
          set.delete(t);
          sock.sendMessage(jid, { text: `⏲ *Time's up!* ${label ? '— ' + clip(label, 100) : `(${fmtDur(ms)})`} @${String(by).split('@')[0].split(':')[0]}`, mentions: [by] })
            .catch((e) => console.error('[timer] send failed:', e?.message || 'unknown error'));
        }, ms);
        t.unref?.();
        set.add(t);
        return ctx.reply(`⏲ Timer set for *${fmtDur(ms)}*. I'll tell you when it's done.`);
      }
    }
  };
  function quotedTimers(acct) { if (!quickTimers.has(acct)) quickTimers.set(acct, new Set()); return quickTimers.get(acct); }
  return defs;
};
