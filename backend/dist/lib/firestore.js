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
exports.getUserTransactionById = getUserTransactionById;
exports.restoreUserTransaction = restoreUserTransaction;
exports.addUserReminder = addUserReminder;
exports.addRecurringTransaction = addRecurringTransaction;
exports.getActiveRecurringTransactions = getActiveRecurringTransactions;
exports.deleteRecurringTransaction = deleteRecurringTransaction;
exports.updateRecurringTransactionBackend = updateRecurringTransactionBackend;
exports.generateOverdueRecurringTransactions = generateOverdueRecurringTransactions;
exports.getAllowedWhatsAppNumbers = getAllowedWhatsAppNumbers;
exports.invalidateAllowedNumbersCacheForUid = invalidateAllowedNumbersCacheForUid;
exports.isPhoneAllowedForUid = isPhoneAllowedForUid;
exports.isPhoneAllowedForAnyAccount = isPhoneAllowedForAnyAccount;
exports.resolveUidFromPhone = resolveUidFromPhone;
exports.getPhoneBinding = getPhoneBinding;
exports.savePhoneBinding = savePhoneBinding;
exports.loadWhatsAppAuthSnapshot = loadWhatsAppAuthSnapshot;
exports.saveWhatsAppAuthSnapshot = saveWhatsAppAuthSnapshot;
exports.clearWhatsAppAuthSnapshot = clearWhatsAppAuthSnapshot;
exports.getRecentConversationByPhone = getRecentConversationByPhone;
exports.getLastConversationActivityByPhone = getLastConversationActivityByPhone;
exports.getLastConversationClientIdByPhone = getLastConversationClientIdByPhone;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
const events_1 = require("../whatsapp/events");
const COLLECTION_NAME = 'whatsappMessages';
const BINDINGS_COLLECTION_NAME = 'whatsappBindings';
const AUTH_STATE_COLLECTION_NAME = 'whatsappRuntime';
const AUTH_STATE_DOC_ID_LEGACY = 'authState';
const AUTH_STATE_FILES_SUBCOLLECTION = 'files';
const PROFILE_SCAN_CACHE_TTL_MS = 15_000; // reduced to 15s so newly registered phones are picked up quickly
const BINDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LAST_ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes (was 1 min)
const ALLOWED_NUMBERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes per-uid cache
function sanitizeDocId(value) {
    return value.replace(/[^\w.-]/g, '_');
}
function authFileDocId(filename) {
    return Buffer.from(filename, 'utf8').toString('base64url');
}
function authStateDocId(slotId) {
    return `authState_${slotId}`;
}
function getDocId(record) {
    const prefix = record.direction === 'inbound'
        ? 'in'
        : record.direction === 'outbound'
            ? 'out'
            : 'ar';
    return `${record.clientId}_${prefix}_${sanitizeDocId(record.messageId)}`;
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
async function inboundMessageExists(messageId, clientId, processedInMemory) {
    // Avoid network call if we already know this ID from the in-process dedup set
    if (processedInMemory?.has(messageId))
        return true;
    const normalizedId = sanitizeDocId(messageId);
    const docIds = clientId === 'wa1'
        ? [`wa1_in_${normalizedId}`, `in_${normalizedId}`]
        : [`${clientId}_in_${normalizedId}`];
    const snapshots = await Promise.all(docIds.map((docId) => db.collection(COLLECTION_NAME).doc(docId).get()));
    return snapshots.some((snap) => snap.exists);
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
async function getUserTransactionById(uid, transactionId) {
    const snap = await db.collection('users').doc(uid).collection('transactions').doc(transactionId).get();
    if (!snap.exists)
        return null;
    return {
        id: snap.id,
        ...snap.data()
    };
}
async function restoreUserTransaction(uid, transactionId, transaction) {
    await db.collection('users').doc(uid).collection('transactions').doc(transactionId).set({
        ...transaction,
        monthKey: monthKeyFromDate(transaction.date),
        updatedAt: new Date().toISOString()
    });
}
async function addUserReminder(uid, input) {
    const now = new Date().toISOString();
    const ref = await db.collection('users').doc(uid).collection('reminders').add({
        title: input.title,
        amount: input.amount,
        dueDate: input.dueDate,
        type: input.type,
        status: input.status ?? 'pending',
        createdAt: now,
        updatedAt: now
    });
    return ref.id;
}
function advanceDateBackend(dateStr, frequency) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    if (frequency === 'weekly')
        d.setDate(d.getDate() + 7);
    else if (frequency === 'monthly')
        d.setMonth(d.getMonth() + 1);
    else if (frequency === 'yearly')
        d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function addRecurringTransaction(uid, input) {
    const now = new Date().toISOString();
    const ref = await db.collection('users').doc(uid).collection('recurringTransactions').add({
        ...input,
        nextDueDate: input.startDate,
        active: true,
        createdAt: now,
        updatedAt: now,
    });
    return ref.id;
}
async function getActiveRecurringTransactions(uid) {
    const snap = await db
        .collection('users')
        .doc(uid)
        .collection('recurringTransactions')
        .where('active', '==', true)
        .get();
    return snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
    }));
}
async function deleteRecurringTransaction(uid, recurringId) {
    await db
        .collection('users')
        .doc(uid)
        .collection('recurringTransactions')
        .doc(recurringId)
        .delete();
}
async function updateRecurringTransactionBackend(uid, recurringId, changes) {
    await db
        .collection('users')
        .doc(uid)
        .collection('recurringTransactions')
        .doc(recurringId)
        .update({
        ...changes,
        updatedAt: new Date().toISOString(),
    });
}
async function generateOverdueRecurringTransactions(uid) {
    const today = new Date().toISOString().split('T')[0];
    const active = await getActiveRecurringTransactions(uid);
    let generated = 0;
    for (const rt of active) {
        let nextDate = rt.nextDueDate;
        while (nextDate <= today) {
            await addUserTransaction(uid, {
                type: rt.type,
                amount: rt.amount,
                date: nextDate,
                category: rt.category,
                description: rt.description,
                paymentMethod: rt.paymentMethod,
            });
            generated++;
            nextDate = advanceDateBackend(nextDate, rt.frequency);
        }
        const updates = { nextDueDate: nextDate };
        if (rt.endDate && nextDate > rt.endDate) {
            updates.active = false;
        }
        await updateRecurringTransactionBackend(uid, rt.id, updates);
    }
    return generated;
}
// ---------------------------------------------------------------------------
// Per-UID allowed numbers cache — avoids repeated Firestore reads per message.
// ---------------------------------------------------------------------------
const allowedNumbersCache = new Map();
function invalidateAllowedNumbersCache(uid) {
    allowedNumbersCache.delete(uid);
}
async function getAllowedWhatsAppNumbers(uid) {
    const cached = allowedNumbersCache.get(uid);
    if (cached && Date.now() - cached.cachedAt <= ALLOWED_NUMBERS_CACHE_TTL_MS) {
        return cached.numbers;
    }
    const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
    if (!snap.exists) {
        allowedNumbersCache.set(uid, { numbers: [], cachedAt: Date.now() });
        return [];
    }
    const data = snap.data();
    // Use normalizeAllowedNumbers to expand each registered number into all Brazilian variants
    const numbers = normalizeAllowedNumbers(data.whatsappAllowedNumbers);
    allowedNumbersCache.set(uid, { numbers, cachedAt: Date.now() });
    return numbers;
}
/** Call this when a user updates their whatsappAllowedNumbers so the cache stays fresh. */
function invalidateAllowedNumbersCacheForUid(uid) {
    invalidateAllowedNumbersCache(uid);
}
let profileScanCache = null;
function normalizeAllowedNumbers(value) {
    if (!Array.isArray(value))
        return [];
    // Expand each stored number into all its Brazilian variants so any format matches
    const allVariants = new Set();
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const digits = (0, events_1.normalizePhoneNumber)(item);
        if (digits.length < 10)
            continue;
        for (const variant of (0, events_1.brazilianPhoneVariants)(digits)) {
            allVariants.add(variant);
        }
    }
    return [...allVariants];
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
// ---------------------------------------------------------------------------
// Phone binding cache — avoids repeated Firestore lookups for the same phone.
// ---------------------------------------------------------------------------
const bindingCache = new Map();
function getCachedBinding(phone) {
    const entry = bindingCache.get(phone);
    if (!entry)
        return undefined;
    if (Date.now() - entry.cachedAt > BINDING_CACHE_TTL_MS) {
        bindingCache.delete(phone);
        return undefined;
    }
    return entry.binding;
}
function setCachedBinding(phone, binding) {
    bindingCache.set(phone, { binding, cachedAt: Date.now() });
}
async function getPhoneBinding(phone) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const cached = getCachedBinding(normalizedPhone);
    if (cached !== undefined)
        return cached;
    const variants = (0, events_1.brazilianPhoneVariants)(normalizedPhone);
    const snaps = await Promise.all(variants.map((v) => db.collection(BINDINGS_COLLECTION_NAME).doc(v).get()));
    for (const snap of snaps) {
        if (!snap.exists)
            continue;
        const data = snap.data();
        if (!data.uid || typeof data.uid !== 'string')
            continue;
        const result = {
            phone: snap.id,
            uid: data.uid,
            linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : new Date().toISOString(),
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
        };
        setCachedBinding(normalizedPhone, result);
        return result;
    }
    setCachedBinding(normalizedPhone, null);
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
    // Invalidate binding cache for all variants
    for (const v of variants) {
        bindingCache.delete(v);
    }
    bindingCache.delete(normalizedPhone);
}
async function loadAuthSnapshotByDocId(docId) {
    try {
        const filesSnap = await db
            .collection(AUTH_STATE_COLLECTION_NAME)
            .doc(docId)
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
        logger_1.logger.error('Failed to load WhatsApp auth snapshot from Firestore', { docId, error });
        return [];
    }
}
async function loadWhatsAppAuthSnapshot(slotId) {
    const slotDocId = authStateDocId(slotId);
    const slotSnapshot = await loadAuthSnapshotByDocId(slotDocId);
    if (slotSnapshot.length > 0) {
        return slotSnapshot;
    }
    if (slotId !== 'wa1') {
        return [];
    }
    const legacySnapshot = await loadAuthSnapshotByDocId(AUTH_STATE_DOC_ID_LEGACY);
    if (legacySnapshot.length > 0) {
        logger_1.logger.info('Using legacy WhatsApp auth snapshot for wa1 fallback', {
            legacyDocId: AUTH_STATE_DOC_ID_LEGACY,
            fileCount: legacySnapshot.length
        });
    }
    return legacySnapshot;
}
async function saveWhatsAppAuthSnapshot(slotId, files) {
    const now = new Date().toISOString();
    const normalized = files
        .map((file) => ({
        filename: file.filename.trim(),
        contentBase64: file.contentBase64.trim()
    }))
        .filter((file) => file.filename.length > 0 && file.contentBase64.length > 0);
    const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(authStateDocId(slotId));
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
async function clearWhatsAppAuthSnapshot(slotId) {
    const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(authStateDocId(slotId));
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
async function getRecentConversationByPhone(uid, phone, limitCount, clientId) {
    if (!uid || uid.trim().length === 0)
        return [];
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return [];
    const [inboundSnap, outboundSnap] = await Promise.all([
        db
            .collection(COLLECTION_NAME)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('from', '==', normalizedPhone)
            .orderBy('createdAt', 'desc')
            .limit(limitCount)
            .get(),
        db
            .collection(COLLECTION_NAME)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
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
            if (data.clientId !== clientId)
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
// ---------------------------------------------------------------------------
// Last conversation activity cache — avoids 2 Firestore queries per message.
// ---------------------------------------------------------------------------
const lastActivityCache = new Map();
function lastActivityCacheKey(uid, phone, clientId) {
    return `${uid}:${phone}:${clientId}`;
}
async function getLastConversationActivityByPhone(uid, phone, clientId) {
    if (!uid || uid.trim().length === 0)
        return null;
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
    if (normalizedPhone.length < 10)
        return null;
    const cacheKey = lastActivityCacheKey(uid, normalizedPhone, clientId);
    const cached = lastActivityCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= LAST_ACTIVITY_CACHE_TTL_MS) {
        return cached.activity;
    }
    try {
        const [inboundSnap, outboundSnap] = await Promise.all([
            db
                .collection(COLLECTION_NAME)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('from', '==', normalizedPhone)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get(),
            db
                .collection(COLLECTION_NAME)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('to', '==', normalizedPhone)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get()
        ]);
        const inboundCreatedAt = inboundSnap.empty ? null : inboundSnap.docs[0].data().createdAt;
        const outboundCreatedAt = outboundSnap.empty ? null : outboundSnap.docs[0].data().createdAt;
        const inboundIso = typeof inboundCreatedAt === 'string' ? inboundCreatedAt : null;
        const outboundIso = typeof outboundCreatedAt === 'string' ? outboundCreatedAt : null;
        let result = null;
        if (!inboundIso && !outboundIso)
            result = null;
        else if (!inboundIso)
            result = outboundIso;
        else if (!outboundIso)
            result = inboundIso;
        else
            result = inboundIso > outboundIso ? inboundIso : outboundIso;
        lastActivityCache.set(cacheKey, { activity: result, cachedAt: Date.now() });
        return result;
    }
    catch (error) {
        logger_1.logger.warn('getLastConversationActivityByPhone failed (index may still be building)', error);
        return null;
    }
}
function asSlotId(value) {
    return value === 'wa1' || value === 'wa2' ? value : null;
}
async function getLastConversationClientIdByPhone(uid, phone) {
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
                .limit(5)
                .get(),
            db
                .collection(COLLECTION_NAME)
                .where('ownerUid', '==', uid)
                .where('to', '==', normalizedPhone)
                .orderBy('createdAt', 'desc')
                .limit(5)
                .get()
        ]);
        let latestTimestamp = '';
        let latestSlot = null;
        const inspect = (snap) => {
            for (const doc of snap.docs) {
                const data = doc.data();
                if (data.status === 'failed')
                    continue;
                if (typeof data.createdAt !== 'string' || data.createdAt.length === 0)
                    continue;
                const slotId = asSlotId(data.clientId);
                if (!slotId)
                    continue;
                if (data.createdAt > latestTimestamp) {
                    latestTimestamp = data.createdAt;
                    latestSlot = slotId;
                }
            }
        };
        inspect(inboundSnap);
        inspect(outboundSnap);
        return latestSlot;
    }
    catch (error) {
        logger_1.logger.warn('getLastConversationClientIdByPhone failed (index may still be building)', error);
        return null;
    }
}
