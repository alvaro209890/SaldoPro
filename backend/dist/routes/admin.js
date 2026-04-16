"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminRouter = createAdminRouter;
const express_1 = require("express");
const admin_session_1 = require("../lib/admin-session");
const document_storage_1 = require("../lib/document-storage");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const local_db_1 = require("../lib/local-db");
const subscription_access_1 = require("../lib/subscription-access");
const admin_auth_1 = require("../middleware/admin-auth");
const cleanupHistory = [];
const CLEANUP_ORDER = [
    'chat_sessions',
    'whatsapp_messages',
    'old_reminders',
    'expired_pending_docs',
    'ai_quotas',
    'billing_events'
];
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
    merged.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return merged;
}
async function loadMergedAdminUsers() {
    const [snapshots, firebaseStates] = await Promise.all([
        (0, firestore_1.listAdminUserSnapshots)(),
        (0, firebase_user_access_1.listAllFirebaseUserAccessStates)()
    ]);
    const uids = [...new Set([...snapshots.map((item) => item.uid), ...firebaseStates.keys()])];
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
function defaultInsightsCutoffDate() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    return cutoff.toISOString();
}
function toIsoString(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function countTable(table, whereSql = '', params = []) {
    const row = local_db_1.db.prepare(`select count(*) as total from ${table}${whereSql ? ` where ${whereSql}` : ''}`).get(...params);
    return Number(row.total ?? 0);
}
function rangeTable(table, column, whereSql = '', params = []) {
    const whereClause = whereSql ? `where ${whereSql}` : '';
    const row = local_db_1.db.prepare(`
    select min(${column}) as oldestAt, max(${column}) as newestAt
    from ${table}
    ${whereClause}
  `).get(...params);
    return { oldestAt: row.oldestAt ?? null, newestAt: row.newestAt ?? null };
}
function avgJsonBytes(table, whereSql = '', params = []) {
    const whereClause = whereSql ? `where ${whereSql}` : '';
    const rows = local_db_1.db.prepare(`select * from ${table} ${whereClause} limit 100`).all(...params);
    if (rows.length === 0)
        return 0;
    const total = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0);
    return total / rows.length;
}
function buildCleanupInsight(category, cutoffDate) {
    const now = new Date().toISOString();
    switch (category) {
        case 'whatsapp_messages': {
            const totalCount = countTable('whatsapp_messages');
            const eligibleCount = countTable('whatsapp_messages', 'created_at < ?', [cutoffDate]);
            const bytes = avgJsonBytes('whatsapp_messages');
            const range = rangeTable('whatsapp_messages', 'created_at');
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(bytes * totalCount),
                estimatedRecoverableBytes: Math.round(bytes * eligibleCount),
                avgBytesPerRecord: Number(bytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 5000 ? 'critical' : eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'sample_json'
            };
        }
        case 'chat_sessions': {
            const totalCount = countTable('app_chat_sessions');
            const eligibleCount = countTable('app_chat_sessions', 'updated_at < ?', [cutoffDate]);
            const bytes = avgJsonBytes('app_chat_sessions');
            const range = rangeTable('app_chat_sessions', 'updated_at');
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(bytes * totalCount),
                estimatedRecoverableBytes: Math.round(bytes * eligibleCount),
                avgBytesPerRecord: Number(bytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'sample_json'
            };
        }
        case 'old_reminders': {
            const totalCount = countTable('app_reminders', 'status = ?', ['paid']);
            const eligibleCount = countTable('app_reminders', 'status = ? and due_date < ?', ['paid', cutoffDate.slice(0, 10)]);
            const bytes = avgJsonBytes('app_reminders', 'status = ?', ['paid']);
            const range = rangeTable('app_reminders', 'due_date', 'status = ?', ['paid']);
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(bytes * totalCount),
                estimatedRecoverableBytes: Math.round(bytes * eligibleCount),
                avgBytesPerRecord: Number(bytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'sample_json'
            };
        }
        case 'expired_pending_docs': {
            const totalCount = countTable('app_whatsapp_pending_documents');
            const eligibleCount = countTable('app_whatsapp_pending_documents', 'expires_at < ?', [now]);
            const sizeRow = local_db_1.db.prepare(`
        select coalesce(avg(size_bytes), 0) as avgBytes
        from app_whatsapp_pending_documents
      `).get();
            const avgBytes = Number(sizeRow.avgBytes ?? 0);
            const range = rangeTable('app_whatsapp_pending_documents', 'expires_at');
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(avgBytes * totalCount),
                estimatedRecoverableBytes: Math.round(avgBytes * eligibleCount),
                avgBytesPerRecord: Number(avgBytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'size_column_sample'
            };
        }
        case 'ai_quotas': {
            const totalCount = countTable('app_daily_ai_quotas');
            const eligibleCount = countTable('app_daily_ai_quotas', 'quota_date < ?', [cutoffDate.slice(0, 10)]);
            const bytes = avgJsonBytes('app_daily_ai_quotas');
            const range = rangeTable('app_daily_ai_quotas', 'quota_date');
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(bytes * totalCount),
                estimatedRecoverableBytes: Math.round(bytes * eligibleCount),
                avgBytesPerRecord: Number(bytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'sample_json'
            };
        }
        case 'billing_events':
        default: {
            const totalCount = countTable('app_billing_events');
            const eligibleCount = countTable('app_billing_events', 'created_at < ?', [cutoffDate]);
            const bytes = avgJsonBytes('app_billing_events');
            const range = rangeTable('app_billing_events', 'created_at');
            return {
                category,
                totalCount,
                eligibleCount,
                eligiblePct: totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0,
                estimatedTotalBytes: Math.round(bytes * totalCount),
                estimatedRecoverableBytes: Math.round(bytes * eligibleCount),
                avgBytesPerRecord: Number(bytes.toFixed(2)),
                oldestAt: range.oldestAt,
                newestAt: range.newestAt,
                riskLevel: eligibleCount > 1000 ? 'warning' : 'low',
                estimationMethod: 'sample_json'
            };
        }
    }
}
function executeCleanup(category, cutoffDate) {
    const now = new Date().toISOString();
    switch (category) {
        case 'whatsapp_messages':
            return local_db_1.db.prepare('delete from whatsapp_messages where created_at < ?').run(cutoffDate).changes;
        case 'chat_sessions': {
            const sessionIds = local_db_1.db.prepare('select id from app_chat_sessions where updated_at < ?').all(cutoffDate);
            for (const session of sessionIds) {
                local_db_1.db.prepare('delete from app_chat_messages where session_id = ?').run(session.id);
            }
            return local_db_1.db.prepare('delete from app_chat_sessions where updated_at < ?').run(cutoffDate).changes;
        }
        case 'old_reminders':
            return local_db_1.db.prepare(`delete from app_reminders where status = 'paid' and due_date < ?`).run(cutoffDate.slice(0, 10)).changes;
        case 'expired_pending_docs':
            return local_db_1.db.prepare('delete from app_whatsapp_pending_documents where expires_at < ?').run(now).changes;
        case 'ai_quotas':
            return local_db_1.db.prepare('delete from app_daily_ai_quotas where quota_date < ?').run(cutoffDate.slice(0, 10)).changes;
        case 'billing_events':
        default:
            return local_db_1.db.prepare('delete from app_billing_events where created_at < ?').run(cutoffDate).changes;
    }
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
            const recentAlerts = logs.filter((entry) => entry.level === 'warn' || entry.level === 'error');
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
            res.json({ storage: await (0, document_storage_1.getDocumentStorageUsageSummary)() });
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
                res.json({
                    user: null,
                    recentTransactions: [],
                    recentReminders: [],
                    missing: true
                });
                return;
            }
            res.json({
                user,
                recentTransactions,
                recentReminders: reminders.slice(0, 5)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/users/:uid/messages', async (req, res, next) => {
        try {
            res.json({
                messages: await (0, firestore_1.getRecentConversationByOwnerUid)(req.params.uid, 50)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/whatsapp/reset-session', async (_req, res, next) => {
        try {
            await manager.resetSession();
            res.json({
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
            res.json({
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
            await (0, firebase_user_access_1.setFirebaseUserDisabled)(req.params.uid, true);
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/unblock', async (req, res, next) => {
        try {
            await (0, firebase_user_access_1.setFirebaseUserDisabled)(req.params.uid, false);
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/block', async (req, res, next) => {
        try {
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
            await (0, subscription_access_1.setUserPlanOverride)(req.params.uid, 'deny', reason || 'Admin block');
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/unblock', async (req, res, next) => {
        try {
            await (0, subscription_access_1.clearUserPlanOverride)(req.params.uid);
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/reset', async (req, res, next) => {
        try {
            await (0, subscription_access_1.clearUserPlanOverride)(req.params.uid);
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/subscriptions', async (_req, res, next) => {
        try {
            res.json({ subscriptions: await (0, subscription_access_1.listAllSubscriptions)() });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/subscription/grant', async (req, res, next) => {
        try {
            const planCode = typeof req.body?.planCode === 'string' ? req.body.planCode.trim() : '';
            await (0, subscription_access_1.adminGrantSubscription)(req.params.uid, planCode);
            res.json({ user: await loadSingleAdminUser(req.params.uid) });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/users/:uid/message', async (req, res, next) => {
        try {
            const uid = req.params.uid;
            const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
            if (!text) {
                res.status(400).json({ error: 'Mensagem obrigatoria.' });
                return;
            }
            const user = await loadSingleAdminUser(uid);
            const target = user?.whatsappAllowedNumbers?.[0];
            if (!target) {
                res.status(400).json({ error: 'Usuario sem WhatsApp configurado.' });
                return;
            }
            const sent = await manager.sendTextWithRouting({
                to: target,
                text,
                ownerUid: uid
            });
            res.json({ ok: true, messageId: sent.messageId, clientId: sent.clientId });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/db-cleanup/insights', async (req, res, next) => {
        try {
            const cutoffDate = toIsoString(req.query.cutoffDate) ?? defaultInsightsCutoffDate();
            const categories = CLEANUP_ORDER.map((category) => buildCleanupInsight(category, cutoffDate));
            res.json({
                cutoffDate,
                totals: {
                    totalRecords: categories.reduce((sum, item) => sum + item.totalCount, 0),
                    eligibleRecords: categories.reduce((sum, item) => sum + item.eligibleCount, 0),
                    estimatedTotalBytes: categories.reduce((sum, item) => sum + item.estimatedTotalBytes, 0),
                    estimatedRecoverableBytes: categories.reduce((sum, item) => sum + item.estimatedRecoverableBytes, 0)
                },
                categories,
                generatedAt: new Date().toISOString()
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/db-cleanup/preview', async (req, res, next) => {
        try {
            const cutoffDate = toIsoString(req.body?.cutoffDate);
            if (!cutoffDate) {
                res.status(400).json({ error: 'Data de corte invalida.' });
                return;
            }
            const categories = Array.isArray(req.body?.categories)
                ? (req.body.categories.filter((item) => CLEANUP_ORDER.includes(item)))
                : CLEANUP_ORDER;
            const counts = Object.fromEntries(categories.map((category) => [category, buildCleanupInsight(category, cutoffDate).eligibleCount]));
            res.json({
                counts,
                total: Object.values(counts).reduce((sum, value) => sum + value, 0)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/db-cleanup/execute', async (req, res, next) => {
        try {
            const cutoffDate = toIsoString(req.body?.cutoffDate);
            if (!cutoffDate) {
                res.status(400).json({ error: 'Data de corte invalida.' });
                return;
            }
            const categories = Array.isArray(req.body?.categories)
                ? (req.body.categories.filter((item) => CLEANUP_ORDER.includes(item)))
                : CLEANUP_ORDER;
            const counts = {};
            let totalDeleted = 0;
            for (const category of categories) {
                const deleted = executeCleanup(category, cutoffDate);
                counts[category] = deleted;
                totalDeleted += deleted;
            }
            cleanupHistory.unshift({
                id: `${Date.now()}`,
                timestamp: new Date().toISOString(),
                cutoffDate,
                categories,
                counts,
                totalDeleted
            });
            cleanupHistory.splice(50);
            res.json({ counts, totalDeleted });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/db-cleanup/history', (_req, res) => {
        res.json({ history: cleanupHistory });
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Admin route error', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' });
    });
    return router;
}
