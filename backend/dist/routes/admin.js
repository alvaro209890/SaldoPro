"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminRouter = createAdminRouter;
const express_1 = require("express");
const admin_session_1 = require("../lib/admin-session");
const subscription_access_1 = require("../lib/subscription-access");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const firestore_1 = require("../lib/firestore");
const document_storage_1 = require("../lib/document-storage");
const logger_1 = require("../lib/logger");
const admin_auth_1 = require("../middleware/admin-auth");
function isWhatsAppLog(entry) {
    if (entry.message.includes('WhatsApp'))
        return true;
    if (entry.message.startsWith('MSG_'))
        return true;
    const slotId = entry.meta?.slotId;
    return slotId === 'wa1';
}
function normalizeLogEntry(entry) {
    return {
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        ...(entry.meta ? { meta: entry.meta } : {})
    };
}
function mergeAdminUsers(snapshots, firebaseStates, planAccessByUid) {
    const snapshotByUid = new Map(snapshots.map((item) => [item.uid, item]));
    const allUids = new Set([
        ...snapshots.map((item) => item.uid),
        ...firebaseStates.keys()
    ]);
    const merged = [...allUids].map((uid) => {
        const snapshot = snapshotByUid.get(uid) ?? null;
        const firebase = firebaseStates.get(uid) ?? null;
        const planAccess = planAccessByUid.get(uid) ?? null;
        return {
            uid,
            email: snapshot?.email ?? firebase?.email ?? null,
            displayName: snapshot?.displayName || firebase?.displayName || '',
            createdAt: snapshot?.createdAt ?? firebase?.createdAt ?? null,
            blocked: firebase?.disabled ?? true,
            firebaseExists: firebase?.exists ?? false,
            whatsappAllowedNumbers: snapshot?.settings?.whatsappAllowedNumbers ?? [],
            settings: snapshot?.settings ?? null,
            metrics: snapshot?.metrics ?? {
                transactions: 0,
                reminders: 0,
                categories: 0,
                whatsappMessages: 0,
                lastWhatsAppMessageAt: null
            },
            firebase: {
                disabled: firebase?.disabled ?? true,
                createdAt: firebase?.createdAt ?? null,
                lastSignInAt: firebase?.lastSignInAt ?? null
            },
            subscription: {
                status: planAccess?.subscriptionStatus ?? 'none',
                premiumActive: planAccess?.hasActivePlan ?? false,
                baseActive: planAccess?.baseHasActivePlan ?? false,
                overrideMode: planAccess?.manualOverride ?? 'none'
            }
        };
    });
    merged.sort((a, b) => {
        const aTime = a.createdAt ?? '';
        const bTime = b.createdAt ?? '';
        return bTime.localeCompare(aTime);
    });
    return merged;
}
async function loadMergedAdminUsers() {
    const [snapshots, firebaseStates] = await Promise.all([
        (0, firestore_1.listAdminUserSnapshots)(),
        (0, firebase_user_access_1.listAllFirebaseUserAccessStates)()
    ]);
    const uids = [
        ...snapshots.map((item) => item.uid),
        ...firebaseStates.keys()
    ];
    const planAccess = await (0, subscription_access_1.getUserPlanAccessSummaryMap)(uids);
    return mergeAdminUsers(snapshots, firebaseStates, planAccess);
}
async function loadSingleAdminUser(uid) {
    const [snapshot, firebase] = await Promise.all([
        (0, firestore_1.getAdminUserSnapshot)(uid),
        (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true)
    ]);
    if (!snapshot && !firebase.exists) {
        return null;
    }
    const planAccess = await (0, subscription_access_1.getUserPlanAccessSummaryMap)([uid]);
    return mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, firebase]]), planAccess)[0] ?? null;
}
function createAdminRouter(manager) {
    const router = (0, express_1.Router)();
    router.post('/auth/login', (req, res) => {
        const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
        if (!password) {
            res.status(400).json({ error: 'Password is required.' });
            return;
        }
        if (!(0, admin_session_1.isValidAdminPassword)(password)) {
            res.status(401).json({ error: 'Invalid password.' });
            return;
        }
        const session = (0, admin_session_1.createAdminSessionToken)();
        res.json({ ok: true, token: session.token, expiresAt: session.expiresAt });
    });
    router.post('/auth/logout', (_req, res) => {
        res.json({ ok: true });
    });
    router.use(admin_auth_1.requireAdminAuth);
    router.get('/auth/session', (req, res) => {
        res.json({
            ok: true,
            expiresAt: req.adminExpiresAt ?? null
        });
    });
    router.get('/overview', async (_req, res, next) => {
        try {
            const [users, qrSlots] = await Promise.all([
                loadMergedAdminUsers(),
                manager.getQrPayloads()
            ]);
            const logs = (0, logger_1.getRecentOperationalLogs)(80);
            const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
            const recentAlerts = logs
                .filter((entry) => entry.level === 'warn' || entry.level === 'error');
            const recentWhatsAppEvents = logs
                .filter(isWhatsAppLog)
                .slice(-20)
                .reverse()
                .map(normalizeLogEntry);
            res.json({
                backend: {
                    ok: true,
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString(),
                    alerts: {
                        warnings15m: recentAlerts.filter((entry) => entry.level === 'warn' && Date.parse(entry.timestamp) >= fifteenMinutesAgo).length,
                        errors15m: recentAlerts.filter((entry) => entry.level === 'error' && Date.parse(entry.timestamp) >= fifteenMinutesAgo).length,
                        recent: recentAlerts.slice(-8).reverse().map(normalizeLogEntry)
                    }
                },
                whatsapp: {
                    slots: manager.getStatuses(),
                    qr: qrSlots,
                    recentEvents: recentWhatsAppEvents
                },
                stats: {
                    totalUsers: users.length,
                    blockedUsers: users.filter((user) => user.blocked).length,
                    activeUsers: users.filter((user) => !user.blocked).length
                }
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/users', async (_req, res, next) => {
        try {
            res.json({ users: await loadMergedAdminUsers() });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/storage-usage', async (_req, res, next) => {
        try {
            const storage = await (0, document_storage_1.getDocumentStorageUsageSummary)();
            res.json({ storage });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/users/:uid', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const [user, recentTransactions, reminders] = await Promise.all([
                loadSingleAdminUser(uid),
                (0, firestore_1.getRecentTransactions)(uid, 5),
                (0, firestore_1.getUserReminders)(uid)
            ]);
            if (!user) {
                const payload = {
                    user: null,
                    recentTransactions: [],
                    recentReminders: [],
                    missing: true
                };
                res.json(payload);
                return;
            }
            const payload = {
                user,
                recentTransactions,
                recentReminders: reminders.slice(0, 5)
            };
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/users/:uid/messages', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const messages = await (0, firestore_1.getRecentConversationByOwnerUid)(uid, 100);
            res.json({ messages });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/whatsapp/reset-session', async (_req, res, next) => {
        try {
            await manager.resetSession('wa1');
            logger_1.logger.warn('Admin triggered WhatsApp session reset', { slotId: 'wa1' });
            res.json({
                ok: true,
                slots: manager.getStatuses(),
                qr: await manager.getQrPayloads()
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/whatsapp/refresh-qr', async (_req, res, next) => {
        try {
            await manager.resetSession('wa1');
            await new Promise((resolve) => setTimeout(resolve, 1500));
            logger_1.logger.warn('Admin forced WhatsApp QR refresh', { slotId: 'wa1' });
            res.json({
                ok: true,
                slots: manager.getStatuses(),
                qr: await manager.getQrPayloads()
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/block', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const state = await (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true);
            if (!state.exists) {
                res.status(404).json({ error: 'Firebase user not found.' });
                return;
            }
            await (0, firebase_user_access_1.setFirebaseUserDisabled)(uid, true);
            const [snapshot, refreshed] = await Promise.all([
                (0, firestore_1.getAdminUserSnapshot)(uid),
                (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true)
            ]);
            logger_1.logger.warn('Admin blocked user', {
                uid,
                reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null
            });
            res.json({
                ok: true,
                user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]), await (0, subscription_access_1.getUserPlanAccessSummaryMap)([uid]))[0]
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/unblock', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const state = await (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true);
            if (!state.exists) {
                res.status(404).json({ error: 'Firebase user not found.' });
                return;
            }
            await (0, firebase_user_access_1.setFirebaseUserDisabled)(uid, false);
            const [snapshot, refreshed] = await Promise.all([
                (0, firestore_1.getAdminUserSnapshot)(uid),
                (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true)
            ]);
            logger_1.logger.warn('Admin unblocked user', { uid });
            res.json({
                ok: true,
                user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]), await (0, subscription_access_1.getUserPlanAccessSummaryMap)([uid]))[0]
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/block', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const user = await loadSingleAdminUser(uid);
            if (!user) {
                res.status(404).json({ error: 'Usuario nao encontrado.' });
                return;
            }
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : null;
            await (0, subscription_access_1.setUserPlanOverride)(uid, 'deny', reason || 'Admin bloqueou assinatura');
            logger_1.logger.warn('Admin blocked subscription access', { uid, reason: reason || null });
            res.json({
                ok: true,
                user: await loadSingleAdminUser(uid)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/unblock', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const user = await loadSingleAdminUser(uid);
            if (!user) {
                res.status(404).json({ error: 'Usuario nao encontrado.' });
                return;
            }
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : null;
            await (0, subscription_access_1.setUserPlanOverride)(uid, 'allow', reason || 'Admin liberou assinatura');
            logger_1.logger.warn('Admin unblocked subscription access', { uid, reason: reason || null });
            res.json({
                ok: true,
                user: await loadSingleAdminUser(uid)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/reset', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const user = await loadSingleAdminUser(uid);
            if (!user) {
                res.status(404).json({ error: 'Usuario nao encontrado.' });
                return;
            }
            await (0, subscription_access_1.clearUserPlanOverride)(uid);
            logger_1.logger.info('Admin reset subscription override', { uid });
            res.json({
                ok: true,
                user: await loadSingleAdminUser(uid)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/message', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
            const phoneOverride = typeof req.body?.phone === 'string' ? req.body.phone.trim() : null;
            if (!text) {
                res.status(400).json({ error: 'Mensagem vazia.' });
                return;
            }
            const snapshot = await (0, firestore_1.getAdminUserSnapshot)(uid);
            if (!snapshot) {
                res.status(404).json({ error: 'Usuário não encontrado.' });
                return;
            }
            let targetPhone = phoneOverride;
            if (!targetPhone) {
                const allowedNumbers = snapshot.settings?.whatsappAllowedNumbers ?? [];
                if (allowedNumbers.length === 0) {
                    res.status(400).json({ error: 'Usuário não possui número de WhatsApp cadastrado e nenhum foi fornecido.' });
                    return;
                }
                targetPhone = allowedNumbers[0];
            }
            await manager.sendTextWithRouting({
                to: targetPhone,
                text,
                ownerUid: uid
            });
            logger_1.logger.info('Admin sent direct message to user', { uid, phone: targetPhone });
            res.json({ ok: true, sent: true });
        }
        catch (error) {
            logger_1.logger.error('Failed to send admin direct message', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Erro ao enviar mensagem.' });
        }
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Admin route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
