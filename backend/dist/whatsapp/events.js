"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRawType = extractRawType;
exports.extractMessageText = extractMessageText;
exports.isImageMessage = isImageMessage;
exports.getImageMimeType = getImageMimeType;
exports.isGroupJid = isGroupJid;
exports.isStatusJid = isStatusJid;
exports.normalizePhoneNumber = normalizePhoneNumber;
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
function jidToPhone(jid) {
    if (!jid)
        return '';
    return normalizePhoneNumber(jid.split('@')[0] ?? '');
}
function normalizePhoneToJid(phoneOrJid) {
    const value = phoneOrJid.trim();
    if (value.includes('@'))
        return value;
    const digits = normalizePhoneNumber(value);
    if (digits.length < 10) {
        throw new Error('Invalid phone number');
    }
    return `${digits}@s.whatsapp.net`;
}
