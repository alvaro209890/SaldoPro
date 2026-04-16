"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDataRouter = createDataRouter;
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const auth_1 = require("firebase-admin/auth");
const supabase_auth_1 = require("../middleware/supabase-auth");
const plan_access_1 = require("../middleware/plan-access");
const firestore_1 = require("../lib/firestore");
const groq_1 = require("../ai/groq");
const document_storage_1 = require("../lib/document-storage");
const firebase_admin_1 = require("../lib/firebase-admin");
const logger_1 = require("../lib/logger");
const realtime_1 = require("../lib/realtime");
const document_intents_1 = require("../whatsapp/document-intents");
const events_1 = require("../whatsapp/events");
const USER_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const USER_DOCUMENT_DOWNLOAD_TTL_SECONDS = 10 * 60;
const MAX_DOCUMENT_TITLE_LENGTH = 80;
const MAX_DOCUMENT_DESCRIPTION_LENGTH = 300;
const MAX_DOCUMENT_TAGS = 12;
function writeSseEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function getUid(req) {
    return req.uid;
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeUtf8Text(value) {
    return value.normalize('NFC');
}
function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function parseDocumentTags(value) {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const unique = new Set();
    for (const item of source) {
        if (typeof item !== 'string')
            continue;
        const normalized = (0, document_intents_1.normalizeDocumentText)(item);
        if (!normalized)
            continue;
        for (const token of normalized.split(' ')) {
            if (!token)
                continue;
            unique.add(token);
            if (unique.size >= MAX_DOCUMENT_TAGS) {
                return [...unique];
            }
        }
    }
    return [...unique];
}
function buildDocumentSearchTokens(title, description, tags) {
    return [...new Set([
            ...(0, document_intents_1.tokenizeDocumentSearch)(title),
            ...(0, document_intents_1.tokenizeDocumentSearch)(description ?? ''),
            ...tags
        ])];
}
function getManualDocumentTags(document) {
    const automaticTokens = new Set([
        ...(0, document_intents_1.tokenizeDocumentSearch)(document.title),
        ...(0, document_intents_1.tokenizeDocumentSearch)(document.description ?? '')
    ]);
    return document.searchTokens.filter((token) => !automaticTokens.has(token));
}
function getDocumentExtension(mimeType) {
    const normalized = mimeType.toLowerCase();
    if (normalized === 'application/pdf')
        return 'pdf';
    if (normalized === 'application/zip' ||
        normalized === 'application/x-zip-compressed' ||
        normalized === 'multipart/x-zip') {
        return 'zip';
    }
    if (normalized.includes('png'))
        return 'png';
    if (normalized.includes('webp'))
        return 'webp';
    if (normalized.includes('gif'))
        return 'gif';
    if (normalized.includes('bmp'))
        return 'bmp';
    if (normalized.includes('heic'))
        return 'heic';
    if (normalized.includes('heif'))
        return 'heif';
    return 'jpg';
}
function buildDocumentDownloadName(document) {
    const baseName = document.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .toLowerCase();
    return `${baseName || `arquivo-${document.id.slice(0, 8)}`}.${getDocumentExtension(document.mimeType)}`;
}
function buildDocumentPayload(document, previewUrl) {
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
function getDocumentMetadata(body) {
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
        normalizedTitle: (0, document_intents_1.normalizeDocumentText)(title),
        normalizedDescription: description ? (0, document_intents_1.normalizeDocumentText)(description) : null,
        searchTokens: buildDocumentSearchTokens(title, description, tags)
    };
}
function createDataRouter(signupWelcomeDispatcher) {
    const router = (0, express_1.Router)();
    router.use(supabase_auth_1.requireSupabaseAuth);
    router.get('/events', (req, res) => {
        const uid = getUid(req);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        req.socket.setKeepAlive(true);
        writeSseEvent(res, 'ready', {
            uid,
            at: new Date().toISOString()
        });
        const unsubscribe = (0, realtime_1.subscribeToUserDataChanges)(uid, (event) => {
            writeSseEvent(res, 'data-changed', event);
        });
        const heartbeat = setInterval(() => {
            writeSseEvent(res, 'ping', {
                uid,
                at: new Date().toISOString()
            });
        }, 25000);
        req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            res.end();
        });
    });
    router.post('/bootstrap', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const email = asString(body.email);
        const displayName = asString(body.displayName);
        const phone = asString(body.phone);
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(phone);
        if (!email || !displayName || normalizedPhone.length < 10) {
            res.status(400).json({ error: '`email`, `displayName` e `phone` sao obrigatorios.' });
            return;
        }
        let bootstrapResult;
        try {
            bootstrapResult = await (0, firestore_1.bootstrapUserData)(uid, {
                email,
                displayName,
                phone: normalizedPhone
            });
        }
        catch (error) {
            if (error instanceof firestore_1.DuplicateUserEmailError) {
                res.status(409).json({ error: 'Este email ja esta cadastrado em outra conta.' });
                return;
            }
            throw error;
        }
        res.json({ ok: true });
        if (bootstrapResult.isNewUser && bootstrapResult.normalizedPhone) {
            signupWelcomeDispatcher.enqueue({
                uid,
                phone: bootstrapResult.normalizedPhone,
                displayName
            });
        }
    });
    router.patch('/profile', async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const displayName = asString(body.displayName);
        if (!displayName) {
            res.status(400).json({ error: '`displayName` e obrigatorio.' });
            return;
        }
        await (0, firestore_1.updateUserDisplayName)(uid, displayName);
        if ((0, firebase_admin_1.ensureFirebaseAdmin)()) {
            try {
                await (0, auth_1.getAuth)().updateUser(uid, { displayName: displayName.trim() });
            }
            catch (error) {
                logger_1.logger.warn('Failed to sync Firebase display name from local profile update', {
                    uid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }
        res.json({ ok: true, displayName: displayName.trim() });
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
    router.post('/categories', async (req, res, next) => {
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
        try {
            const id = await (0, firestore_1.addUserCategory)(uid, { name, type, color, icon });
            res.json({ id });
        }
        catch (error) {
            if (error instanceof firestore_1.DuplicateCategoryError) {
                res.status(409).json({ error: error.message });
                return;
            }
            next(error);
        }
    });
    router.patch('/categories/:id', async (req, res, next) => {
        const uid = getUid(req);
        const categoryId = req.params.id;
        const body = (req.body ?? {});
        try {
            await (0, firestore_1.updateUserCategory)(uid, categoryId, {
                ...(typeof body.name === 'string' ? { name: body.name } : {}),
                ...(body.type === 'income' || body.type === 'expense' ? { type: body.type } : {}),
                ...(typeof body.color === 'string' ? { color: body.color } : {}),
                ...(typeof body.icon === 'string' ? { icon: body.icon } : {})
            });
            res.json({ ok: true });
        }
        catch (error) {
            if (error instanceof firestore_1.DuplicateCategoryError) {
                res.status(409).json({ error: error.message });
                return;
            }
            next(error);
        }
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
    router.get('/chat-sessions', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        const sessions = await (0, firestore_1.getUserChatSessions)(uid);
        res.json(sessions);
    });
    router.post('/chat-sessions', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        const title = asString((req.body ?? {})['title']);
        if (!title) {
            res.status(400).json({ error: '`title` e obrigatorio.' });
            return;
        }
        const id = await (0, firestore_1.createUserChatSession)(uid, title);
        res.json({ id });
    });
    router.patch('/chat-sessions/:id', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        const title = asString((req.body ?? {})['title']);
        if (!title) {
            res.status(400).json({ error: '`title` e obrigatorio.' });
            return;
        }
        await (0, firestore_1.updateUserChatSessionTitle)(uid, req.params.id, title);
        res.json({ ok: true });
    });
    router.delete('/chat-sessions/:id', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        await (0, firestore_1.deleteUserChatSession)(uid, req.params.id);
        res.json({ ok: true });
    });
    router.get('/chat-sessions/:id/messages', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        const messages = await (0, firestore_1.getUserChatMessages)(uid, req.params.id);
        res.json(messages);
    });
    router.post('/chat-sessions/:id/messages', (0, plan_access_1.requirePlanFeature)('web_ai_chat_history'), async (req, res) => {
        const uid = getUid(req);
        const body = (req.body ?? {});
        const role = body.role === 'user' || body.role === 'assistant' || body.role === 'system' ? body.role : null;
        const content = normalizeUtf8Text(asString(body.content));
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
    router.get('/documents', (0, plan_access_1.requirePlanFeature)('document_storage'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const documents = await (0, firestore_1.listUserDocuments)(uid);
            const items = await Promise.all(documents.map(async (document) => {
                let previewUrl = null;
                try {
                    previewUrl = await (0, document_storage_1.createSignedDocumentUrl)(document.storagePath, USER_DOCUMENT_SIGNED_URL_TTL_SECONDS);
                }
                catch (err) {
                    logger_1.logger.warn('Failed to generate preview URL, returning null', {
                        uid,
                        documentId: document.id,
                        storagePath: document.storagePath,
                        error: err instanceof Error ? err.message : 'unknown'
                    });
                }
                return buildDocumentPayload(document, previewUrl);
            }));
            res.json(items);
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/documents', (0, plan_access_1.requirePlanFeature)('document_storage'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const body = (req.body ?? {});
            const fileDataUrl = asString(body.fileDataUrl) || asString(body.imageDataUrl);
            if (!fileDataUrl.startsWith('data:')) {
                res.status(400).json({ error: '`fileDataUrl` deve ser um arquivo em base64.' });
                return;
            }
            let metadata;
            try {
                metadata = getDocumentMetadata(body);
            }
            catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : 'Metadados invalidos.' });
                return;
            }
            const documentId = (0, node_crypto_1.randomUUID)();
            const upload = await (0, document_storage_1.uploadPendingDocument)(uid, fileDataUrl);
            let finalStoragePath = upload.storagePath;
            try {
                finalStoragePath = await (0, document_storage_1.finalizePendingDocumentMove)(uid, upload.storagePath, documentId, upload.mimeType);
                await (0, firestore_1.createUserDocument)(uid, {
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
            }
            catch (error) {
                try {
                    await (0, document_storage_1.deleteStoredDocument)(finalStoragePath);
                }
                catch (cleanupError) {
                    logger_1.logger.warn('Failed to cleanup uploaded document after API error', {
                        uid,
                        storagePath: finalStoragePath,
                        error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
                    });
                }
                next(error);
            }
        }
        catch (error) {
            next(error);
        }
    });
    router.patch('/documents/:id', (0, plan_access_1.requirePlanFeature)('document_storage'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const current = await (0, firestore_1.getUserDocument)(uid, req.params.id);
            if (!current) {
                res.status(404).json({ error: 'Imagem nao encontrada.' });
                return;
            }
            let metadata;
            try {
                metadata = getDocumentMetadata((req.body ?? {}));
            }
            catch (error) {
                res.status(400).json({ error: error instanceof Error ? error.message : 'Metadados invalidos.' });
                return;
            }
            await (0, firestore_1.updateUserDocument)(uid, current.id, {
                title: metadata.title,
                description: metadata.description,
                normalizedTitle: metadata.normalizedTitle,
                normalizedDescription: metadata.normalizedDescription,
                searchTokens: metadata.searchTokens
            });
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/documents/:id/download-url', (0, plan_access_1.requirePlanFeature)('document_storage'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const document = await (0, firestore_1.getUserDocument)(uid, req.params.id);
            if (!document) {
                res.status(404).json({ error: 'Imagem nao encontrada.' });
                return;
            }
            let url;
            try {
                [url] = await Promise.all([
                    (0, document_storage_1.createSignedDocumentUrl)(document.storagePath, USER_DOCUMENT_DOWNLOAD_TTL_SECONDS),
                    (0, firestore_1.touchUserDocumentAccess)(uid, document.id)
                ]);
            }
            catch (err) {
                res.status(404).json({ error: 'O arquivo fisico nao foi encontrado no armazenamento. Ele pode estar corrompido ou foi removido.' });
                return;
            }
            res.json({
                url,
                fileName: buildDocumentDownloadName(document)
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.delete('/documents/:id', (0, plan_access_1.requirePlanFeature)('document_storage'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const document = await (0, firestore_1.getUserDocument)(uid, req.params.id);
            if (!document) {
                res.status(404).json({ error: 'Imagem nao encontrada.' });
                return;
            }
            await (0, document_storage_1.deleteStoredDocument)(document.storagePath);
            await (0, firestore_1.markUserDocumentDeleted)(uid, document.id);
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
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
    // ─── Financial Profile ─────────────────────────────────────────────────
    router.get('/financial-profile', async (req, res, next) => {
        try {
            const uid = getUid(req);
            const profile = await (0, firestore_1.getUserFinancialProfile)(uid);
            res.json(profile);
        }
        catch (error) {
            next(error);
        }
    });
    router.put('/financial-profile', async (req, res, next) => {
        try {
            const uid = getUid(req);
            const body = (req.body ?? {});
            const monthlyIncome = typeof body.monthlyIncome === 'number' ? body.monthlyIncome : NaN;
            const fixedExpenses = typeof body.fixedExpenses === 'number' ? body.fixedExpenses : NaN;
            const variableExpenses = typeof body.variableExpenses === 'number' ? body.variableExpenses : NaN;
            const savingsTargetPct = typeof body.savingsTargetPct === 'number' ? body.savingsTargetPct : NaN;
            const financialGoalsText = typeof body.financialGoalsText === 'string' ? body.financialGoalsText.trim().slice(0, 500) : null;
            if (!Number.isFinite(monthlyIncome) || monthlyIncome < 0 ||
                !Number.isFinite(fixedExpenses) || fixedExpenses < 0 ||
                !Number.isFinite(variableExpenses) || variableExpenses < 0 ||
                !Number.isFinite(savingsTargetPct) || savingsTargetPct < 0 || savingsTargetPct > 100) {
                res.status(400).json({ error: 'Campos invalidos para perfil financeiro.' });
                return;
            }
            await (0, firestore_1.upsertUserFinancialProfile)(uid, {
                monthlyIncome,
                fixedExpenses,
                variableExpenses,
                savingsTargetPct,
                financialGoalsText,
            });
            const profile = await (0, firestore_1.getUserFinancialProfile)(uid);
            res.json(profile);
        }
        catch (error) {
            next(error);
        }
    });
    // ─── Goals ─────────────────────────────────────────────────────────────
    router.get('/goals', (0, plan_access_1.requirePlanFeature)('goals'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const goals = await (0, firestore_1.getUserGoals)(uid);
            res.json(goals);
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/goals', (0, plan_access_1.requirePlanFeature)('goals'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const body = (req.body ?? {});
            const title = asString(body.title);
            if (!title) {
                res.status(400).json({ error: '`title` e obrigatorio.' });
                return;
            }
            const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : null;
            const targetAmount = typeof body.targetAmount === 'number' && Number.isFinite(body.targetAmount) && body.targetAmount > 0 ? body.targetAmount : null;
            const currentAmount = typeof body.currentAmount === 'number' && Number.isFinite(body.currentAmount) ? body.currentAmount : 0;
            const deadline = typeof body.deadline === 'string' ? body.deadline.trim() : null;
            const priority = body.priority === 'low' || body.priority === 'high' ? body.priority : 'medium';
            const id = await (0, firestore_1.addUserGoal)(uid, {
                title: title.slice(0, 120),
                description,
                targetAmount,
                currentAmount,
                deadline,
                source: 'manual',
                priority,
            });
            res.json({ id });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/goals/generate', (0, plan_access_1.requirePlanFeature)('goals'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const profile = await (0, firestore_1.getUserFinancialProfile)(uid);
            if (!profile) {
                res.status(400).json({ error: 'Perfil financeiro nao encontrado. Preencha o questionario primeiro.' });
                return;
            }
            const settings = await (0, firestore_1.getUserSettings)(uid);
            const currency = settings?.currency ?? 'BRL';
            const generatedGoals = await (0, groq_1.generateFinancialGoals)(profile, currency);
            const ids = [];
            for (const goal of generatedGoals) {
                const id = await (0, firestore_1.addUserGoal)(uid, {
                    title: goal.title,
                    description: goal.description,
                    targetAmount: goal.targetAmount,
                    deadline: goal.deadline,
                    source: 'ai',
                    priority: goal.priority,
                });
                ids.push(id);
            }
            const goals = await (0, firestore_1.getUserGoals)(uid);
            res.json({ generated: ids.length, goals });
        }
        catch (error) {
            next(error);
        }
    });
    router.patch('/goals/:id', (0, plan_access_1.requirePlanFeature)('goals'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            const body = (req.body ?? {});
            await (0, firestore_1.updateUserGoal)(uid, req.params.id, {
                ...(typeof body.title === 'string' ? { title: body.title.slice(0, 120) } : {}),
                ...(typeof body.description === 'string' || body.description === null ? { description: body.description } : {}),
                ...(typeof body.targetAmount === 'number' || body.targetAmount === null ? { targetAmount: body.targetAmount } : {}),
                ...(typeof body.currentAmount === 'number' ? { currentAmount: body.currentAmount } : {}),
                ...(typeof body.deadline === 'string' || body.deadline === null ? { deadline: body.deadline } : {}),
                ...(body.status === 'active' || body.status === 'completed' || body.status === 'cancelled' ? { status: body.status } : {}),
                ...(body.priority === 'low' || body.priority === 'medium' || body.priority === 'high' ? { priority: body.priority } : {}),
            });
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    router.delete('/goals/:id', (0, plan_access_1.requirePlanFeature)('goals'), async (req, res, next) => {
        try {
            const uid = getUid(req);
            await (0, firestore_1.deleteUserGoal)(uid, req.params.id);
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('Data router error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
