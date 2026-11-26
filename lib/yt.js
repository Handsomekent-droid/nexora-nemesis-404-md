/**
 * YouTube audio / video for .play .song .video .ytmp3 .ytmp4.
 * Providers are tried in order until one gives a file that really plays:
 *   1. Casper YTM  (ytm.xcasper.space — no key; streams the mp3/mp4 by video id)
 *   2. AlwaysRizz aio  (needs RIZZ_KEY + RIZZ_USER in .env)
 *   3. eliteprotech-apis (the older one)
 *   4. prexzyapis aio
 * Every download is inspected before it is returned: web pages / JSON / playlists are rejected, and audio or
 * video that WhatsApp can't play (webm, opus, AV1/VP9 ...) is converted with ffmpeg when it is available.
 * Returns { buffer, mime }. Throws a plain, user-safe Error if every provider fails.
 */
const axios = require('axios');
const config = require('../config');
const dl = require('./dl');
const media = require('./media');

const fs = require('fs');
const os = require('os');
const path = require('path');
const MAX_FILE_MB = Math.max(20, Number(process.env.MAX_FILE_MB) || 700);   // biggest file we will fetch (YouTube video / audio)
const MAX_BYTES = MAX_FILE_MB * 1024 * 1024;
const MEM_LIMIT = 50 * 1024 * 1024;   // up to this size a file is handled in memory, bigger ones are streamed through the disk
const CASPER = (process.env.CASPER_API || 'https://ytm.xcasper.space').replace(/\/$/, '');
const YT_ID = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/;
const OLD = { mp3: process.env.YTMP3_API || 'https://eliteprotech-apis.zone.id/download/ytmp3?url=', mp4: process.env.YTMP4_API || 'https://eliteprotech-apis.zone.id/download/ytmp4?url=' };

if (!config.RIZZ_KEY) console.warn('[yt] RIZZ_KEY is not set — YouTube downloads fall back to the older providers. Add RIZZ_KEY and RIZZ_USER to .env.');
if (!media.hasFfmpeg()) console.warn('[yt] ffmpeg not found — files in formats WhatsApp cannot play will be skipped instead of converted.');

// Download to a temp file (so a movie never has to sit in RAM). Returns { buf } for small files or { file, size } for big ones.
async function get(url) {
  const file = path.join(os.tmpdir(), `nx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`);
  try {
    const res = await axios.get(url, { responseType: 'stream', timeout: 60000, maxRedirects: 5, validateStatus: (st) => st >= 200 && st < 300 });
    const declared = Number(res.headers['content-length']) || 0;
    if (declared > MAX_BYTES) { res.data.destroy(); throw new Error(`file is ${Math.round(declared / 1048576)} MB, the limit is ${MAX_FILE_MB} MB`); }
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const idle = () => setTimeout(() => { res.data.destroy(new Error('download stalled')); }, 90000); // no data for 90s
      let t = idle();
      res.data.on('data', (c) => { size += c.length; clearTimeout(t); t = idle(); if (size > MAX_BYTES) res.data.destroy(new Error(`file is bigger than ${MAX_FILE_MB} MB`)); });
      res.data.on('error', (e) => { clearTimeout(t); out.destroy(); reject(e); });
      out.on('error', reject);
      out.on('finish', () => { clearTimeout(t); resolve(); });
      res.data.pipe(out);
    });
    if (size <= MEM_LIMIT) { const buf = fs.readFileSync(file); fs.unlink(file, () => {}); return { buf }; }
    return { file, size };
  } catch (e) { fs.unlink(file, () => {}); throw e; }
}
const headOf = (file, n = 4096) => { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { fs.closeSync(fd); } };
const sliceOf = (file, size, pos, n) => { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(Math.min(n, size - pos)); fs.readSync(fd, b, 0, b.length, pos); return b; } finally { fs.closeSync(fd); } };

// what is this file really?
function sniff(b) {
  if (!b || b.length < 2048) return 'tiny';
  const s4 = b.toString('latin1', 4, 8);
  if (s4 === 'ftyp') return 'mp4';
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (b.toString('latin1', 0, 4) === 'RIFF') return 'wav';
  const t = b.toString('utf8', 0, 60).trimStart().toLowerCase();
  if (t.startsWith('<') || t.startsWith('{') || t.startsWith('[') || t.startsWith('#extm3u')) return 'text';
  return 'unknown';
}
const has = (b, tag) => b.includes(tag, 0, 'latin1');
const EXT = { mp4: 'mp4', webm: 'webm', ogg: 'ogg', wav: 'wav', mp3: 'mp3', unknown: 'bin' };

