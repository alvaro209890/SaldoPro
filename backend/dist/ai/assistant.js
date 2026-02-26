"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processWhatsAppAIMessage = processWhatsAppAIMessage;
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const groq_1 = require("./groq");
const VALID_PAYMENT_METHODS = [
    'pix',
    'credit',
    'debit',
    'cash',
    'transfer',
    'boleto'
];
function todayISO() {
    return new Date().toISOString().split('T')[0];
}
function normalizeDate(date) {
    if (typeof date !== 'string')
        return todayISO();
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
        return trimmed;
    return todayISO();
}
function normalizePaymentMethod(method) {
    if (typeof method === 'string' && VALID_PAYMENT_METHODS.includes(method)) {
        return method;
    }
    return 'pix';
}
async function processWhatsAppAIMessage(uid, messages, options = {}) {
    if (!uid || uid.trim().length === 0) {
        return 'Nao foi possivel identificar a conta vinculada para processar a mensagem.';
    }
    const sanitizedMessages = messages
        .slice(-env_1.env.whatsappAiHistoryLimit)
        .map((message) => ({
        role: message.role,
        content: (message.content ?? '').toString().slice(0, env_1.env.maxMessageLength),
        ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {})
    }))
        .filter((message) => message.content.trim() || message.imageDataUrl);
    if (sanitizedMessages.length === 0) {
        return 'Nao consegui interpretar a mensagem recebida.';
    }
    const [categories, recentTransactions, settings, profile] = await Promise.all([
        (0, firestore_1.getUserCategories)(uid),
        (0, firestore_1.getRecentTransactions)(uid, env_1.env.whatsappAiRecentTransactions),
        (0, firestore_1.getUserSettings)(uid),
        (0, firestore_1.getUserProfile)(uid)
    ]);
    const context = {
        profile,
        settings,
        categories,
        recentTransactions,
        isFirstMessage: Boolean(options.isFirstMessage),
        isGreeting: Boolean(options.isGreeting),
        isConversationRestart: Boolean(options.isConversationRestart),
        shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
    };
    const ai = await (0, groq_1.queryGroqAssistant)(sanitizedMessages, context);
    await executeAction(uid, ai.actionObject, categories);
    return `${ai.reply}`.slice(0, env_1.env.maxMessageLength);
}
async function executeAction(uid, action, categories) {
    try {
        if (action.action === 'none') {
            return;
        }
        if (action.action === 'add_transaction') {
            if (!Number.isFinite(action.amount) || action.amount <= 0) {
                return;
            }
            const categoryExists = categories.find((c) => c.id === action.categoryId);
            const fallbackCategory = categories.find((c) => c.type === action.type);
            const category = categoryExists?.id ?? fallbackCategory?.id;
            if (!category) {
                return;
            }
            const payload = {
                type: action.type,
                amount: Number(action.amount),
                description: (action.description || 'Lancamento via WhatsApp').toString().slice(0, 120),
                category,
                date: normalizeDate(action.date),
                paymentMethod: normalizePaymentMethod(action.paymentMethod)
            };
            await (0, firestore_1.addUserTransaction)(uid, payload);
            return;
        }
        if (action.action === 'update_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return;
            }
            const changes = { ...(action.changes ?? {}) };
            if ('categoryId' in changes && !('category' in changes)) {
                changes.category = changes.categoryId;
            }
            delete changes.categoryId;
            if ('date' in changes) {
                changes.date = normalizeDate(changes.date);
            }
            if ('paymentMethod' in changes) {
                changes.paymentMethod = normalizePaymentMethod(changes.paymentMethod);
            }
            if ('amount' in changes) {
                const amount = Number(changes.amount);
                if (!Number.isFinite(amount) || amount <= 0) {
                    return;
                }
                changes.amount = amount;
            }
            if (Object.keys(changes).length === 0) {
                return;
            }
            await (0, firestore_1.updateUserTransaction)(uid, action.id, changes);
            return;
        }
        if (action.action === 'delete_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return;
            }
            await (0, firestore_1.deleteUserTransaction)(uid, action.id);
            return;
        }
    }
    catch (error) {
        logger_1.logger.error('Failed executing AI financial action', error);
    }
}
