const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { handleMessage, preview } = require('./commands');
const ownmsgs = require('./ownmsgs');
const clog = require('./clog');
const config = require('../config');
const settings = require('./settings');

try { console.log(`[wa] Baileys ${require('@whiskeysockets/baileys/package.json').version}`); } catch {}
const userPart = (j) => String(j || '').split('@')[0].split(':')[0];
const SESS_DIR = path.join(__dirname, '..', 'sessions');
fs.mkdirSync(SESS_DIR, { recursive: true });

const logger = pino({ level: 'silent' });
const PAIR_TIMEOUT = 3 * 60 * 1000;
const SENT_CACHE_MAX = 500; // per session; 400+ sessions x 500 messages was a lot of RAM

const live = new Map();     // tgId -> { sock, clear }
const online = new Set();
const startTimes = new Map(); // id -> when .start() was called, for the "Startup: Ns" line in the connected banner   // tgIds whose WhatsApp connection is currently open
const retries = new Map();  // tgId -> consecutive reconnect attempts

// tiny node-cache look-alike (get/set/del/flushAll) for Baileys' retry counters
function makeRetryCache() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); if (m.size > 2000) m.delete(m.keys().next().value); },
    del: (k) => m.delete(k),
    flushAll: () => m.clear()
  };
}

// Every paired account was presenting the exact same device fingerprint (Ubuntu + Chrome).
// With 100+ accounts all connecting from this one server with an IDENTICAL device signature,
// in quick succession as people pair, that's one of the clearest patterns WhatsApp's anti-abuse
// systems watch for — a real contributor to the bans being reported. Each account now gets a
// plausible, varied device fingerprint, picked deterministically from its own id so it stays the
// SAME across reconnects for that one account (switching an account's device identity on every
// reconnect would itself look suspicious) — but different ACROSS accounts.
// Baileys wants the browser as [OS name, BROWSER name, version] (same shape as Browsers.ubuntu('Chrome')
// = ['Ubuntu','Chrome','22.04.4']). The browser name MUST be one WhatsApp knows (Chrome) or the pairing
// code is refused on the phone with "Couldn't link device". Only the Ubuntu+Chrome shape is used: it is the one confirmed to pair reliably (Mac OS/Windows variants were reported to be refused).
const DEVICE_POOL = [
  ['Ubuntu', 'Chrome', '22.04.4'],
  ['Ubuntu', 'Chrome', '22.04.3'],
  ['Ubuntu', 'Chrome', '24.04.1']
];
function deviceFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEVICE_POOL[h % DEVICE_POOL.length];
}

const sessionPath = (id) => path.join(SESS_DIR, String(id));
const hasSession = (id) => fs.existsSync(path.join(sessionPath(id), 'creds.json'));
const isLive = (id) => live.has(String(id));
const isOnline = (id) => online.has(String(id));
const wipe = (id) => fs.rmSync(sessionPath(id), { recursive: true, force: true });

function sessionIds() {
  try {
    return fs.readdirSync(SESS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && hasSession(d.name))
      .map((d) => d.name);
  } catch { return []; }
}

// One version lookup per hour instead of one per socket/reconnect
let waVersion = null;
let waVersionAt = 0;
async function getVersion() {
  if (waVersion && Date.now() - waVersionAt < 3600e3) return waVersion;
  try {
    const r = await fetchLatestBaileysVersion();
    if (r?.version) { waVersion = r.version; waVersionAt = Date.now(); }
    console.log(`[wa] WhatsApp Web version ${waVersion?.join('.')}${r?.isLatest === false ? ' (fallback, could not fetch latest)' : ''}`);
  } catch (e) {
    console.error('[wa] could not fetch the latest WhatsApp Web version:', e?.message || e);
  }
  return waVersion || undefined;
}

function scheduleReconnect(id, opts, code) {
  const n = retries.get(id) || 0;
  retries.set(id, n + 1);
  // 440 = logged in somewhere else with the same session: back off hard instead of fighting it
  const base = code === DisconnectReason.connectionReplaced ? 30000 : Math.min(3000 * 2 ** n, 60000);
  const delay = base + Math.floor(Math.random() * 5000); // jitter: spread reconnects out after a network blip
  setTimeout(() => {
    if (live.has(id) || !hasSession(id)) return; // re-paired, or unpaired meanwhile
    start(id, opts).catch((e) => {
      console.error('[reconnect]', id, e?.message || e);
      scheduleReconnect(id, opts, code);
    });
  }, delay);
}

