"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRawType = extractRawType;
exports.extractMessageText = extractMessageText;
exports.isImageMessage = isImageMessage;
exports.getImageMimeType = getImageMimeType;
exports.isAudioMessage = isAudioMessage;
exports.getAudioMimeType = getAudioMimeType;
exports.isGroupJid = isGroupJid;
exports.isStatusJid = isStatusJid;
exports.normalizePhoneNumber = normalizePhoneNumber;
exports.brazilianPhoneVariants = brazilianPhoneVariants;
exports.jidToPhone = jidToPhone;
exports.normalizePhoneToJid = normalizePhoneToJid;
const baileys_1 = require("@whiskeysockets/baileys");
function getMessageContent(message) {
    return (0, baileys_1.extractMessageContent)(message.message);
}
function extractRawType(message) {
    const content = getMessageContent(message);
    if (!content)
        return null;
    const keys = Object.keys(content);
    return keys.length > 0 ? keys[0] : null;
}
function extractMessageText(message) {
    const payload = getMessageContent(message);
    if (!payload)
        return '';
    if (payload.conversation)
        return payload.conversation;
    if (payload.extendedTextMessage?.text)
        return payload.extendedTextMessage.text;
    if (payload.imageMessage?.caption)
        return payload.imageMessage.caption;
    if (payload.videoMessage?.caption)
        return payload.videoMessage.caption;
    if (payload.documentMessage?.caption)
        return payload.documentMessage.caption;
    if (payload.buttonsResponseMessage?.selectedDisplayText) {
        return payload.buttonsResponseMessage.selectedDisplayText;
    }
    if (payload.listResponseMessage?.title)
        return payload.listResponseMessage.title;
    if (payload.templateButtonReplyMessage?.selectedDisplayText) {
        return payload.templateButtonReplyMessage.selectedDisplayText;
    }
    return '';
}
function isImageMessage(message) {
    const payload = getMessageContent(message);
    return Boolean(payload?.imageMessage);
}
function getImageMimeType(message) {
    const payload = getMessageContent(message);
    const mimeType = payload?.imageMessage?.mimetype;
    if (!mimeType || typeof mimeType !== 'string')
        return null;
    return mimeType;
}
function isAudioMessage(message) {
    const payload = getMessageContent(message);
    return Boolean(payload?.audioMessage || payload?.ptvMessage);
}
function getAudioMimeType(message) {
    const payload = getMessageContent(message);
    const mimeType = payload?.audioMessage?.mimetype || payload?.ptvMessage?.mimetype;
    if (!mimeType || typeof mimeType !== 'string')
        return null;
    return mimeType;
}
function isGroupJid(jid) {
    return Boolean(jid && jid.endsWith('@g.us'));
}
function isStatusJid(jid) {
    return jid === 'status@broadcast';
}
function normalizePhoneNumber(value) {
    if (!value)
        return '';
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
function brazilianPhoneVariants(phone) {
    const digits = normalizePhoneNumber(phone);
    if (!digits || digits.length < 10 || digits.length > 13)
        return [digits];
    let areaCode;
    let localNumber;
    if (digits.startsWith('55') && digits.length >= 12) {
        areaCode = digits.slice(2, 4);
        localNumber = digits.slice(4);
    }
    else if (digits.length <= 11) {
        areaCode = digits.slice(0, 2);
        localNumber = digits.slice(2);
    }
    else {
        return [digits];
    }
    let base8;
    if (localNumber.length === 9 && localNumber.startsWith('9')) {
        base8 = localNumber.slice(1);
    }
    else if (localNumber.length === 8) {
        base8 = localNumber;
    }
    else {
        return [digits];
    }
    return [
        `55${areaCode}9${base8}`, // 13 digits — full with 9
        `55${areaCode}${base8}`, // 12 digits — full without 9 (common in WhatsApp JIDs)
        `${areaCode}9${base8}`, // 11 digits — no country code, with 9
        `${areaCode}${base8}` // 10 digits — no country code, no 9
    ];
}
function jidToPhone(jid) {
    if (!jid)
        return '';
    // Strip the @domain part, then strip the :device suffix (multi-device JIDs like "5566984396232:15@s.whatsapp.net")
    const userPart = jid.split('@')[0] ?? '';
    const phoneOnly = userPart.split(':')[0] ?? '';
    return normalizePhoneNumber(phoneOnly);
}
function normalizePhoneToJid(phoneOrJid) {
    const value = phoneOrJid.trim();
    if (value.includes('@'))
        return value;
    const digits = normalizePhoneNumber(value);
    const normalizedDigits = digits.length === 10 || digits.length === 11
        ? `55${digits}`
        : digits;
    // E.164 supports up to 15 digits. Longer numeric IDs are not phone numbers.
    if (normalizedDigits.length < 12 || normalizedDigits.length > 15) {
        throw new Error('Invalid phone number');
    }
    return `${normalizedDigits}@s.whatsapp.net`;
}
