/**
 * All-in-one downloader (prexzyapis.com) — one endpoint for TikTok, Instagram, Facebook, X/Twitter,
 * Pinterest, Threads, etc. Call: GET https://prexzyapis.com/download/aio?url=<link>
 *
 * The exact JSON the API returns could not be tested when this was written (no outbound access),
 * so instead of trusting one field name this walks the whole response, collects every media link
 * it finds (with the key/type/quality next to it) and picks sensibly: video first, else audio,
 * else pictures. If the API ever returns something it can't read, the first 600 chars of the
 * response go to the console as "[aio] unreadable response" so the one parser here can be adjusted.
 */
const axios = require('axios');

const API = process.env.AIO_API || 'https://prexzyapis.com/download/aio';
const KEY = process.env.AIO_KEY || ''; // only if the API ever asks for a key: appended as ?apikey=
const MAX_BYTES = 90 * 1024 * 1024;    // WhatsApp won't take much more than this anyway

const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
const extOf = (u) => (String(u).split('?')[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1]?.toLowerCase() || '';

function classify(url, hints) {
  const h = `${hints} ${extOf(url)}`.toLowerCase();
  if (/(mp3|m4a|opus|audio|music|sound)/.test(h)) return 'audio';
  if (/(mp4|webm|mov|video|hd|sd|nowm|nowatermark|play)/.test(h)) return 'video';
  if (/(jpe?g|png|webp|image|photo|thumb|cover|picture)/.test(h)) return /thumb|cover/.test(h) ? 'thumb' : 'image';
  return 'unknown';
}

// Depth-first: every string URL, remembering the key path and sibling type/quality fields.
function collect(node, path, siblingHint, out, depth = 0) {
  if (depth > 6 || node == null) return;
  if (isUrl(node)) { out.push({ url: node, kind: classify(node, `${path} ${siblingHint}`), hint: `${path} ${siblingHint}` }); return; }
  if (Array.isArray(node)) { node.slice(0, 40).forEach((x) => collect(x, path, siblingHint, out, depth + 1)); return; }
  if (typeof node === 'object') {
    const hint = ['type', 'quality', 'extension', 'ext', 'format', 'label', 'mime', 'resolution']
      .map((k) => (typeof node[k] === 'string' ? node[k] : '')).join(' ');
    for (const [k, v] of Object.entries(node)) collect(v, `${path}.${k}`, hint, out, depth + 1);
  }
}

const firstString = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return null; };

// Turns any aio-style JSON response into { title, video[], audio[], images[] }.
function parseAio(data) {
  const found = [];
  collect(data?.result ?? data?.data ?? data, '', '', found);
  const seen = new Set();
  const items = found.filter((x) => !seen.has(x.url) && seen.add(x.url));

  const video = items.filter((x) => x.kind === 'video');
  const audio = items.filter((x) => x.kind === 'audio');
  const images = items.filter((x) => x.kind === 'image');
  // an "unknown" link is most often the one real download link — treat it as video if nothing better exists
  const unknown = items.filter((x) => x.kind === 'unknown');

  const root = data?.result ?? data?.data ?? data ?? {};
  const meta = Array.isArray(root) ? root[0] : root;
  const title = firstString(meta, ['title', 'caption', 'description', 'desc', 'text']) || null;

  if (!video.length && !audio.length && !images.length && !unknown.length) {
    console.error('[aio] unreadable response:', JSON.stringify(data).slice(0, 600));
    throw new Error(data?.message || data?.error || 'No downloadable media found for that link (is it public?).');
  }
  return { title: title && title.length > 200 ? title.slice(0, 197) + '…' : title, video: video.length ? video : unknown, audio, images };
}

// provider = { api, params } ; the media link goes in as `url`
async function fetchFrom(provider, link) {
  let data;
  try {
    ({ data } = await axios.get(provider.api, { params: { ...provider.params, url: link }, timeout: 90000 }));
  } catch (e) {
    const code = e?.response?.status;
    throw new Error(code ? `The download service answered ${code}. Try again in a moment.` : 'Could not reach the download service. Try again in a moment.');
  }
  if (data && data.status === false && (data.error || data.message)) throw new Error(String(data.error || data.message));
  return parseAio(data);
}

// The all-in-one provider used for TikTok / Instagram / Facebook / X / Pinterest / Threads
async function fetchAio(link) {
  return fetchFrom({ api: API, params: KEY ? { apikey: KEY } : {} }, link);
}

async function getBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES });
  return Buffer.from(res.data);
}

// Fetches and sends whatever the link holds: a video, else photos (up to 10), else audio.
async function downloadAndSend({ link, sock, jid, m, caption }) {
  const r = await fetchAio(link);
  const cap = `${r.title ? `*${r.title}*\n\n` : ''}${caption || ''}`.trim();
  if (r.video.length) {
    let lastErr;
    for (const v of r.video.slice(0, 3)) { // if one mirror fails, try the next
      try { return { type: 'video', msg: await sock.sendMessage(jid, { video: await getBuffer(v.url), caption: cap }, { quoted: m }) }; }
      catch (e) { lastErr = e; }
    }
    throw new Error(`Could not fetch the video (${lastErr?.message || 'failed'}). It may be too large or private.`);
  }
  if (r.images.length) {
    let n = 0;
    for (const im of r.images.slice(0, 10)) {
      try { await sock.sendMessage(jid, { image: await getBuffer(im.url), caption: n === 0 ? cap : '' }, { quoted: m }); n++; } catch {}
    }
    if (n) return { type: 'image', count: n };
  }
  if (r.audio.length) {
    return { type: 'audio', msg: await sock.sendMessage(jid, { audio: await getBuffer(r.audio[0].url), mimetype: 'audio/mpeg' }, { quoted: m }) };
  }
  throw new Error('Found the post but no media could be downloaded.');
}

module.exports = { fetchAio, fetchFrom, parseAio, downloadAndSend, getBuffer };