async function start(tgId, opts = {}) {
  const id = String(tgId);
  startTimes.set(id, Date.now());
  const { phone, onCode, onOpen, onFail, onLoggedOut, onState } = opts;

  // A new pairing always starts from clean credentials: leftovers of an earlier, never-finished attempt
  // make WhatsApp reject the new code on the phone ("Couldn't link device").
  if (phone) {
    try {
      const f = path.join(sessionPath(id), 'creds.json');
      if (fs.existsSync(f) && !JSON.parse(fs.readFileSync(f, 'utf8')).registered) wipe(id);
    } catch { wipe(id); }
  }
  const { state, saveCreds: saveCredsRaw } = await useMultiFileAuthState(sessionPath(id));
  const version = await getVersion();

  // Baileys calls saveCreds on almost every event. With many sessions live at once, writing to
  // disk that often becomes the bottleneck. Coalesce true rapid-fire bursts into one write —
  // but keep the window short: if the process dies (crash/restart) before an unflushed write
  // lands, the session's keys go stale and EVERY message in that chat starts failing to decrypt
  // ("Waiting for this message", permanently, not just occasionally). A short window keeps the
  // performance benefit without leaving credentials unsaved for long.
  let saveTimer = null;
  let savePending = false;
  const flushSave = () => { saveTimer = null; if (savePending) { savePending = false; saveCredsRaw().catch(() => {}); } };
  const saveCreds = () => {
    savePending = true;
    if (!saveTimer) saveTimer = setTimeout(flushSave, 150);
  };

  // Never leave two sockets alive for one user
  const prev = live.get(id);
  if (prev) { live.delete(id); prev.clear(); try { prev.sock.end(undefined); } catch {} }

  // Remember what we send. When a phone can't decrypt a message it asks for a resend and
  // Baileys needs getMessage() to answer; without it the chat shows "Waiting for this message".
  const sentCache = new Map(); // message id -> message content
  const retryCache = makeRetryCache();
  const devicesCache = makeRetryCache(); // device lists: Baileys re-uses them instead of asking WhatsApp for every send (as other bots do)

  const sock = makeWASocket({
    ...(version && { version }),
    logger,
    printQRInTerminal: false,
    browser: deviceFor(id),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    markOnlineOnConnect: false,   // don't announce 'online' on every connect
    syncFullHistory: false,
    // NOTE: history sync is left at WhatsApp's default on purpose. A freshly linked device needs WhatsApp's first
    // sync to finish before it can decrypt chats; turning it off left new pairings deaf/"waiting" for minutes.
    generateHighQualityLinkPreview: false,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 60000,
    // If WhatsApp asks us to resend something we no longer hold, answer with an empty message instead of nothing:
    // that still renews the encryption session so the next messages are readable.
    getMessage: async (key) => sentCache.get(key.id) || proto.Message.fromObject({}),
    msgRetryCounterCache: retryCache,
    userDevicesCache: devicesCache
  });

  sock.__sentKeys = new Map(); // chat jid -> last bot message keys (used by /clear)
  sock.__stats = { sent: 0 }; // used by .safestatus — this bot's own send volume, nothing WhatsApp-internal
  sock.__tgId = id; // lets WhatsApp-side commands (e.g. referral-gated features) look up this account's Telegram user
  const rawSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    let sent;
    try {
      sent = await rawSend(...args);
    } catch (e) {
      console.error(`[wa:${id}] send failed, retrying once:`, e?.message || e);
      await new Promise((r) => setTimeout(r, 1200));
      sent = await rawSend(...args); // let it throw on a second failure — the caller already logs that
    }
    sock.__stats.sent++;
    if (sent?.key?.id && sent.message) {
      sentCache.set(sent.key.id, sent.message);
      if (sentCache.size > SENT_CACHE_MAX) sentCache.delete(sentCache.keys().next().value);
      { const arr = sock.__sentKeys.get(sent.key.remoteJid) || []; arr.push(sent.key); if (arr.length > 60) arr.shift(); sock.__sentKeys.set(sent.key.remoteJid, arr); if (sock.__sentKeys.size > 200) sock.__sentKeys.delete(sock.__sentKeys.keys().next().value); }
      ownmsgs.mark(sent.key.id); // any paired session's own output is never re-moderated by another
    }
    return sent;
  };

  let notified = false;
  let codeTimer = null;
  const clear = () => { clearTimeout(codeTimer); clearTimeout(pairTimer); };
  const current = () => live.get(id)?.sock === sock;
  live.set(id, { sock, clear, flushSave: () => { clearTimeout(saveTimer); flushSave(); } });

  sock.ev.on('creds.update', saveCreds);

  // Fresh session: ask WhatsApp for a pairing code. The request is sent as soon as the connection to
  // WhatsApp is ready (its first 'qr' event); the timer is only a fallback if that event never arrives.
  let askedCode = false;
  const askCode = async () => {
    if (askedCode || !current() || sock.authState.creds.registered) return;
    askedCode = true;
    try {
      const raw = await sock.requestPairingCode(phone);
      console.log(`[pair:${id}] pairing code issued for +${phone.slice(0, 5)}…`);
      if (current()) onCode?.(raw.match(/.{1,4}/g).join('-'));
    } catch (e) {
      console.error('[pair]', e?.message || e);
      if (!current()) return; // a newer attempt owns this user now
      await stop(id);
      onFail?.('Could not generate a pairing code. Check the number and try again.');
    }
  };
  let pairTimer = null;
  if (!sock.authState.creds.registered && phone) {
    sock.ev.on('connection.update', ({ qr }) => { if (qr) { clearTimeout(codeTimer); setTimeout(askCode, 1500); } });
    codeTimer = setTimeout(askCode, 8000);

    pairTimer = setTimeout(async () => {
      if (current() && !sock.authState.creds.registered) {
        await stop(id);
        onFail?.('Pairing timed out. Tap Pair again to get a new code.');
      }
    }, PAIR_TIMEOUT);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (!current()) return; // event from a socket we replaced or closed on purpose

    if (connection === 'open') {
      clear();
      retries.delete(id);
      online.add(id);
      clearTimeout(saveTimer); flushSave(); // a successful connect is the most important write — never let it sit debounced
      console.log(`[wa] ${id} connected`);
      try {
        const acct = userPart(sock.user?.id);
        clog.connected({ id, botName: config.BOT_NAME, build: config.BUILD, startedAt: startTimes.get(id), mode: settings.get(acct).maintenance ? 'maintenance' : 'public', prefix: settings.get(acct).prefix || config.PREFIX });
      } catch {}
      onState?.('active');
      try { require('./auto').onOpen(sock); } catch {}
      if (!notified) { notified = true; onOpen?.(sock); }
      return;
    }

    if (connection !== 'close') return;
    if (!sock.authState.creds.registered) {
      const err = lastDisconnect?.error;
      console.error(`[pair:${id}] closed before link finished: code=${err?.output?.statusCode} msg=${err?.message}`);
    }
    try { require('./auto').onClose(sock); } catch {}
    online.delete(id);
    clear();
    live.delete(id);
    clearTimeout(saveTimer); flushSave(); // flush whatever's pending before this socket is gone
    const code = lastDisconnect?.error?.output?.statusCode;

    if (code === DisconnectReason.loggedOut) {
      wipe(id);
      retries.delete(id);
      onLoggedOut?.();
      return;
    }

    // 515 = restart required, normal right after pairing
    if (!sock.authState.creds.registered && code !== DisconnectReason.restartRequired) {
      wipe(id);
      onFail?.('Connection closed before pairing finished. Tap Pair to try again.');
      return;
    }

    onState?.('inactive');
    scheduleReconnect(id, { ...opts, phone: undefined, onCode: undefined, onOpen: notified ? undefined : onOpen }, code);
  });

  sock.ev.on('group-participants.update', (ev) => {
    require('./commands').onGroupParticipants(sock, ev).catch((e) => console.error(`[group-event:${id}]`, e?.message || 'unknown error'));
  });

  sock.ev.on('call', (calls) => {
    require('./auto').onCall(sock, calls).catch((e) => console.error(`[call:${id}]`, e?.message || 'unknown error'));
  });

  let rxLeft = 15;
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') { console.log(`[rx:${id}] ignored upsert type=${type}`); return; }
    for (const m of messages) {
      // diagnostics for the first messages of each connection: shows whether anything arrives at all
      if (rxLeft > 0) {
        rxLeft--;
        const kinds = m.message ? Object.keys(m.message).join(',') : 'NO-CONTENT(' + (m.messageStubType ?? '?') + ')';
        console.log(`[rx:${id}] type=${type} fromMe=${!!m.key.fromMe} chat=${String(m.key.remoteJid).split('@')[1] || '?'} content=${kinds}`);
      }
      // One clean line per real incoming message — this is the actual message feed, with
      // nothing about keys/sessions in it at all, just who said what.
      if (m.message && !m.key.fromMe) {
        const from = (m.key.participant || m.key.remoteJid || '').split('@')[0];
        try { console.log(`[msg:${id}] ${from}: ${preview(m)}`); } catch {}
        try {
          clog.trace({ id, type, from, name: m.pushName, chat: m.key.remoteJid, body: preview(m), startedAt: startTimes.get(id) });
        } catch {}
      }
      require('./auto').onMessage(sock, m, type).catch((e) => console.error(`[auto:${id}]`, e?.message || 'unknown error'));
      handleMessage(sock, m, type).catch((e) =>
        // Never print the raw error object here: a decrypt failure from the signal-protocol layer
        // can throw an object that carries the actual session/key material as properties, and
        // printing it whole would leak that into the console. Message text only, never the object.
        console.error(`[msg:${id}]`, e?.message || 'unknown error'));
    }
  });

  return sock;
}

