/**
 * Owner protection layer — runs before anything else touches a message.
 * Keeps the bot alive and keeps garbage out of the command pipeline, in every chat (DM and group).
 */

// Toggle at runtime with .antibug on/off (in-memory; defaults ON every start, which is the safe default).
let enabled = true;
const setEnabled = (v) => (enabled = v);
const isEnabled = () => enabled;

const blocked = new Set(); // jids we've already blocked this run, so we don't spam groupParticipantsUpdate/block calls

// Known crash/attack shapes sent as normal-looking WhatsApp messages:
//  - thousands of fake @mentions in one message (mention-flood crash bug)
//  - RTL/invisible override characters used to corrupt rendering or break parsers
//  - a single absurdly long text blob
//  - a malformed/oversized raw payload
const RTL_FLOOD = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F]{30,}/;
const MAX_TEXT = 55000;
const MAX_MENTIONS = 500;
const MAX_RAW = 300000; // bytes of the raw message object — legit messages never get near this

function inspect(m, body, ctxInfo) {
  if (!enabled) return null;
  if ((ctxInfo?.mentionedJid?.length || 0) > MAX_MENTIONS) return 'mention-flood';
  if (body && body.length > MAX_TEXT) return 'oversized text';
  if (body && RTL_FLOOD.test(body)) return 'invisible-character flood';
  try { if (Buffer.byteLength(JSON.stringify(m.message)) > MAX_RAW) return 'oversized payload'; } catch { return 'unreadable payload'; }
  return null;
}

// Runs for every incoming message, before anything else is parsed. Returns true if the message
// was neutralised and must not be processed any further (no reply is ever sent back to the sender —
// replying confirms the bot is alive and worth attacking again).
async function guard(rawSock, m, body, ctxInfo) {
  if (m.key.fromMe) return false; // never flag the owner's own messages (e.g. .spam output)
  const reason = inspect(m, body, ctxInfo);
  if (!reason) return false;

  const jid = m.key.remoteJid;
  const sender = m.key.participant || m.participant || jid;
  console.error(`[antibug] blocked a ${reason} message from ${sender} in ${jid}`);

  try { await rawSock.sendMessage(jid, { delete: m.key }); } catch {}
  if (!blocked.has(sender) && !m.key.fromMe) {
    blocked.add(sender);
    try { await rawSock.updateBlockStatus(sender, 'block'); } catch {}
  }
  return true;
}

module.exports = { guard, setEnabled, isEnabled };
