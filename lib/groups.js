const { createStore } = require('./store');

const { data, save } = createStore('groups');

// Everything a group can have. New keys are filled in lazily, so old data.json files keep working.
const fresh = () => ({
  antilink: 'off', antigroupmention: 'off', antispam: 'off',
  antibadword: 'off', antiflood: 'off', antibot: 'off',
  warns: {}, muted: [], banned: [], blacklist: [], whitelist: [], filters: {}, modlogs: [],
  welcome: { on: false, text: '' }, goodbye: { on: false, text: '' }, votes: null
});
const DEFAULT = Object.freeze(fresh());
const ensure = (jid) => {
  const g = (data[jid] ||= fresh());
  for (const [k, v] of Object.entries(DEFAULT)) if (g[k] === undefined) g[k] = JSON.parse(JSON.stringify(v));
  return g;
};

module.exports = {
  // read-only: never creates an entry (this runs for every group message)
  get: (jid) => data[jid] || DEFAULT,
  // change anything: groups.update(jid, (g) => { g.muted.push(x); })
  update(jid, fn) { const g = ensure(jid); const r = fn(g); save(); return r; },
  setMode(jid, key, mode) { ensure(jid)[key] = mode; save(); },
  setAntilink(jid, mode) { ensure(jid).antilink = mode; save(); },
  addWarn(jid, user) {
    const g = ensure(jid);
    g.warns[user] = (g.warns[user] || 0) + 1;
    save();
    return g.warns[user];
  },
  getWarn: (jid, user) => (data[jid]?.warns[user]) || 0,
  resetWarn(jid, user) {
    if (!data[jid]) return;
    delete data[jid].warns[user];
    save();
  },
  // moderation log: last 100 entries per group
  log(jid, entry) {
    const g = ensure(jid);
    g.modlogs.push({ t: Date.now(), ...entry });
    if (g.modlogs.length > 100) g.modlogs.splice(0, g.modlogs.length - 100);
    save();
  }
};
