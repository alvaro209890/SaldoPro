import { Router, type Request, type Response } from 'express';
import { requireFirebaseAuth } from '../middleware/firebase-auth';
import {
  addRecurringTransaction,
  addUserCategory,
  addUserChatMessage,
  addUserReminder,
  addUserTransaction,
  bootstrapUserData,
  createUserChatSession,
  deleteRecurringTransaction,
  deleteUserCategory,
  deleteUserChatSession,
  deleteUserReminder,
  deleteUserTransaction,
  getRecurringTransactions,
  getTransactionsByMonth,
  getUserCategories,
  getUserChatMessages,
  getUserChatSessions,
  getUserReminders,
  getUserSettings,
  updateRecurringTransactionBackend,
  updateUserCategory,
  updateUserChatSessionTitle,
  updateUserReminder,
  updateUserSettings,
  updateUserTransaction
} from '../lib/firestore';
import { logger } from '../lib/logger';

function getUid(req: Request): string {
  return (req as Request & { uid: string }).uid;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDataRouter(): Router {
  const router = Router();

  router.use(requireFirebaseAuth);

  router.post('/bootstrap', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as { email?: unknown; displayName?: unknown; phone?: unknown };
    const email = asString(body.email);
    const displayName = asString(body.displayName);
    const phone = asString(body.phone);

    if (!email || !displayName) {
      res.status(400).json({ error: '`email` e `displayName` sao obrigatorios.' });
      return;
    }

    await bootstrapUserData(uid, {
      email,
      displayName,
      ...(phone ? { phone } : {})
    });
    res.json({ ok: true });
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

  router.get('/reminders', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const reminders = await getUserReminders(uid);
    res.json(reminders);
  });

  router.post('/reminders', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as {
      title?: unknown;
      amount?: unknown;
      dueDate?: unknown;
      type?: unknown;
      status?: unknown;
    };
    const title = asString(body.title);
    const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
    const dueDate = asString(body.dueDate);
    const type = body.type === 'payable' || body.type === 'receivable' ? body.type : null;
    const status = body.status === 'pending' || body.status === 'paid' ? body.status : undefined;

    if (!title || !Number.isFinite(amount) || amount <= 0 || !dueDate || !type) {
      res.status(400).json({ error: 'Campos invalidos para lembrete.' });
      return;
    }

    const id = await addUserReminder(uid, { title, amount, dueDate, type, ...(status ? { status } : {}) });
    res.json({ id });
  });

  router.patch('/reminders/:id', async (req: Request, res: Response) => {
    const uid = getUid(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    await updateUserReminder(uid, req.params.id, {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
      ...(typeof body.dueDate === 'string' ? { dueDate: body.dueDate } : {}),
      ...(body.type === 'payable' || body.type === 'receivable' ? { type: body.type } : {}),
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

