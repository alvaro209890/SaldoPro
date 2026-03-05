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
const supabase_1 = require("../lib/supabase");
const cleanupHistory = [];
const MAX_CLEANUP_HISTORY = 50;
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
    router.get('/subscriptions', async (_req, res, next) => {
        try {
            const subscriptions = await (0, subscription_access_1.listAllSubscriptions)();
            res.json({ subscriptions });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/grant', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const days = typeof req.body?.days === 'number' ? req.body.days : 0;
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : null;
            if (days < 1 || days > 3650) {
                res.status(400).json({ error: 'Dias deve ser entre 1 e 3650.' });
                return;
            }
            const subscription = await (0, subscription_access_1.adminGrantSubscription)(uid, days, reason);
            const user = await loadSingleAdminUser(uid);
            logger_1.logger.warn('Admin granted subscription access', { uid, days, reason: reason || null });
            res.json({
                ok: true,
                subscription,
                user
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
    /* ───── DB Cleanup Routes ───── */
    async function countForCategory(category, cutoff) {
        let count = 0;
        switch (category) {
            case 'whatsapp_messages': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_whatsapp_messages')
                    .select('*', { count: 'exact', head: true })
                    .lt('created_at', cutoff);
                if (error)
                    throw new Error(`whatsapp_messages count: ${error.message}`);
                count = c ?? 0;
                break;
            }
            case 'chat_sessions': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_chat_sessions')
                    .select('*', { count: 'exact', head: true })
                    .lt('updated_at', cutoff);
                if (error)
                    throw new Error(`chat_sessions count: ${error.message}`);
                count = c ?? 0;
                break;
            }
            case 'old_reminders': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_reminders')
                    .select('*', { count: 'exact', head: true })
                    .lt('due_date', cutoff)
                    .eq('status', 'paid');
                if (error)
                    throw new Error(`old_reminders count: ${error.message}`);
                count = c ?? 0;
                break;
            }
            case 'expired_pending_docs': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_whatsapp_pending_documents')
                    .select('*', { count: 'exact', head: true })
                    .lt('expires_at', new Date().toISOString());
                if (error)
                    throw new Error(`expired_pending_docs count: ${error.message}`);
                count = c ?? 0;
                break;
            }
            case 'ai_quotas': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_daily_ai_quotas')
                    .select('*', { count: 'exact', head: true })
                    .lt('quota_date', cutoff);
                if (error)
                    throw new Error(`ai_quotas count: ${error.message}`);
                count = c ?? 0;
                break;
            }
            case 'billing_events': {
                const { count: c, error } = await supabase_1.supabaseAdmin
                    .from('app_billing_events')
                    .select('*', { count: 'exact', head: true })
                    .lt('created_at', cutoff);
                if (error)
                    throw new Error(`billing_events count: ${error.message}`);
                count = c ?? 0;
                break;
            }
        }
        return count;
    }
    async function deleteForCategory(category, cutoff) {
        let deleted = 0;
        switch (category) {
            case 'whatsapp_messages': {
                const { count, error } = await supabase_1.supabaseAdmin
                    .from('app_whatsapp_messages')
                    .delete({ count: 'exact' })
                    .lt('created_at', cutoff);
                if (error)
                    throw new Error(`whatsapp_messages delete: ${error.message}`);
                deleted = count ?? 0;
                break;
            }
            case 'chat_sessions': {
                // First get session IDs to delete their messages
                const { data: sessions, error: fetchErr } = await supabase_1.supabaseAdmin
                    .from('app_chat_sessions')
                    .select('id')
                    .lt('updated_at', cutoff);
                if (fetchErr)
                    throw new Error(`chat_sessions fetch: ${fetchErr.message}`);
                if (sessions && sessions.length > 0) {
                    const sessionIds = sessions.map((s) => s.id);
                    // Delete messages first (FK constraint)
                    const { error: msgErr } = await supabase_1.supabaseAdmin
                        .from('app_chat_messages')
                        .delete()
                        .in('session_id', sessionIds);
                    if (msgErr)
                        throw new Error(`chat_messages delete: ${msgErr.message}`);
                    // Then delete sessions
                    const { count, error: sessErr } = await supabase_1.supabaseAdmin
                        .from('app_chat_sessions')
                        .delete({ count: 'exact' })
                        .lt('updated_at', cutoff);
                    if (sessErr)
                        throw new Error(`chat_sessions delete: ${sessErr.message}`);
                    deleted = count ?? 0;
                }
                break;
            }
            case 'old_reminders': {
                const { count, error } = await supabase_1.supabaseAdmin
                    .from('app_reminders')
                    .delete({ count: 'exact' })
                    .lt('due_date', cutoff)
                    .eq('status', 'paid');
                if (error)
                    throw new Error(`old_reminders delete: ${error.message}`);
                deleted = count ?? 0;
                break;
            }
            case 'expired_pending_docs': {
                const { count, error } = await supabase_1.supabaseAdmin
                    .from('app_whatsapp_pending_documents')
                    .delete({ count: 'exact' })
                    .lt('expires_at', new Date().toISOString());
                if (error)
                    throw new Error(`expired_pending_docs delete: ${error.message}`);
                deleted = count ?? 0;
                break;
            }
            case 'ai_quotas': {
                const { count, error } = await supabase_1.supabaseAdmin
                    .from('app_daily_ai_quotas')
                    .delete({ count: 'exact' })
                    .lt('quota_date', cutoff);
                if (error)
                    throw new Error(`ai_quotas delete: ${error.message}`);
                deleted = count ?? 0;
                break;
            }
            case 'billing_events': {
                const { count, error } = await supabase_1.supabaseAdmin
                    .from('app_billing_events')
                    .delete({ count: 'exact' })
                    .lt('created_at', cutoff);
                if (error)
                    throw new Error(`billing_events delete: ${error.message}`);
                deleted = count ?? 0;
                break;
            }
        }
        return deleted;
    }
    router.post('/db-cleanup/preview', async (req, res, next) => {
        try {
            const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];
            const cutoffDate = typeof req.body?.cutoffDate === 'string' ? req.body.cutoffDate : '';
            if (categories.length === 0) {
                res.status(400).json({ error: 'Selecione ao menos uma categoria.' });
                return;
            }
            if (!cutoffDate) {
                res.status(400).json({ error: 'Data de corte é obrigatória.' });
                return;
            }
            const counts = {};
            for (const cat of categories) {
                counts[cat] = await countForCategory(cat, cutoffDate);
            }
            const total = Object.values(counts).reduce((s, v) => s + (v ?? 0), 0);
            res.json({ ok: true, counts, total });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/db-cleanup/execute', async (req, res, next) => {
        try {
            const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];
            const cutoffDate = typeof req.body?.cutoffDate === 'string' ? req.body.cutoffDate : '';
            const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';
            if (categories.length === 0) {
                res.status(400).json({ error: 'Selecione ao menos uma categoria.' });
                return;
            }
            if (!cutoffDate) {
                res.status(400).json({ error: 'Data de corte é obrigatória.' });
                return;
            }
            if (confirmation !== 'CONFIRMAR') {
                res.status(400).json({ error: 'Confirmação inválida. Digite CONFIRMAR.' });
                return;
            }
            // Process in a specific order to respect FK constraints
            const orderedCategories = [
                'chat_sessions', 'whatsapp_messages', 'old_reminders',
                'expired_pending_docs', 'ai_quotas', 'billing_events'
            ].filter(c => categories.includes(c));
            const counts = {};
            for (const cat of orderedCategories) {
                counts[cat] = await deleteForCategory(cat, cutoffDate);
            }
            const totalDeleted = Object.values(counts).reduce((s, v) => s + v, 0);
            const entry = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                cutoffDate,
                categories: orderedCategories,
                counts,
                totalDeleted
            };
            cleanupHistory.unshift(entry);
            if (cleanupHistory.length > MAX_CLEANUP_HISTORY)
                cleanupHistory.length = MAX_CLEANUP_HISTORY;
            logger_1.logger.warn('Admin executed DB cleanup', {
                cutoffDate,
                categories: orderedCategories,
                counts,
                totalDeleted
            });
            res.json({ ok: true, counts, totalDeleted });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/db-cleanup/history', (_req, res) => {
        res.json({ history: cleanupHistory });
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Admin route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