// make sure the bytes are something WhatsApp will play; convert when needed
async function fix(kind, got, link) {
  if (got.file) return fixBig(kind, got);
  const buf = got.buf;
  const type = sniff(buf);
  if (type === 'tiny' || type === 'text') throw new Error(`not a media file (${type}, ${buf?.length || 0} bytes)`);
  if (kind === 'mp3') {
    if (type === 'mp3') return { buffer: buf, mime: 'audio/mpeg' };
    if (type === 'mp4' && !has(buf, 'avc1') && has(buf, 'mp4a')) return { buffer: buf, mime: 'audio/mp4' };
    if (!media.hasFfmpeg()) throw new Error(`${type} audio needs ffmpeg to convert`);
    const out = await media.ffmpeg({ input: buf, inExt: EXT[type] || 'bin', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k'], outExt: 'mp3', timeout: 180000 });
    return { buffer: out, mime: 'audio/mpeg' };
  }
  if (type === 'mp4' && has(buf, 'avc1') && has(buf, 'mp4a')) return { buffer: buf, mime: 'video/mp4' };
  if (!media.hasFfmpeg()) throw new Error(`video is ${type}${type === 'mp4' ? ' without H.264+AAC' : ''} and ffmpeg is missing to convert it`);
  const out = await media.ffmpeg({
    input: buf, inExt: EXT[type] || 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-vf', "scale=-2:'min(720,ih)'", '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
    outExt: 'mp4', timeout: 300000
  });
  return { buffer: out, mime: 'video/mp4' };
}

// big file (movie / long audio): only playable-as-is files are accepted, it is sent straight from disk
function fixBig(kind, got) {
  const { file, size } = got;
  const done = () => fs.unlink(file, () => {});
  try {
    const head = headOf(file); const type = sniff(head.length < 2048 ? Buffer.concat([head, Buffer.alloc(2048)]) : head);
    if (kind === 'mp3') {
      if (type === 'mp3') return { file, size, mime: 'audio/mpeg', cleanup: done };
      if (type === 'mp4') return { file, size, mime: 'audio/mp4', cleanup: done };
      throw new Error(`large ${type} audio cannot be converted`);
    }
    if (type !== 'mp4') throw new Error(`large video is ${type}, not mp4`);
    const probe = Buffer.concat([sliceOf(file, size, 0, 6 * 1048576), sliceOf(file, size, Math.max(0, size - 6 * 1048576), 6 * 1048576)]);
    if (!(has(probe, 'avc1') && has(probe, 'mp4a'))) throw new Error('large mp4 is not H.264+AAC (WhatsApp may not play it)');
    return { file, size, mime: 'video/mp4', cleanup: done };
  } catch (e) { done(); throw e; }
}

// WhatsApp message content for a result: big files are streamed from disk, small ones sent from memory
function payload(field, r) { return { [field]: r.file ? { url: r.file } : r.buffer }; }
// call after the message was sent (or failed) to remove the temp file
const release = (r) => { try { r?.cleanup?.(); } catch {} };

// try each candidate link until one gives a playable file
async function firstGood(kind, links) {
  let last;
  for (const link of links.slice(0, 4)) {
    try { return await fix(kind, await get(link), link); }
    catch (e) { last = e; console.error(`[yt] rejected ${String(link).slice(0, 90)} — ${e?.message || e}`); }
  }
  throw last || new Error('no media link');
}

// prefer a mid quality (small enough for WhatsApp) over 1080p+ when several are offered
const rank = (x) => { const h = x.hint || ''; if (/(360|480)/.test(h)) return 0; if (/720/.test(h)) return 1; if (/(1080|1440|2160|4k)/.test(h)) return 3; return 2; };
const sorted = (list) => [...list].sort((a, b) => rank(a) - rank(b));
const linksFrom = (kind, r) => (kind === 'mp3' ? [...r.audio, ...sorted(r.video)] : sorted(r.video)).map((x) => x.url);

async function viaCasper(kind, url) {
  const id = String(url).match(YT_ID)?.[1] || (/^[\w-]{11}$/.test(url) ? url : null);
  if (!id) throw new Error('no video id');
  return firstGood(kind, [`${CASPER}/api/download/${id}${kind === 'mp4' ? '?format=mp4' : ''}`]);
}

async function viaRizz(kind, url) {
  const params = { apikey: config.RIZZ_KEY, ...(config.RIZZ_USER ? { username: config.RIZZ_USER } : {}) };
  const r = await dl.fetchFrom({ api: config.RIZZ_API, params }, url);
  return firstGood(kind, linksFrom(kind, r));
}

async function viaOld(kind, url) {
  const { data } = await axios.get(`${OLD[kind]}${encodeURIComponent(url)}`, { timeout: 120000 });
  const link = data?.download?.downloadUrl || data?.data?.url || data?.result?.url || data?.url;
  if (!link) throw new Error('no link');
  return firstGood(kind, [link]);
}

async function viaPrexzy(kind, url) {
  return firstGood(kind, linksFrom(kind, await dl.fetchAio(url)));
}

async function mediaFor(kind, url) {
  const chain = [['casper', viaCasper]];
  if (config.RIZZ_KEY) chain.push(['rizz', viaRizz]);
  chain.push(['old', viaOld], ['prexzy', viaPrexzy]);
  for (const [name, fn] of chain) {
    try { return await fn(kind, url); }
    catch (e) { console.error(`[yt] ${name} failed for ${kind}:`, e?.message || e); }
  }
  throw new Error('All download services failed for this one. Try again in a moment.');
}

module.exports = { media: mediaFor, sniff, payload, release, MAX_FILE_MB };
