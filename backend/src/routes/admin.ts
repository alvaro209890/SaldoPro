import { Router, type Request, type Response } from 'express';
import {
  createAdminSessionToken,
  isValidAdminPassword
} from '../lib/admin-session';
import {
  listAllFirebaseUserAccessStates,
  getFirebaseUserAccessState,
  setFirebaseUserDisabled
} from '../lib/firebase-user-access';
import {
  getAdminUserSnapshot,
  getRecentTransactions,
  listAdminUserSnapshots,
  getUserReminders,
  type AdminUserSnapshot
} from '../lib/firestore';
import { getRecentOperationalLogs, logger, type OperationalLogEntry } from '../lib/logger';
import { requireAdminAuth } from '../middleware/admin-auth';
import type { WhatsAppClientsManager } from '../whatsapp/manager';

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
}

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
  firebaseStates: Map<string, Awaited<ReturnType<typeof getFirebaseUserAccessState>>>
): AdminApiUser[] {
  const snapshotByUid = new Map(snapshots.map((item) => [item.uid, item] as const));
  const allUids = new Set<string>([
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
      const [snapshots, firebaseStates, qrSlots] = await Promise.all([
        listAdminUserSnapshots(),
        listAllFirebaseUserAccessStates(),
        manager.getQrPayloads()
      ]);
      const users = mergeAdminUsers(snapshots, firebaseStates);
      const logs = getRecentOperationalLogs(80);
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
            warnings15m: recentAlerts.filter(
              (entry) => entry.level === 'warn' && Date.parse(entry.timestamp) >= fifteenMinutesAgo
            ).length,
            errors15m: recentAlerts.filter(
              (entry) => entry.level === 'error' && Date.parse(entry.timestamp) >= fifteenMinutesAgo
            ).length,
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
      const [snapshots, firebaseStates] = await Promise.all([
        listAdminUserSnapshots(),
        listAllFirebaseUserAccessStates()
      ]);
      res.json({ users: mergeAdminUsers(snapshots, firebaseStates) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:uid', async (req: Request, res: Response, next) => {
    try {
      const uid = req.params.uid;
      const [snapshot, firebase, recentTransactions, reminders] = await Promise.all([
        getAdminUserSnapshot(uid),
        getFirebaseUserAccessState(uid),
        getRecentTransactions(uid, 5),
        getUserReminders(uid)
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
    } catch (error) {
      next(error);
    }
  });

  router.post('/whatsapp/reset-session', async (_req: Request, res: Response, next) => {
    try {
      await manager.resetSession('wa1');
      logger.warn('Admin triggered WhatsApp session reset', { slotId: 'wa1' });
      res.json({
        ok: true,
        slots: manager.getStatuses(),
        qr: await manager.getQrPayloads()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/whatsapp/refresh-qr', async (_req: Request, res: Response, next) => {
    try {
      await manager.resetSession('wa1');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      logger.warn('Admin forced WhatsApp QR refresh', { slotId: 'wa1' });
      res.json({
        ok: true,
        slots: manager.getStatuses(),
        qr: await manager.getQrPayloads()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/block', async (req: Request, res: Response, next) => {
    try {
      const uid = req.params.uid;
      const state = await getFirebaseUserAccessState(uid, true);
      if (!state.exists) {
        res.status(404).json({ error: 'Firebase user not found.' });
        return;
      }

      await setFirebaseUserDisabled(uid, true);
      const [snapshot, refreshed] = await Promise.all([
        getAdminUserSnapshot(uid),
        getFirebaseUserAccessState(uid, true)
      ]);

      logger.warn('Admin blocked user', {
        uid,
        reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null
      });

      res.json({
        ok: true,
        user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]))[0]
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:uid/unblock', async (req: Request, res: Response, next) => {
    try {
      const uid = req.params.uid;
      const state = await getFirebaseUserAccessState(uid, true);
      if (!state.exists) {
        res.status(404).json({ error: 'Firebase user not found.' });
        return;
      }

      await setFirebaseUserDisabled(uid, false);
      const [snapshot, refreshed] = await Promise.all([
        getAdminUserSnapshot(uid),
        getFirebaseUserAccessState(uid, true)
      ]);

      logger.warn('Admin unblocked user', { uid });

      res.json({
        ok: true,
        user: mergeAdminUsers(snapshot ? [snapshot] : [], new Map([[uid, refreshed]]))[0]
      });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    logger.error('Admin route error', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return router;
}
