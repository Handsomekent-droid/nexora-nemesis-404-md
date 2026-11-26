/**
 * HTTP helpers for commands that fetch things from the internet.
 * safeUrl() refuses anything that points at this server or a private network (SSRF protection),
 * because several commands (/url, /gdrive, /mediafire ...) fetch links that strangers type in.
 */
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const MAX_DEFAULT = 60 * 1024 * 1024; // 60 MB

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
  }
  return true;
}

// Throws a friendly Error when the URL is not a public http(s) address
async function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('That is not a valid link.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http/https links are supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('That address is not allowed.');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new Error('Could not resolve that address.'); })).map((x) => x.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('That address is not allowed.');
  return u.toString();
}

const getJson = async (url, opts = {}) => (await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA }, ...opts })).data;
const getText = async (url, opts = {}) => (await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'text', ...opts })).data;

// Download to a Buffer, capped in size. Pass { safe: true } for user-supplied links.
async function getBuffer(url, { maxBytes = MAX_DEFAULT, safe = false, timeout = 120000, headers = {} } = {}) {
  if (safe) await safeUrl(url);
  const res = await axios.get(url, {
    responseType: 'arraybuffer', timeout, maxContentLength: maxBytes, maxBodyLength: maxBytes,
    maxRedirects: 5, headers: { 'User-Agent': UA, ...headers }
  });
  return { buffer: Buffer.from(res.data), mime: String(res.headers['content-type'] || '').split(';')[0], headers: res.headers, finalUrl: res.request?.res?.responseUrl || url };
}

// HEAD-ish size check for safe links (null when unknown)
async function headInfo(url) {
  await safeUrl(url);
  try {
    const r = await axios.head(url, { timeout: 15000, maxRedirects: 5, headers: { 'User-Agent': UA } });
    return { size: Number(r.headers['content-length']) || null, mime: String(r.headers['content-type'] || '').split(';')[0], headers: r.headers };
  } catch { return { size: null, mime: '', headers: {} }; }
}

module.exports = { UA, safeUrl, getJson, getText, getBuffer, headInfo, isPrivateIp };
