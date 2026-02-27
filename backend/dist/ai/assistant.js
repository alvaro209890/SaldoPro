"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.undoLastAction = undoLastAction;
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
const MAX_ACTIONS_PER_MESSAGE = 10;
// ---------------------------------------------------------------------------
// Financial context cache — avoids repeated Firestore reads for active users.
// TTL: 2 minutes. Invalidated when a transaction is added/updated/deleted.
// ---------------------------------------------------------------------------
const CONTEXT_CACHE_TTL_MS = 2 * 60 * 1000;
const financialContextCache = new Map();
function getCachedContext(uid) {
    const entry = financialContextCache.get(uid);
    if (!entry)
        return null;
    if (Date.now() - entry.cachedAt > CONTEXT_CACHE_TTL_MS) {
        financialContextCache.delete(uid);
        return null;
    }
    return entry;
}
function setCachedContext(uid, ctx) {
    financialContextCache.set(uid, { ...ctx, cachedAt: Date.now() });
}
/** Invalidate cache after a mutation so the next call gets fresh data. */
function invalidateContextCache(uid) {
    financialContextCache.delete(uid);
}
// ---------------------------------------------------------------------------
// Last-action tracking for quick undo
// ---------------------------------------------------------------------------
const UNDO_TTL_MS = 5 * 60 * 1000; // 5 minutes
const lastActionByUid = new Map();
function trackUndoableAction(uid, action) {
    lastActionByUid.set(uid, { ...action, timestamp: action.timestamp ?? Date.now() });
}
/**
 * Undo the last action for a user. Returns a human-friendly message.
 * Supports quick undo for add/add_recurring/delete.
 */
