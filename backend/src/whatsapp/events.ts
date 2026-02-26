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

export function isAudioMessage(message: proto.IWebMessageInfo): boolean {
  const payload = getMessageContent(message);
  return Boolean(payload?.audioMessage || payload?.ptvMessage);
}

export function getAudioMimeType(message: proto.IWebMessageInfo): string | null {
  const payload = getMessageContent(message);
  const mimeType = payload?.audioMessage?.mimetype || payload?.ptvMessage?.mimetype;
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

/**
 * Generates all possible Brazilian phone number variants to handle:
 * - Country code 55 present or absent
 * - Mobile "9" digit present or absent (added to BR mobiles but WhatsApp JIDs often omit it)
 *
 * Example: user registers "66984396232", WhatsApp JID comes as "556684396232"
 * This function generates: ["5566984396232","556684396232","66984396232","6684396232"]
 */
export function brazilianPhoneVariants(phone: string): string[] {
  const digits = normalizePhoneNumber(phone);
  if (!digits || digits.length < 10 || digits.length > 13) return [digits];

  let areaCode: string;
  let localNumber: string;

  if (digits.startsWith('55') && digits.length >= 12) {
    areaCode = digits.slice(2, 4);
    localNumber = digits.slice(4);
  } else if (digits.length <= 11) {
    areaCode = digits.slice(0, 2);
    localNumber = digits.slice(2);
  } else {
    return [digits];
  }

  let base8: string;
  if (localNumber.length === 9 && localNumber.startsWith('9')) {
    base8 = localNumber.slice(1);
  } else if (localNumber.length === 8) {
    base8 = localNumber;
  } else {
    return [digits];
  }

  return [
    `55${areaCode}9${base8}`,  // 13 digits — full with 9
    `55${areaCode}${base8}`,   // 12 digits — full without 9 (common in WhatsApp JIDs)
    `${areaCode}9${base8}`,    // 11 digits — no country code, with 9
    `${areaCode}${base8}`      // 10 digits — no country code, no 9
  ];
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
