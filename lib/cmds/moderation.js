/**
 * Moderation module: report / ban / unban / clearwarns / antibot / modlogs / filter / unfilter /
 * blacklist / whitelist (cat moderation) and mute / unmute / antibadword / antiflood / antitag (cat group).
 *
 * ONE message hook enforces everything per group (muted, banned, antibot, blacklist words,
 * flood, filters) and ONE participants hook removes banned users who rejoin. Hooks never throw,
 * never touch admins / owner / sudo / the bot itself, and only act while the bot is a group admin.
 */
module.exports = (H) => {
  const { groups, userPart, getMeta, isAdmin, botAdmin, removeMember, warnUser, getTargets, getCtxInfo, tagOf, P, usage, hooks } = H;

  /* ---------- helpers ---------- */
  // Older group entries may lack the newer keys: always read through this
  const G = (jid) => {
    const g = groups.get(jid) || {};
    return {
      muted: g.muted || [], banned: g.banned || [], blacklist: g.blacklist || [], whitelist: g.whitelist || [],
      filters: g.filters || {}, modlogs: g.modlogs || [],
      antibadword: g.antibadword || 'off', antiflood: g.antiflood || 'off', antibot: g.antibot || 'off'
    };
  };
  const ensureArr = (g, k) => (Array.isArray(g[k]) ? g[k] : (g[k] = []));
  const ensureObj = (g, k) => (g[k] && typeof g[k] === 'object' && !Array.isArray(g[k]) ? g[k] : (g[k] = {}));
  const numOf = (jid) => userPart(jid);
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error('[moderation]', e?.message || 'unknown error'); return false; } };

  // lower-case, strip accents + zero-width/invisible characters, light leetspeak
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
  const normalise = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '').toLowerCase()
    .replace(/[01345 7@$!]/g, (c) => (c === ' ' ? ' ' : LEET[c] || c));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (text, word) => {
    if (!word) return false;
    return new RegExp(`(^|[^a-z0-9])${esc(word)}([^a-z0-9]|$)`, 'i').test(text);
  };
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[​-‏﻿]/g, '').toLowerCase();

  const del = (rawSock, jid, key) => rawSock.sendMessage(jid, { delete: key }).catch(() => {});
  const timeStr = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);
  const quotedText = (m) => {
    const q = H.unwrap({ ...(getCtxInfo(m).quotedMessage || {}) });
    return q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '';
  };
  const botIsAdmin = async (ctx) => {
    try { return botAdmin(await getMeta(ctx.rawSock, ctx.jid, true), ctx.rawSock) !== false; } catch { return true; }
  };
  const sayTo = (ctx, text, mentions = []) => ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.m });
  const selfNum = (ctx) => userPart(ctx.rawSock.user?.id);
  // targets minus the bot itself
  const targetsOf = (ctx, args = ctx.args) => getTargets(ctx.m, args).filter((j) => numOf(j) !== selfNum(ctx));

  /* ---------- in-memory counters (cleaned as they are used) ---------- */
  const floods = new Map();   // group:sender -> { times: [], texts: [{t, text}] }
  const botHits = new Map();  // group:sender -> count
  const filterSeen = new Map(); // group:word -> last reply time
  const prune = (map, cap = 3000) => { if (map.size > cap) for (const k of [...map.keys()].slice(0, cap / 2)) map.delete(k); };

  /* ---------- the message hook ---------- */
  const looksLikeBotId = (id) => typeof id === 'string' && id.length >= 22 && /^(BAE5|3EB0)/.test(id);

  async function punish(hctx, mode, reason) {
    const { rawSock, jid, sender } = hctx;
    if (mode === 'warn') await warnUser(rawSock, jid, sender, reason);
    else if (mode === 'kick') await removeMember(rawSock, jid, sender);
  }

  async function onMessage(hctx) {
    const { rawSock, sock, m, jid, body, isGroup, sender, senderNum, fromMe, rank, acct, prefix } = hctx;
    if (!isGroup || fromMe || rank > 0 || !sender || senderNum === acct) return false;

    const g = G(jid);
    const active = g.muted.length || g.banned.length || g.antibot !== 'off' || (g.antibadword !== 'off' && g.blacklist.length) ||
      g.antiflood !== 'off' || Object.keys(g.filters).length;
    if (!active) return false;

    let meta;
    try { meta = await getMeta(rawSock, jid); } catch { return false; }
    if (isAdmin(meta, sender)) return false;               // admins are never touched
    if (botAdmin(meta, rawSock) === false) return false;   // can't act without admin rights
    const exempt = g.whitelist.includes(senderNum);

    // muted: delete everything they send
    if (g.muted.includes(senderNum)) { await del(rawSock, jid, m.key); return true; }

    // banned user somehow speaking (rejoined while the hook missed it): remove
    if (g.banned.includes(senderNum)) {
      await del(rawSock, jid, m.key);
      await removeMember(rawSock, jid, sender);
      groups.log(jid, { type: 'ban-removed', target: senderNum, reason: 'banned user posted' });
      return true;
    }

    // antibot: messages with another bot's id pattern
    if (!exempt && g.antibot !== 'off' && looksLikeBotId(m.key.id)) {
      await del(rawSock, jid, m.key);
      const k = `${jid}:${senderNum}`;
      const n = (botHits.get(k) || 0) + 1;
      botHits.set(k, n); prune(botHits);
      groups.log(jid, { type: 'antibot', target: senderNum, reason: `bot-like message (${n}/3)` });
      if (n >= 3) {
        botHits.delete(k);
        await removeMember(rawSock, jid, sender);
        await sock.sendMessage(jid, { text: `🤖 @${senderNum} looked like a bot and was removed.`, mentions: [sender] });
      }
      return true;
    }

    // blacklist words
    if (!exempt && g.antibadword !== 'off' && g.blacklist.length && body) {
      const text = normalise(body);
      const hit = g.blacklist.find((w) => hasWord(text, normalise(w)));
      if (hit) {
        await del(rawSock, jid, m.key);
        groups.log(jid, { type: 'antibadword', target: senderNum, reason: `blacklisted word (${g.antibadword})` });
        await punish(hctx, g.antibadword, 'Using a blacklisted word');
        return true;
      }
    }

    // flood: too many messages quickly, or the same text repeated
    if (!exempt && g.antiflood !== 'off') {
      const now = Date.now();
      const k = `${jid}:${senderNum}`;
      const st = floods.get(k) || { times: [], texts: [] };
      st.times = st.times.filter((t) => now - t < 8000); st.times.push(now);
      st.texts = st.texts.filter((x) => now - x.t < 15000);
      const t = plain(body).trim();
      if (t) st.texts.push({ t: now, text: t });
      floods.set(k, st); prune(floods);
      const repeats = t ? st.texts.filter((x) => x.text === t).length : 0;
      if (st.times.length > 6 || repeats >= 4) {
        floods.delete(k);
        await del(rawSock, jid, m.key);
        groups.log(jid, { type: 'antiflood', target: senderNum, reason: repeats >= 4 ? 'repeated text' : 'message flood' });
        await warnUser(rawSock, jid, sender, 'Flooding the chat');
        return true;
      }
    }

    // filters: auto-reply on a whole-word match (never blocks commands)
    if (body && !body.startsWith(prefix)) {
      const keys = Object.keys(g.filters);
      if (keys.length) {
        const text = plain(body);
        const word = keys.find((w) => hasWord(text, plain(w)));
        if (word) {
          const fk = `${jid}:${word}`;
          const now = Date.now();
          if (now - (filterSeen.get(fk) || 0) > 20000) {
            filterSeen.set(fk, now); prune(filterSeen);
            await sock.sendMessage(jid, { text: g.filters[word] }, { quoted: m });
          }
        }
      }
    }
    return false;
  }
  hooks.message.push(safe(onMessage));

  /* ---------- the participants hook: banned users who rejoin ---------- */
  async function onParticipants({ rawSock, sock, ev }) {
    if (!ev || ev.action !== 'add' || !String(ev.id || '').endsWith('@g.us')) return;
    const g = G(ev.id);
    if (!g.banned.length) return;
    const joined = (ev.participants || []).map((p) => (typeof p === 'string' ? p : p?.id || p?.jid)).filter(Boolean);
    const bad = joined.filter((p) => g.banned.includes(numOf(p)));
    if (!bad.length) return;
    let meta;
    try { meta = await getMeta(rawSock, ev.id, true); } catch { return; }
    if (botAdmin(meta, rawSock) === false) return;
    for (const p of bad) {
      if (isAdmin(meta, p)) continue;
      if (await removeMember(rawSock, ev.id, p)) {
        groups.log(ev.id, { type: 'ban-removed', target: numOf(p), reason: 'banned user rejoined' });
        await sock.sendMessage(ev.id, { text: `🚫 @${numOf(p)} is banned from this group and was removed.`, mentions: [p] }).catch(() => {});
      }
    }
  }
  hooks.participants.push(safe(onParticipants));

  /* ---------- toggles ---------- */
  const toggleCmd = ({ key, label, modes, desc, helpLines }) => ({
    cat: 'group', usage: `${key} <${modes.join('|')}>`, desc, group: true,
    run: async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      const cur = G(ctx.jid)[key];
      if (!modes.includes(mode)) return ctx.reply(`🛡 *${label}:* ${cur.toUpperCase()}\n\n${helpLines(P())}\n\nAdmins, owner and sudo are never affected.`);
      groups.setMode(ctx.jid, key, mode);
      groups.log(ctx.jid, { type: key, by: ctx.senderNum, reason: `set to ${mode}` });
      const note = mode !== 'off' && !(await botIsAdmin(ctx)) ? '\n\n⚠️ This account is not an admin yet — make it admin so it can act.' : '';
      return ctx.reply(`🛡 ${label} set to *${mode.toUpperCase()}*${note}`);
    }
  });

  const commands = {};

  commands.report = {
    cat: 'moderation', access: 'public', group: true, cooldown: 30, usage: 'report <reason> (reply / @user)',
    desc: 'report a user or message to the group admins',
    run: async (ctx) => {
      const targets = targetsOf(ctx);
      const ci = getCtxInfo(ctx.m);
      const reason = ctx.text.replace(/@\d+/g, '').trim();
      if (!targets.length && !reason) return ctx.reply(`${usage('report <reason>')}\nReply to the message you are reporting, or tag the user.`);
      const meta = await getMeta(ctx.rawSock, ctx.jid, true).catch(() => null);
      const admins = (meta?.participants || []).filter((p) => p.admin).map((p) => p.id);
      const snippet = quotedText(ctx.m).slice(0, 200);
      const target = targets[0];
      const lines = [
        '🚨 *REPORT*',
        `👤 By: @${ctx.senderNum}`,
        ...(target ? [`🎯 User: @${numOf(target)}`] : []),
        `📝 Reason: ${reason || 'not given'}`,
        ...(snippet ? [`💬 Message: "${snippet}"`] : []),
        '', admins.length ? `Admins: ${tagOf(admins)}` : ''
      ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
      await ctx.sock.sendMessage(ctx.jid, { text: lines.join('\n'), mentions: [...new Set([ctx.sender, ...(target ? [target] : []), ...admins])] }, { quoted: ctx.m });
      groups.log(ctx.jid, { type: 'report', by: ctx.senderNum, target: target ? numOf(target) : null, reason: reason || snippet || 'reported' });
      void ci;
    }
  };

  commands.ban = {
    cat: 'moderation', admin: true, group: true, usage: 'ban @user|reply [reason]', desc: 'remove a user and block them from rejoining',
    run: async (ctx) => {
      const targets = targetsOf(ctx);
      if (!targets.length) return ctx.reply(`${usage('ban @user [reason]')} (or reply to their message)`);
      const reason = ctx.text.replace(/@\d+/g, '').replace(/\d{7,15}/g, '').trim() || 'no reason';
      const done = []; const skipped = [];
      for (const t of targets) {
        if (isAdmin(ctx.meta, t)) { skipped.push(t); continue; }
        groups.update(ctx.jid, (g) => { const a = ensureArr(g, 'banned'); if (!a.includes(numOf(t))) a.push(numOf(t)); });
        await removeMember(ctx.rawSock, ctx.jid, t);
        groups.log(ctx.jid, { type: 'ban', by: ctx.senderNum, target: numOf(t), reason });
        done.push(t);
      }
      if (done.length) await sayTo(ctx, `🔨 Banned ${tagOf(done)}\n📝 ${reason}`, done);
      if (skipped.length) await sayTo(ctx, `⚠️ ${tagOf(skipped)} ${skipped.length > 1 ? 'are admins' : 'is an admin'} — demote first, then ban.`, skipped);
    }
  };

  commands.unban = {
    cat: 'moderation', group: true, usage: 'unban @user|number', desc: 'let a banned user rejoin',
    run: async (ctx) => {
      const targets = targetsOf(ctx);
      if (!targets.length) return ctx.reply(`${usage('unban @user')} (or a phone number)`);
      const lifted = [];
      for (const t of targets) {
        if (G(ctx.jid).banned.includes(numOf(t))) {
          groups.update(ctx.jid, (g) => { g.banned = ensureArr(g, 'banned').filter((x) => x !== numOf(t)); });
          groups.log(ctx.jid, { type: 'unban', by: ctx.senderNum, target: numOf(t) });
          lifted.push(t);
        }
      }
      if (!lifted.length) return ctx.reply('ℹ️ That user is not banned here.');
      await sayTo(ctx, `✅ Unbanned ${tagOf(lifted)}`, lifted);
    }
  };

  commands.clearwarns = {
    cat: 'moderation', group: true, usage: 'clearwarns @user|all', desc: 'reset warnings for one user or everyone',
    run: async (ctx) => {
      if ((ctx.args[0] || '').toLowerCase() === 'all') {
        groups.update(ctx.jid, (g) => { g.warns = {}; });
        groups.log(ctx.jid, { type: 'clearwarns', by: ctx.senderNum, reason: 'everyone' });
        return ctx.reply('✅ Warnings cleared for everyone in this group.');
      }
      const targets = targetsOf(ctx);
      if (!targets.length) return ctx.reply(`${usage('clearwarns @user')} (or ${P()}clearwarns all)`);
      targets.forEach((t) => groups.resetWarn(ctx.jid, numOf(t)));
      groups.log(ctx.jid, { type: 'clearwarns', by: ctx.senderNum, target: targets.map(numOf).join(',') });
      await sayTo(ctx, `✅ Warnings cleared for ${tagOf(targets)}.`, targets);
    }
  };

  commands.antibot = {
    cat: 'moderation', group: true, usage: 'antibot <on|off>', desc: 'delete messages sent by other bots',
    run: async (ctx) => {
      const mode = (ctx.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(`🤖 *Antibot:* ${G(ctx.jid).antibot.toUpperCase()}\n\n${P()}antibot on — delete bot-looking messages (3 strikes = removed)\n${P()}antibot off — disable\n\nAdmins, owner, sudo and whitelisted users are never affected.`);
      }
      groups.setMode(ctx.jid, 'antibot', mode);
      groups.log(ctx.jid, { type: 'antibot', by: ctx.senderNum, reason: `set to ${mode}` });
      const note = mode === 'on' && !(await botIsAdmin(ctx)) ? '\n\n⚠️ This account is not an admin yet — make it admin so it can act.' : '';
      await ctx.reply(`🤖 Antibot set to *${mode.toUpperCase()}*${note}`);
    }
  };

  commands.modlogs = {
    cat: 'moderation', group: true, usage: 'modlogs [count]', desc: 'recent moderation actions (max 20)',
    run: async (ctx) => {
      const n = Math.min(20, Math.max(1, parseInt(ctx.args[0], 10) || 10));
      const logs = G(ctx.jid).modlogs.slice(-n).reverse();
      if (!logs.length) return ctx.reply('📜 No moderation actions logged yet.');
      const rows = logs.map((l) => `• ${timeStr(l.t)} — *${l.type}*${l.by ? ` by ${l.by}` : ''}${l.target ? ` → ${l.target}` : ''}${l.reason ? ` (${String(l.reason).slice(0, 80)})` : ''}`);
      await ctx.reply(`📜 *Moderation log* (last ${logs.length})\n\n${rows.join('\n')}`);
    }
  };

  commands.filter = {
    cat: 'moderation', group: true, usage: 'filter <word> <reply> | filter list', desc: 'auto-reply when a word is said',
    run: async (ctx) => {
      const [first, ...rest] = ctx.args;
      if (!first) return ctx.reply(`${usage('filter <word> <reply>')}\n${usage('filter list')}\n${usage('unfilter <word>')}`);
      if (first.toLowerCase() === 'list') {
        const keys = Object.keys(G(ctx.jid).filters);
        return ctx.reply(keys.length ? `🧷 *Filters (${keys.length})*\n${keys.map((k) => `• ${k}`).join('\n')}` : 'ℹ️ No filters set. Add one with filter <word> <reply>.');
      }
      const word = plain(first).replace(/[^a-z0-9_-]/g, '');
      const replyText = (rest.join(' ') || quotedText(ctx.m)).trim();
      if (!word || word.length > 30) return ctx.reply('⚠️ The filter word must be one short word (letters/numbers).');
      if (!replyText) return ctx.reply(`${usage('filter <word> <reply>')} (or reply to a message to use its text)`);
      if (replyText.length > 500) return ctx.reply('⚠️ The reply can be at most 500 characters.');
      if (Object.keys(G(ctx.jid).filters).length >= 50 && !G(ctx.jid).filters[word]) return ctx.reply('⚠️ Filter limit reached (50). Remove one with unfilter.');
      groups.update(ctx.jid, (g) => { ensureObj(g, 'filters')[word] = replyText; });
      groups.log(ctx.jid, { type: 'filter', by: ctx.senderNum, reason: `+${word}` });
      await ctx.reply(`✅ Filter added: *${word}*`);
    }
  };

  commands.unfilter = {
    cat: 'moderation', group: true, usage: 'unfilter <word>', desc: 'remove an auto-reply filter',
    run: async (ctx) => {
      const word = plain(ctx.args[0] || '').replace(/[^a-z0-9_-]/g, '');
      if (!word) return ctx.reply(usage('unfilter <word>'));
      if (!G(ctx.jid).filters[word]) return ctx.reply(`ℹ️ There is no filter called *${word}*.`);
      groups.update(ctx.jid, (g) => { delete ensureObj(g, 'filters')[word]; });
      groups.log(ctx.jid, { type: 'unfilter', by: ctx.senderNum, reason: `-${word}` });
      await ctx.reply(`🗑 Filter removed: *${word}*`);
    }
  };

  commands.blacklist = {
    cat: 'moderation', group: true, usage: 'blacklist add|remove|list <word>', desc: 'banned words (used by antibadword)',
    run: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const word = normalise(ctx.args.slice(1).join(' ')).trim();
      const list = G(ctx.jid).blacklist;
      if (sub === 'list') return ctx.reply(list.length ? `🚫 *Blacklisted words (${list.length})*\n${list.map((w) => `• ${w}`).join('\n')}` : 'ℹ️ The blacklist is empty.');
      if (!['add', 'remove'].includes(sub) || !word) return ctx.reply(`${usage('blacklist add <word>')}\n${usage('blacklist remove <word>')}\n${usage('blacklist list')}`);
      if (word.length > 40) return ctx.reply('⚠️ That word/phrase is too long (max 40 characters).');
      if (sub === 'add') {
        if (list.includes(word)) return ctx.reply('ℹ️ That word is already blacklisted.');
        if (list.length >= 200) return ctx.reply('⚠️ Blacklist limit reached (200).');
        groups.update(ctx.jid, (g) => { ensureArr(g, 'blacklist').push(word); });
        groups.log(ctx.jid, { type: 'blacklist', by: ctx.senderNum, reason: `+${word}` });
        return ctx.reply(`✅ Added to the blacklist.\n_Turn it on with ${P()}antibadword delete|warn|kick._`);
      }
      if (!list.includes(word)) return ctx.reply('ℹ️ That word is not on the blacklist.');
      groups.update(ctx.jid, (g) => { g.blacklist = ensureArr(g, 'blacklist').filter((w) => w !== word); });
      groups.log(ctx.jid, { type: 'blacklist', by: ctx.senderNum, reason: `-${word}` });
      await ctx.reply('🗑 Removed from the blacklist.');
    }
  };

  commands.whitelist = {
    cat: 'moderation', group: true, usage: 'whitelist add|remove|list @user', desc: 'exempt users from antibadword / antiflood / antibot',
    run: async (ctx) => {
      const sub = (ctx.args[0] || '').toLowerCase();
      const list = G(ctx.jid).whitelist;
      if (sub === 'list') {
        return ctx.sock.sendMessage(ctx.jid, {
          text: list.length ? `✅ *Whitelisted (${list.length})*\n${list.map((n) => `• @${n}`).join('\n')}` : 'ℹ️ Nobody is whitelisted.',
          mentions: list.map((n) => `${n}@s.whatsapp.net`)
        }, { quoted: ctx.m });
      }
      const targets = targetsOf(ctx, ctx.args.slice(1));
      if (!['add', 'remove'].includes(sub) || !targets.length) return ctx.reply(`${usage('whitelist add @user')}\n${usage('whitelist remove @user')}\n${usage('whitelist list')}`);
      const nums = targets.map(numOf);
      groups.update(ctx.jid, (g) => {
        const a = ensureArr(g, 'whitelist');
        g.whitelist = sub === 'add' ? [...new Set([...a, ...nums])] : a.filter((n) => !nums.includes(n));
      });
      groups.log(ctx.jid, { type: 'whitelist', by: ctx.senderNum, target: nums.join(','), reason: sub });
      await sayTo(ctx, `${sub === 'add' ? '✅ Whitelisted' : '🗑 Removed from whitelist:'} ${tagOf(targets)}`, targets);
    }
  };

  /* ---------- group-category toggles + mute ---------- */
  commands.mute = {
    cat: 'group', group: true, usage: 'mute [@user|reply]', desc: 'no name: only admins can chat | with a name: delete that member\'s messages',
    run: async (ctx) => {
      const targets = targetsOf(ctx);
      if (!targets.length) { // nobody named -> mute the whole group
        try { await ctx.rawSock.groupSettingUpdate(ctx.jid, 'announcement'); return ctx.reply('🔇 Group muted — only admins can send messages.\nUse .unmute to open it again.'); }
        catch (e) { return ctx.reply('❌ Failed. Make sure this account is a group admin.'); }
      }
      const meta = await getMeta(ctx.rawSock, ctx.jid, true).catch(() => null);
      const ok = targets.filter((t) => !(meta && isAdmin(meta, t)));
      if (!ok.length) return ctx.reply("⚠️ You can't mute an admin.");
      groups.update(ctx.jid, (g) => { g.muted = [...new Set([...ensureArr(g, 'muted'), ...ok.map(numOf)])]; });
      ok.forEach((t) => groups.log(ctx.jid, { type: 'mute', by: ctx.senderNum, target: numOf(t) }));
      const note = !(await botIsAdmin(ctx)) ? '\n\n⚠️ This account is not an admin yet, so it cannot delete their messages.' : '';
      await sayTo(ctx, `🔇 Muted ${tagOf(ok)} — their messages will be deleted.${note}`, ok);
    }
  };

  commands.unmute = {
    cat: 'group', group: true, usage: 'unmute [@user|reply]', desc: 'no name: everyone can chat again | with a name: let that member talk',
    run: async (ctx) => {
      const targets = targetsOf(ctx);
      if (!targets.length) { // nobody named -> open the whole group
        try { await ctx.rawSock.groupSettingUpdate(ctx.jid, 'not_announcement'); return ctx.reply('🔊 Group unmuted — everyone can send messages.'); }
        catch (e) { return ctx.reply('❌ Failed. Make sure this account is a group admin.'); }
      }
      const was = targets.filter((t) => G(ctx.jid).muted.includes(numOf(t)));
      if (!was.length) return ctx.reply('ℹ️ That user is not muted.');
      groups.update(ctx.jid, (g) => { g.muted = ensureArr(g, 'muted').filter((n) => !was.map(numOf).includes(n)); });
      was.forEach((t) => groups.log(ctx.jid, { type: 'unmute', by: ctx.senderNum, target: numOf(t) }));
      await sayTo(ctx, `🔊 Unmuted ${tagOf(was)}`, was);
    }
  };

  commands.antibadword = toggleCmd({
    key: 'antibadword', label: 'Antibadword', modes: ['off', 'delete', 'warn', 'kick'], desc: 'delete blacklisted words',
    helpLines: (p) => `${p}antibadword delete — delete the message\n${p}antibadword warn — delete + warn (${H.MAX_WARNS} warns = kick)\n${p}antibadword kick — delete + remove sender\n${p}antibadword off — disable\n\nManage words with ${p}blacklist add|remove|list.`
  });

  commands.antiflood = toggleCmd({
    key: 'antiflood', label: 'Antiflood', modes: ['off', 'on'], desc: 'on | off — stop rapid or repeated messages',
    helpLines: (p) => `${p}antiflood on — delete + warn for 7+ messages in 8s, or the same text 4 times in 15s\n${p}antiflood off — disable`
  });

  // antitag shares the existing antigroupmention setting (mass @mention spam), so both commands stay in sync
  commands.antitag = {
    cat: 'group', group: true, usage: 'antitag <on|off|delete|warn|kick>', desc: 'stop mass-tagging (same setting as antigroupmention)',
    run: async (ctx) => {
      const raw = (ctx.args[0] || '').toLowerCase();
      const mode = raw === 'on' ? 'delete' : raw;
      const cur = (groups.get(ctx.jid).antigroupmention || 'off');
      if (!['off', 'delete', 'warn', 'kick'].includes(mode)) {
        return ctx.reply(`🛡 *Antitag:* ${cur.toUpperCase()}\n\n${P()}antitag on|delete — delete mass-tag messages\n${P()}antitag warn — delete + warn\n${P()}antitag kick — delete + remove sender\n${P()}antitag off — disable\n\nTriggers at 5+ @mentions in one message.`);
      }
      groups.setMode(ctx.jid, 'antigroupmention', mode);
      groups.log(ctx.jid, { type: 'antitag', by: ctx.senderNum, reason: `set to ${mode}` });
      const note = mode !== 'off' && !(await botIsAdmin(ctx)) ? '\n\n⚠️ This account is not an admin yet — make it admin so it can act.' : '';
      await ctx.reply(`🛡 Antitag set to *${mode.toUpperCase()}*${note}`);
    }
  };

  return commands;
};
