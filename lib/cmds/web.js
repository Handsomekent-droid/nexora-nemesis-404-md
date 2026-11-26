/**
 * WEB & FACTS (cat web) — free public services, no API key.
 *   Fun facts : dadjoke chuck kanye numberfact today holidays xkcd bored
 *   Info      : worldtime iss earthquake sunrise zipcode color httpcat
 *   Lookups   : pokemon cocktail book tvshow itunes nationalize agify genderize randomuser
 *   Network   : isup headers dns
 * Every command answers with a clear message when its service is down, and never crashes the bot.
 */
const dns = require('dns').promises;

module.exports = (H) => {
  const { http, usage } = H;
  const P = () => H.P();
  const enc = encodeURIComponent;
  const clip = (s, n = 900) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const out = {};

  // fn(ctx) returns a string, or { text } / { image, caption }
  const def = (name, u, desc, fn, extra = {}) => {
    out[name] = {
      cat: 'web', access: 'public', cooldown: extra.cooldown ?? 5, usage: `${name} ${u}`.trim(), desc, aliases: extra.aliases,
      run: async (ctx) => {
        if (extra.needsText && !ctx.text) return ctx.reply(`${usage(`${name} ${u}`.trim())}${extra.example ? `\nExample: ${P()}${extra.example}` : ''}`);
        try {
          const r = await fn(ctx);
          if (!r) return;
          if (typeof r === 'string') return await ctx.reply(r);
          if (r.image) return await ctx.sock.sendMessage(ctx.jid, { image: { url: r.image }, caption: clip(r.caption || '', 1000) }, { quoted: ctx.m });
          if (r.text) return await ctx.reply(r.text);
        } catch (e) {
          console.error(`[${name}]`, e?.message || 'unknown error');
          await ctx.reply(`❌ ${e?.userMessage || extra.notFound || 'Could not get that right now. Please try again in a moment.'}`);
        }
      }
    };
  };
  const nf = (msg) => Object.assign(new Error(msg), { userMessage: msg });

  /* ---------- fun facts ---------- */
  def('dadjoke', '', 'a random dad joke', async () => { const d = await http.getJson('https://icanhazdadjoke.com/', { headers: { Accept: 'application/json', 'User-Agent': 'NexoraBot' } }); return `😄 ${d.joke}`; });
  def('chuck', '', 'a Chuck Norris joke', async () => `🥋 ${(await http.getJson('https://api.chucknorris.io/jokes/random')).value}`, { aliases: ['chucknorris'] });
  def('kanye', '', 'a Kanye West quote', async () => `🎤 "${(await http.getJson('https://api.kanye.rest/')).quote}" — Kanye`);
  def('numberfact', '[number]', 'a fact about a number', async (c) => { const n = /^\d+$/.test(c.args[0] || '') ? c.args[0] : 'random'; return `🔢 ${await http.getText(`http://numbersapi.com/${n}`)}`; }, { aliases: ['numfact'] });
  def('today', '', 'what happened on this day in history', async () => {
    const t = new Date(); const d = await http.getJson(`https://byabbe.se/on-this-day/${t.getUTCMonth() + 1}/${t.getUTCDate()}/events.json`);
    const ev = (d.events || []).sort(() => Math.random() - 0.5).slice(0, 4);
    if (!ev.length) throw nf('No events found for today.');
    return `📜 *On this day*\n\n${ev.map((e) => `• *${e.year}* — ${clip(e.description, 160)}`).join('\n\n')}`;
  }, { aliases: ['onthisday'] });
  def('holidays', '[country code]', 'public holidays this year', async (c) => {
    const cc = (c.args[0] || 'KE').toUpperCase(); const y = new Date().getUTCFullYear();
    const d = await http.getJson(`https://date.nager.at/api/v3/PublicHolidays/${y}/${enc(cc)}`);
    if (!Array.isArray(d) || !d.length) throw nf('No holidays found. Use a 2-letter country code, e.g. KE, US, GB.');
    return `🎉 *Public holidays ${y} (${cc})*\n\n${d.map((h) => `${h.date}  ${h.localName}`).join('\n')}`;
  }, { notFound: 'Country not found. Use a 2-letter code, e.g. KE, US, GB.' });
  def('xkcd', '[number]', 'an xkcd comic', async (c) => {
    const n = /^\d+$/.test(c.args[0] || '') ? `${c.args[0]}/` : '';
    const d = await http.getJson(`https://xkcd.com/${n}info.0.json`);
    return { image: d.img, caption: `*#${d.num} ${d.title}*\n${d.alt}` };
  });
  const BORED = ['Learn 5 words in a new language', 'Cook a dish you have never tried', 'Go for a 20-minute walk', 'Call a friend you have not spoken to in a while', 'Write down 3 goals for next month', 'Clean and reorganise your phone gallery', 'Learn a card trick', 'Draw something with your non-dominant hand', 'Watch a documentary', 'Start a small workout: 20 pushups, 20 squats', 'Listen to an album you have never heard', 'Write a thank-you message to someone', 'Try a new recipe with only 3 ingredients', 'Plan your dream holiday', 'Learn to juggle with 3 socks'];
  def('bored', '', 'an idea when you are bored', () => `🥱➡️💡 ${H.pick(BORED)}`, { aliases: ['activity'] });

  /* ---------- info ---------- */
  def('worldtime', '<Area/City>', 'time in any city', async (c) => {
    const z = c.text.trim().replace(/\s+/g, '_'); if (!z) throw nf(`Example: ${P()}worldtime Africa/Nairobi`);
    const d = await http.getJson(`https://worldtimeapi.org/api/timezone/${z.split('/').map(enc).join('/')}`);
    return `🕒 *${d.timezone}*\n${d.datetime.slice(0, 10)}  ${d.datetime.slice(11, 19)}\nUTC offset: ${d.utc_offset}\nWeek ${d.week_number} · day ${d.day_of_year}`;
  }, { needsText: true, example: 'worldtime Africa/Nairobi', notFound: 'Timezone not found. Use Area/City like Africa/Nairobi or Europe/London.', aliases: ['tz'] });
  def('iss', '', 'where the space station is now', async () => {
    const d = await http.getJson('http://api.open-notify.org/iss-now.json'); const p = d.iss_position;
    return `🛰 *International Space Station*\nLatitude: ${(+p.latitude).toFixed(3)}\nLongitude: ${(+p.longitude).toFixed(3)}\nhttps://www.google.com/maps?q=${p.latitude},${p.longitude}`;
  });
  def('earthquake', '', 'latest significant earthquakes', async () => {
    const d = await http.getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson');
    const f = (d.features || []).slice(0, 5); if (!f.length) return '🌍 No significant earthquakes this week.';
    return `🌍 *Significant earthquakes (7 days)*\n\n${f.map((x) => `• M${x.properties.mag} — ${x.properties.place}\n  ${new Date(x.properties.time).toUTCString().slice(0, 22)}`).join('\n\n')}`;
  }, { aliases: ['quake'] });
  def('sunrise', '<city>', 'sunrise and sunset times', async (c) => {
    const g = (await http.getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(c.text)}&count=1`))?.results?.[0]; if (!g) throw nf('City not found.');
    const d = (await http.getJson(`https://api.sunrise-sunset.org/json?lat=${g.latitude}&lng=${g.longitude}&formatted=0`)).results;
    const tm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: g.timezone || 'UTC', hour: '2-digit', minute: '2-digit' });
    return `🌅 *${g.name}, ${g.country || ''}*\nSunrise: ${tm(d.sunrise)}\nSunset: ${tm(d.sunset)}\nDay length: ${Math.floor(d.day_length / 3600)}h ${Math.floor(d.day_length / 60) % 60}m`;
  }, { needsText: true, example: 'sunrise Nairobi' });
  def('zipcode', '<country code> <code>', 'place for a postal code', async (c) => {
    const [cc, z] = c.args; if (!cc || !z) throw nf(`Example: ${P()}zipcode us 90210`);
    const d = await http.getJson(`https://api.zippopotam.us/${enc(cc.toLowerCase())}/${enc(z)}`); const p = d.places?.[0];
    if (!p) throw nf('Nothing found for that code.');
    return `📮 *${d['post code']}* — ${d.country}\n${p['place name']}, ${p.state}\n📍 ${p.latitude}, ${p.longitude}`;
  }, { needsText: true, example: 'zipcode us 90210', notFound: 'Postal code not found.', aliases: ['postcode'] });
  def('color', '<hex or name>', 'color info + preview', async (c) => {
    const raw = c.text.trim().replace(/^#/, ''); const hex = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw) ? raw : null;
    const q = hex ? `hex=${hex}` : `named=${enc(raw)}`; const d = await http.getJson(`https://www.thecolorapi.com/id?${q}&format=json`);
    return { image: `https://singlecolorimage.com/get/${d.hex.clean}/400x200`, caption: `🎨 *${d.name.value}*\nHEX: ${d.hex.value}\nRGB: ${d.rgb.value}\nHSL: ${d.hsl.value}\nCMYK: ${d.cmyk.value}` };
  }, { needsText: true, example: 'color #ff5733', notFound: 'Color not found. Try a hex like #ff5733.', aliases: ['colour'] });
  const HTTP = { 100: 'Continue', 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 418: "I'm a teapot", 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
  def('httpcat', '<status code>', 'HTTP status code explained', (c) => {
    const n = parseInt(c.args[0], 10); if (!HTTP[n]) throw nf(`Known codes: ${Object.keys(HTTP).join(', ')}`);
    return { image: `https://http.cat/${n}.jpg`, caption: `🐱 *${n}* — ${HTTP[n]}` };
  }, { needsText: true, example: 'httpcat 404', aliases: ['http'] });

  /* ---------- lookups ---------- */
  def('pokemon', '<name or number>', 'Pokémon stats', async (c) => {
    const d = await http.getJson(`https://pokeapi.co/api/v2/pokemon/${enc(c.text.toLowerCase().trim())}`);
    const st = Object.fromEntries(d.stats.map((s) => [s.stat.name, s.base_stat]));
    return { image: d.sprites?.other?.['official-artwork']?.front_default || d.sprites?.front_default, caption: `⚡ *${d.name.toUpperCase()}* #${d.id}\nType: ${d.types.map((t) => t.type.name).join(' / ')}\nHeight: ${d.height / 10}m  Weight: ${d.weight / 10}kg\n\nHP ${st.hp} · ATK ${st.attack} · DEF ${st.defense}\nSP.ATK ${st['special-attack']} · SP.DEF ${st['special-defense']} · SPD ${st.speed}\nAbilities: ${d.abilities.map((a) => a.ability.name).join(', ')}` };
  }, { needsText: true, example: 'pokemon pikachu', notFound: 'Pokémon not found.', aliases: ['poke'] });
  def('cocktail', '<name>', 'cocktail recipe', async (c) => {
    const d = (await http.getJson(`https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${enc(c.text)}`))?.drinks?.[0]; if (!d) throw nf('Cocktail not found.');
    const ing = []; for (let i = 1; i <= 15; i++) if (d[`strIngredient${i}`]) ing.push(`• ${d[`strMeasure${i}`] || ''}${d[`strIngredient${i}`]}`);
    return { image: d.strDrinkThumb, caption: `🍹 *${d.strDrink}* (${d.strCategory})\n\n${ing.join('\n')}\n\n${clip(d.strInstructions, 500)}` };
  }, { needsText: true, example: 'cocktail mojito', aliases: ['drink'] });
  def('book', '<title or author>', 'search for a book', async (c) => {
    const d = (await http.getJson(`https://openlibrary.org/search.json?q=${enc(c.text)}&limit=4`))?.docs || []; if (!d.length) throw nf('No books found.');
    return `📚 *Books for "${clip(c.text, 40)}"*\n\n${d.map((b) => `• *${b.title}*${b.author_name ? ' — ' + b.author_name[0] : ''}${b.first_publish_year ? ` (${b.first_publish_year})` : ''}`).join('\n')}`;
  }, { needsText: true, example: 'book atomic habits', aliases: ['books'] });
  def('tvshow', '<name>', 'TV show info', async (c) => {
    const d = await http.getJson(`https://api.tvmaze.com/singlesearch/shows?q=${enc(c.text)}`);
    return { image: d.image?.original, caption: `📺 *${d.name}* (${(d.premiered || '').slice(0, 4)})\n⭐ ${d.rating?.average ?? '—'}  •  ${(d.genres || []).join(', ')}\nStatus: ${d.status}  •  ${d.network?.name || d.webChannel?.name || ''}\n\n${clip((d.summary || '').replace(/<[^>]+>/g, ''), 500)}` };
  }, { needsText: true, example: 'tvshow breaking bad', notFound: 'Show not found.', aliases: ['series'] });
  def('itunes', '<song or artist>', 'search songs on iTunes', async (c) => {
    const d = (await http.getJson(`https://itunes.apple.com/search?term=${enc(c.text)}&entity=song&limit=5`))?.results || []; if (!d.length) throw nf('Nothing found.');
    return `🎵 *iTunes results*\n\n${d.map((t) => `• *${t.trackName}* — ${t.artistName}\n  ${t.collectionName || ''}`).join('\n\n')}`;
  }, { needsText: true, example: 'itunes alan walker' });
  def('nationalize', '<first name>', 'guess nationality from a name', async (c) => {
    const d = await http.getJson(`https://api.nationalize.io/?name=${enc(c.args[0])}`); if (!d.country?.length) throw nf('No data for that name.');
    return `🌍 *${d.name}*\n${d.country.slice(0, 4).map((x) => `${x.country_id}: ${(x.probability * 100).toFixed(1)}%`).join('\n')}\n_Just a statistical guess for fun._`;
  }, { needsText: true, example: 'nationalize Wanjiku' });
  def('agify', '<first name>', 'guess age from a name', async (c) => { const d = await http.getJson(`https://api.agify.io/?name=${enc(c.args[0])}`); if (!d.age) throw nf('No data for that name.'); return `🎂 People named *${d.name}* are on average *${d.age}* years old.\n_Just a statistical guess for fun._`; }, { needsText: true, example: 'agify Brian' });
  def('genderize', '<first name>', 'guess gender from a name', async (c) => { const d = await http.getJson(`https://api.genderize.io/?name=${enc(c.args[0])}`); if (!d.gender) throw nf('No data for that name.'); return `👤 *${d.name}* → ${d.gender} (${(d.probability * 100).toFixed(0)}% of ${d.count} records)\n_Just a statistical guess for fun._`; }, { needsText: true, example: 'genderize Alex' });
  def('randomuser', '', 'a fake random profile', async () => {
    const u = (await http.getJson('https://randomuser.me/api/?nat=gb,us,fr,es'))?.results?.[0];
    return { image: u.picture?.large, caption: `🧑 *${u.name.first} ${u.name.last}*\n${u.gender} · ${u.dob.age} years\n📍 ${u.location.city}, ${u.location.country}\n✉️ ${u.email}\n_Fake profile for testing/fun._` };
  }, { aliases: ['fakeuser'] });

  /* ---------- network ---------- */
  const siteOf = async (raw) => http.safeUrl(/^https?:\/\//i.test(raw) ? raw.trim() : `https://${raw.trim()}`);
  def('isup', '<website>', 'is a website up?', async (c) => {
    const url = await siteOf(c.text); const t = Date.now();
    try { const r = await require('axios').get(url, { timeout: 15000, validateStatus: () => true, maxRedirects: 3, headers: { 'User-Agent': 'Mozilla/5.0' } }); return `${r.status < 500 ? '✅ UP' : '⚠️ ERROR'} — ${url}\nStatus: ${r.status}\nResponse: ${Date.now() - t}ms`; }
    catch { return `❌ DOWN or unreachable — ${url}`; }
  }, { needsText: true, example: 'isup google.com', cooldown: 8, aliases: ['down'] });
  def('headers', '<website>', 'HTTP response headers', async (c) => {
    const url = await siteOf(c.text); const r = await require('axios').head(url, { timeout: 15000, validateStatus: () => true, maxRedirects: 3, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const keep = ['server', 'content-type', 'content-length', 'cache-control', 'date', 'x-powered-by', 'strict-transport-security', 'location'];
    return `🔎 *${url}* → ${r.status}\n\n${keep.filter((k) => r.headers[k]).map((k) => `${k}: ${clip(r.headers[k], 80)}`).join('\n')}`;
  }, { needsText: true, example: 'headers github.com', cooldown: 8 });
  def('dns', '<domain>', 'DNS records of a domain', async (c) => {
    const d = c.args[0].toLowerCase().replace(/^https?:\/\//, '').split('/')[0]; if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw nf('Send a domain like example.com');
    const [a, mx, ns] = await Promise.all([dns.resolve4(d).catch(() => []), dns.resolveMx(d).catch(() => []), dns.resolveNs(d).catch(() => [])]);
    if (!a.length && !mx.length && !ns.length) throw nf('No DNS records found.');
    return `🌐 *${d}*\n\nA: ${a.join(', ') || '—'}\nMX: ${mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange).join(', ') || '—'}\nNS: ${ns.join(', ') || '—'}`;
  }, { needsText: true, example: 'dns google.com', aliases: ['nslookup'] });

  return out;
};
