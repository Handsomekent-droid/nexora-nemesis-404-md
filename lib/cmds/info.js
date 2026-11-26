/** Bot information commands. */
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = (H) => {
  const { config } = H;
  const LOCK = { owner: '🔒', root: '🔐', admin: '🛡' };
  const roots = () => [...new Set([config.OWNER_NUMBER, ...(config.OWNER_NUMBERS || [])])];
  const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
  const inCat = (key) => Object.values(H.commands).filter((c) => c.cat === key || (c.alsoIn || []).includes(key));
  const shown = () => H.CATEGORIES.map((c) => ({ ...c, list: inCat(c.key) })).filter((c) => c.list.length);
  const sessions = () => { try { const wa = H.wa(); const ids = wa.sessionIds(); return { total: ids.length, online: ids.filter((i) => wa.isOnline(i)).length }; } catch { return { total: 0, online: 0 }; } };
  const baileysVersion = () => { try { return require('@whiskeysockets/baileys/package.json').version; } catch { return 'unknown'; } };
  const link = (u) => (u ? `${u}` : '');

  const fullMenu = (prefix) => shown().map((c) => H.box(`${c.icon} ${H.sc(c.key === 'custom' ? 'more' : c.key)} ${H.sc('menu')} ⟨${c.list.length}⟩`,
    c.list.map((cmd) => `✦ ${prefix}${cmd.name}${LOCK[H.accessOf(cmd)] ? ' ' + LOCK[H.accessOf(cmd)] : ''}`))).join('\n\n');

  return {
    about: {
      cat: 'info', usage: 'about', desc: 'about this bot',
      run: ({ reply, prefix }) => reply([
        `*${config.BOT_NAME}*`, '',
        'A multi-device WhatsApp bot with downloads, utilities, media tools, games, group management and moderation.', '',
        `👑 Developer: ${H.footer()}`, `🔖 Build: ${H.VERSION}`, `⚙️ Prefix: ${prefix}`, `📦 Commands: ${Object.keys(H.commands).length}`,
        `Send ${prefix}menu to see everything.`].join('\n'))
    },
    ownerinfo: {
      cat: 'info', usage: 'ownerinfo', desc: 'owner contact card',
      run: async ({ sock, jid, m, reply }) => {
        const nums = roots();
        const contacts = nums.map((n, i) => ({ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${config.DEV}${i ? ` (${i + 1})` : ''}\nORG:${config.APP_NAME};\nTEL;type=CELL;type=VOICE;waid=${n}:+${n}\nEND:VCARD` }));
        await sock.sendMessage(jid, { contacts: { displayName: config.DEV, contacts } }, { quoted: m });
        await reply(`👑 *${config.DEV}*\n${nums.map((n) => `📞 wa.me/${n}`).join('\n')}${config.OWNER_TG ? `\n✈️ t.me/${config.OWNER_TG}` : ''}`);
      }
    },
    botinfo: {
      cat: 'info', usage: 'botinfo', desc: 'bot details',
      run: ({ reply, prefix }) => {
        const s = sessions();
        return reply([
          `🤖 *Name:* ${config.BOT_NAME}`, `🔖 *Build:* ${H.VERSION}`, `👑 *Developer:* ${H.footer()}`, `⚙️ *Prefix:* ${prefix}`,
          `🌐 *Mode:* ${config.PUBLIC_MODE ? 'Public' : 'Private'}`, `📦 *Commands:* ${Object.keys(H.commands).length} in ${shown().length} categories`,
          `📶 *Sessions:* ${s.online} online / ${s.total}`, `🟢 *Node:* ${process.version}`, `💾 *Memory:* ${mb(process.memoryUsage().rss)}`,
          `⏱ *Uptime:* ${H.uptimeShort(Date.now() - H.startedAt)}`].join('\n'));
      }
    },
    version: {
      cat: 'info', usage: 'version', desc: 'bot + library versions',
      run: ({ reply }) => reply(`🔖 *${config.APP_NAME}*\nBuild: ${H.VERSION}\nBaileys: ${baileysVersion()}\nNode: ${process.version}`)
    },
    status: {
      cat: 'info', usage: 'status', desc: 'live bot status', cooldown: 3,
      run: async ({ reply, acct, rawSock, jid, m }) => {
        const S = H.settings.get(acct);
        const t0 = Date.now();
        const ss = sessions();
        const on = (v) => (v ? '✅' : '❌');
        const lag = Number(String(m?.messageTimestamp || 0)) * 1000;
        return reply([
          `🟢 *Online*`, `⏱ Uptime: ${H.uptimeShort(Date.now() - H.startedAt)}`, `💾 Memory: ${mb(process.memoryUsage().rss)} · Load: ${os.loadavg()[0].toFixed(2)}`,
          `📶 Sessions: ${ss.online}/${ss.total}`, lag ? `⚡ Message delay: ${Math.max(0, t0 - lag)} ms` : '', '',
          `🛠 Maintenance: ${on(S.maintenance)}`, `👁 Auto-read: ${on(S.autoread)}  ⌨️ Typing: ${on(S.autotyping)}`,
          `😀 Auto-react: ${on(S.autoreact)}  💬 Auto-reply: ${on(S.autoreply?.on)}`, `📦 Commands run here: ${S.commandsRun || 0}`
        ].filter((x) => x !== '').join('\n'));
      }
    },
    support: {
      cat: 'info', usage: 'support', desc: 'support groups & channels',
      run: ({ reply }) => reply([
        '💬 *Support & community*', '',
        ...(config.WA_GROUPS || []).map((g) => `👥 WhatsApp group: ${String(g).split('?')[0]}`),
        ...(config.WA_CHANNELS || []).map((c) => `📢 WhatsApp channel: ${c}`),
        ...(config.TG_CHATS || []).map((c) => `✈️ ${c.label}: ${c.link}`), '',
        `👑 Owner: wa.me/${config.OWNER_NUMBER}`].join('\n'))
    },
    repository: {
      cat: 'info', usage: 'repository', desc: 'source code', aliases: ['repo', 'source'],
      run: ({ reply }) => reply(config.REPO_URL
        ? `📂 *Source code*\n${link(config.REPO_URL)}`
        : `📂 The source code of ${config.APP_NAME} is private.\nFor access or questions, contact the owner: wa.me/${config.OWNER_NUMBER}`)
    },
    commands: {
      cat: 'info', usage: 'commands [category]', desc: 'command counts per category',
      run: ({ reply, args, prefix }) => {
        const want = (args[0] || '').toLowerCase();
        const cats = shown();
        if (want) {
          const c = cats.find((x) => x.key === want);
          if (!c) return reply(`⚠️ No category "${want}". Categories: ${cats.map((x) => x.key).join(', ')}`);
          return reply(`${c.icon} *${c.key}* (${c.list.length})\n${c.list.map((x) => prefix + x.name).join(', ')}`);
        }
        return reply([`📚 *${Object.keys(H.commands).length} commands*`, '', ...cats.map((c) => `${c.icon} ${c.key}: ${c.list.length}`), '', `Use ${prefix}commands <category> to list one, or ${prefix}allmenu for everything.`].join('\n'));
      }
    },
    allmenu: {
      cat: 'info', usage: 'allmenu', desc: 'every command in one message', cooldown: 10,
      run: async ({ sock, jid, m, prefix }) => {
        const head = `꧁༺ *${H.sc(config.BOT_NAME)}* ༻꧂\n${H.sc('build')} ${H.VERSION} · ${Object.keys(H.commands).length} ${H.sc('commands')}\n${LOCK.admin} group admin · ${LOCK.owner} owner/sudo · ${LOCK.root} bot host\n\n`;
        const text = head + fullMenu(prefix) + `\n\n✦ ${H.sc('developed by')} ${H.sc(H.footer())} 👑`;
        // WhatsApp text limit is generous but keep chunks readable
        const parts = [];
        let cur = '';
        for (const block of text.split('\n\n')) {
          if ((cur + '\n\n' + block).length > 3500) { parts.push(cur); cur = block; } else cur = cur ? cur + '\n\n' + block : block;
        }
        if (cur) parts.push(cur);
        for (const p of parts) await sock.sendMessage(jid, { text: p }, { quoted: m });
      }
    }
  };
};
