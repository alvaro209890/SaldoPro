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
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
const events_1 = require("../whatsapp/events");
const COLLECTION_NAME = 'whatsappMessages';
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
