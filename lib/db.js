const { createStore } = require('./store');

const { data, save } = createStore('users');

module.exports = {
  get: (id) => data[String(id)],
  set(id, v) { data[String(id)] = { ...data[String(id)], ...v }; save(); },
  del(id) { delete data[String(id)]; save(); },
  all: () => data
};
