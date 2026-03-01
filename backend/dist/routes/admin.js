"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminRouter = createAdminRouter;
const express_1 = require("express");
const admin_session_1 = require("../lib/admin-session");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const firestore_1 = require("../lib/firestore");
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
function mergeAdminUsers(snapshots, firebaseStates) {
    const snapshotByUid = new Map(snapshots.map((item) => [item.uid, item]));
    const allUids = new Set([
        ...snapshots.map((item) => item.uid),
        ...firebaseStates.keys()
    ]);
    const merged = [...allUids].map((uid) => {
        const snapshot = snapshotByUid.get(uid) ?? null;
        const firebase = firebaseStates.get(uid) ?? null;
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
            const [snapshots, firebaseStates, qrSlots] = await Promise.all([
                (0, firestore_1.listAdminUserSnapshots)(),
                (0, firebase_user_access_1.listAllFirebaseUserAccessStates)(),
                manager.getQrPayloads()
            ]);
            const users = mergeAdminUsers(snapshots, firebaseStates);
            const logs = (0, logger_1.getRecentOperationalLogs)(80);
            const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
            const recentAlerts = logs
                .filter((entry) => entry.level === 'warn' || entry.level === 'error');
            const recentWhatsAppEvents = logs
                .filter(isWhatsAppLog)
                .slice(-8)
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
            const [snapshots, firebaseStates] = await Promise.all([
                (0, firestore_1.listAdminUserSnapshots)(),
                (0, firebase_user_access_1.listAllFirebaseUserAccessStates)()
            ]);
            res.json({ users: mergeAdminUsers(snapshots, firebaseStates) });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/users/:uid', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const [snapshot, firebase, recentTransactions, reminders] = await Promise.all([
                (0, firestore_1.getAdminUserSnapshot)(uid),
                (0, firebase_user_access_1.getFirebaseUserAccessState)(uid),
                (0, firestore_1.getRecentTransactions)(uid, 5),
                (0, firestore_1.getUserReminders)(uid)
            ]);
            if (!snapshot && !firebase.exists) {
                res.status(404).json({ error: 'User not found.' });
                return;
            }
            const merged = mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, firebase]]))[0];
            res.json({
                user: merged,
                recentTransactions,
                recentReminders: reminders.slice(0, 5)
            });
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
                user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]))[0]
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
                user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]))[0]
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Admin route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
