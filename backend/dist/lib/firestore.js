"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveWhatsAppMessage = saveWhatsAppMessage;
exports.inboundMessageExists = inboundMessageExists;
exports.saveMessageSafe = saveMessageSafe;
exports.getUserSettings = getUserSettings;
exports.getUserProfile = getUserProfile;
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
exports.loadWhatsAppAuthSnapshot = loadWhatsAppAuthSnapshot;
exports.saveWhatsAppAuthSnapshot = saveWhatsAppAuthSnapshot;
exports.clearWhatsAppAuthSnapshot = clearWhatsAppAuthSnapshot;
exports.getRecentConversationByPhone = getRecentConversationByPhone;
exports.getLastConversationActivityByPhone = getLastConversationActivityByPhone;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
const events_1 = require("../whatsapp/events");
const COLLECTION_NAME = 'whatsappMessages';
const BINDINGS_COLLECTION_NAME = 'whatsappBindings';
const AUTH_STATE_COLLECTION_NAME = 'whatsappRuntime';
const AUTH_STATE_DOC_ID = 'authState';
const AUTH_STATE_FILES_SUBCOLLECTION = 'files';
const PROFILE_SCAN_CACHE_TTL_MS = 30_000;
function sanitizeDocId(value) {
    return value.replace(/[^\w.-]/g, '_');
}
function authFileDocId(filename) {
    return Buffer.from(filename, 'utf8').toString('base64url');
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
async function getUserSettings(uid) {
    const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
    if (!snap.exists)
        return { budget: 0, startDay: 1, currency: 'BRL' };
    const data = snap.data();
    return {
        budget: typeof data.budget === 'number' ? data.budget : 0,
        startDay: typeof data.startDay === 'number' ? data.startDay : 1,
        currency: typeof data.currency === 'string' ? data.currency : 'BRL'
    };
}
async function getUserProfile(uid) {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists)
        return { displayName: '' };
    const data = snap.data();
    return {
        displayName: typeof data.displayName === 'string' ? data.displayName : ''
    };
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
let profileScanCache = null;
function normalizeAllowedNumbers(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .map((item) => (typeof item === 'string' ? (0, events_1.normalizePhoneNumber)(item) : ''))
            .filter((item) => item.length >= 10))];
}
function isMissingIndexError(error) {
    const message = error?.message;
    if (typeof message === 'string' && message.includes('FAILED_PRECONDITION'))
        return true;
    const code = error?.code;
    return code === 9;
}
async function scanAllProfileSettings(forceRefresh = false) {
    if (!forceRefresh && profileScanCache) {
        const ageMs = Date.now() - profileScanCache.fetchedAt;
        if (ageMs <= PROFILE_SCAN_CACHE_TTL_MS) {
            return profileScanCache.entries;
        }
    }
    const usersSnap = await db.collection('users').get();
    if (usersSnap.empty) {
        profileScanCache = { fetchedAt: Date.now(), entries: [] };
        return [];
    }
    const profileSnaps = await Promise.all(usersSnap.docs.map((userDoc) => userDoc.ref.collection('settings').doc('profile').get()));
    const entries = [];
    for (const profileSnap of profileSnaps) {
        if (!profileSnap.exists)
            continue;
        const uid = profileSnap.ref.parent.parent?.id;
        if (!uid)
            continue;
        entries.push({
            uid,
            data: (profileSnap.data() ?? {})
        });
    }
    profileScanCache = { fetchedAt: Date.now(), entries };
    return entries;
}
async function fallbackIsPhoneAllowedForAnyAccount(variants) {
    const profiles = await scanAllProfileSettings();
    return profiles.some((entry) => {
        const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
        return variants.some((variant) => allowed.includes(variant));
    });
}
async function fallbackResolveUidFromPhone(variants) {
    const profiles = await scanAllProfileSettings();
    for (const entry of profiles) {
        const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
        if (variants.some((variant) => allowed.includes(variant))) {
            return entry.uid;
        }
    }
    return null;
}
async function fallbackResolveUidFromAccessCode(normalizedCode, variants) {
    const profiles = await scanAllProfileSettings();
    for (const entry of profiles) {
        const code = typeof entry.data.whatsappAccessCodeNormalized === 'string'
            ? entry.data.whatsappAccessCodeNormalized
            : '';
        if (code !== normalizedCode)
            continue;
        const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
        if (variants.some((variant) => allowed.includes(variant))) {
            return entry.uid;
        }
    }
    return null;
}
async function isPhoneAllowedForUid(uid, phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return false;
    const allowed = await getAllowedWhatsAppNumbers(uid);
    const phoneVariants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    return phoneVariants.some((v) => allowed.includes(v));
}
async function isPhoneAllowedForAnyAccount(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return false;
    const variants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    try {
        const snaps = await Promise.all(variants.map((v) => db.collectionGroup('settings')
            .where('whatsappAllowedNumbers', 'array-contains', v)
            .limit(1)
            .get()));
        return snaps.some((snap) => snap.docs.some((doc) => doc.id === 'profile'));
    }
    catch (error) {
        logger_1.logger.error('isPhoneAllowedForAnyAccount: collectionGroup query failed (missing Firestore index?)', error);
        if (!isMissingIndexError(error)) {
            return false;
        }
        logger_1.logger.warn('isPhoneAllowedForAnyAccount: falling back to users profile scan');
        try {
            return await fallbackIsPhoneAllowedForAnyAccount(variants);
        }
        catch (fallbackError) {
            logger_1.logger.error('isPhoneAllowedForAnyAccount fallback failed', fallbackError);
            return false;
        }
    }
}
async function resolveUidFromPhone(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const variants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    try {
        const result = await fallbackResolveUidFromPhone(variants);
        if (!result) {
            // Log all registered numbers for debugging
            const profiles = await scanAllProfileSettings();
            const allNumbers = profiles.flatMap((p) => normalizeAllowedNumbers(p.data.whatsappAllowedNumbers));
            logger_1.logger.info('MSG_RESOLVE_DEBUG: phone not found in any account', {
                incomingPhone: normalizedPhone,
                variantsTried: variants,
                registeredNumbers: allNumbers.slice(0, 20),
                totalUsers: profiles.length
            });
        }
        return result;
    }
    catch (error) {
        logger_1.logger.error('resolveUidFromPhone: failed to scan profiles', error);
        return null;
    }
}
async function resolveUidFromAccessCode(accessCodeText, phone) {
    const normalizedCode = normalizeAccessCode(accessCodeText);
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedCode.length < 8 || normalizedPhone.length < 10) {
        return null;
    }
    try {
        // Scan all profiles and match by access code only
        const profiles = await scanAllProfileSettings();
        for (const entry of profiles) {
            const entryCode = normalizeAccessCode(typeof entry.data.whatsappAccessCodeNormalized === 'string'
                ? entry.data.whatsappAccessCodeNormalized
                : '');
            if (entryCode && entryCode === normalizedCode) {
                return entry.uid;
            }
        }
    }
    catch (error) {
        logger_1.logger.error('resolveUidFromAccessCode failed', error);
    }
    return null;
}
async function getPhoneBinding(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const variants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    const snaps = await Promise.all(variants.map((v) => db.collection(BINDINGS_COLLECTION_NAME).doc(v).get()));
    for (const snap of snaps) {
        if (!snap.exists)
            continue;
        const data = snap.data();
        if (!data.uid || typeof data.uid !== 'string')
            continue;
        return {
            phone: snap.id,
            uid: data.uid,
            linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : new Date().toISOString(),
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
        };
    }
    return null;
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
    // Save binding under ALL Brazilian variants so lookups work regardless of format
    const variants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    const canonicalPhone = variants[0] || normalizedPhone; // 13-digit form
    // Check any existing binding for linkedAt
    let linkedAt = now;
    for (const v of variants) {
        const existing = await db.collection(BINDINGS_COLLECTION_NAME).doc(v).get();
        if (existing.exists && typeof existing.data()?.linkedAt === 'string') {
            linkedAt = existing.data()?.linkedAt;
            break;
        }
    }
    const bindingData = {
        phone: canonicalPhone,
        uid,
        linkedAt,
        updatedAt: now
    };
    // Write binding under all variants for reliable lookups
    const batch = db.batch();
    for (const v of variants) {
        batch.set(db.collection(BINDINGS_COLLECTION_NAME).doc(v), bindingData, { merge: true });
    }
    await batch.commit();
}
async function loadWhatsAppAuthSnapshot() {
    try {
        const filesSnap = await db
            .collection(AUTH_STATE_COLLECTION_NAME)
            .doc(AUTH_STATE_DOC_ID)
            .collection(AUTH_STATE_FILES_SUBCOLLECTION)
            .get();
        return filesSnap.docs
            .map((doc) => {
            const data = doc.data();
            const filename = typeof data.filename === 'string' ? data.filename.trim() : '';
            const contentBase64 = typeof data.contentBase64 === 'string' ? data.contentBase64.trim() : '';
            if (!filename || !contentBase64)
                return null;
            return { filename, contentBase64 };
        })
            .filter((entry) => Boolean(entry))
            .sort((a, b) => a.filename.localeCompare(b.filename));
    }
    catch (error) {
        logger_1.logger.error('Failed to load WhatsApp auth snapshot from Firestore', error);
        return [];
    }
}
async function saveWhatsAppAuthSnapshot(files) {
    const now = new Date().toISOString();
    const normalized = files
        .map((file) => ({
        filename: file.filename.trim(),
        contentBase64: file.contentBase64.trim()
    }))
        .filter((file) => file.filename.length > 0 && file.contentBase64.length > 0);
    const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(AUTH_STATE_DOC_ID);
    const filesRef = rootRef.collection(AUTH_STATE_FILES_SUBCOLLECTION);
    const existingSnap = await filesRef.get();
    const batch = db.batch();
    const keptDocIds = new Set();
    for (const file of normalized) {
        const docId = authFileDocId(file.filename);
        keptDocIds.add(docId);
        batch.set(filesRef.doc(docId), {
            filename: file.filename,
            contentBase64: file.contentBase64,
            updatedAt: now
        }, { merge: true });
    }
    for (const doc of existingSnap.docs) {
        if (!keptDocIds.has(doc.id)) {
            batch.delete(doc.ref);
        }
    }
    batch.set(rootRef, {
        fileCount: normalized.length,
        updatedAt: now
    }, { merge: true });
    await batch.commit();
}
async function clearWhatsAppAuthSnapshot() {
    const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(AUTH_STATE_DOC_ID);
    const filesRef = rootRef.collection(AUTH_STATE_FILES_SUBCOLLECTION);
    const filesSnap = await filesRef.get();
    const batch = db.batch();
    for (const doc of filesSnap.docs) {
        batch.delete(doc.ref);
    }
    batch.set(rootRef, {
        fileCount: 0,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    await batch.commit();
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
async function getLastConversationActivityByPhone(uid, phone) {
    if (!uid || uid.trim().length === 0)
        return null;
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    try {
        const [inboundSnap, outboundSnap] = await Promise.all([
            db
                .collection(COLLECTION_NAME)
                .where('ownerUid', '==', uid)
                .where('from', '==', normalizedPhone)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get(),
            db
                .collection(COLLECTION_NAME)
                .where('ownerUid', '==', uid)
                .where('to', '==', normalizedPhone)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get()
        ]);
        const inboundCreatedAt = inboundSnap.empty ? null : inboundSnap.docs[0].data().createdAt;
        const outboundCreatedAt = outboundSnap.empty ? null : outboundSnap.docs[0].data().createdAt;
        const inboundIso = typeof inboundCreatedAt === 'string' ? inboundCreatedAt : null;
        const outboundIso = typeof outboundCreatedAt === 'string' ? outboundCreatedAt : null;
        if (!inboundIso && !outboundIso)
            return null;
        if (!inboundIso)
            return outboundIso;
        if (!outboundIso)
            return inboundIso;
        return inboundIso > outboundIso ? inboundIso : outboundIso;
    }
    catch (error) {
        logger_1.logger.error('getLastConversationActivityByPhone failed', error);
        return null;
    }
}
