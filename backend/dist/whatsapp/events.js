"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRawType = extractRawType;
exports.extractMessageText = extractMessageText;
exports.isGroupJid = isGroupJid;
exports.isStatusJid = isStatusJid;
exports.normalizePhoneNumber = normalizePhoneNumber;
exports.jidToPhone = jidToPhone;
exports.normalizePhoneToJid = normalizePhoneToJid;
function extractRawType(message) {
    if (!message.message)
        return null;
    const keys = Object.keys(message.message);
    return keys.length > 0 ? keys[0] : null;
}
function extractMessageText(message) {
    const payload = message.message;
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
