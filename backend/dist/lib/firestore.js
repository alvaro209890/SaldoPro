"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveWhatsAppMessage = saveWhatsAppMessage;
exports.inboundMessageExists = inboundMessageExists;
exports.saveMessageSafe = saveMessageSafe;
exports.getUserCategories = getUserCategories;
exports.getRecentTransactions = getRecentTransactions;
exports.addUserTransaction = addUserTransaction;
exports.updateUserTransaction = updateUserTransaction;
exports.deleteUserTransaction = deleteUserTransaction;
exports.getAllowedWhatsAppNumbers = getAllowedWhatsAppNumbers;
exports.isPhoneAllowedForUid = isPhoneAllowedForUid;
exports.isPhoneAllowedForAnyAccount = isPhoneAllowedForAnyAccount;
exports.resolveUidFromPhone = resolveUidFromPhone;
exports.resolveUidFromAccessCode = resolveUidFromAccessCode;
exports.getPhoneBinding = getPhoneBinding;
exports.savePhoneBinding = savePhoneBinding;
exports.getRecentConversationByPhone = getRecentConversationByPhone;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
const events_1 = require("../whatsapp/events");
const COLLECTION_NAME = 'whatsappMessages';
const BINDINGS_COLLECTION_NAME = 'whatsappBindings';
function sanitizeDocId(value) {
    return value.replace(/[^\w.-]/g, '_');
}
function getDocId(record) {
    const prefix = record.direction === 'inbound'
        ? 'in'
        : record.direction === 'outbound'
            ? 'out'
            : 'ar';
    return `${prefix}_${sanitizeDocId(record.messageId)}`;
}
function initFirebaseAdmin() {
    if ((0, app_1.getApps)().length > 0)
        return;
    (0, app_1.initializeApp)({
        credential: (0, app_1.cert)({
            projectId: env_1.env.firebaseProjectId,
            clientEmail: env_1.env.firebaseClientEmail,
            privateKey: env_1.env.firebasePrivateKey.replace(/\\n/g, '\n')
        })
    });
}
initFirebaseAdmin();
const db = (0, firestore_1.getFirestore)();
async function saveWhatsAppMessage(record) {
    const docId = getDocId(record);
    await db.collection(COLLECTION_NAME).doc(docId).set(record, { merge: true });
}
async function inboundMessageExists(messageId) {
    const docId = `in_${sanitizeDocId(messageId)}`;
    const snap = await db.collection(COLLECTION_NAME).doc(docId).get();
    return snap.exists;
}
async function saveMessageSafe(record) {
    try {
        await saveWhatsAppMessage(record);
    }
    catch (error) {
        logger_1.logger.error('Failed to save WhatsApp message in Firestore', error);
    }
}
function monthKeyFromDate(date) {
    return date.slice(0, 7);
}
async function getUserCategories(uid) {
    const snap = await db.collection('users').doc(uid).collection('categories').orderBy('name', 'asc').get();
    return snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
}
async function getRecentTransactions(uid, limitCount) {
    const snap = await db
        .collection('users')
        .doc(uid)
        .collection('transactions')
        .orderBy('date', 'desc')
        .limit(limitCount)
        .get();
    return snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
}
async function addUserTransaction(uid, input) {
    const now = new Date().toISOString();
    const ref = await db.collection('users').doc(uid).collection('transactions').add({
        ...input,
        monthKey: monthKeyFromDate(input.date),
        createdAt: now,
        updatedAt: now
    });
    return ref.id;
}
async function updateUserTransaction(uid, transactionId, changes) {
    const updates = {
        ...changes,
        updatedAt: new Date().toISOString()
    };
    if (typeof changes.date === 'string' && changes.date.length >= 7) {
        updates.monthKey = monthKeyFromDate(changes.date);
    }
    await db.collection('users').doc(uid).collection('transactions').doc(transactionId).update(updates);
}
async function deleteUserTransaction(uid, transactionId) {
    await db.collection('users').doc(uid).collection('transactions').doc(transactionId).delete();
}
async function getAllowedWhatsAppNumbers(uid) {
    const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
    if (!snap.exists)
        return [];
    const data = snap.data();
    if (!Array.isArray(data.whatsappAllowedNumbers))
        return [];
    return [...new Set(data.whatsappAllowedNumbers
            .map((value) => (typeof value === 'string' ? (0, events_1.normalizePhoneNumber)(value) : ''))
            .filter((value) => value.length >= 10))];
}
function normalizeAccessCode(value) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function extractUidFromSettingsDoc(doc) {
    return doc.ref.parent.parent?.id ?? null;
}
async function isPhoneAllowedForUid(uid, phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return false;
    const allowed = await getAllowedWhatsAppNumbers(uid);
    return allowed.includes(normalizedPhone);
}
async function isPhoneAllowedForAnyAccount(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return false;
    const snap = await db
        .collectionGroup('settings')
        .where('whatsappAllowedNumbers', 'array-contains', normalizedPhone)
        .limit(1)
        .get();
    return snap.docs.some((doc) => doc.id === 'profile');
}
async function resolveUidFromPhone(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const snap = await db
        .collectionGroup('settings')
        .where('whatsappAllowedNumbers', 'array-contains', normalizedPhone)
        .limit(5)
        .get();
    for (const settingsDoc of snap.docs) {
        if (settingsDoc.id !== 'profile')
            continue;
        const uid = extractUidFromSettingsDoc(settingsDoc);
        if (uid)
            return uid;
    }
    return null;
}
async function resolveUidFromAccessCode(accessCodeText, phone) {
    const normalizedCode = normalizeAccessCode(accessCodeText);
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    // Minimum 8 chars to match looksLikeAccessCode() in WhatsAppClient
    if (normalizedCode.length < 8 || normalizedPhone.length < 10) {
        return null;
    }
    const snap = await db
        .collectionGroup('settings')
        .where('whatsappAccessCodeNormalized', '==', normalizedCode)
        .limit(5)
        .get();
    for (const settingsDoc of snap.docs) {
        if (settingsDoc.id !== 'profile')
            continue;
        const uid = extractUidFromSettingsDoc(settingsDoc);
        if (!uid)
            continue;
        const data = settingsDoc.data();
        const allowed = Array.isArray(data.whatsappAllowedNumbers)
            ? data.whatsappAllowedNumbers
                .map((value) => (typeof value === 'string' ? (0, events_1.normalizePhoneNumber)(value) : ''))
                .filter((value) => value.length >= 10)
            : [];
        if (allowed.includes(normalizedPhone)) {
            return uid;
        }
    }
    return null;
}
async function getPhoneBinding(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const snap = await db.collection(BINDINGS_COLLECTION_NAME).doc(normalizedPhone).get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (!data.uid || typeof data.uid !== 'string')
        return null;
    return {
        phone: normalizedPhone,
        uid: data.uid,
        linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : new Date().toISOString(),
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
    };
}
async function savePhoneBinding(phone, uid) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10) {
        throw new Error('Invalid phone for binding');
    }
    if (!uid || uid.trim().length === 0) {
        throw new Error('Invalid uid for binding');
    }
    const now = new Date().toISOString();
    const docRef = db.collection(BINDINGS_COLLECTION_NAME).doc(normalizedPhone);
    const existing = await docRef.get();
    const linkedAt = existing.exists && typeof existing.data()?.linkedAt === 'string'
        ? existing.data()?.linkedAt
        : now;
    await docRef.set({
        phone: normalizedPhone,
        uid,
        linkedAt,
        updatedAt: now
    }, { merge: true });
}
async function getRecentConversationByPhone(uid, phone, limitCount) {
    if (!uid || uid.trim().length === 0)
        return [];
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return [];
    const [inboundSnap, outboundSnap] = await Promise.all([
        db
            .collection(COLLECTION_NAME)
            .where('ownerUid', '==', uid)
            .where('from', '==', normalizedPhone)
            .orderBy('createdAt', 'desc')
            .limit(limitCount)
            .get(),
        db
            .collection(COLLECTION_NAME)
            .where('ownerUid', '==', uid)
            .where('to', '==', normalizedPhone)
            .orderBy('createdAt', 'desc')
            .limit(limitCount)
            .get()
    ]);
    const docsById = new Map();
    const pushDoc = (snap) => {
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.status === 'failed')
                continue;
            if (typeof data.createdAt !== 'string' || data.createdAt.length === 0)
                continue;
            if (data.ownerUid !== uid)
                continue;
            const hasImage = Boolean(data.metadata?.hasImage);
            const text = typeof data.text === 'string' ? data.text.trim() : '';
            const content = text || (hasImage ? 'Imagem enviada no WhatsApp.' : '');
            if (!content)
                continue;
            docsById.set(doc.id, {
                createdAt: data.createdAt,
                role: data.direction === 'inbound' ? 'user' : 'assistant',
                content: content.slice(0, 800)
            });
        }
    };
    pushDoc(inboundSnap);
    pushDoc(outboundSnap);
    return [...docsById.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-limitCount)
        .map((entry) => ({
        role: entry.role,
        content: entry.content
    }));
}