async function stop(tgId, { logout = false } = {}) {
  const id = String(tgId);
  const entry = live.get(id);
  live.delete(id); // remove first so the close handler ignores it
  online.delete(id);
  retries.delete(id);
  if (entry) {
    entry.clear();
    entry.flushSave?.();
    try { if (logout) await entry.sock.logout(); } catch {}
    try { entry.sock.end(undefined); } catch {}
  }
  wipe(id);
}

// Process shutdown: close sockets but KEEP the sessions
function stopAll() {
  for (const [id, entry] of live) {
    live.delete(id);
    entry.clear();
    entry.flushSave?.();
    try { entry.sock.end(undefined); } catch {}
  }
  online.clear();
}

const RESTORE_BATCH = 10; // sessions connecting at once on startup (400+ sessions: staggered, not a burst)
const RESTORE_GAP = () => 1500 + Math.random() * 2500; // pause between batches
async function restoreAll(hooksFor) {
  const ids = sessionIds();
  console.log(`[wa] restoring ${ids.length} session(s), ${RESTORE_BATCH} at a time...`);
  for (let i = 0; i < ids.length; i += RESTORE_BATCH) {
    await Promise.all(ids.slice(i, i + RESTORE_BATCH).map((id) =>
      start(id, hooksFor(id)).catch((e) => {
        console.error('[restore]', id, e?.message || e);
        scheduleReconnect(id, hooksFor(id));
      })
    ));
    if (i + RESTORE_BATCH < ids.length) await new Promise((r) => setTimeout(r, RESTORE_GAP()));
  }
  console.log(`[wa] restore complete (${ids.length} session(s) queued/connected)`);
}

// the live socket of a session (or null) — used by the website API
const getSock = (id) => live.get(String(id))?.sock || null;

// Drop the socket and connect again WITHOUT touching the saved login (the website's "Reconnect" button)
async function restart(id, opts = {}) {
  id = String(id);
  const entry = live.get(id);
  if (!entry && !hasSession(id)) throw new Error('no session');
  live.delete(id); online.delete(id); retries.delete(id);
  if (entry) { entry.clear(); entry.flushSave?.(); try { entry.sock.end(undefined); } catch {} }
  await start(id, opts);
}

module.exports = { start, stop, stopAll, isLive, isOnline, hasSession, sessionIds, restoreAll, getSock, restart };
