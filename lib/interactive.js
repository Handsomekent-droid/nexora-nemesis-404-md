/**
 * WhatsApp "native flow" interactive message (picture header + body + footer + buttons),
 * the style with "Visit My Creator" (link button) and "See all options" (pop-up list).
 *
 * Baileys has no helper for this, so it is built by hand and relayed with the extra "biz" node
 * WhatsApp expects. Rendering depends on the recipient's WhatsApp version and on the account type —
 * so the caller (the .menu command) always has a plain-text fallback, and MENU_STYLE=classic in
 * .env turns this off entirely.
 */
const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = require('@whiskeysockets/baileys');
const ownmsgs = require('./ownmsgs');

const btn = (name, params) => ({ name, buttonParamsJson: JSON.stringify(params) });
const urlButton = (text, url) => btn('cta_url', { display_text: text, url, merchant_url: url });
const copyButton = (text, code) => btn('cta_copy', { display_text: text, copy_code: code });
const listButton = (title, sections) => btn('single_select', { title, sections });

async function sendInteractive(sock, jid, { image, title = '', body, footer = '', buttons }, quoted) {
  let header = { title, subtitle: '', hasMediaAttachment: false };
  if (image) {
    const media = await prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer });
    header = { ...header, hasMediaAttachment: true, imageMessage: media.imageMessage };
  }
  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          header,
          body: { text: body },
          footer: { text: footer },
          nativeFlowMessage: { buttons, messageParamsJson: '' }
        })
      }
    }
  };
  const msg = generateWAMessageFromContent(jid, content, { quoted, userJid: sock.user?.id });
  const isGroup = jid.endsWith('@g.us');
  const additionalNodes = [{
    tag: 'biz', attrs: {},
    content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }]
  }];
  if (!isGroup) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  ownmsgs.mark(msg.key.id);
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes });
  return msg;
}

module.exports = { sendInteractive, urlButton, copyButton, listButton };
