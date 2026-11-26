const { createStore } = require('./store');

// Every Telegram user who ever opened the bot (separate from db.js, which only holds pairing data)
const { data, save } = createStore('seen');

module.exports = {
  touch(from) {
    const id = String(from.id);
    const old = data[id];
    data[id] = {
      name: [from.first_name, from.last_name].filter(Boolean).join(' ') || old?.name || 'User',
      username: from.username || null,
      firstSeen: old?.firstSeen || Date.now(),
      lastSeen: Date.now()
    };
    save();
  },
  all: () => data
};
