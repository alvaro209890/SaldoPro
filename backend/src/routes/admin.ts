import { Router, type Request, type Response } from 'express';
import { createAdminSessionToken, isValidAdminPassword } from '../lib/admin-session';
import { getDocumentStorageUsageSummary } from '../lib/document-storage';
import {
  getFirebaseUserAccessState,
  listAllFirebaseUserAccessStates,
  setFirebaseUserDisabled
} from '../lib/firebase-user-access';
import {
  getAdminUserSnapshot,
  getRecentConversationByOwnerUid,
  getRecentTransactions,
  getUserReminders,
  listAdminUserSnapshots,
  type AdminUserSnapshot
} from '../lib/firestore';
import { getRecentOperationalLogs, type OperationalLogEntry, logger } from '../lib/logger';
import { db } from '../lib/local-db';
import {
  adminGrantSubscription,
  clearUserPlanOverride,
  getUserPlanAccessSummaryMap,
  listAllSubscriptions,
  setUserPlanOverride,
  type UserPlanAccessSummary
} from '../lib/subscription-access';
import { requireAdminAuth } from '../middleware/admin-auth';
import type { WhatsAppClientsManager } from '../whatsapp/manager';

type CleanupCategory = 'whatsapp_messages' | 'chat_sessions' | 'old_reminders' | 'expired_pending_docs' | 'ai_quotas' | 'billing_events';

interface CleanupHistoryEntry {
  id: string;
  timestamp: string;
  cutoffDate: string;
  categories: CleanupCategory[];
  counts: Record<CleanupCategory, number>;
  totalDeleted: number;
}

interface AdminApiUser {
  uid: string;
  email: string | null;
  displayName: string;
  createdAt: string | null;
  blocked: boolean;
  firebaseExists: boolean;
  whatsappAllowedNumbers: string[];
  settings: AdminUserSnapshot['settings'];
  metrics: AdminUserSnapshot['metrics'];
  firebase: {
    disabled: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
  };
  subscription: {
    status: 'none' | 'pending' | 'authorized' | 'paused' | 'cancelled' | 'rejected';
    premiumActive: boolean;
    baseActive: boolean;
    overrideMode: 'none' | 'allow' | 'deny';
  };
}

interface CleanupCategoryInsight {
  category: CleanupCategory;
  totalCount: number;
  eligibleCount: number;
  eligiblePct: number;
  estimatedTotalBytes: number;
  estimatedRecoverableBytes: number;
  avgBytesPerRecord: number;
  oldestAt: string | null;
  newestAt: string | null;
  riskLevel: 'low' | 'warning' | 'critical';
  estimationMethod: 'sample_json' | 'size_column_sample';
  note?: string;
}

const cleanupHistory: CleanupHistoryEntry[] = [];
const CLEANUP_ORDER: CleanupCategory[] = [
  'chat_sessions',
  'whatsapp_messages',
  'old_reminders',
  'expired_pending_docs',
  'ai_quotas',
  'billing_events'
];

function isWhatsAppLog(entry: OperationalLogEntry): boolean {
  if (entry.message.includes('WhatsApp')) return true;
  if (entry.message.startsWith('MSG_')) return true;
  const slotId = entry.meta?.slotId;
  return slotId === 'wa1';
}

function normalizeLogEntry(entry: OperationalLogEntry): {
  timestamp: string;
  level: OperationalLogEntry['level'];
  message: string;
  meta?: Record<string, unknown>;
} {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    ...(entry.meta ? { meta: entry.meta } : {})
  };
}

function mergeAdminUsers(
  snapshots: AdminUserSnapshot[],
  firebaseStates: Map<string, Awaited<ReturnType<typeof getFirebaseUserAccessState>>>,
  planAccessByUid: Map<string, UserPlanAccessSummary>
): AdminApiUser[] {
  const snapshotByUid = new Map(snapshots.map((item) => [item.uid, item] as const));
  const allUids = new Set<string>([
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

async function loadMergedAdminUsers(): Promise<AdminApiUser[]> {
  const [snapshots, firebaseStates] = await Promise.all([
    listAdminUserSnapshots(),
    listAllFirebaseUserAccessStates()
  ]);
  const uids = [...new Set([...snapshots.map((item) => item.uid), ...firebaseStates.keys()])];
  const planAccess = await getUserPlanAccessSummaryMap(uids);
  return mergeAdminUsers(snapshots, firebaseStates, planAccess);
}

async function loadSingleAdminUser(uid: string): Promise<AdminApiUser | null> {
  const [snapshot, firebase] = await Promise.all([
    getAdminUserSnapshot(uid),
    getFirebaseUserAccessState(uid, true)
  ]);
  if (!snapshot && !firebase.exists) {
    return null;
  }
  const planAccess = await getUserPlanAccessSummaryMap([uid]);
  return mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, firebase]]), planAccess)[0] ?? null;
}

