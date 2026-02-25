import type { proto } from '@whiskeysockets/baileys';

export function extractRawType(message: proto.IWebMessageInfo): string | null {
  if (!message.message) return null;
  const keys = Object.keys(message.message);
  return keys.length > 0 ? keys[0] : null;
}

export function extractMessageText(message: proto.IWebMessageInfo): string {
  const payload = message.message;
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

export function isGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid && jid.endsWith('@g.us'));
}

export function isStatusJid(jid: string | null | undefined): boolean {
  return jid === 'status@broadcast';
}

export function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return '';
  return jid.split('@')[0] ?? '';
}

export function normalizePhoneToJid(phoneOrJid: string): string {
  const value = phoneOrJid.trim();
  if (value.includes('@')) return value;
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 10) {
    throw new Error('Invalid phone number');
  }
  return `${digits}@s.whatsapp.net`;
}

