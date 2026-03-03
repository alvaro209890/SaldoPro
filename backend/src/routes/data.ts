import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireFirebaseAuth } from '../middleware/firebase-auth';
import {
  addRecurringTransaction,
  addUserCategory,
  addUserChatMessage,
  addUserReminder,
  addUserTransaction,
  bootstrapUserData,
  createUserDocument,
  createUserChatSession,
  deleteRecurringTransaction,
  deleteUserCategory,
  deleteUserChatSession,
  deleteUserReminder,
  deleteUserTransaction,
  getUserDocument,
  getRecurringTransactions,
  getTransactionsByMonth,
  getUserCategories,
  getUserChatMessages,
  getUserChatSessions,
  listUserDocuments,
  markUserDocumentDeleted,
  touchUserDocumentAccess,
  type UserDocument,
  getUserReminders,
  getUserSettings,
  updateRecurringTransactionBackend,
  updateUserCategory,
  updateUserChatSessionTitle,
  updateUserDocument,
  updateUserReminder,
  updateUserSettings,
  updateUserTransaction
} from '../lib/firestore';
import {
  createSignedDocumentUrl,
  deleteStoredDocument,
  finalizePendingDocumentMove,
  uploadPendingDocument
} from '../lib/document-storage';
import { logger } from '../lib/logger';
import {
  normalizeDocumentText,
  tokenizeDocumentSearch
} from '../whatsapp/document-intents';
import { normalizePhoneNumber } from '../whatsapp/events';
import type { SignupWelcomeDispatcher } from '../whatsapp/signup-welcome-dispatcher';

const USER_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const USER_DOCUMENT_DOWNLOAD_TTL_SECONDS = 10 * 60;
const MAX_DOCUMENT_TITLE_LENGTH = 80;
const MAX_DOCUMENT_DESCRIPTION_LENGTH = 300;
const MAX_DOCUMENT_TAGS = 12;

interface ApiUserDocument {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  previewUrl: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
}

function getUid(req: Request): string {
  return (req as Request & { uid: string }).uid;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseDocumentTags(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const unique = new Set<string>();
  for (const item of source) {
    if (typeof item !== 'string') continue;

    const normalized = normalizeDocumentText(item);
    if (!normalized) continue;

    for (const token of normalized.split(' ')) {
      if (!token) continue;
      unique.add(token);
      if (unique.size >= MAX_DOCUMENT_TAGS) {
        return [...unique];
      }
    }
  }

  return [...unique];
}

function buildDocumentSearchTokens(title: string, description: string | null, tags: string[]): string[] {
  return [...new Set([
    ...tokenizeDocumentSearch(title),
    ...tokenizeDocumentSearch(description ?? ''),
    ...tags
  ])];
}

function getManualDocumentTags(document: UserDocument): string[] {
  const automaticTokens = new Set<string>([
    ...tokenizeDocumentSearch(document.title),
    ...tokenizeDocumentSearch(document.description ?? '')
  ]);

  return document.searchTokens.filter((token) => !automaticTokens.has(token));
}

function getDocumentExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized === 'multipart/x-zip'
  ) {
    return 'zip';
  }
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  return 'jpg';
}

function buildDocumentDownloadName(document: UserDocument): string {
  const baseName = document.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return `${baseName || `arquivo-${document.id.slice(0, 8)}`}.${getDocumentExtension(document.mimeType)}`;
}

function buildDocumentPayload(document: UserDocument, previewUrl: string): ApiUserDocument {
  return {
    id: document.id,
    title: document.title,
    description: document.description ?? null,
    tags: getManualDocumentTags(document),
    previewUrl,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    source: document.source,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastAccessedAt: document.lastAccessedAt ?? null
  };
}

function getDocumentMetadata(body: Record<string, unknown>): {
  title: string;
  description: string | null;
  tags: string[];
  normalizedTitle: string;
  normalizedDescription: string | null;
  searchTokens: string[];
} {
  const title = collapseWhitespace(asString(body.title)).slice(0, MAX_DOCUMENT_TITLE_LENGTH);
  const rawDescription = collapseWhitespace(asString(body.description)).slice(0, MAX_DOCUMENT_DESCRIPTION_LENGTH);
  const description = rawDescription || null;
  const tags = parseDocumentTags(body.tags);

  if (!title) {
    throw new Error('`title` e obrigatorio.');
  }

  return {
    title,
    description,
    tags,
    normalizedTitle: normalizeDocumentText(title),
    normalizedDescription: description ? normalizeDocumentText(description) : null,
    searchTokens: buildDocumentSearchTokens(title, description, tags)
  };
}

