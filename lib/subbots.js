// Sub-bots: other people's Telegram bots that run this same bot code. Stored in data/subbots.json.
// NOTE: the file holds bot tokens — keep the data/ folder private.
const { createStore } = require('./store');
const { data, save } = createStore('subbots');

module.exports = {
  all: () => data,
  get: (id) => data[String(id)],
  add(id, v) { data[String(id)] = v; save(); },
  del(id) { delete data[String(id)]; save(); },
  byOwner: (uid) => Object.entries(data).filter(([, v]) => String(v.addedBy) === String(uid)).map(([id, v]) => ({ id, ...v })),
  findByName: (n) => Object.entries(data).find(([, v]) => v.username?.toLowerCase() === String(n).replace(/^@/, '').toLowerCase())?.[0]
};
