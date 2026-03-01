"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDataRouter = createDataRouter;
const express_1 = require("express");
const firebase_auth_1 = require("../middleware/firebase-auth");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
function getUid(req) {
    return req.uid;
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function createDataRouter(signupWelcomeDispatcher) {
    const router = (0, express_1.Router)();
    router.use(firebase_auth_1.requireFirebaseAuth);
    router.post('/bootstrap', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const email = asString(body.email);
        const displayName = asString(body.displayName);
        const phone = asString(body.phone);
        if (!email || !displayName) {
            res.status(400).json({ error: '`email` e `displayName` sao obrigatorios.' });
            return;
        }
        const bootstrapResult = await (0, firestore_1.bootstrapUserData)(uid, {
            email,
            displayName,
            ...(phone ? { phone } : {})
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
    router.get('/settings', async (req, res) => {
        const uid = getUid(req);
        const settings = await (0, firestore_1.getUserSettings)(uid);
        res.json(settings);
    });
    router.patch('/settings', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        await (0, firestore_1.updateUserSettings)(uid, {
            ...(typeof body.budget === 'number' ? { budget: body.budget } : {}),
            ...(typeof body.startDay === 'number' ? { startDay: body.startDay } : {}),
            ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
            ...(Array.isArray(body.whatsappAllowedNumbers)
                ? {
                    whatsappAllowedNumbers: body.whatsappAllowedNumbers.filter((value) => typeof value === 'string')
                }
                : {})
        });
        const settings = await (0, firestore_1.getUserSettings)(uid);
        res.json(settings);
    });
    router.get('/categories', async (req, res) => {
        const uid = getUid(req);
        const categories = await (0, firestore_1.getUserCategories)(uid);
        res.json(categories);
    });
    router.post('/categories', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const name = asString(body.name);
        const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
        const color = asString(body.color);
        const icon = asString(body.icon);
        if (!name || !type || !color || !icon) {
            res.status(400).json({ error: 'Campos invalidos para categoria.' });
            return;
        }
        const id = await (0, firestore_1.addUserCategory)(uid, { name, type, color, icon });
        res.json({ id });
    });
    router.patch('/categories/:id', async (req, res) => {
        const uid = getUid(req);
        const categoryId = req.params.id;
        const body = (req.body ?? {});
        await (0, firestore_1.updateUserCategory)(uid, categoryId, {
            ...(typeof body.name === 'string' ? { name: body.name } : {}),
            ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
            ...(typeof body.color === 'string' ? { color: body.color } : {}),
            ...(typeof body.icon === 'string' ? { icon: body.icon } : {})
        });
        res.json({ ok: true });
    });
    router.delete('/categories/:id', async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteUserCategory)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.get('/transactions', async (req, res) => {
        const uid = getUid(req);
        const monthKey = asString(req.query.monthKey);
        if (!monthKey) {
            res.status(400).json({ error: '`monthKey` e obrigatorio.' });
            return;
        }
        const transactions = await (0, firestore_1.getTransactionsByMonth)(uid, monthKey);
        res.json(transactions);
    });
    router.post('/transactions', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
        const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
        const date = asString(body.date);
        const category = asString(body.category);
        const description = asString(body.description);
        const paymentMethod = asString(body.paymentMethod);
        if (!type || !Number.isFinite(amount) || amount <= 0 || !date || !category || !description || !paymentMethod) {
            res.status(400).json({ error: 'Campos invalidos para transacao.' });
            return;
        }
        const id = await (0, firestore_1.addUserTransaction)(uid, {
            type,
            amount,
            date,
            category,
            description,
            paymentMethod
        });
        res.json({ id });
    });
    router.patch('/transactions/:id', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        await (0, firestore_1.updateUserTransaction)(uid, req.params.id, {
            ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
            ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
            ...(typeof body.date === 'string' ? { date: body.date } : {}),
            ...(typeof body.category === 'string' ? { category: body.category } : {}),
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
            ...(typeof body.paymentMethod === 'string'
                ? {
                    paymentMethod: body.paymentMethod
                }
                : {})
        });
        res.json({ ok: true });
    });
    router.delete('/transactions/:id', async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteUserTransaction)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.get('/chat-sessions', async (req, res) => {
        const uid = getUid(req);
        const sessions = await (0, firestore_1.getUserChatSessions)(uid);
        res.json(sessions);
    });
    router.post('/chat-sessions', async (req, res) => {
        const uid = getUid(req);
        const title = asString((req.body ?? {})['title']);
        if (!title) {
            res.status(400).json({ error: '`title` e obrigatorio.' });
            return;
        }
        const id = await (0, firestore_1.createUserChatSession)(uid, title);
        res.json({ id });
    });
    router.patch('/chat-sessions/:id', async (req, res) => {
        const uid = getUid(req);
        const title = asString((req.body ?? {})['title']);
        if (!title) {
            res.status(400).json({ error: '`title` e obrigatorio.' });
            return;
        }
        await (0, firestore_1.updateUserChatSessionTitle)(uid, req.params.id, title);
        res.json({ ok: true });
    });
    router.delete('/chat-sessions/:id', async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteUserChatSession)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.get('/chat-sessions/:id/messages', async (req, res) => {
        const uid = getUid(req);
        const messages = await (0, firestore_1.getUserChatMessages)(uid, req.params.id);
        res.json(messages);
    });
    router.post('/chat-sessions/:id/messages', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const role = body.role === 'user' || body.role === 'assistant' || body.role === 'system' ? body.role : null;
        const content = asString(body.content);
        const imageUrl = asString(body.imageUrl);
        if (!role || !content) {
            res.status(400).json({ error: 'Campos invalidos para mensagem.' });
            return;
        }
        const id = await (0, firestore_1.addUserChatMessage)(uid, req.params.id, {
            role,
            content,
            ...(imageUrl ? { imageUrl } : {})
        });
        res.json({ id });
    });
    router.get('/reminders', async (req, res) => {
        const uid = getUid(req);
        const reminders = await (0, firestore_1.getUserReminders)(uid);
        res.json(reminders);
    });
    router.post('/reminders', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const reminderKind = body.reminderKind === 'general' || body.reminderKind === 'payable' || body.reminderKind === 'receivable'
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
        const id = await (0, firestore_1.addUserReminder)(uid, {
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
    router.patch('/reminders/:id', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const reminderKind = body.reminderKind === 'general' || body.reminderKind === 'payable' || body.reminderKind === 'receivable'
            ? body.reminderKind
            : undefined;
        await (0, firestore_1.updateUserReminder)(uid, req.params.id, {
            ...(reminderKind ? { reminderKind } : {}),
            ...(typeof body.title === 'string' ? { title: body.title } : {}),
            ...(typeof body.amount === 'number' || body.amount === null ? { amount: body.amount } : {}),
            ...(typeof body.dueDate === 'string' ? { dueDate: body.dueDate } : {}),
            ...('dueTime' in body && (typeof body.dueTime === 'string' || body.dueTime === null)
                ? { dueTime: body.dueTime }
                : {}),
            ...(body.type === 'payable' || body.type === 'receivable' || body.type === null
                ? { type: body.type }
                : {}),
            ...(body.status === 'pending' || body.status === 'paid' ? { status: body.status } : {})
        });
        res.json({ ok: true });
    });
    router.delete('/reminders/:id', async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteUserReminder)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.get('/recurring-transactions', async (req, res) => {
        const uid = getUid(req);
        const items = await (0, firestore_1.getRecurringTransactions)(uid);
        res.json(items);
    });
    router.post('/recurring-transactions', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const type = body.type === 'income' || body.type === 'expense' ? body.type : null;
        const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
        const category = asString(body.category);
        const description = asString(body.description);
        const paymentMethod = asString(body.paymentMethod);
        const frequency = body.frequency === 'weekly' || body.frequency === 'monthly' || body.frequency === 'yearly'
            ? body.frequency
            : null;
        const startDate = asString(body.startDate);
        const endDate = body.endDate === null ? null : asString(body.endDate);
        if (!type ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !category ||
            !description ||
            !paymentMethod ||
            !frequency ||
            !startDate) {
            res.status(400).json({ error: 'Campos invalidos para recorrente.' });
            return;
        }
        const id = await (0, firestore_1.addRecurringTransaction)(uid, {
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
    router.patch('/recurring-transactions/:id', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        await (0, firestore_1.updateRecurringTransactionBackend)(uid, req.params.id, {
            ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
            ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
            ...(typeof body.category === 'string' ? { category: body.category } : {}),
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
            ...(typeof body.paymentMethod === 'string'
                ? {
                    paymentMethod: body.paymentMethod
                }
                : {}),
            ...(body.frequency === 'weekly' || body.frequency === 'monthly' || body.frequency === 'yearly'
                ? { frequency: body.frequency }
                : {}),
            ...(typeof body.startDate === 'string' ? { startDate: body.startDate } : {}),
            ...(typeof body.endDate === 'string' || body.endDate === null ? { endDate: body.endDate } : {}),
            ...(typeof body.nextDueDate === 'string' ? { nextDueDate: body.nextDueDate } : {}),
            ...(typeof body.active === 'boolean' ? { active: body.active } : {})
        });
        res.json({ ok: true });
    });
    router.delete('/recurring-transactions/:id', async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteRecurringTransaction)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Data router error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
