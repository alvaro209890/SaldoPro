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
const DEFAULT_INSIGHTS_CUTOFF_MONTHS = 6;
const INSIGHTS_SAMPLE_SIZE = 150;
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
const CLEANUP_CATEGORY_CONFIG = {
    whatsapp_messages: {
        table: 'whatsapp_messages',
        timestampColumn: 'created_at',
        sampleColumns: 'id, owner_uid, direction, status, text, metadata, created_at, from_phone, to_phone',
        estimationMethod: 'sample_json',
        applyTotalFilters: (query) => query,
        applyEligibleFilters: (query, context) => query.lt('created_at', context.cutoffDate)
    },
    chat_sessions: {
        table: 'app_chat_sessions',
        timestampColumn: 'updated_at',
        sampleColumns: 'id, uid, title, created_at, updated_at',
        estimationMethod: 'sample_json',
        applyTotalFilters: (query) => query,
        applyEligibleFilters: (query, context) => query.lt('updated_at', context.cutoffDate)
    },
    old_reminders: {
        table: 'app_reminders',
        timestampColumn: 'due_date',
        sampleColumns: 'id, uid, reminder_kind, title, amount, due_date, status, type, created_at, updated_at',
        estimationMethod: 'sample_json',
        applyTotalFilters: (query) => query.eq('status', 'paid'),
        applyEligibleFilters: (query, context) => query.eq('status', 'paid').lt('due_date', context.cutoffDate)
    },
    expired_pending_docs: {
        table: 'app_whatsapp_pending_documents',
        timestampColumn: 'expires_at',
        sampleColumns: 'id, uid, source_phone, size_bytes, pending_reason, expires_at, created_at',
        estimationMethod: 'size_column_sample',
        sizeColumn: 'size_bytes',
        applyTotalFilters: (query) => query,
        applyEligibleFilters: (query, context) => query.lt('expires_at', context.nowIso)
    },
    ai_quotas: {
        table: 'app_daily_ai_quotas',
        timestampColumn: 'quota_date',
        sampleColumns: 'uid, quota_date, channel, used_count, created_at, updated_at',
        estimationMethod: 'sample_json',
        applyTotalFilters: (query) => query,
        applyEligibleFilters: (query, context) => query.lt('quota_date', context.cutoffDate)
    },
    billing_events: {
        table: 'app_billing_events',
        timestampColumn: 'created_at',
        sampleColumns: 'id, provider, event_type, provider_event_id, processed, created_at, raw_payload',
        estimationMethod: 'sample_json',
        applyTotalFilters: (query) => query,
        applyEligibleFilters: (query, context) => query.lt('created_at', context.cutoffDate)
    }
};
function toIsoString(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()))
        return null;
    return parsed.toISOString();
}
function defaultInsightsCutoffDate() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - DEFAULT_INSIGHTS_CUTOFF_MONTHS);
    return cutoff.toISOString();
}
function resolveInsightsCutoffDate(rawValue) {
    if (rawValue == null || rawValue === '') {
        return { cutoffDate: defaultInsightsCutoffDate() };
    }
    const cutoffDate = toIsoString(rawValue);
    if (!cutoffDate) {
        return { error: 'cutoffDate invalida. Use uma data ISO valida.' };
    }
    return { cutoffDate };
}
function resolveRequiredCutoffDate(rawValue) {
    const cutoffDate = toIsoString(rawValue);
    if (!cutoffDate) {
        return { error: 'Data de corte invalida.' };
    }
    return { cutoffDate };
}
function normalizeCleanupCategories(input) {
    if (!Array.isArray(input))
        return [];
    const allowed = new Set(CLEANUP_ORDER);
    return input.filter((value) => typeof value === 'string' && allowed.has(value));
}
function createCleanupFilterContext(cutoffDate) {
    return {
        cutoffDate,
        nowIso: new Date().toISOString()
    };
}
function readRowField(row, field) {
    if (!row || typeof row !== 'object' || Array.isArray(row))
        return undefined;
    return row[field];
}
function toObjectRows(rows) {
    if (!Array.isArray(rows))
        return [];
    return rows.filter((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}
async function countCleanupCategoryRecords(category, context, scope) {
    const config = CLEANUP_CATEGORY_CONFIG[category];
    let query = supabase_1.supabaseAdmin
        .from(config.table)
        .select('*', { count: 'exact', head: true });
    query = scope === 'eligible'
        ? config.applyEligibleFilters(query, context)
        : config.applyTotalFilters(query, context);
    const { count, error } = await query;
    if (error)
        throw new Error(`${category} ${scope} count: ${error.message}`);
    return count ?? 0;
}
async function getCategoryTimeRange(category, context) {
    const config = CLEANUP_CATEGORY_CONFIG[category];
    const column = config.timestampColumn;
    let oldestQuery = supabase_1.supabaseAdmin
        .from(config.table)
        .select(column)
        .not(column, 'is', null)
        .order(column, { ascending: true })
        .limit(1);
    oldestQuery = config.applyTotalFilters(oldestQuery, context);
    let newestQuery = supabase_1.supabaseAdmin
        .from(config.table)
        .select(column)
        .not(column, 'is', null)
        .order(column, { ascending: false })
        .limit(1);
    newestQuery = config.applyTotalFilters(newestQuery, context);
    const [oldestResult, newestResult] = await Promise.all([oldestQuery, newestQuery]);
    if (oldestResult.error)
        throw new Error(`${category} oldestAt: ${oldestResult.error.message}`);
    if (newestResult.error)
        throw new Error(`${category} newestAt: ${newestResult.error.message}`);
    const oldestAt = readRowField(oldestResult.data?.[0], column);
    const newestAt = readRowField(newestResult.data?.[0], column);
    return {
        oldestAt: typeof oldestAt === 'string' ? oldestAt : null,
        newestAt: typeof newestAt === 'string' ? newestAt : null
    };
}
function averageBytesFromRows(rows) {
    if (rows.length === 0)
        return 0;
    const totalBytes = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0);
    return totalBytes / rows.length;
}
async function estimateCategoryBytes(category, context, totalCount, eligibleCount) {
    const config = CLEANUP_CATEGORY_CONFIG[category];
    if (totalCount <= 0) {
        return {
            estimatedTotalBytes: 0,
            estimatedRecoverableBytes: 0,
            avgBytesPerRecord: 0,
            estimationMethod: config.estimationMethod
        };
    }
    try {
        if (config.estimationMethod === 'size_column_sample' && config.sizeColumn) {
            let query = supabase_1.supabaseAdmin
                .from(config.table)
                .select(config.sizeColumn)
                .not(config.sizeColumn, 'is', null)
                .limit(INSIGHTS_SAMPLE_SIZE);
            query = config.applyTotalFilters(query, context);
            if (config.timestampColumn) {
                query = query.order(config.timestampColumn, { ascending: false });
            }
            const { data, error } = await query;
            if (error)
                throw new Error(error.message);
            const sizes = toObjectRows((data ?? []))
                .map((item) => Number(readRowField(item, config.sizeColumn)))
                .filter((value) => Number.isFinite(value) && value >= 0);
            const avgBytesPerRecord = sizes.length > 0
                ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length
                : 0;
            return {
                estimatedTotalBytes: Math.round(avgBytesPerRecord * totalCount),
                estimatedRecoverableBytes: Math.round(avgBytesPerRecord * eligibleCount),
                avgBytesPerRecord: Number(avgBytesPerRecord.toFixed(2)),
                estimationMethod: config.estimationMethod,
                ...(sizes.length === 0 ? { note: 'Amostra sem dados de tamanho para estimativa.' } : {})
            };
        }
        let query = supabase_1.supabaseAdmin
            .from(config.table)
            .select(config.sampleColumns)
            .limit(INSIGHTS_SAMPLE_SIZE);
        query = config.applyTotalFilters(query, context);
        if (config.timestampColumn) {
            query = query.order(config.timestampColumn, { ascending: false });
        }
        const { data, error } = await query;
        if (error)
            throw new Error(error.message);
        const rows = toObjectRows((data ?? []));
        const avgBytesPerRecord = averageBytesFromRows(rows);
        return {
            estimatedTotalBytes: Math.round(avgBytesPerRecord * totalCount),
            estimatedRecoverableBytes: Math.round(avgBytesPerRecord * eligibleCount),
            avgBytesPerRecord: Number(avgBytesPerRecord.toFixed(2)),
            estimationMethod: config.estimationMethod,
            ...(rows.length === 0 ? { note: 'Amostra vazia; valores estimados podem estar subestimados.' } : {})
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.warn('Admin cleanup insights sample failed', { category, message });
        return {
            estimatedTotalBytes: 0,
            estimatedRecoverableBytes: 0,
            avgBytesPerRecord: 0,
            estimationMethod: config.estimationMethod,
            note: 'Estimativa de armazenamento indisponivel para esta categoria.'
        };
    }
}
function classifyCleanupRisk(eligibleCount, eligiblePct, estimatedRecoverableBytes) {
    if (eligibleCount <= 0)
        return 'low';
    const oneMb = 1024 * 1024;
    if (estimatedRecoverableBytes >= 50 * oneMb ||
        (eligiblePct >= 80 && eligibleCount >= 300) ||
        eligibleCount >= 5000) {
        return 'critical';
    }
    if (estimatedRecoverableBytes >= 10 * oneMb ||
        eligiblePct >= 40 ||
        eligibleCount >= 1000) {
        return 'warning';
    }
    return 'low';
}
async function buildCategoryInsight(category, context) {
    const [totalCount, eligibleCount, range] = await Promise.all([
        countCleanupCategoryRecords(category, context, 'total'),
        countCleanupCategoryRecords(category, context, 'eligible'),
        getCategoryTimeRange(category, context)
    ]);
    const bytes = await estimateCategoryBytes(category, context, totalCount, eligibleCount);
    const eligiblePct = totalCount > 0 ? Number(((eligibleCount / totalCount) * 100).toFixed(2)) : 0;
    return {
        category,
        totalCount,
        eligibleCount,
        eligiblePct,
        estimatedTotalBytes: bytes.estimatedTotalBytes,
        estimatedRecoverableBytes: bytes.estimatedRecoverableBytes,
        avgBytesPerRecord: bytes.avgBytesPerRecord,
        oldestAt: range.oldestAt,
        newestAt: range.newestAt,
        riskLevel: classifyCleanupRisk(eligibleCount, eligiblePct, bytes.estimatedRecoverableBytes),
        estimationMethod: bytes.estimationMethod,
        ...(bytes.note ? { note: bytes.note } : {})
    };
}
async function deleteCleanupCategoryRecords(category, context) {
    switch (category) {
        case 'whatsapp_messages': {
            const { count, error } = await supabase_1.supabaseAdmin
                .from('whatsapp_messages')
                .delete({ count: 'exact' })
                .lt('created_at', context.cutoffDate);
            if (error)
                throw new Error(`whatsapp_messages delete: ${error.message}`);
            return count ?? 0;
        }
        case 'chat_sessions': {
            const { data: sessions, error: fetchErr } = await supabase_1.supabaseAdmin
                .from('app_chat_sessions')
                .select('id')
                .lt('updated_at', context.cutoffDate);
            if (fetchErr)
                throw new Error(`chat_sessions fetch: ${fetchErr.message}`);
            if (!sessions || sessions.length === 0)
                return 0;
            const sessionIds = sessions
                .map((entry) => entry.id)
                .filter((id) => typeof id === 'string' && id.length > 0);
            if (sessionIds.length === 0)
                return 0;
            const { error: msgErr } = await supabase_1.supabaseAdmin
                .from('app_chat_messages')
                .delete()
                .in('session_id', sessionIds);
            if (msgErr)
                throw new Error(`chat_messages delete: ${msgErr.message}`);
            const { count, error: sessErr } = await supabase_1.supabaseAdmin
                .from('app_chat_sessions')
                .delete({ count: 'exact' })
                .lt('updated_at', context.cutoffDate);
            if (sessErr)
                throw new Error(`chat_sessions delete: ${sessErr.message}`);
            return count ?? 0;
        }
        case 'old_reminders': {
            const { count, error } = await supabase_1.supabaseAdmin
                .from('app_reminders')
                .delete({ count: 'exact' })
                .lt('due_date', context.cutoffDate)
                .eq('status', 'paid');
            if (error)
                throw new Error(`old_reminders delete: ${error.message}`);
            return count ?? 0;
        }
        case 'expired_pending_docs': {
            const { count, error } = await supabase_1.supabaseAdmin
                .from('app_whatsapp_pending_documents')
                .delete({ count: 'exact' })
                .lt('expires_at', context.nowIso);
            if (error)
                throw new Error(`expired_pending_docs delete: ${error.message}`);
            return count ?? 0;
        }
        case 'ai_quotas': {
            const { count, error } = await supabase_1.supabaseAdmin
                .from('app_daily_ai_quotas')
                .delete({ count: 'exact' })
                .lt('quota_date', context.cutoffDate);
            if (error)
                throw new Error(`ai_quotas delete: ${error.message}`);
            return count ?? 0;
        }
        case 'billing_events': {
            const { count, error } = await supabase_1.supabaseAdmin
                .from('app_billing_events')
                .delete({ count: 'exact' })
                .lt('created_at', context.cutoffDate);
            if (error)
                throw new Error(`billing_events delete: ${error.message}`);
            return count ?? 0;
        }
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
    router.get('/db-cleanup/insights', async (req, res, next) => {
        try {
            const resolvedCutoff = resolveInsightsCutoffDate(req.query?.cutoffDate);
            if ('error' in resolvedCutoff) {
                res.status(400).json({ error: resolvedCutoff.error });
                return;
            }
            const context = createCleanupFilterContext(resolvedCutoff.cutoffDate);
            const categories = await Promise.all(CLEANUP_ORDER.map((category) => buildCategoryInsight(category, context)));
            const totals = categories.reduce((acc, item) => {
                acc.totalRecords += item.totalCount;
                acc.eligibleRecords += item.eligibleCount;
                acc.estimatedTotalBytes += item.estimatedTotalBytes;
                acc.estimatedRecoverableBytes += item.estimatedRecoverableBytes;
                return acc;
            }, {
                totalRecords: 0,
                eligibleRecords: 0,
                estimatedTotalBytes: 0,
                estimatedRecoverableBytes: 0
            });
            res.json({
                cutoffDate: context.cutoffDate,
                totals,
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
            const categories = normalizeCleanupCategories(req.body?.categories);
            const resolvedCutoff = resolveRequiredCutoffDate(req.body?.cutoffDate);
            if (categories.length === 0) {
                res.status(400).json({ error: 'Selecione ao menos uma categoria.' });
                return;
            }
            if ('error' in resolvedCutoff) {
                res.status(400).json({ error: resolvedCutoff.error });
                return;
            }
            const context = createCleanupFilterContext(resolvedCutoff.cutoffDate);
            const counts = {};
            for (const cat of categories) {
                counts[cat] = await countCleanupCategoryRecords(cat, context, 'eligible');
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
            const categories = normalizeCleanupCategories(req.body?.categories);
            const resolvedCutoff = resolveRequiredCutoffDate(req.body?.cutoffDate);
            const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';
            if (categories.length === 0) {
                res.status(400).json({ error: 'Selecione ao menos uma categoria.' });
                return;
            }
            if ('error' in resolvedCutoff) {
                res.status(400).json({ error: resolvedCutoff.error });
                return;
            }
            if (confirmation !== 'CONFIRMAR') {
                res.status(400).json({ error: 'Confirmação inválida. Digite CONFIRMAR.' });
                return;
            }
            const context = createCleanupFilterContext(resolvedCutoff.cutoffDate);
            const orderedCategories = CLEANUP_ORDER.filter((category) => categories.includes(category));
            const counts = {};
            for (const cat of orderedCategories) {
                counts[cat] = await deleteCleanupCategoryRecords(cat, context);
            }
            const totalDeleted = Object.values(counts).reduce((s, v) => s + v, 0);
            const entry = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                cutoffDate: context.cutoffDate,
                categories: orderedCategories,
                counts,
                totalDeleted
            };
            cleanupHistory.unshift(entry);
            if (cleanupHistory.length > MAX_CLEANUP_HISTORY)
                cleanupHistory.length = MAX_CLEANUP_HISTORY;
            logger_1.logger.warn('Admin executed DB cleanup', {
                cutoffDate: context.cutoffDate,
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
