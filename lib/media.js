/**
 * Media helpers: read the image/video/sticker/audio attached to (or replied to by) a command, and
 * convert with ffmpeg. ffmpeg is looked up on the server's PATH first, then in the optional
 * `ffmpeg-static` package; if neither exists, commands that need it say so instead of crashing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* ---------- ffmpeg ---------- */
let ffPath;
function ffmpegBin() {
  if (ffPath !== undefined) return ffPath;
  const { spawnSync } = require('child_process');
  const ok = (p) => { try { return spawnSync(p, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
  if (ok('ffmpeg')) return (ffPath = 'ffmpeg');
  try { const p = require('ffmpeg-static'); if (p && ok(p)) return (ffPath = p); } catch {}
  return (ffPath = null);
}
const hasFfmpeg = () => !!ffmpegBin();

const tmpPath = (ext) => path.join(os.tmpdir(), `nx-${crypto.randomBytes(8).toString('hex')}.${ext}`);

/**
 * ffmpeg({ input: Buffer, inExt: 'jpg', args: ['-vf','scale=512:-1'], outExt: 'png', timeout })
 * -> Buffer. Temp files are always removed. `args` go between input and output.
 */
function ffmpeg({ input, inExt = 'bin', args = [], outExt = 'png', timeout = 90000 }) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegBin();
    if (!bin) return reject(new Error('ffmpeg is not installed on this server. Install ffmpeg (or add the ffmpeg-static package) to use this command.'));
    const inFile = tmpPath(inExt);
    const outFile = tmpPath(outExt);
    const cleanup = () => { fs.rm(inFile, { force: true }, () => {}); fs.rm(outFile, { force: true }, () => {}); };
    try { fs.writeFileSync(inFile, input); } catch (e) { return reject(e); }
    const p = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', '-i', inFile, ...args, outFile], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeout);
    p.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !fs.existsSync(outFile)) throw new Error(`conversion failed${err ? ': ' + err.trim().split('\n').pop() : ''}`);
        const out = fs.readFileSync(outFile);
        cleanup();
        resolve(out);
      } catch (e) { cleanup(); reject(e); }
    });
  });
}

/* ---------- reading media from a message ---------- */
const KINDS = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage'];
const kindName = (k) => k.replace('Message', '');

function unwrapMsg(x) {
  let msg = x || {};
  for (let i = 0; i < 4; i++) {
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message ||
      msg.viewOnceMessageV2Extension?.message || msg.documentWithCaptionMessage?.message;
    if (!inner) break;
    msg = inner;
  }
  return msg;
}

// Where is the media? In the message itself, or in the message it replies to.
function findMedia(m) {
  const own = unwrapMsg(m.message);
  for (const k of KINDS) if (own[k]) return { kind: kindName(k), node: own[k], key: m.key, message: own };
  const ci = Object.values(own).find((v) => v && typeof v === 'object' && v.contextInfo)?.contextInfo;
  const q = unwrapMsg(ci?.quotedMessage);
  for (const k of KINDS) {
    if (q[k]) {
      return {
        kind: kindName(k), node: q[k], message: q,
        key: { remoteJid: m.key.remoteJid, id: ci.stanzaId, participant: ci.participant, fromMe: false }
      };
    }
  }
  return null;
}

/**
 * getMedia(ctx, ['image','sticker']) -> { kind, buffer, mime, animated, seconds } or null.
 * `kinds` optional filter. Never throws on "no media": returns null.
 */
async function getMedia(ctx, kinds) {
  const f = findMedia(ctx.m);
  if (!f || (kinds && !kinds.includes(f.kind))) return null;
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  const buffer = await downloadMediaMessage(
    { key: f.key, message: f.message }, 'buffer', {},
    { logger: { level: 'silent', info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return this; } }, reuploadRequest: ctx.rawSock.updateMediaMessage });
  return {
    kind: f.kind, buffer, mime: f.node.mimetype || '',
    animated: !!f.node.isAnimated || !!f.node.gifPlayback, seconds: Number(f.node.seconds) || 0,
    fileName: f.node.fileName || ''
  };
}

/* ---------- WhatsApp sticker (.webp) building, with pack name/author in EXIF ---------- */
function exifChunk(pack, author) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': crypto.randomBytes(16).toString('hex'), 'sticker-pack-name': pack || '', 'sticker-pack-publisher': author || '',
    emojis: ['🤖']
  }), 'utf8');
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  head.writeUInt32LE(json.length, 14);
  const data = Buffer.concat([head, json]);
  const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const hdr = Buffer.alloc(8);
  hdr.write('EXIF', 0, 'ascii');
  hdr.writeUInt32LE(data.length, 4);
  return Buffer.concat([hdr, data, pad]);
}

// Adds (or replaces) the EXIF chunk of a webp so WhatsApp shows the pack name and author
function webpWithExif(webp, pack, author) {
  if (webp.length < 20 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') return webp;
  const chunks = [];
  let off = 12;
  while (off + 8 <= webp.length) {
    const id = webp.toString('ascii', off, off + 4);
    const size = webp.readUInt32LE(off + 4);
    const end = off + 8 + size + (size % 2);
    chunks.push({ id, buf: webp.subarray(off, Math.min(end, webp.length)) });
    off = end;
  }
  let vp8x = chunks.find((c) => c.id === 'VP8X');
  const rest = chunks.filter((c) => c.id !== 'VP8X' && c.id !== 'EXIF');
  if (!vp8x) {
    // simple (non-extended) file: build a VP8X header; stickers are always 512x512
    const b = Buffer.alloc(18);
    b.write('VP8X', 0, 'ascii'); b.writeUInt32LE(10, 4);
    b.writeUIntLE(511, 12, 3); b.writeUIntLE(511, 15, 3);
    vp8x = { id: 'VP8X', buf: b };
  } else {
    vp8x = { id: 'VP8X', buf: Buffer.from(vp8x.buf) };
  }
  vp8x.buf[8] |= 0x08; // EXIF flag
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), vp8x.buf, ...rest.map((c) => c.buf), exifChunk(pack, author)]);
  const out = Buffer.alloc(8);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(body.length, 4);
  return Buffer.concat([out, body]);
}

/** Image/video buffer -> 512x512 WhatsApp sticker webp (animated for video/gif), with pack/author. */
async function toSticker({ buffer, inExt, animated, pack, author, crop = false }) {
  const scale = crop
    ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
    : 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba';
  const args = animated
    ? ['-t', '8', '-vf', `fps=15,${scale}`, '-loop', '0', '-an', '-c:v', 'libwebp', '-q:v', '50', '-compression_level', '6', '-preset', 'default', '-f', 'webp']
    : ['-vf', scale, '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '80', '-f', 'webp'];
  const webp = await ffmpeg({ input: buffer, inExt, args, outExt: 'webp', timeout: 120000 });
  return webpWithExif(webp, pack, author);
}

const extFor = (mime, kind) => {
  const m = String(mime).toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4a') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'sticker' ? 'webp' : kind === 'audio' ? 'ogg' : 'bin';
};

module.exports = { ffmpeg, hasFfmpeg, findMedia, getMedia, webpWithExif, toSticker, extFor, tmpPath };
