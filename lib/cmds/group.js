/**
 * GROUP commands (module "group"). Access defaults to group-admin (core checks it);
 * read-only commands are `access: 'public'`. `admin: true` = the BOT must be admin too
 * (core runs needGroupAdmin and puts the group metadata in ctx.meta).
 *
 * Also registers: the welcome/goodbye participants hook and the vote message hook.
 */
module.exports = (H) => {
  const { userPart, usage, sleep, groups, config } = H;
  const P = H.P;

  const tag = (j) => '@' + userPart(j);
  const ids = (list) => list.map((p) => p.id || p.jid).filter(Boolean);
  const bareBot = (rawSock) => userPart(rawSock.user?.id);
  const isBotP = (rawSock, p) => {
    const u = rawSock.user || {};
    const me = [u.id, u.lid].filter(Boolean).map(userPart);
    return me.includes(userPart(p.id || p)) || (p.jid && me.includes(userPart(p.jid)));
  };
  const freshMeta = (ctx) => ctx.meta || H.getMeta(ctx.rawSock, ctx.jid, true);
  const notAdminMsg = '⚠️ Make this WhatsApp account an *admin* of the group first.';
  const failMsg = (e) => {
    console.error('[group]', e?.message || 'unknown error');
    return /not-authorized|forbidden|401|403/i.test(String(e?.message || e)) ? notAdminMsg : '❌ That did not work. Make sure this account is an admin of the group.';
  };
  const send = (ctx, text, mentions) => ctx.sock.sendMessage(ctx.jid, { text, ...(mentions ? { mentions } : {}) }, { quoted: ctx.m });

  /* ---------- welcome / goodbye ---------- */
  const DEFAULT_WELCOME = '👋 Welcome {user} to *{group}*!\nYou are member #{count}. Please read the group description.';
  const DEFAULT_GOODBYE = '👋 {user} left *{group}*. Goodbye!';
  const fill = (tpl, { users, group, count, desc }) => tpl
    .replace(/\{user\}/gi, users).replace(/\{group\}/gi, group)
    .replace(/\{count\}/gi, String(count)).replace(/\{desc\}/gi, desc || '');

  const toggleCmd = (key, label) => ({
    cat: 'group', alsoIn: ['owner'], group: true, usage: `${key} on|off|status`, desc: `${label} messages on/off`,
    run: async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      const g = groups.get(ctx.jid)[key];
      if (mode === 'on' || mode === 'off') {
        groups.update(ctx.jid, (x) => { x[key].on = mode === 'on'; });
        return ctx.reply(`✅ ${label} messages are now *${mode.toUpperCase()}*.${mode === 'on' && !g.text ? '\nUsing the default text — change it with ' + P() + 'set' + key + ' <text>.' : ''}`);
      }
      if (mode === 'status' || !mode) {
        return ctx.reply(`📋 *${label}:* ${g.on ? 'ON' : 'OFF'}\n*Text:* ${g.text || (key === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE)}\n\n${usage(`${key} on|off`)}\n${usage(`set${key} <text>`)}`);
      }
      return ctx.reply(usage(`${key} on|off|status`));
    }
  });

  const setTextCmd = (key, label) => ({
    cat: 'group', group: true, usage: `set${key} <text|reset>`, desc: `custom ${label} text`,
    run: async (ctx) => {
      if (!ctx.text) {
        return ctx.reply(`${usage(`set${key} <text>`)}\nPlaceholders: {user} {group} {count} {desc}\nExample: ${P()}set${key} Hi {user}, welcome to {group}!\n${usage(`set${key} reset`)} restores the default.`);
      }
      if (ctx.text.length > 800) return ctx.reply('⚠️ That text is too long (800 characters max).');
      const reset = ctx.text.toLowerCase() === 'reset';
      groups.update(ctx.jid, (x) => { x[key].text = reset ? '' : ctx.text; });
      return ctx.reply(reset ? `✅ ${label} text reset to the default.` : `✅ ${label} text saved.${groups.get(ctx.jid)[key].on ? '' : `\nTurn it on with ${P()}${key} on.`}`);
    }
  });

  const lastEvent = new Map(); // group jid -> time of last welcome/goodbye (max 1 per 3s)
  H.hooks.participants.push(async ({ rawSock, sock, ev }) => {
    if (!ev || !ev.id || !ev.id.endsWith('@g.us')) return;
    const kind = ev.action === 'add' ? 'welcome' : ev.action === 'remove' ? 'goodbye' : null;
    if (!kind) return;
    const g = groups.get(ev.id)[kind];
    if (!g.on) return;
    const people = (ev.participants || []).map((p) => (typeof p === 'string' ? p : p.id || p.jid)).filter(Boolean)
      .filter((p) => !isBotP(rawSock, p));
    if (!people.length) return;
    const now = Date.now();
    if (now - (lastEvent.get(ev.id) || 0) < 3000) return;
    lastEvent.set(ev.id, now);
    if (lastEvent.size > 500) lastEvent.delete(lastEvent.keys().next().value);

    let group = 'the group', count = '?', desc = '';
    try {
      const meta = await H.getMeta(rawSock, ev.id, true);
      group = meta.subject || group; count = meta.participants.length; desc = meta.desc || '';
    } catch {}
    const text = fill(g.text || (kind === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE),
      { users: people.map(tag).join(', '), group, count, desc });
    await sock.sendMessage(ev.id, { text, mentions: people });
  });

  /* ---------- votes (lightweight, text based) ---------- */
  H.hooks.message.push(async ({ jid, body, isGroup, senderNum, prefix, fromMe, m }) => {
    if (!isGroup || fromMe || !body || body.startsWith(prefix)) return false;
    if (!/^\d{1,2}$/.test(body)) return false;
    const v = groups.get(jid).votes;
    if (!v || !v.open) return false;
    const n = parseInt(body, 10);
    if (n < 1 || n > v.options.length) return false;
    groups.update(jid, (g) => { g.votes.votes[senderNum] = n - 1; });
    return false; // never swallow the message: other hooks (games etc.) still see it
  });

  const tally = (v) => {
    const counts = v.options.map(() => 0);
    Object.values(v.votes || {}).forEach((i) => { if (counts[i] !== undefined) counts[i]++; });
    const total = counts.reduce((a, b) => a + b, 0);
    return v.options.map((o, i) => {
      const pct = total ? Math.round((counts[i] / total) * 100) : 0;
      return `${i + 1}. ${o}\n   ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))} ${counts[i]} (${pct}%)`;
    }).join('\n') + `\n\n🗳 Total votes: *${total}*`;
  };

  /* ---------- pin duration ---------- */
  const PIN = { '24h': 86400, '1d': 86400, '7d': 604800, '30d': 2592000 };

  return {
    grouplink: {
      cat: 'group', group: true, admin: true, usage: 'grouplink', desc: 'invite link of this group',
      run: async (ctx) => {
        try {
          const code = await ctx.rawSock.groupInviteCode(ctx.jid);
          await ctx.reply(`🔗 *${ctx.meta?.subject || 'Group'}*\nhttps://chat.whatsapp.com/${code}`);
        } catch (e) { await ctx.reply(failMsg(e)); }
      }
    },

    invite: {
      cat: 'group', group: true, admin: true, usage: 'invite <number>', desc: 'DM the group link to a number',
      run: async (ctx) => {
        const num = (ctx.args[0] || '').replace(/\D/g, '');
        if (num.length < 7 || num.length > 15) return ctx.reply(`${usage('invite 2547XXXXXXXX')}\nNumber with country code, digits only.`);
        const jid = `${num}@s.whatsapp.net`;
        try {
          if (ctx.rawSock.onWhatsApp) {
            const r = await ctx.rawSock.onWhatsApp(jid).catch(() => null);
            if (Array.isArray(r) && r.length && r[0].exists === false) return ctx.reply('⚠️ That number is not on WhatsApp.');
          }
          const code = await ctx.rawSock.groupInviteCode(ctx.jid);
          await ctx.sock.sendMessage(jid, { text: `📨 You are invited to join *${ctx.meta?.subject || 'a group'}*:\nhttps://chat.whatsapp.com/${code}` });
          await ctx.reply(`✅ Invite sent to +${num}.`);
        } catch (e) { await ctx.reply(failMsg(e)); }
      }
    },

    admins: {
      cat: 'group', group: true, access: 'public', usage: 'admins', desc: 'list the group admins',
      run: async (ctx) => {
        let meta;
        try { meta = await freshMeta(ctx); } catch { return ctx.reply('⚠️ Could not read this group.'); }
        const list = meta.participants.filter((p) => p.admin);
        if (!list.length) return ctx.reply('ℹ️ No admins found.');
        const text = `👑 *Admins (${list.length})*\n\n${list.map((p, i) => `${i + 1}. ${tag(p.id)}${p.admin === 'superadmin' ? ' ⭐' : ''}`).join('\n')}`;
        await send(ctx, text, ids(list));
      }
    },

    members: {
      cat: 'group', group: true, access: 'public', usage: 'members', desc: 'member count + list',
      run: async (ctx) => {
        let meta;
        try { meta = await freshMeta(ctx); } catch { return ctx.reply('⚠️ Could not read this group.'); }
        const all = meta.participants;
        const shown = all.slice(0, 100);
        const text = `👥 *${meta.subject || 'Group'}*\nMembers: *${all.length}* · Admins: *${all.filter((p) => p.admin).length}*\n\n` +
          shown.map((p, i) => `${i + 1}. ${tag(p.id)}${p.admin ? ' 👑' : ''}`).join('\n') +
          (all.length > 100 ? `\n\n…and ${all.length - 100} more.` : '');
        await send(ctx, text, ids(shown));
      }
    },

    tagadmins: {
      cat: 'group', group: true, usage: 'tagadmins [message]', desc: 'tag all admins',
      run: async (ctx) => {
        let meta;
        try { meta = await freshMeta(ctx); } catch { return ctx.reply('⚠️ Could not read this group.'); }
        const list = meta.participants.filter((p) => p.admin);
        if (!list.length) return ctx.reply('ℹ️ No admins found.');
        await send(ctx, `📢 *Admins*${ctx.text ? `\n${ctx.text}` : ''}\n\n${list.map((p) => tag(p.id)).join(' ')}`, ids(list));
      }
    },

    tagmembers: {
      cat: 'group', group: true, usage: 'tagmembers [message]', desc: 'tag all non-admin members',
      run: async (ctx) => {
        let meta;
        try { meta = await freshMeta(ctx); } catch { return ctx.reply('⚠️ Could not read this group.'); }
        const list = meta.participants.filter((p) => !p.admin);
        if (!list.length) return ctx.reply('ℹ️ There are no non-admin members.');
        await send(ctx, `📢 *Members*${ctx.text ? `\n${ctx.text}` : ''}\n\n${list.map((p) => tag(p.id)).join(' ')}`, ids(list));
      }
    },

    kickall: {
      cat: 'group', group: true, admin: true, cooldown: 30, usage: 'kickall confirm', desc: 'remove every non-admin member',
      run: async (ctx) => {
        if ((ctx.args[0] || '').toLowerCase() !== 'confirm') {
          return ctx.reply(`⚠️ This removes *every non-admin member* (max 200) from the group.\nIf you are sure, send:\n*${P()}kickall confirm*`);
        }
        const me = bareBot(ctx.rawSock);
        const sender = userPart(ctx.sender);
        let targets = ctx.meta.participants
          .filter((p) => !p.admin && !isBotP(ctx.rawSock, p) && userPart(p.id) !== sender && userPart(p.id) !== ctx.senderNum && userPart(p.id) !== me)
          .map((p) => p.id);
        if (!targets.length) return ctx.reply('ℹ️ There are no non-admin members to remove.');
        const total = targets.length;
        targets = targets.slice(0, 200);
        await ctx.reply(`⏳ Removing *${targets.length}* member(s)${total > 200 ? ` (limit 200 of ${total})` : ''}...`);
        let ok = 0, failed = 0;
        for (let i = 0; i < targets.length; i += 5) {
          const batch = targets.slice(i, i + 5);
          try {
            const res = await ctx.rawSock.groupParticipantsUpdate(ctx.jid, batch, 'remove');
            if (Array.isArray(res)) res.forEach((r) => (String(r.status) === '200' ? ok++ : failed++));
            else ok += batch.length;
          } catch (e) { console.error('[kickall]', e?.message || 'unknown error'); failed += batch.length; }
          if (i + 5 < targets.length) await sleep(2000);
        }
        groups.log(ctx.jid, { action: 'kickall', by: ctx.senderNum, count: ok });
        await ctx.reply(`✅ Removed: *${ok}*${failed ? `\n❌ Failed: *${failed}*` : ''}`);
      }
    },

    lockinfo: {
      cat: 'group', group: true, admin: true, usage: 'lockinfo', desc: 'only admins can edit group info (name, icon)',
      run: async (ctx) => {
        try { await ctx.rawSock.groupSettingUpdate(ctx.jid, 'locked'); await ctx.reply('🔒 Group info is now locked — only admins can edit it.'); }
        catch (e) { await ctx.reply(failMsg(e)); }
      }
    },
    unlockinfo: {
      cat: 'group', group: true, admin: true, usage: 'unlockinfo', desc: 'everyone can edit group info (name, icon)',
      run: async (ctx) => {
        try { await ctx.rawSock.groupSettingUpdate(ctx.jid, 'unlocked'); await ctx.reply('🔓 Group info is now unlocked — everyone can edit it.'); }
        catch (e) { await ctx.reply(failMsg(e)); }
      }
    },

    welcome: toggleCmd('welcome', 'Welcome'),
    goodbye: toggleCmd('goodbye', 'Goodbye'),
    setwelcome: setTextCmd('welcome', 'Welcome'),
    setgoodbye: setTextCmd('goodbye', 'Goodbye'),

    setgpp: {
      cat: 'group', group: true, admin: true, usage: 'setgpp (send/reply to an image)', desc: 'change the group picture',
      run: async (ctx) => {
        let media;
        try { media = await H.media.getMedia(ctx, ['image']); } catch (e) { console.error('[setgpp]', e?.message || 'download failed'); return ctx.reply('❌ Could not read that image.'); }
        if (!media) return ctx.reply(`${usage('setgpp')} — send an image with this caption, or reply to an image with it.`);
        try {
          await ctx.rawSock.updateProfilePicture(ctx.jid, media.buffer);
          await ctx.reply('✅ Group picture updated.');
        } catch (e) { await ctx.reply(failMsg(e)); }
      }
    },

    vote: {
      cat: 'group', group: true, access: 'public', cooldown: 3, usage: 'vote <question> | opt1 | opt2 ...', desc: 'start a vote / vote result / vote end',
      run: async (ctx) => {
        const sub = (ctx.args[0] || '').toLowerCase();
        const cur = groups.get(ctx.jid).votes;
        const isAdm = async () => {
          if (ctx.rank >= 1) return true;
          try { return H.isAdmin(await H.getMeta(ctx.rawSock, ctx.jid), ctx.sender); } catch { return false; }
        };

        if (sub === 'result' || sub === 'results') {
          if (!cur) return ctx.reply('ℹ️ There is no vote in this group yet.');
          return ctx.reply(`🗳 *${cur.q}* ${cur.open ? '(open)' : '(closed)'}\n\n${tally(cur)}`);
        }
        if (sub === 'end' || sub === 'stop') {
          if (!cur || !cur.open) return ctx.reply('ℹ️ There is no open vote.');
          if (!(await isAdm())) return ctx.reply('🛡 Only group admins can end a vote.');
          groups.update(ctx.jid, (g) => { g.votes.open = false; });
          return ctx.reply(`🏁 *Vote closed:* ${cur.q}\n\n${tally(groups.get(ctx.jid).votes)}`);
        }

        const parts = ctx.text.split('|').map((x) => x.trim()).filter(Boolean);
        if (parts.length < 3) {
          return ctx.reply(`${usage('vote Best color? | Red | Blue | Green')}\nThen members vote by sending the option *number*.\n${usage('vote result')} · ${usage('vote end')}`);
        }
        if (cur?.open && !(await isAdm())) return ctx.reply(`⚠️ A vote is already running. Use ${P()}vote result, or ask an admin to ${P()}vote end.`);
        const [q, ...options] = parts;
        if (options.length > 10) return ctx.reply('⚠️ Maximum 10 options.');
        if (q.length > 200 || options.some((o) => o.length > 80)) return ctx.reply('⚠️ Question or an option is too long.');
        groups.update(ctx.jid, (g) => { g.votes = { q, options, votes: {}, open: true, by: ctx.senderNum, at: Date.now() }; });
        await ctx.reply(`🗳 *${q}*\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nVote by sending the *number* of your choice.\nResults: ${P()}vote result`);
      }
    },

    clear: {
      cat: 'group', usage: 'clear [n]', desc: "delete the bot's own recent messages here (default 10, max 50)",
      run: async (ctx) => {
        const n = Math.min(50, Math.max(1, parseInt(ctx.args[0], 10) || 10));
        const keys = (ctx.rawSock.__sentKeys?.get(ctx.jid) || []).slice(-n).reverse();
        if (!keys.length) return ctx.reply('ℹ️ I have no recent messages of mine in this chat to clear.');
        let done = 0;
        for (const key of keys) {
          try { await ctx.rawSock.sendMessage(ctx.jid, { delete: { ...key, fromMe: true } }); done++; }
          catch (e) { console.error('[clear]', e?.message || 'unknown error'); }
          await sleep(500);
        }
        ctx.rawSock.__sentKeys?.set(ctx.jid, (ctx.rawSock.__sentKeys.get(ctx.jid) || []).filter((k) => !keys.includes(k)));
        await ctx.sock.sendMessage(ctx.jid, { text: `🧹 Cleared *${done}* of my message(s).` });
      }
    },

    pin: {
      cat: 'group', group: true, admin: true, usage: 'pin [24h|7d|30d] (reply to a message)', desc: 'pin the replied message',
      run: async (ctx) => {
        const ci = H.getCtxInfo(ctx.m);
        if (!ci.stanzaId) return ctx.reply(`${usage('pin [24h|7d|30d]')} — reply to the message you want to pin.`);
        const dur = (ctx.args[0] || '7d').toLowerCase();
        if (!PIN[dur]) return ctx.reply(`⚠️ Duration must be 24h, 7d or 30d.\n${usage('pin 7d')}`);
        const key = { remoteJid: ctx.jid, id: ci.stanzaId, fromMe: userPart(ci.participant) === bareBot(ctx.rawSock), participant: ci.participant };
        try {
          await ctx.rawSock.sendMessage(ctx.jid, { pin: key, type: 1, time: PIN[dur] });
          await ctx.reply(`📌 Message pinned for *${dur}*.`);
        } catch (e) { console.error('[pin]', e?.message || 'unknown error'); await ctx.reply('❌ Could not pin that message. This account must be an admin (if only admins can edit info) and the message must still exist.'); }
      }
    },
    unpin: {
      cat: 'group', group: true, admin: true, usage: 'unpin (reply to the pinned message)', desc: 'unpin the replied message',
      run: async (ctx) => {
        const ci = H.getCtxInfo(ctx.m);
        if (!ci.stanzaId) return ctx.reply(`${usage('unpin')} — reply to the pinned message.`);
        const key = { remoteJid: ctx.jid, id: ci.stanzaId, fromMe: userPart(ci.participant) === bareBot(ctx.rawSock), participant: ci.participant };
        try {
          await ctx.rawSock.sendMessage(ctx.jid, { pin: key, type: 2 });
          await ctx.reply('📍 Message unpinned.');
        } catch (e) { console.error('[unpin]', e?.message || 'unknown error'); await ctx.reply('❌ Could not unpin that message.'); }
      }
    }
  };
};
