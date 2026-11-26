/**
 * Per-session (per paired WhatsApp account) owner settings, saved in data/settings.json.
 * Every paired account is its own bot instance, so prefix / sudo / auto-features / banned users
 * etc. are stored per account number — one user's /setprefix never changes another user's bot.
 */
const { createStore } = require('./store');
const { data, save } = createStore('settings');

const DEFAULTS = () => ({
  prefix: null, footer: null, theme: 'default', language: 'en', menuStyle: null, menuDesign: null, menuImage: null,
  autoread: false, autotyping: false, autoreact: false,
  autoviewstatus: false, autolikestatus: false, statusEmoji: '❤️', alwaysonline: false,
  anticall: false, anticallMode: 'reject', anticallMsg: '📵 Calls are not accepted on this number. Please send a message instead.',
  antidelete: false, antiviewonce: false, autorecording: false, autobio: false, autobioText: '🤖 {bot} • up {uptime} • {time}',
  autoreply: { on: false, text: '👋 Hi! I am away right now, I will reply as soon as I can.' },
  maintenance: false, selfMode: false, sudo: [], banned: [], commandsRun: 0, since: Date.now()
});

const get = (acct) => {
  const k = String(acct);
  return (data[k] ||= DEFAULTS());
};
// read-only look that never creates an entry (used on every message)
const peek = (acct) => data[String(acct)] || null;
function set(acct, patch) { Object.assign(get(acct), patch); save(); return get(acct); }
function update(acct, fn) { const s = get(acct); fn(s); save(); return s; }

const list = (acct, key) => get(acct)[key] || [];
function addTo(acct, key, v) { update(acct, (s) => { s[key] = [...new Set([...(s[key] || []), v])]; }); }
function removeFrom(acct, key, v) { update(acct, (s) => { s[key] = (s[key] || []).filter((x) => x !== v); }); }

// full export/import used by /backup and /restore (settings only — never session credentials)
const exportOne = (acct) => JSON.parse(JSON.stringify(get(acct)));
function importOne(acct, obj) {
  const clean = { ...DEFAULTS(), ...obj };
  delete clean.since;
  data[String(acct)] = { ...clean, since: get(acct).since };
  save();
}

module.exports = { DEFAULTS, get, peek, set, update, list, addTo, removeFrom, exportOne, importOne, all: () => data };
