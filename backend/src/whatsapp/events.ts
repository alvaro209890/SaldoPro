import { extractMessageContent, type proto } from '@whiskeysockets/baileys';

function getMessageContent(message: proto.IWebMessageInfo): proto.IMessage | undefined {
  return extractMessageContent(message.message);
}

export function extractRawType(message: proto.IWebMessageInfo): string | null {
  const content = getMessageContent(message);
  if (!content) return null;
  const keys = Object.keys(content);
  return keys.length > 0 ? keys[0] : null;
}

export function extractMessageText(message: proto.IWebMessageInfo): string {
  const payload = getMessageContent(message);
  if (!payload) return '';

  if (payload.conversation) return payload.conversation;
  if (payload.extendedTextMessage?.text) return payload.extendedTextMessage.text;
  if (payload.imageMessage?.caption) return payload.imageMessage.caption;
  if (payload.videoMessage?.caption) return payload.videoMessage.caption;
  if (payload.documentMessage?.caption) return payload.documentMessage.caption;
  if (payload.buttonsResponseMessage?.selectedDisplayText) {
    return payload.buttonsResponseMessage.selectedDisplayText;
  }
  if (payload.listResponseMessage?.title) return payload.listResponseMessage.title;
  if (payload.templateButtonReplyMessage?.selectedDisplayText) {
    return payload.templateButtonReplyMessage.selectedDisplayText;
  }

  return '';
}

export function isImageMessage(message: proto.IWebMessageInfo): boolean {
  const payload = getMessageContent(message);
  return Boolean(payload?.imageMessage);
}

export function getImageMimeType(message: proto.IWebMessageInfo): string | null {
  const payload = getMessageContent(message);
  const mimeType = payload?.imageMessage?.mimetype;
  if (!mimeType || typeof mimeType !== 'string') return null;
  return mimeType;
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid && jid.endsWith('@g.us'));
}

export function isStatusJid(jid: string | null | undefined): boolean {
  return jid === 'status@broadcast';
}

export function normalizePhoneNumber(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[^\d]/g, '');
}

export function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return '';
  return normalizePhoneNumber(jid.split('@')[0] ?? '');
}

export function normalizePhoneToJid(phoneOrJid: string): string {
  const value = phoneOrJid.trim();
  if (value.includes('@')) return value;
  const digits = normalizePhoneNumber(value);
  if (digits.length < 10) {
    throw new Error('Invalid phone number');
  }
  return `${digits}@s.whatsapp.net`;
}
