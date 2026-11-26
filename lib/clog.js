/**
 * 🎨 Colored console logging (Build 41) — no npm package needed, just raw ANSI codes, so it needs
 * nothing installed and nothing downloaded. Purely cosmetic: never touches what gets sent on WhatsApp,
 * never prints a key/password/session file, and is safe to leave off entirely (DEBUG_TRACE=0).
 */
const RESET = '\x1b[0m';
const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m' };
// Most panels (Pterodactyl etc.) show a real terminal to the person even though Node sees a non-TTY pipe,
// so colors stay ON by default; only NO_COLOR=1 in .env turns them off.
const NO_COLOR = process.env.NO_COLOR === '1';
const paint = (code, s) => (NO_COLOR ? s : `${code}${s}${RESET}`);
const c = { dim: (s) => paint(C.dim, s), bold: (s) => paint(C.bold, s), red: (s) => paint(C.red, s), green: (s) => paint(C.green, s),
  yellow: (s) => paint(C.yellow, s), blue: (s) => paint(C.blue, s), magenta: (s) => paint(C.magenta, s), cyan: (s) => paint(C.cyan, s) };

const bar = (ch, n, color) => (color ? c[color](ch.repeat(n)) : ch.repeat(n));

// a boxed banner: box('TRUTH-MD', ['line one', 'line two'], 'cyan')
function box(title, lines, color = 'cyan') {
  const top = `${bar('━', 1, color)} ${c.bold(title)} ${bar('━', 1, color)}`;
  const body = lines.map((l) => `${c[color] ? c[color]('»') : '»'} ${l}`).join('\n');
  console.log(`${top}\n${body}`);
}

// per-message trace line, same shape as other well-known bots' console output — console only, never sent anywhere
const TRACE_ON = process.env.DEBUG_TRACE !== '0';
function trace({ id, type, from, name, chat, body, startedAt }) {
  if (!TRACE_ON) return;
  const delay = startedAt ? `${((Date.now() - startedAt) / 1000).toFixed(2)}s` : '—';
  const time = new Date().toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const short = String(body || '').replace(/\s+/g, ' ').slice(0, 160);
  console.log(
    `${c.dim(bar('─', 20, 'blue'))} ${c.magenta('⌬')} ${c.bold(id)} ${c.dim(bar('─', 20, 'yellow'))}\n` +
    `${c.magenta('»')} ${c.dim('Type:')} ${c.yellow(type)}\n` +
    `${c.magenta('»')} ${c.dim('Time:')} ${c.yellow(time)}\n` +
    `${c.magenta('»')} ${c.dim('Delay:')} ${c.green(delay)}\n` +
    `${c.magenta('»')} ${c.dim('Sender:')} ${c.cyan(from || '—')}\n` +
    `${c.magenta('»')} ${c.dim('Name:')} ${c.cyan(name || '—')}\n` +
    `${c.magenta('»')} ${c.dim('Chat:')} ${c.blue(chat || '—')}` +
    (short ? `\n${c.magenta('»')} ${c.dim('Message:')} ${short}` : '')
  );
}

function connected({ id, botName, build, startedAt, mode, prefix }) {
  const startup = startedAt ? `${((Date.now() - startedAt) / 1000).toFixed(1)}s` : '—';
  box(`✅ ${botName} CONNECTED`, [
    `${c.dim('Session:')} ${c.cyan(id)}`,
    `${c.dim('Build:')} ${c.yellow(build)}`,
    `${c.dim('Startup:')} ${c.green(startup)}`,
    `${c.dim('Mode:')} ${c.cyan(mode)}`,
    `${c.dim('Prefix:')} ${c.yellow(prefix)}`,
    `${c.dim('Time:')} ${new Date().toLocaleString('en-GB', { hour12: true })}`
  ], 'green');
}

module.exports = { c, box, bar, trace, connected };
