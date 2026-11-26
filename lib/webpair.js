/**
 * WEB PAIRING (Build 27): a small website so people without Telegram can link their WhatsApp.
 *   open  http://<your-host>:<WEB_PORT>/   ->  type the number, get a pairing code, enter it in WhatsApp.
 * Same sessions, limits and bot as the Telegram flow. No extra packages (plain Node http).
 * Settings (.env):  WEB_PORT (or the panel's PORT)  ·  WEB_PAIR=off to disable  ·  WEB_TRUST_PROXY=1 behind nginx/Cloudflare
 *   WEB_API_SECRET=<long random>  opens the /hub/* API used by the Vercel website  ·  WEB_PUBLIC=off hides the built-in page
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('./db');
const wa = require('./wa');
const autojoin = require('./autojoin');

const ROOT = path.join(__dirname, '..');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const asset = (n) => { try { return fs.readFileSync(path.join(ROOT, 'assets', n)); } catch { return null; } };
const ART = asset('cat_menu_1.jpg') || asset('tg_menu.jpg');

/* ---------- limits (the code request makes WhatsApp notify that number, so the page must not be abusable) ---------- */
const IP_LIMIT = { max: Number(process.env.WEB_IP_LIMIT) || 5, windowMs: 60 * 60 * 1000 };   // code requests per IP per hour
const PHONE_COOLDOWN = 10 * 60 * 1000;                                                        // same number again
const OWNER_COOLDOWN = 30 * 1000;                                                             // same browser
const MAX_PENDING = 25;                                                                        // codes being created at once
const ipHits = new Map(), phoneAt = new Map(), ownerAt = new Map();
const jobs = new Map(); // session key -> { state, code, msg, at }

const prune = (map, ttl) => { const now = Date.now(); for (const [k, v] of map) if (now - (Array.isArray(v) ? v[v.length - 1] : v) > ttl) map.delete(k); };
setInterval(() => { prune(ipHits, IP_LIMIT.windowMs); prune(phoneAt, PHONE_COOLDOWN); prune(ownerAt, OWNER_COOLDOWN); for (const [k, j] of jobs) if (Date.now() - j.at > 30 * 60 * 1000) jobs.delete(k); }, 5 * 60 * 1000).unref?.();

function ipOf(req) {
  if (process.env.WEB_TRUST_PROXY === '1') { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || '?';
}
function ipAllowed(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_LIMIT.windowMs);
  if (hits.length >= IP_LIMIT.max) { ipHits.set(ip, hits); return false; }
  hits.push(now); ipHits.set(ip, hits); return true;
}