function defaultInsightsCutoffDate(): string {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  return cutoff.toISOString();
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function countTable(table: string, whereSql = '', params: unknown[] = []): number {
  const row = db.prepare(`select count(*) as total from ${table}${whereSql ? ` where ${whereSql}` : ''}`).get(...params) as {
    total: number;
  };
  return Number(row.total ?? 0);
}

function rangeTable(table: string, column: string, whereSql = '', params: unknown[] = []): { oldestAt: string | null; newestAt: string | null } {
  const whereClause = whereSql ? `where ${whereSql}` : '';
  const row = db.prepare(`
    select min(${column}) as oldestAt, max(${column}) as newestAt
    from ${table}
    ${whereClause}
  `).get(...params) as { oldestAt: string | null; newestAt: string | null };
  return { oldestAt: row.oldestAt ?? null, newestAt: row.newestAt ?? null };
}

function avgJsonBytes(table: string, whereSql = '', params: unknown[] = []): number {
  const whereClause = whereSql ? `where ${whereSql}` : '';
  const rows = db.prepare(`select * from ${table} ${whereClause} limit 100`).all(...params) as unknown[];
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum: number, row: unknown) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'), 0);
  return total / rows.length;
}

function buildCleanupInsight(category: CleanupCategory, cutoffDate: string): CleanupCategoryInsight {
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
      const sizeRow = db.prepare(`
        select coalesce(avg(size_bytes), 0) as avgBytes
        from app_whatsapp_pending_documents
      `).get() as { avgBytes: number };
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

function executeCleanup(category: CleanupCategory, cutoffDate: string): number {
  const now = new Date().toISOString();
  switch (category) {
    case 'whatsapp_messages':
      return db.prepare('delete from whatsapp_messages where created_at < ?').run(cutoffDate).changes;
    case 'chat_sessions': {
      const sessionIds = db.prepare('select id from app_chat_sessions where updated_at < ?').all(cutoffDate) as Array<{ id: string }>;
      for (const session of sessionIds) {
        db.prepare('delete from app_chat_messages where session_id = ?').run(session.id);
      }
      return db.prepare('delete from app_chat_sessions where updated_at < ?').run(cutoffDate).changes;
    }
    case 'old_reminders':
      return db.prepare(`delete from app_reminders where status = 'paid' and due_date < ?`).run(cutoffDate.slice(0, 10)).changes;
    case 'expired_pending_docs':
      return db.prepare('delete from app_whatsapp_pending_documents where expires_at < ?').run(now).changes;
    case 'ai_quotas':
      return db.prepare('delete from app_daily_ai_quotas where quota_date < ?').run(cutoffDate.slice(0, 10)).changes;
    case 'billing_events':
    default:
      return db.prepare('delete from app_billing_events where created_at < ?').run(cutoffDate).changes;
  }
}

export function createAdminRouter(manager: WhatsAppClientsManager): Router {
  const router = Router();

  router.post('/auth/login', (req: Request, res: Response) => {
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password) {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    if (!isValidAdminPassword(password)) {
      res.status(401).json({ error: 'Invalid password.' });
      return;
    }

    const session = createAdminSessionToken();
    res.json({ ok: true, token: session.token, expiresAt: session.expiresAt });
  });

  router.post('/auth/logout', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.use(requireAdminAuth);

  router.get('/auth/session', (req: Request, res: Response) => {
    res.json({
      ok: true,
      expiresAt: (req as Request & { adminExpiresAt?: string }).adminExpiresAt ?? null
    });
  });

  router.get('/overview', async (_req: Request, res: Response, next) => {
    try {
      const [users, qrSlots] = await Promise.all([
        loadMergedAdminUsers(),
        manager.getQrPayloads()
      ]);
      const logs = getRecentOperationalLogs(80);
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
    } catch (error) {
      next(error);
    }
  });

  router.get('/users', async (_req: Request, res: Response, next) => {
    try {
      res.json({ users: await loadMergedAdminUsers() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/storage-usage', async (_req: Request, res: Response, next) => {
    try {
      res.json({ storage: await getDocumentStorageUsageSummary() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:uid', async (req: Request, res: Response, next) => {
    try {
      const uid = req.params.uid;
      const [user, recentTransactions, reminders] = await Promise.all([
        loadSingleAdminUser(uid),
        getRecentTransactions(uid, 5),
        getUserReminders(uid)
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
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:uid/messages', async (req: Request, res: Response, next) => {
    try {
      res.json({
        messages: await getRecentConversationByOwnerUid(req.params.uid, 50)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/whatsapp/reset-session', async (_req: Request, res: Response, next) => {
    try {
      await manager.resetSession();
      res.json({
        slots: manager.getStatuses(),
        qr: await manager.getQrPayloads()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/whatsapp/refresh-qr', async (_req: Request, res: Response, next) => {
    try {
      res.json({
        slots: manager.getStatuses(),
        qr: await manager.getQrPayloads()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/block', async (req: Request, res: Response, next) => {
    try {
      await setFirebaseUserDisabled(req.params.uid, true);
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/unblock', async (req: Request, res: Response, next) => {
    try {
      await setFirebaseUserDisabled(req.params.uid, false);
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/subscription/block', async (req: Request, res: Response, next) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
      await setUserPlanOverride(req.params.uid, 'deny', reason || 'Admin block');
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/subscription/unblock', async (req: Request, res: Response, next) => {
    try {
      await clearUserPlanOverride(req.params.uid);
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/subscription/reset', async (req: Request, res: Response, next) => {
    try {
      await clearUserPlanOverride(req.params.uid);
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscriptions', async (_req: Request, res: Response, next) => {
    try {
      res.json({ subscriptions: await listAllSubscriptions() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/subscription/grant', async (req: Request, res: Response, next) => {
    try {
      const planCode = typeof req.body?.planCode === 'string' ? req.body.planCode.trim() : '';
      await adminGrantSubscription(req.params.uid, planCode);
      res.json({ user: await loadSingleAdminUser(req.params.uid) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/message', async (req: Request, res: Response, next) => {
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
    } catch (error) {
      next(error);
    }
  });

  router.get('/db-cleanup/insights', async (req: Request, res: Response, next) => {
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
    } catch (error) {
      next(error);
    }
  });

  router.post('/db-cleanup/preview', async (req: Request, res: Response, next) => {
    try {
      const cutoffDate = toIsoString(req.body?.cutoffDate);
      if (!cutoffDate) {
        res.status(400).json({ error: 'Data de corte invalida.' });
        return;
      }

      const categories: CleanupCategory[] = Array.isArray(req.body?.categories)
        ? (req.body.categories.filter((item: unknown): item is CleanupCategory => CLEANUP_ORDER.includes(item as CleanupCategory)))
        : CLEANUP_ORDER;

      const counts = Object.fromEntries(
        categories.map((category: CleanupCategory) => [category, buildCleanupInsight(category, cutoffDate).eligibleCount] as const)
      ) as Record<string, number>;
      res.json({
        counts,
        total: Object.values(counts).reduce((sum, value) => sum + value, 0)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/db-cleanup/execute', async (req: Request, res: Response, next) => {
    try {
      const cutoffDate = toIsoString(req.body?.cutoffDate);
      if (!cutoffDate) {
        res.status(400).json({ error: 'Data de corte invalida.' });
        return;
      }

      const categories: CleanupCategory[] = Array.isArray(req.body?.categories)
        ? (req.body.categories.filter((item: unknown): item is CleanupCategory => CLEANUP_ORDER.includes(item as CleanupCategory)))
        : CLEANUP_ORDER;

      const counts = {} as Record<CleanupCategory, number>;
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
    } catch (error) {
      next(error);
    }
  });

  router.get('/db-cleanup/history', (_req: Request, res: Response) => {
    res.json({ history: cleanupHistory });
  });

  router.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    logger.error('Admin route error', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' });
  });

  return router;
}