async function undoLastAction(uid) {
    const entry = lastActionByUid.get(uid);
    if (!entry) {
        return 'Nao encontrei nenhuma acao recente para desfazer.';
    }
    if (Date.now() - entry.timestamp > UNDO_TTL_MS) {
        lastActionByUid.delete(uid);
        return 'A ultima acao foi ha mais de 5 minutos e nao pode mais ser desfeita.';
    }
    try {
        if (entry.actionKind === 'added') {
            await (0, firestore_1.deleteUserTransaction)(uid, entry.resourceId);
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nA ultima transacao registrada foi excluida com sucesso.';
        }
        if (entry.actionKind === 'added_recurring') {
            await (0, firestore_1.deleteRecurringTransaction)(uid, entry.resourceId);
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nA transacao recorrente criada foi excluida com sucesso.';
        }
        if (entry.actionKind === 'deleted') {
            if (!entry.deletedTransaction) {
                lastActionByUid.delete(uid);
                return 'Nao consegui restaurar a ultima exclusao porque os dados originais nao estavam disponiveis.';
            }
            await (0, firestore_1.restoreUserTransaction)(uid, entry.resourceId, entry.deletedTransaction);
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nA transacao excluida foi restaurada com sucesso.';
        }
        lastActionByUid.delete(uid);
        return 'Desculpe, essa acao ainda nao pode ser desfeita automaticamente.';
    }
    catch (error) {
        logger_1.logger.error('Failed to undo last action', error);
        return 'Ocorreu um erro ao tentar desfazer a acao. Tente novamente.';
    }
}
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
function normalizeDueTime(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed))
        return null;
    return trimmed;
}
function formatCurrency(value, currency) {
    if (currency === 'BRL') {
        return `R$ ${value.toFixed(2).replace('.', ',')}`;
    }
    return `${currency} ${value.toFixed(2)}`;
}
function formatDateBRFromISO(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return value;
    return new Date(parsed).toLocaleDateString('pt-BR');
}
function formatDateBRFromYmd(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return value;
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}
function formatDateTimeBR(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return value;
    return new Date(parsed).toLocaleString('pt-BR', { hour12: false });
}
function paymentMethodLabel(value) {
    const labels = {
        pix: 'PIX',
        credit: 'Cartão de crédito',
        debit: 'Cartão de débito',
        cash: 'Dinheiro',
        transfer: 'Transferência',
        boleto: 'Boleto'
    };
    return labels[value] ?? value;
}
function frequencyLabel(freq) {
    const labels = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
    return labels[freq] ?? freq;
}
function reminderTypeLabel(value) {
    return value === 'payable' ? 'A pagar' : 'A receber';
}
function reminderKindLabel(value) {
    if (value === 'general')
        return 'Lembrete';
    return reminderTypeLabel(value);
}
function transactionTypeLabel(value) {
    return value === 'income' ? 'Receita' : 'Despesa';
}
function hashBase36(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase();
}
function toFriendlyTransactionCode(transactionId) {
    const normalized = transactionId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalized.length >= 6) {
        return `TX-${normalized.slice(0, 6)}`;
    }
    const hash = hashBase36(transactionId).padStart(6, '0').slice(0, 6);
    return `TX-${hash}`;
}
function buildEditDeleteHint(transactionCodes) {
    const uniqueCodes = [...new Set(transactionCodes.filter((code) => code.trim().length > 0))];
    if (uniqueCodes.length === 1) {
        const code = uniqueCodes[0];
        return `Se quiser excluir, digite "excluir ${code}". Se quiser editar, me diga o que deseja alterar na transação ${code}.`;
    }
    return 'Se quiser excluir, digite "excluir" e informe o código da transação. Se quiser editar, me diga o que deseja alterar em cada transação.';
}
function buildAddedTransactionMessage(receipt, aiReply, currency) {
    const typeEmoji = receipt.type === 'income' ? '📥' : '📤';
    const lines = [
        `${typeEmoji} *${transactionTypeLabel(receipt.type)} registrada*`,
        '',
        `*${formatCurrency(receipt.amount, currency)}* - ${receipt.description}`,
        `${receipt.categoryName} | ${paymentMethodLabel(receipt.paymentMethod)} | ${formatDateBRFromYmd(receipt.transactionDate)}`,
        `Código: ${receipt.transactionCode}`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', buildEditDeleteHint([receipt.transactionCode]));
    return lines.join('\n');
}
function fieldLabel(field) {
    const labels = {
        amount: 'Valor',
        description: 'Descrição',
        category: 'Categoria',
        date: 'Data',
        type: 'Tipo',
        paymentMethod: 'Pagamento'
    };
    return labels[field] ?? field;
}
function buildUpdatedTransactionMessage(receipt, aiReply) {
    const lines = [
        `✏️ *Transação atualizada*`,
        '',
        `Alterado: ${receipt.changedFields.map(fieldLabel).join(', ')}`,
        `Código: ${receipt.transactionCode}`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', buildEditDeleteHint([receipt.transactionCode]));
    return lines.join('\n');
}
function buildDeletedTransactionMessage(receipt, aiReply) {
    const lines = [
        `🗑️ *Transação excluída*`,
        '',
        `Código: ${receipt.transactionCode}`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', 'Se quiser registrar novamente, é só me dizer os dados da transação.');
    return lines.join('\n');
}
function buildAddedRecurringTransactionMessage(receipt, aiReply, currency) {
    const typeEmoji = receipt.type === 'income' ? '📥' : '📤';
    const lines = [
        `${typeEmoji} *${transactionTypeLabel(receipt.type)} recorrente criada*`,
        '',
        `*${formatCurrency(receipt.amount, currency)}* - ${receipt.description}`,
        `${receipt.categoryName} | ${paymentMethodLabel(receipt.paymentMethod)}`,
        `Frequência: ${frequencyLabel(receipt.frequency)} | Início: ${formatDateBRFromYmd(receipt.startDate)}`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', 'Para editar, me diga o que você quer alterar na recorrência. Para excluir, digite "excluir recorrente".');
    return lines.join('\n');
}
function buildAddedReminderMessage(receipt, aiReply, currency) {
    const dueLabel = receipt.dueTime
        ? `${formatDateBRFromYmd(receipt.dueDate)} ${receipt.dueTime}`
        : formatDateBRFromYmd(receipt.dueDate);
    const financialType = receipt.reminderKind === 'payable' ? 'payable' : 'receivable';
    const financialDetails = receipt.reminderKind === 'general'
        ? dueLabel
        : `${reminderTypeLabel(receipt.reminderType ?? financialType)} | ${formatCurrency(receipt.amount ?? 0, currency)} | ${dueLabel}`;
    const lines = [
        `⏰ *Lembrete criado*`,
        '',
        `*${receipt.title}*`,
        financialDetails
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', receipt.dueTime
        ? (receipt.reminderKind === 'general'
            ? 'Vou te lembrar no WhatsApp nesse horario. Se quiser ajustar texto, data ou horario, e so me pedir.'
            : 'Vou te lembrar no WhatsApp nesse horario. Se quiser ajustar valor, data ou horario, e so me pedir.')
        : (receipt.reminderKind === 'general'
            ? 'Se quiser ajustar texto ou data do lembrete, e so me pedir.'
            : 'Se quiser ajustar valor, data ou descricao do lembrete, e so me pedir.'));
    return lines.join('\n');
}
function buildReminderDetailLine(receipt, currency) {
    const dueLabel = receipt.dueTime
        ? `${formatDateBRFromYmd(receipt.dueDate)} ${receipt.dueTime}`
        : formatDateBRFromYmd(receipt.dueDate);
    if (receipt.reminderKind === 'general') {
        return `Vencimento: ${dueLabel}`;
    }
    return `${reminderKindLabel(receipt.reminderKind)} | ${formatCurrency(receipt.amount ?? 0, currency)} | ${dueLabel}`;
}
function buildUpdatedReminderMessage(receipt, aiReply, currency) {
    const lines = [
        '✏️ *Lembrete atualizado*',
        '',
        `*${receipt.title}*`,
        buildReminderDetailLine(receipt, currency),
        `Status: ${receipt.status === 'paid' ? 'Concluido' : 'Pendente'}`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', 'Se quiser, posso concluir, reabrir, editar ou excluir esse lembrete.');
    return lines.join('\n');
}
function buildCompletedReminderMessage(receipt, aiReply) {
    const lines = [
        '✅ *Lembrete concluido*',
        '',
        `*${receipt.title}*`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', 'Se quiser reabrir esse lembrete, e so me pedir.');
    return lines.join('\n');
}
function buildDeletedReminderMessage(receipt, aiReply) {
    const lines = [
        '🗑️ *Lembrete excluido*',
        '',
        `*${receipt.title}*`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', 'Se quiser, posso criar um novo lembrete com outras configuracoes.');
    return lines.join('\n');
}
function buildMultiActionMessage(results, aiReply, currency) {
    const lines = ['✅ *Ações processadas:*', ''];
    const transactionCodes = [];
    let hasReminderActions = false;
    for (const result of results) {
        if (result.kind === 'added') {
            transactionCodes.push(result.receipt.transactionCode);
            lines.push(`- ${transactionTypeLabel(result.receipt.type)}: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (Código: ${result.receipt.transactionCode})`);
            continue;
        }
        if (result.kind === 'added_recurring') {
            lines.push(`- ${transactionTypeLabel(result.receipt.type)} recorrente: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (${frequencyLabel(result.receipt.frequency)})`);
            continue;
        }
        if (result.kind === 'added_reminder') {
            hasReminderActions = true;
            const dueLabel = result.receipt.dueTime
                ? `${formatDateBRFromYmd(result.receipt.dueDate)} ${result.receipt.dueTime}`
                : formatDateBRFromYmd(result.receipt.dueDate);
            const reminderSummary = result.receipt.reminderKind === 'general'
                ? `${result.receipt.title} para ${dueLabel}`
                : `${result.receipt.title} - ${formatCurrency(result.receipt.amount ?? 0, currency)} (${reminderKindLabel(result.receipt.reminderKind)}) para ${dueLabel}`;
            lines.push(`- Lembrete: ${reminderSummary}`);
            continue;
        }
        if (result.kind === 'updated_reminder') {
            hasReminderActions = true;
            lines.push(`- Lembrete atualizado: ${result.receipt.title}`);
            continue;
        }
        if (result.kind === 'completed_reminder') {
            hasReminderActions = true;
            lines.push(`- Lembrete concluido: ${result.receipt.title}`);
            continue;
        }
        if (result.kind === 'deleted_reminder') {
            hasReminderActions = true;
            lines.push(`- Lembrete excluido: ${result.receipt.title}`);
            continue;
        }
        if (result.kind === 'updated') {
            transactionCodes.push(result.receipt.transactionCode);
            lines.push(`- Transação atualizada (Código: ${result.receipt.transactionCode}) - Campos: ${result.receipt.changedFields.map(fieldLabel).join(', ')}`);
            continue;
        }
        if (result.kind === 'deleted') {
            transactionCodes.push(result.receipt.transactionCode);
            lines.push(`- Transação excluída (Código: ${result.receipt.transactionCode})`);
            continue;
        }
        if (result.kind === 'error') {
            lines.push(`- Aviso: ${result.message}`);
        }
    }
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    if (transactionCodes.length > 0) {
        lines.push('', buildEditDeleteHint(transactionCodes));
    }
    else if (hasReminderActions) {
        lines.push('', 'Se quiser, posso concluir, reabrir, editar ou excluir outros lembretes.');
    }
    return lines.join('\n');
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
        ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {}),
        ...(message.audioDataUrl ? { audioDataUrl: message.audioDataUrl } : {})
    }))
        .filter((message) => message.content.trim() || message.imageDataUrl || message.audioDataUrl);
    if (sanitizedMessages.length === 0) {
        return 'Nao consegui interpretar a mensagem recebida.';
    }
    // Use cached context if available (TTL 2 min), otherwise fetch from Firestore
    const cached = getCachedContext(uid);
    let categories;
    let recentTransactions;
    let recentReminders;
    let settings;
    let profile;
    if (cached) {
        logger_1.logger.info('Using cached financial context', { uid });
        ({ categories, recentTransactions, recentReminders, settings, profile } = cached);
    }
    else {
        [categories, recentTransactions, recentReminders, settings, profile] = await Promise.all([
            (0, firestore_1.getUserCategories)(uid),
            (0, firestore_1.getRecentTransactions)(uid, env_1.env.whatsappAiRecentTransactions),
            (0, firestore_1.getUserReminders)(uid),
            (0, firestore_1.getUserSettings)(uid),
            (0, firestore_1.getUserProfile)(uid)
        ]);
        setCachedContext(uid, { categories, recentTransactions, recentReminders, settings, profile });
        // Generate overdue recurring transactions when context is freshly loaded
        try {
            const generatedCount = await (0, firestore_1.generateOverdueRecurringTransactions)(uid);
            if (generatedCount > 0) {
                logger_1.logger.info('Generated overdue recurring transactions', { uid, count: generatedCount });
                recentTransactions = await (0, firestore_1.getRecentTransactions)(uid, env_1.env.whatsappAiRecentTransactions);
                setCachedContext(uid, { categories, recentTransactions, recentReminders, settings, profile });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to generate overdue recurring transactions', error);
        }
    }
    const context = {
        profile,
        settings,
        categories,
        recentTransactions,
        recentReminders,
        isFirstMessage: Boolean(options.isFirstMessage),
        isGreeting: Boolean(options.isGreeting),
        isCapabilitiesQuestion: Boolean(options.isCapabilitiesQuestion),
        isConversationRestart: Boolean(options.isConversationRestart),
        shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
    };
    const ai = await (0, groq_1.queryGroqAssistant)(sanitizedMessages, context);
    const actionResults = await executeActions(uid, ai.actionObjects, categories, options);
    const actionableResults = actionResults.filter((result) => result.kind !== 'none');
    if (actionableResults.length === 0) {
        return `${ai.reply}`.slice(0, env_1.env.maxMessageLength);
    }
    if (actionableResults.length === 1) {
        const [actionResult] = actionableResults;
        if (actionResult.kind === 'added') {
            return buildAddedTransactionMessage(actionResult.receipt, ai.reply, settings.currency)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'added_recurring') {
            return buildAddedRecurringTransactionMessage(actionResult.receipt, ai.reply, settings.currency)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'added_reminder') {
            return buildAddedReminderMessage(actionResult.receipt, ai.reply, settings.currency)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'updated_reminder') {
            return buildUpdatedReminderMessage(actionResult.receipt, ai.reply, settings.currency)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'completed_reminder') {
            return buildCompletedReminderMessage(actionResult.receipt, ai.reply)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'deleted_reminder') {
            return buildDeletedReminderMessage(actionResult.receipt, ai.reply)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'updated') {
            return buildUpdatedTransactionMessage(actionResult.receipt, ai.reply)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'deleted') {
            return buildDeletedTransactionMessage(actionResult.receipt, ai.reply)
                .slice(0, env_1.env.maxMessageLength);
        }
        if (actionResult.kind === 'error') {
            const baseReply = ai.reply.trim() || 'Nao consegui concluir a acao solicitada.';
            return `${baseReply}\n\nAviso: ${actionResult.message}`.slice(0, env_1.env.maxMessageLength);
        }
    }
    return buildMultiActionMessage(actionableResults, ai.reply, settings.currency)
        .slice(0, env_1.env.maxMessageLength);
}
async function executeActions(uid, actions, categories, options) {
    const safeActions = Array.isArray(actions) && actions.length > 0
        ? actions.slice(0, MAX_ACTIONS_PER_MESSAGE)
        : [{ action: 'none' }];
    const results = [];
    for (const action of safeActions) {
        const result = await executeAction(uid, action, categories, options);
        results.push(result);
    }
    return results;
}
async function executeAction(uid, action, categories, options) {
    try {
        if (action.action === 'none') {
            return { kind: 'none' };
        }
        if (action.action === 'add_transaction') {
            if (!Number.isFinite(action.amount) || action.amount <= 0) {
                return { kind: 'none' };
            }
            const categoryExists = categories.find((c) => c.id === action.categoryId);
            const fallbackCategory = categories.find((c) => c.type === action.type);
            const category = categoryExists?.id ?? fallbackCategory?.id;
            if (!category) {
                return { kind: 'none' };
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
            invalidateContextCache(uid);
            trackUndoableAction(uid, { actionKind: 'added', resourceId: transactionId });
            const categoryName = categories.find((c) => c.id === category)?.name ?? category;
            return {
                kind: 'added',
                receipt: {
                    transactionId,
                    transactionCode: toFriendlyTransactionCode(transactionId),
                    type: payload.type,
                    amount: payload.amount,
                    description: payload.description,
                    categoryName,
                    paymentMethod: payload.paymentMethod,
                    transactionDate: payload.date,
                    recordedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'update_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
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
                    return { kind: 'none' };
                }
                changes.amount = amount;
            }
            if (Object.keys(changes).length === 0) {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserTransaction)(uid, action.id, changes);
            invalidateContextCache(uid);
            trackUndoableAction(uid, { actionKind: 'updated', resourceId: action.id });
            return {
                kind: 'updated',
                receipt: {
                    transactionCode: toFriendlyTransactionCode(action.id),
                    changedFields: Object.keys(changes),
                    updatedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'delete_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const existing = await (0, firestore_1.getUserTransactionById)(uid, action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            const { id: existingId, ...deletedTransaction } = existing;
            await (0, firestore_1.deleteUserTransaction)(uid, action.id);
            invalidateContextCache(uid);
            trackUndoableAction(uid, {
                actionKind: 'deleted',
                resourceId: existingId,
                deletedTransaction
            });
            return {
                kind: 'deleted',
                receipt: {
                    transactionCode: toFriendlyTransactionCode(action.id),
                    deletedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'add_recurring_transaction') {
            if (!Number.isFinite(action.amount) || action.amount <= 0) {
                return { kind: 'none' };
            }
            const categoryExists = categories.find((c) => c.id === action.categoryId);
            const fallbackCategory = categories.find((c) => c.type === action.type);
            const category = categoryExists?.id ?? fallbackCategory?.id;
            if (!category) {
                return { kind: 'none' };
            }
            const payload = {
                type: action.type,
                amount: Number(action.amount),
                description: (action.description || 'Recorrente via WhatsApp').toString().slice(0, 120),
                category,
                paymentMethod: normalizePaymentMethod(action.paymentMethod),
                frequency: action.frequency,
                startDate: normalizeDate(action.date),
                endDate: action.endDate ?? null,
            };
            const recurringId = await (0, firestore_1.addRecurringTransaction)(uid, payload);
            invalidateContextCache(uid);
            trackUndoableAction(uid, { actionKind: 'added_recurring', resourceId: recurringId });
            const categoryName = categories.find((c) => c.id === category)?.name ?? category;
            return {
                kind: 'added_recurring',
                receipt: {
                    recurringId,
                    type: payload.type,
                    amount: payload.amount,
                    description: payload.description,
                    categoryName,
                    paymentMethod: payload.paymentMethod,
                    frequency: payload.frequency,
                    startDate: payload.startDate,
                    recordedAt: new Date().toISOString(),
                },
            };
        }
        if (action.action === 'add_reminder') {
            const reminderKind = action.reminderKind ?? action.reminderType ?? 'general';
            const isFinancial = reminderKind === 'payable' || reminderKind === 'receivable';
            const normalizedAmount = typeof action.amount === 'number' ? Number(action.amount) : Number.NaN;
            if (isFinancial && (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0)) {
                return { kind: 'none' };
            }
            const payload = {
                reminderKind,
                title: (action.title || 'Lembrete via WhatsApp').toString().slice(0, 120),
                amount: isFinancial ? normalizedAmount : null,
                dueDate: normalizeDate(action.dueDate),
                dueTime: normalizeDueTime(action.dueTime),
                type: isFinancial ? reminderKind : null,
                status: 'pending',
                notifyPhone: options.sourcePhone ?? null
            };
            const reminderId = await (0, firestore_1.addUserReminder)(uid, payload);
            invalidateContextCache(uid);
            return {
                kind: 'added_reminder',
                receipt: {
                    reminderId,
                    reminderKind,
                    title: payload.title,
                    amount: payload.amount ?? null,
                    dueDate: payload.dueDate,
                    dueTime: payload.dueTime ?? null,
                    reminderType: payload.type ?? null,
                    recordedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'update_reminder') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const rawChanges = action.changes ?? {};
            const updates = {};
            if (typeof rawChanges.title === 'string' && rawChanges.title.trim().length > 0) {
                updates.title = rawChanges.title.trim().slice(0, 120);
            }
            if (typeof rawChanges.dueDate === 'string') {
                updates.dueDate = normalizeDate(rawChanges.dueDate);
            }
            if ('dueTime' in rawChanges) {
                updates.dueTime = normalizeDueTime(rawChanges.dueTime) ?? null;
            }
            if (rawChanges.reminderKind === 'general' || rawChanges.reminderKind === 'payable' || rawChanges.reminderKind === 'receivable') {
                updates.reminderKind = rawChanges.reminderKind;
                updates.type = rawChanges.reminderKind === 'general' ? null : rawChanges.reminderKind;
            }
            else if (rawChanges.reminderType === 'payable' || rawChanges.reminderType === 'receivable') {
                updates.reminderKind = rawChanges.reminderType;
                updates.type = rawChanges.reminderType;
            }
            else if (rawChanges.reminderType === null) {
                updates.type = null;
            }
            if ('amount' in rawChanges) {
                if (rawChanges.amount == null) {
                    updates.amount = null;
                }
                else {
                    const parsedAmount = Number(rawChanges.amount);
                    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
                        updates.amount = parsedAmount;
                    }
                }
            }
            if (rawChanges.status === 'pending' || rawChanges.status === 'paid') {
                updates.status = rawChanges.status;
            }
            if (Object.keys(updates).length === 0) {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserReminder)(uid, action.id, updates);
            invalidateContextCache(uid);
            const updated = await (0, firestore_1.getUserReminderById)(uid, action.id);
            if (!updated) {
                return { kind: 'none' };
            }
            return {
                kind: 'updated_reminder',
                receipt: {
                    reminderId: updated.id,
                    reminderKind: updated.reminderKind,
                    title: updated.title,
                    amount: updated.amount,
                    dueDate: updated.dueDate,
                    dueTime: updated.dueTime ?? null,
                    status: updated.status,
                    updatedAt: updated.updatedAt
                }
            };
        }
        if (action.action === 'complete_reminder') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserReminder)(uid, action.id, { status: 'paid' });
            invalidateContextCache(uid);
            const updated = await (0, firestore_1.getUserReminderById)(uid, action.id);
            if (!updated) {
                return { kind: 'none' };
            }
            return {
                kind: 'completed_reminder',
                receipt: {
                    reminderId: updated.id,
                    reminderKind: updated.reminderKind,
                    title: updated.title,
                    amount: updated.amount,
                    dueDate: updated.dueDate,
                    dueTime: updated.dueTime ?? null,
                    status: updated.status,
                    updatedAt: updated.updatedAt
                }
            };
        }
        if (action.action === 'delete_reminder') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const existing = await (0, firestore_1.getUserReminderById)(uid, action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            await (0, firestore_1.deleteUserReminder)(uid, action.id);
            invalidateContextCache(uid);
            return {
                kind: 'deleted_reminder',
                receipt: {
                    reminderId: existing.id,
                    title: existing.title,
                    deletedAt: new Date().toISOString()
                }
            };
        }
    }
    catch (error) {
        logger_1.logger.error('Failed executing AI financial action', error);
        return { kind: 'error', message: 'Ocorreu um erro ao salvar a acao solicitada.' };
    }
    return { kind: 'none' };
}