/* ---------- helpers ---------- */
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const json = (res, code, obj) => send(res, code, obj);
function readBody(req, max = 2048) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
// the browser keeps a random token; we only keep its hash, so nobody can list or delete someone else's sessions
const ownerIdOf = (token) => (typeof token === 'string' && /^[a-f0-9]{32,64}$/.test(token) ? 'web' + sha(token).slice(0, 16) : null);
const fmtCode = (c) => { const s = String(c || '').replace(/[^A-Za-z0-9]/g, ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s; };

function listFor(oid, T) {
  return T.keysOf(oid).map((k) => {
    const u = db.get(k) || {}, j = jobs.get(k);
    const state = wa.isOnline(k) ? 'connected' : u.status === 'pairing' ? (j?.state === 'code' ? 'code' : 'pairing') : 'offline';
    return { id: k, phone: u.phone ? `+${u.phone.slice(0, 4)}${'•'.repeat(Math.max(0, u.phone.length - 7))}${u.phone.slice(-3)}` : '', state, pairedAt: u.pairedAt || null, commands: (require('./settings').peek(u.phone) || {}).commandsRun || 0 };
  });
}

/* ---------- API ---------- */
// Core of a pairing request. `oid` = who owns the session, `ip` = visitor address (for the hourly limit).
async function doPair({ oid, ip, phone }, T) {
  const mine = T.keysOf(oid);
  const same = mine.find((k) => db.get(k)?.phone === phone);
  if (same && wa.isOnline(same) && db.get(same)?.pairedAt) return [200, { ok: true, id: same, state: 'connected', msg: 'This number is already linked.' }];

  const now = Date.now();
  if (now - (ownerAt.get(oid) || 0) < OWNER_COOLDOWN) return [429, { ok: false, msg: 'Please wait a few seconds before asking for another code.' }];
  if (now - (phoneAt.get(phone) || 0) < PHONE_COOLDOWN) return [429, { ok: false, msg: 'A code was just sent for this number. Check your WhatsApp, or wait a few minutes and try again.' }];
  if ([...jobs.values()].filter((j) => j.state === 'pairing').length >= MAX_PENDING) return [503, { ok: false, msg: 'Many people are linking right now. Try again in a minute.' }];

  let id = same;
  if (!id) {
    if (mine.length >= T.MAX_PER_USER) return [400, { ok: false, msg: `You already have ${mine.length}/${T.MAX_PER_USER} numbers linked. Remove one first.` }];
    for (let n = 1; n <= T.MAX_PER_USER && !id; n++) { const k = T.slotKey(oid, n); if (!mine.includes(k) && !wa.hasSession(k)) id = k; }
    if (!id) return [400, { ok: false, msg: 'No free slot.' }];
  }
  if (!wa.hasSession(id) && wa.sessionIds().length >= config.MAX_SESSIONS) return [503, { ok: false, msg: 'This bot is full right now.' }];
  if (!ipAllowed(ip)) return [429, { ok: false, msg: 'Too many attempts. Try again in an hour.' }];

  ownerAt.set(oid, now); phoneAt.set(phone, now);
  jobs.set(id, { state: 'pairing', code: null, msg: '', at: now });
  await wa.stop(id);
  db.set(id, { phone, pairedAt: null, status: 'pairing', viaBot: 'web', name: 'Web user', username: null, tg: null, web: true });

  wa.start(id, T.hooksFor(id, {
    phone,
    onCode: (code) => { jobs.set(id, { state: 'code', code: fmtCode(code), msg: '', at: Date.now() }); },
    onOpen: (sock) => {
      db.set(id, { pairedAt: Date.now(), status: 'active', lastActiveAt: Date.now() });
      jobs.set(id, { state: 'connected', code: null, msg: '', at: Date.now() });
      const num = String(sock?.user?.id || '').split('@')[0].split(':')[0];
      if (num && T.CONNECTED_IMG) {
        sock.sendMessage(`${num}@s.whatsapp.net`, { image: T.CONNECTED_IMG, caption: `✅ *${config.BOT_NAME} connected!*\n\nSend *${config.PREFIX}menu* in any chat to see every command.\n\n> ${config.DEV}` }).catch(() => {});
      }
      setTimeout(() => { autojoin.joinAll(sock).catch(() => {}); }, 8000 + Math.random() * 12000);
      try { const main = T.getMain(); if (main) require('./owner').notify(main, `🆕 <b>New paired user (web)</b>\n${require('./owner').who(id, db.get(id))}`); } catch {}
    },
    onFail: (msg) => {
      if (!db.get(id)?.pairedAt) db.del(id);
      jobs.set(id, { state: 'failed', code: null, msg: String(msg || 'Pairing failed. Try again.'), at: Date.now() });
    }
  })).catch((e) => {
    console.error('[web] start failed:', e?.message || e);
    db.del(id);
    jobs.set(id, { state: 'failed', code: null, msg: 'Could not start pairing. Try again in a moment.', at: Date.now() });
  });
  return [200, { ok: true, id, state: 'pairing' }];
}

// public page flow (browser token)
async function pair(req, res, T) {
  const ip = ipOf(req);
  let b; try { b = await readBody(req); } catch { return json(res, 400, { ok: false, msg: 'Bad request.' }); }
  if (b.website) return json(res, 200, { ok: true, token: 'x', id: 'x' }); // honeypot field: real people never fill it
  const phone = T.normalizePhone(b.phone || '');
  if (!phone) return json(res, 400, { ok: false, msg: 'That number does not look right. Use the country code, digits only (e.g. 254712345678).' });
  const token = typeof b.token === 'string' && ownerIdOf(b.token) ? b.token : crypto.randomBytes(24).toString('hex');
  const [code, obj] = await doPair({ oid: ownerIdOf(token), ip, phone }, T);
  return json(res, code, obj.ok ? { ...obj, token } : obj);
}

/* ---------- hub API: used by the Vercel website (server to server, guarded by a shared secret) ---------- */
const HUB_SECRET = () => String(process.env.WEB_API_SECRET || '');
const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
function hubAuth(req) {
  const secret = HUB_SECRET();
  if (secret.length < 16) return null; // not configured (or too weak): hub API stays closed
  if (!safeEq(req.headers['x-hub-secret'] || '', secret)) return null;
  const user = String(req.headers['x-hub-user'] || '');
  if (!/^[0-9a-f-]{36}$/i.test(user)) return null;
  const ip = String(req.headers['x-hub-ip'] || '').slice(0, 64) || 'hub';
  return { oid: 'web' + crypto.createHash('sha256').update(secret + ':' + user).digest('hex').slice(0, 16), ip, admin: String(req.headers['x-hub-admin'] || '') === '1' };
}
async function hub(req, res, p, url, T) {
  const who = hubAuth(req);
  if (!who) return json(res, 401, { ok: false, msg: 'Unauthorized.' });
  if (req.method === 'POST' && p === '/hub/pair') {
    let b; try { b = await readBody(req); } catch { return json(res, 400, { ok: false, msg: 'Bad request.' }); }
    const phone = T.normalizePhone(b.phone || '');
    if (!phone) return json(res, 400, { ok: false, msg: 'That number does not look right. Use the country code, digits only (e.g. 254712345678).' });
    const [code, obj] = await doPair({ oid: who.oid, ip: who.ip, phone }, T);
    return json(res, code, obj);
  }
  if (req.method === 'GET' && p === '/hub/status') {
    const id = url.searchParams.get('id') || '';
    if (!T.keysOf(who.oid).includes(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    const j = jobs.get(id) || {};
    const state = wa.isOnline(id) && db.get(id)?.pairedAt ? 'connected' : (j.state || 'pairing');
    return json(res, 200, { ok: true, state, code: state === 'code' ? j.code : null, msg: j.msg || '' });
  }
  if (req.method === 'GET' && p === '/hub/my') return json(res, 200, { ok: true, sessions: listFor(who.oid, T), max: T.MAX_PER_USER });
  if (req.method === 'POST' && p === '/hub/delete') {
    let b; try { b = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    const id = String(b.id || '');
    if (id === 'all') { const ks = T.keysOf(who.oid); for (const k of ks) { await T.removeSession(k); jobs.delete(k); } return json(res, 200, { ok: true, removed: ks.length }); }
    if (!T.keysOf(who.oid).includes(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    await T.removeSession(id); jobs.delete(id);
    return json(res, 200, { ok: true });
  }
  const extra = await require('./hubapi').handle({ req, res, p, url, who, T, json, readBody, jobs });
  if (extra !== false) return extra;
  return json(res, 404, { ok: false, msg: 'Not found.' });
}

async function route(req, res, T) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.startsWith('/hub/')) return hub(req, res, p, url, T);
  if (String(process.env.WEB_PUBLIC || '').toLowerCase() === 'off' && p !== '/health') return json(res, 404, { ok: false, msg: 'Not found.' });
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, PAGE, 'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
  if (req.method === 'GET' && p === '/art.jpg' && ART) return send(res, 200, ART, 'image/jpeg', { 'Cache-Control': 'public, max-age=86400' });
  if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && p === '/api/info') return json(res, 200, { ok: true, name: config.BOT_NAME, dev: config.DEV, prefix: config.PREFIX, channel: config.CHANNEL_URL, max: T.MAX_PER_USER });
  if (req.method === 'POST' && p === '/api/pair') return pair(req, res, T);
  if (req.method === 'GET' && p === '/api/status') {
    const oid = ownerIdOf(url.searchParams.get('token')); const id = url.searchParams.get('id') || '';
    if (!oid || !T.keysOf(oid).concat(jobs.has(id) && id.startsWith(oid) ? [id] : []).includes(id)) return json(res, 404, { ok: false, msg: 'Not found.' });
    const j = jobs.get(id) || {};
    const state = wa.isOnline(id) && db.get(id)?.pairedAt ? 'connected' : (j.state || 'pairing');
    return json(res, 200, { ok: true, state, code: state === 'code' ? j.code : null, msg: j.msg || '' });
  }
  if (req.method === 'GET' && p === '/api/my') {
    const oid = ownerIdOf(url.searchParams.get('token'));
    if (!oid) return json(res, 200, { ok: true, sessions: [] });
    return json(res, 200, { ok: true, sessions: listFor(oid, T), max: T.MAX_PER_USER });
  }
  if (req.method === 'POST' && p === '/api/delete') {
    let b; try { b = await readBody(req); } catch { return json(res, 400, { ok: false }); }
    const oid = ownerIdOf(b.token);
    if (!oid || !T.keysOf(oid).includes(String(b.id))) return json(res, 404, { ok: false, msg: 'Not found.' });
    await T.removeSession(String(b.id)); jobs.delete(String(b.id));
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { ok: false, msg: 'Not found.' });
}

function start() {
  if (String(process.env.WEB_PAIR || '').toLowerCase() === 'off') return null;
  const port = Number(process.env.WEB_PORT || process.env.PORT || process.env.SERVER_PORT || 0);
  if (!port) { console.log('[web] pairing website is off — set WEB_PORT in .env to turn it on'); return null; }
  const T = require('./tgbot')._web;
  const server = http.createServer((req, res) => {
    route(req, res, T).catch((e) => { console.error('[web]', e?.message || e); try { json(res, 500, { ok: false, msg: 'Server error.' }); } catch {} });
  });
  server.headersTimeout = 15000; server.requestTimeout = 20000;
  server.on('error', (e) => console.error('[web] could not start:', e?.message || e));
  server.listen(port, '0.0.0.0', () => console.log(`[web] pairing website on port ${port}`));
  return server;
}

/* ---------- the page ---------- */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexora Nemesis 404 — Link your WhatsApp</title><meta name="theme-color" content="#08040f">
<style>
:root{--bg:#08040f;--card:#130a22;--line:#3b1e66;--ac:#b57bff;--ac2:#7a2cff;--tx:#f3ecff;--mut:#a79bc2;--ok:#4ade80;--bad:#ff6b81}
*{box-sizing:border-box;margin:0}body{background:radial-gradient(circle at 50% -10%,#2a1050 0,var(--bg) 60%);color:var(--tx);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;padding:24px 16px 60px}
.wrap{max-width:520px;margin:0 auto}.art{display:block;margin:6px auto 14px;width:150px;height:150px;border-radius:50%;object-fit:cover;box-shadow:0 0 50px #7a2cff88,0 0 0 3px var(--ac)}
h1{text-align:center;font-size:26px;letter-spacing:.04em}h1 b{color:var(--ac)}.sub{text-align:center;color:var(--mut);margin:4px 0 22px;font-size:14px;letter-spacing:.15em;text-transform:uppercase}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:16px}
label{display:block;font-size:13px;color:var(--mut);margin-bottom:6px;letter-spacing:.08em;text-transform:uppercase}
input[type=tel]{width:100%;padding:14px 16px;font-size:20px;letter-spacing:.05em;background:#0b0615;color:var(--tx);border:1px solid var(--line);border-radius:12px;outline:none}input:focus{border-color:var(--ac)}
button{cursor:pointer;border:0;border-radius:12px;font:inherit;font-weight:700}.go{width:100%;margin-top:14px;padding:14px;background:linear-gradient(90deg,var(--ac2),var(--ac));color:#fff;font-size:17px}.go:disabled{opacity:.5;cursor:wait}
.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}.hint{color:var(--mut);font-size:13px;margin-top:10px}
.code{font:800 40px/1.1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-align:center;padding:18px 8px;margin:10px 0;border:2px dashed var(--ac);border-radius:14px;background:#0b0615;word-break:break-all}
.cp{background:#241240;color:var(--tx);padding:10px 16px;margin:0 auto;display:block}ol{margin:14px 0 0 20px;color:var(--tx)}li{margin:6px 0}
.msg{margin-top:12px;padding:12px;border-radius:10px;font-size:14px}.err{background:#3a0f1a;color:#ffb3c0}.okc{background:#0f3a22;color:#a7f3c4}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.st{font-size:13px}.st.connected{color:var(--ok)}.st.offline,.st.failed{color:var(--bad)}.del{background:#3a0f1a;color:#ffb3c0;padding:8px 12px;font-size:13px}
.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}.links a{flex:1;min-width:140px;text-align:center;text-decoration:none;color:var(--tx);background:#241240;border:1px solid var(--line);padding:12px;border-radius:12px;font-weight:600;font-size:14px}
.hide{display:none}.foot{text-align:center;color:var(--mut);font-size:12px;margin-top:24px}
</style></head><body><div class="wrap">
<img class="art" src="/art.jpg" alt="" onerror="this.style.display='none'">
<h1>NEXORA <b>NEMESIS</b> 404</h1><div class="sub">Link your WhatsApp · no Telegram needed</div>

<div class="card" id="form">
  <label for="ph">Your WhatsApp number</label>
  <input id="ph" type="tel" inputmode="numeric" autocomplete="tel" placeholder="254712345678" maxlength="20">
  <input class="hp" id="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="go" id="go">Get my pairing code</button>
  <div class="hint">Country code first, digits only (Kenya: 2547…). The code is sent to <b>this</b> number's WhatsApp, so only enter your own.</div>
  <div id="err" class="msg err hide"></div>
</div>

<div class="card hide" id="codeBox">
  <label>Your pairing code</label>
  <div class="code" id="code">········</div>
  <button class="cp" id="copy">Copy code</button>
  <ol><li>Open <b>WhatsApp</b> on that phone</li><li><b>Settings → Linked Devices → Link a Device</b></li><li>Tap <b>Link with phone number instead</b></li><li>Type the code above</li></ol>
  <div class="hint" id="wait">Waiting for you to enter the code… (it expires after a few minutes)</div>
</div>

<div class="card hide" id="done"><div class="msg okc" id="doneMsg">✅ Connected! Open WhatsApp and send <b>.menu</b> to any chat.</div></div>

<div class="card hide" id="mine"><label>Your linked numbers</label><div id="list"></div><div class="hint">Remove a number to free a slot or to unlink the bot.</div></div>

<div class="card"><label>Join us</label><div class="links"><a id="chan" href="#" target="_blank" rel="noopener">📢 WhatsApp channel</a><a href="https://t.me/exodile" target="_blank" rel="noopener">✈️ Telegram</a></div></div>
<div class="foot" id="foot">NEXORA NEMESIS 404 · DEV × PRIME × KILLER × KENT</div>
</div>
<script>
(function(){
var $=function(i){return document.getElementById(i)},T='';try{T=localStorage.getItem('nx_token')||''}catch(e){}
var cur=null,poll=null,tries=0;
function show(id,on){$(id).classList.toggle('hide',!on)}
function err(t){var e=$('err');e.textContent=t||'';show('err',!!t)}
function api(p,o){return fetch(p,o).then(function(r){return r.json().catch(function(){return{ok:false,msg:'Server error.'}})})}
function save(t){T=t;try{localStorage.setItem('nx_token',t)}catch(e){}}
function stop(){clearInterval(poll);poll=null}
function reset(){stop();show('codeBox',false);$('go').disabled=false;$('go').textContent='Get my pairing code'}
function status(){
  if(!cur)return;tries++;
  api('/api/status?token='+encodeURIComponent(T)+'&id='+encodeURIComponent(cur)).then(function(d){
    if(!d.ok){return}
    if(d.state==='code'&&d.code){$('code').textContent=d.code;show('codeBox',true)}
    if(d.state==='connected'){stop();show('codeBox',false);show('done',true);$('go').disabled=false;$('go').textContent='Link another number';loadMine()}
    if(d.state==='failed'){reset();err(d.msg||'Pairing failed. Try again.')}
  });
  if(tries>110){reset();err('The code expired. Tap the button to get a new one.')}
}
function loadMine(){
  if(!T)return;api('/api/my?token='+encodeURIComponent(T)).then(function(d){
    var l=$('list');l.textContent='';var s=d.sessions||[];show('mine',s.length>0);
    s.forEach(function(x){var r=document.createElement('div');r.className='row';
      var a=document.createElement('div');var n=document.createElement('div');n.textContent=x.phone||'—';var st=document.createElement('div');st.className='st '+x.state;st.textContent=({connected:'🟢 Connected',code:'⏳ Waiting for code',pairing:'⏳ Starting…',offline:'🔴 Not connected'})[x.state]||x.state;a.appendChild(n);a.appendChild(st);
      var b=document.createElement('button');b.className='del';b.textContent='Remove';b.onclick=function(){if(!confirm('Remove this number from the bot?'))return;api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:T,id:x.id})}).then(loadMine)};
      r.appendChild(a);r.appendChild(b);l.appendChild(r)})
  })
}
$('go').onclick=function(){
  err('');show('done',false);var ph=$('ph').value.trim();if(ph.replace(/\\D/g,'').length<9){err('Enter your WhatsApp number with the country code.');return}
  $('go').disabled=true;$('go').textContent='Requesting code…';
  api('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,token:T,website:$('website').value})}).then(function(d){
    if(!d.ok){reset();err(d.msg||'Something went wrong.');return}
    save(d.token);cur=d.id;tries=0;
    if(d.state==='connected'){reset();show('done',true);$('doneMsg').innerHTML='✅ '+(d.msg||'Already linked.');loadMine();return}
    stop();poll=setInterval(status,2000);status();loadMine();
  }).catch(function(){reset();err('Could not reach the server. Check your connection and try again.')})
};
$('copy').onclick=function(){var c=$('code').textContent.replace(/-/g,'');try{navigator.clipboard.writeText(c);$('copy').textContent='Copied ✓'}catch(e){$('copy').textContent='Select the code and copy it'}setTimeout(function(){$('copy').textContent='Copy code'},2000)};
api('/api/info').then(function(d){if(d&&d.channel)$('chan').href=d.channel;});
loadMine();
})();
</script></body></html>`;

module.exports = { start, _route: route };