export function createDataRouter(signupWelcomeDispatcher: SignupWelcomeDispatcher): Router {
  const router = Router();

  router.use(requireFirebaseAuth);

  router.post('/bootstrap', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as { email?: unknown; displayName?: unknown; phone?: unknown };
    const email = asString(body.email);
    const displayName = asString(body.displayName);
    const phone = asString(body.phone);
    const normalizedPhone = normalizePhoneNumber(phone);

    if (!email || !displayName || normalizedPhone.length < 10) {
      res.status(400).json({ error: '`email`, `displayName` e `phone` sao obrigatorios.' });
      return;
    }

    const bootstrapResult = await bootstrapUserData(uid, {
      email,
      displayName,
      phone: normalizedPhone
    });

    res.json({ ok: true });

    if (bootstrapResult.isNewUser && bootstrapResult.normalizedPhone) {
      signupWelcomeDispatcher.enqueue({
        uid,
        phone: bootstrapResult.normalizedPhone,
        displayName
      });
    }
  });

  router.get('/settings', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const settings = await getUserSettings(uid);
    res.json(settings);
  });

  router.patch('/settings', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as {
      budget?: unknown;
      startDay?: unknown;
      currency?: unknown;
      whatsappAllowedNumbers?: unknown;
    };

    await updateUserSettings(uid, {
      ...(typeof body.budget === 'number' ? { budget: body.budget } : {}),
      ...(typeof body.startDay === 'number' ? { startDay: body.startDay } : {}),
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
      ...(Array.isArray(body.whatsappAllowedNumbers)
        ? {
            whatsappAllowedNumbers: body.whatsappAllowedNumbers.filter(
              (value): value is string => typeof value === 'string'
            )
          }
        : {})
    });

    const settings = await getUserSettings(uid);
    res.json(settings);
  });

  router.get('/categories', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const categories = await getUserCategories(uid);
    res.json(categories);
  });

  router.post('/categories', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as { name?: unknown; type?: unknown; color?: unknown; icon?: unknown };

    const name = asString(body.name);
    const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
    const color = asString(body.color);
    const icon = asString(body.icon);
    if (!name || !type || !color || !icon) {
      res.status(400).json({ error: 'Campos invalidos para categoria.' });
      return;
    }

    const id = await addUserCategory(uid, { name, type, color, icon });
    res.json({ id });
  });

  router.patch('/categories/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const categoryId = req.params.id;
    const body = (req.body ?? {}) as { name?: unknown; type?: unknown; color?: unknown; icon?: unknown };
    await updateUserCategory(uid, categoryId, {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
      ...(typeof body.color === 'string' ? { color: body.color } : {}),
      ...(typeof body.icon === 'string' ? { icon: body.icon } : {})
    });
    res.json({ ok: true });
  });

  router.delete('/categories/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    await deleteUserCategory(uid, req.params.id);
    res.json({ ok: true });
  });

  router.get('/transactions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const monthKey = asString(req.query.monthKey);
    if (!monthKey) {
      res.status(400).json({ error: '`monthKey` e obrigatorio.' });
      return;
    }
    const transactions = await getTransactionsByMonth(uid, monthKey);
    res.json(transactions);
  });

  router.post('/transactions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as {
      type?: unknown;
      amount?: unknown;
      date?: unknown;
      category?: unknown;
      description?: unknown;
      paymentMethod?: unknown;
    };

    const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
    const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
    const date = asString(body.date);
    const category = asString(body.category);
    const description = asString(body.description);
    const paymentMethod = asString(body.paymentMethod) as
      | 'pix'
      | 'credit'
      | 'debit'
      | 'cash'
      | 'transfer'
      | 'boleto';

    if (!type || !Number.isFinite(amount) || amount <= 0 || !date || !category || !description || !paymentMethod) {
      res.status(400).json({ error: 'Campos invalidos para transacao.' });
      return;
    }

    const id = await addUserTransaction(uid, {
      type,
      amount,
      date,
      category,
      description,
      paymentMethod
    });
    res.json({ id });
  });

  router.patch('/transactions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    await updateUserTransaction(uid, req.params.id, {
      ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
      ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
      ...(typeof body.date === 'string' ? { date: body.date } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.paymentMethod === 'string'
        ? {
            paymentMethod: body.paymentMethod as
              | 'pix'
              | 'credit'
              | 'debit'
              | 'cash'
              | 'transfer'
              | 'boleto'
          }
        : {})
    });
    res.json({ ok: true });
  });

  router.delete('/transactions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    await deleteUserTransaction(uid, req.params.id);
    res.json({ ok: true });
  });

  router.get('/chat-sessions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const sessions = await getUserChatSessions(uid);
    res.json(sessions);
  });

  router.post('/chat-sessions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const title = asString((req.body ?? {})['title']);
    if (!title) {
      res.status(400).json({ error: '`title` e obrigatorio.' });
      return;
    }
    const id = await createUserChatSession(uid, title);
    res.json({ id });
  });

  router.patch('/chat-sessions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const title = asString((req.body ?? {})['title']);
    if (!title) {
      res.status(400).json({ error: '`title` e obrigatorio.' });
      return;
    }
    await updateUserChatSessionTitle(uid, req.params.id, title);
    res.json({ ok: true });
  });

  router.delete('/chat-sessions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    await deleteUserChatSession(uid, req.params.id);
    res.json({ ok: true });
  });

  router.get('/chat-sessions/:id/messages', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const messages = await getUserChatMessages(uid, req.params.id);
    res.json(messages);
  });

  router.post('/chat-sessions/:id/messages', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as { role?: unknown; content?: unknown; imageUrl?: unknown };
    const role = body.role === 'user' || body.role === 'assistant' || body.role === 'system' ? body.role : null;
    const content = asString(body.content);
    const imageUrl = asString(body.imageUrl);
    if (!role || !content) {
      res.status(400).json({ error: 'Campos invalidos para mensagem.' });
      return;
    }

    const id = await addUserChatMessage(uid, req.params.id, {
      role,
      content,
      ...(imageUrl ? { imageUrl } : {})
    });
    res.json({ id });
  });

  router.get('/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = getUid(req);
      const documents = await listUserDocuments(uid);
      const items = await Promise.all(
        documents.map(async (document) => {
          const previewUrl = await createSignedDocumentUrl(document.storagePath, USER_DOCUMENT_SIGNED_URL_TTL_SECONDS);
          return buildDocumentPayload(document, previewUrl);
        })
      );

      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  router.post('/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = getUid(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const fileDataUrl = asString(body.fileDataUrl) || asString(body.imageDataUrl);

      if (!fileDataUrl.startsWith('data:')) {
        res.status(400).json({ error: '`fileDataUrl` deve ser um arquivo em base64.' });
        return;
      }

      let metadata;
      try {
        metadata = getDocumentMetadata(body);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Metadados invalidos.' });
        return;
      }

      const documentId = randomUUID();
      const upload = await uploadPendingDocument(uid, fileDataUrl);
      let finalStoragePath = upload.storagePath;

      try {
        finalStoragePath = await finalizePendingDocumentMove(uid, upload.storagePath, documentId, upload.mimeType);
        await createUserDocument(uid, {
          id: documentId,
          source: 'manual_upload',
          title: metadata.title,
          description: metadata.description,
          normalizedTitle: metadata.normalizedTitle,
          normalizedDescription: metadata.normalizedDescription,
          searchTokens: metadata.searchTokens,
          storagePath: finalStoragePath,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes
        });
        res.status(201).json({ ok: true, id: documentId });
      } catch (error) {
        try {
          await deleteStoredDocument(finalStoragePath);
        } catch (cleanupError) {
          logger.warn('Failed to cleanup uploaded document after API error', {
            uid,
            storagePath: finalStoragePath,
            error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
          });
        }

        next(error);
      }
    } catch (error) {
      next(error);
    }
  });

  router.patch('/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = getUid(req);
      const current = await getUserDocument(uid, req.params.id);

      if (!current) {
        res.status(404).json({ error: 'Imagem nao encontrada.' });
        return;
      }

      let metadata;
      try {
        metadata = getDocumentMetadata((req.body ?? {}) as Record<string, unknown>);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Metadados invalidos.' });
        return;
      }

      await updateUserDocument(uid, current.id, {
        title: metadata.title,
        description: metadata.description,
        normalizedTitle: metadata.normalizedTitle,
        normalizedDescription: metadata.normalizedDescription,
        searchTokens: metadata.searchTokens
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/documents/:id/download-url', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = getUid(req);
      const document = await getUserDocument(uid, req.params.id);

      if (!document) {
        res.status(404).json({ error: 'Imagem nao encontrada.' });
        return;
      }

      const [url] = await Promise.all([
        createSignedDocumentUrl(document.storagePath, USER_DOCUMENT_DOWNLOAD_TTL_SECONDS),
        touchUserDocumentAccess(uid, document.id)
      ]);

      res.json({
        url,
        fileName: buildDocumentDownloadName(document)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = getUid(req);
      const document = await getUserDocument(uid, req.params.id);

      if (!document) {
        res.status(404).json({ error: 'Imagem nao encontrada.' });
        return;
      }

      await deleteStoredDocument(document.storagePath);
      await markUserDocumentDeleted(uid, document.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/reminders', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const reminders = await getUserReminders(uid);
    res.json(reminders);
  });

  router.post('/reminders', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as {
      reminderKind?: unknown;
      title?: unknown;
      amount?: unknown;
      dueDate?: unknown;
      dueTime?: unknown;
      type?: unknown;
      status?: unknown;
    };
    const reminderKind =
      body.reminderKind === 'general' || body.reminderKind === 'payable' || body.reminderKind === 'receivable'
        ? body.reminderKind
        : null;
    const title = asString(body.title);
    const amount = typeof body.amount === 'number' ? body.amount : null;
    const dueDate = asString(body.dueDate);
    const dueTime = body.dueTime === null ? null : asString(body.dueTime);
    const typeFromBody = body.type === 'payable' || body.type === 'receivable' ? body.type : null;
    const status = body.status === 'pending' || body.status === 'paid' ? body.status : undefined;
    const finalKind = reminderKind ?? typeFromBody ?? 'general';
    const finalType = finalKind === 'general' ? null : finalKind;

    if (!title || !dueDate) {
      res.status(400).json({ error: 'Campos invalidos para lembrete.' });
      return;
    }

    if (finalKind !== 'general' && (!Number.isFinite(amount) || (amount ?? 0) <= 0)) {
      res.status(400).json({ error: 'Campos invalidos para lembrete.' });
      return;
    }

    const id = await addUserReminder(uid, {
      reminderKind: finalKind,
      title,
      amount: finalKind === 'general' ? null : amount,
      dueDate,
      ...(dueTime !== null ? { dueTime: dueTime || null } : { dueTime: null }),
      type: finalType,
      ...(status ? { status } : {})
    });
    res.json({ id });
  });

  router.patch('/reminders/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reminderKind = body.reminderKind === 'general' || body.reminderKind === 'payable' || body.reminderKind === 'receivable'
      ? body.reminderKind
      : undefined;
    await updateUserReminder(uid, req.params.id, {
      ...(reminderKind ? { reminderKind } : {}),
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.amount === 'number' || body.amount === null ? { amount: body.amount as number | null } : {}),
      ...(typeof body.dueDate === 'string' ? { dueDate: body.dueDate } : {}),
      ...('dueTime' in body && (typeof body.dueTime === 'string' || body.dueTime === null)
        ? { dueTime: body.dueTime }
        : {}),
      ...(body.type === 'payable' || body.type === 'receivable' || body.type === null
        ? { type: body.type as 'payable' | 'receivable' | null }
        : {}),
      ...(body.status === 'pending' || body.status === 'paid' ? { status: body.status } : {})
    });
    res.json({ ok: true });
  });

  router.delete('/reminders/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    await deleteUserReminder(uid, req.params.id);
    res.json({ ok: true });
  });

  router.get('/recurring-transactions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const items = await getRecurringTransactions(uid);
    res.json(items);
  });

  router.post('/recurring-transactions', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as {
      type?: unknown;
      amount?: unknown;
      category?: unknown;
      description?: unknown;
      paymentMethod?: unknown;
      frequency?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    };

    const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
    const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
    const category = asString(body.category);
    const description = asString(body.description);
    const paymentMethod = asString(body.paymentMethod) as
      | 'pix'
      | 'credit'
      | 'debit'
      | 'cash'
      | 'transfer'
      | 'boleto';
    const frequency = body.frequency === 'weekly' || body.frequency === 'monthly' || body.frequency === 'yearly'
      ? body.frequency
      : null;
    const startDate = asString(body.startDate);
    const endDate = body.endDate === null ? null : asString(body.endDate);

    if (
      !type ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !category ||
      !description ||
      !paymentMethod ||
      !frequency ||
      !startDate
    ) {
      res.status(400).json({ error: 'Campos invalidos para recorrente.' });
      return;
    }

    const id = await addRecurringTransaction(uid, {
      type,
      amount,
      category,
      description,
      paymentMethod,
      frequency,
      startDate,
      endDate: endDate || null
    });
    res.json({ id });
  });

  router.patch('/recurring-transactions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    await updateRecurringTransactionBackend(uid, req.params.id, {
      ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
      ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.paymentMethod === 'string'
        ? {
            paymentMethod: body.paymentMethod as
              | 'pix'
              | 'credit'
              | 'debit'
              | 'cash'
              | 'transfer'
              | 'boleto'
          }
        : {}),
      ...(body.frequency === 'weekly' || body.frequency === 'monthly' || body.frequency === 'yearly'
        ? { frequency: body.frequency }
        : {}),
      ...(typeof body.startDate === 'string' ? { startDate: body.startDate } : {}),
      ...(typeof body.endDate === 'string' || body.endDate === null ? { endDate: body.endDate as string | null } : {}),
      ...(typeof body.nextDueDate === 'string' ? { nextDueDate: body.nextDueDate } : {}),
      ...(typeof body.active === 'boolean' ? { active: body.active } : {})
    });
    res.json({ ok: true });
  });

  router.delete('/recurring-transactions/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    await deleteRecurringTransaction(uid, req.params.id);
    res.json({ ok: true });
  });

  router.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    logger.error('Data router error', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return router;
}
