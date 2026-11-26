const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

// Tiny JSON store: in-memory object, debounced + atomic writes (no corrupt file on a crash).
function createStore(name) {
  const file = path.join(DIR, `${name}.json`);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[store] ${name}.json unreadable, backing it up:`, e.message);
      try { fs.renameSync(file, `${file}.bak`); } catch {}
    }
    data = {};
  }

  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { fs.mkdirSync(DIR, { recursive: true }); } catch {} // the folder may have been deleted while the bot runs
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  };
  const save = () => { if (!timer) timer = setTimeout(flush, 500); };
  process.on('exit', () => { if (timer) flush(); });

  return { data, save, flush };
}

module.exports = { createStore };
