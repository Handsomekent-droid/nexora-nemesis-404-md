/**
 * 📟 Console pairing (Build 42) — for anyone who deploys this bot on their own panel/VPS.
 * If no WhatsApp number has ever been paired on this server, the console itself asks for one:
 * no Telegram bot, no website, no extra setup. Safe to leave running forever: it only listens,
 * never blocks the rest of the bot, and does nothing once a number is paired.
 */
const readline = require('readline');
const clog = require('./clog');

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function offer({ wa, db, config }) {
  if (wa.sessionIds().length > 0) return; // already paired at least one number — nothing to do

  console.log('');
  clog.box(`📟 ${config.BOT_NAME} — FIRST-TIME SETUP`, [
    'No WhatsApp number is paired on this server yet.',
    'Type a number below (with country code, no + or spaces) and press Enter.',
    'Example: 254712345678',
    `Prefer the website or Telegram instead? Just ignore this — it never interrupts anything else.`
  ], 'cyan');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // the host's console may not be interactive (CI, a first automated boot) — never crash the bot over that
  rl.on('error', () => {});
  process.stdin.on('error', () => {});

  let closed = false;
  rl.on('close', () => { closed = true; });

  while (!closed && wa.sessionIds().length === 0) {
    const raw = await ask(rl, '📱 WhatsApp number: ').catch(() => null);
    if (raw == null || closed) break;
    const phone = raw.replace(/[^\d]/g, '');
    if (phone.length < 7 || phone.length > 15) {
      console.log(clog.c.red('❌ That doesn\'t look like a real number. Include the country code, digits only.'));
      continue;
    }
    console.log(clog.c.dim(`⏳ Requesting a pairing code for +${phone}...`));
    try {
      await new Promise((resolve, reject) => {
        wa.start(phone, {
          phone,
          onCode: (code) => {
            clog.box('🔑 PAIRING CODE', [
              clog.c.bold(code),
              '',
              '1. Open WhatsApp on that phone',
              '2. Settings → Linked Devices → Link a Device',
              '3. Tap "Link with phone number instead"',
              '4. Enter the code above (expires in a few minutes)'
            ], 'yellow');
          },
          onOpen: (sock) => {
            db.set(phone, { pairedAt: Date.now(), status: 'active', lastActiveAt: Date.now() });
            clog.connected({ id: phone, botName: config.BOT_NAME, build: config.BUILD, startedAt: Date.now(), mode: 'public', prefix: config.PREFIX });
            sock.sendMessage(`${phone}@s.whatsapp.net`, { text: `✅ *${config.BOT_NAME} is connected!*\n\nSend *${config.PREFIX}menu* in any chat to see every command.\n\n> ${config.DEV}` }).catch(() => {});
            resolve();
          },
          onFail: (msg) => { console.log(clog.c.red(`❌ ${msg}`)); resolve(); },
          onLoggedOut: () => { console.log(clog.c.red('❌ WhatsApp logged this session out. Try pairing again.')); resolve(); },
          onState: () => {}
        }).catch(reject);
      });
    } catch (e) {
      console.log(clog.c.red(`❌ Could not start pairing: ${e?.message || 'unknown error'}`));
    }
  }
  rl.close();
}

module.exports = { offer };
