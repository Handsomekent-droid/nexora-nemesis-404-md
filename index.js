// Entry point. Installs missing dependencies automatically, then starts the bot (bot.js).
// Works even when the host blocks git/remote npm packages (the "libsignal" error).
require('./lib/consolesafety'); // MUST be first — guards every console call before Baileys even loads
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const PKG_FILE = path.join(ROOT, 'package.json');
const VENDOR = path.join(ROOT, 'vendor', 'libsignal');
const LIBSIGNAL_URLS = [
  'https://codeload.github.com/WhiskeySockets/libsignal-node/tar.gz/refs/heads/master',
  'https://github.com/WhiskeySockets/libsignal-node/archive/refs/heads/master.tar.gz'
];

const log = (m) => console.log(`[setup] ${m}`);
const isInstalled = (name) => fs.existsSync(path.join(ROOT, 'node_modules', name, 'package.json'));
// A dependency also counts as missing when package.json pins an exact version and a different one is installed
// (this is how switching Baileys version just works: change package.json, restart).
const wrongVersion = (name, want) => {
  if (!/^\d/.test(String(want))) return false; // only exact pins (no ^ or ~)
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version !== want; } catch { return false; }
};
const missing = () => {
  const deps = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')).dependencies;
  return [...Object.keys(deps), 'libsignal'].filter((d) => !isInstalled(d) || wrongVersion(d, deps[d]));
};

function npmInstall() {
  const r = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--allow-git=all', '--allow-remote=all'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NPM_CONFIG_ALLOW_GIT: 'all', NPM_CONFIG_ALLOW_REMOTE: 'all' }
  });
  return r.status === 0;
}

function download(url, file, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nexora-setup' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, file, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject);
    }).on('error', reject);
  });
}

// Host blocks git/remote packages: fetch libsignal ourselves and point npm at the local copy
async function vendorLibsignal() {
  if (!fs.existsSync(path.join(VENDOR, 'package.json'))) {
    fs.rmSync(VENDOR, { recursive: true, force: true });
    fs.mkdirSync(VENDOR, { recursive: true });
    const tgz = path.join(ROOT, 'vendor', 'libsignal.tgz');
    let ok = false;
    for (const url of LIBSIGNAL_URLS) {
      try {
        log(`downloading libsignal from ${new URL(url).host}...`);
        await download(url, tgz);
        const t = spawnSync('tar', ['-xzf', tgz, '-C', VENDOR, '--strip-components=1'], { stdio: 'inherit' });
        if (t.status === 0 && fs.existsSync(path.join(VENDOR, 'package.json'))) { ok = true; break; }
      } catch (e) { log(`failed: ${e.message}`); }
    }
    fs.rmSync(tgz, { force: true });
    if (!ok) throw new Error('could not download libsignal (is outbound internet to github.com allowed?)');
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));
  pkg.overrides = { ...pkg.overrides, libsignal: 'file:./vendor/libsignal' };
  fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n');
}

async function ensureDeps() {
  if (!missing().length) return;
  log(`installing: ${missing().join(', ')}`);
  if (npmInstall() && !missing().length) return;

  log('normal install failed (git/remote packages blocked?), using local libsignal fallback...');
  await vendorLibsignal();
  if (npmInstall() && !missing().length) return;
  if (npmInstall() && !missing().length) return; // one more try for flaky networks

  throw new Error(`still missing: ${missing().join(', ')}`);
}

ensureDeps()
  .then(() => require('./bot'))
  .catch((e) => {
    console.error(`❌ Setup failed: ${e.message}`);
    console.error('Scroll up for the npm error. Make sure the server has internet access.');
    process.exit(1);
  });
