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
async function processWhatsAppAIMessage(uid, messages) {
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
    const categories = await (0, firestore_1.getUserCategories)(uid);
    const recentTransactions = await (0, firestore_1.getRecentTransactions)(uid, env_1.env.whatsappAiRecentTransactions);
    const ai = await (0, groq_1.queryGroqAssistant)(sanitizedMessages, categories, recentTransactions);
    const actionMessage = await executeAction(uid, ai.actionObject, categories);
    if (!actionMessage) {
        return ai.reply;
    }
    return `${ai.reply}\n\n${actionMessage}`.slice(0, env_1.env.maxMessageLength);
}
async function executeAction(uid, action, categories) {
    try {
        if (action.action === 'none') {
            return null;
        }
        if (action.action === 'add_transaction') {
            if (!Number.isFinite(action.amount) || action.amount <= 0) {
                return 'Nao executei o lancamento porque o valor esta invalido.';
            }
            const categoryExists = categories.find((c) => c.id === action.categoryId);
            const fallbackCategory = categories.find((c) => c.type === action.type);
            const category = categoryExists?.id ?? fallbackCategory?.id;
            if (!category) {
                return 'Nao executei o lancamento porque nao encontrei categoria compativel.';
            }
            const payload = {
                type: action.type,
                amount: Number(action.amount),
                description: (action.description || 'Lancamento via WhatsApp').toString().slice(0, 120),
                category,
                date: normalizeDate(action.date),
                paymentMethod: normalizePaymentMethod(action.paymentMethod)
            };
            const transactionId = await (0, firestore_1.addUserTransaction)(uid, payload);
            return `Lancamento criado com sucesso (ID: ${transactionId}).`;
        }
        if (action.action === 'update_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return 'Nao executei a edicao porque o ID da transacao nao foi informado.';
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
                    return 'Nao executei a edicao porque o novo valor esta invalido.';
                }
                changes.amount = amount;
            }
            if (Object.keys(changes).length === 0) {
                return 'Nao executei a edicao porque nao houve campos validos para atualizar.';
            }
            await (0, firestore_1.updateUserTransaction)(uid, action.id, changes);
            return `Transacao ${action.id} atualizada com sucesso.`;
        }
        if (action.action === 'delete_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return 'Nao executei a exclusao porque o ID da transacao nao foi informado.';
            }
            await (0, firestore_1.deleteUserTransaction)(uid, action.id);
            return `Transacao ${action.id} removida com sucesso.`;
        }
    }
    catch (error) {
        logger_1.logger.error('Failed executing AI financial action', error);
        return 'Entendi o pedido, mas ocorreu erro ao salvar no banco.';
    }
    return null;
}
