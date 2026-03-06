"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.undoLastAction = undoLastAction;
exports.handleReminderShortcut = handleReminderShortcut;
exports.processWhatsAppAIMessage = processWhatsAppAIMessage;
exports.processWebAIMessage = processWebAIMessage;
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const date_utils_1 = require("../lib/date-utils");
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
const DISPLAY_TIMEZONE = 'America/Sao_Paulo';
const MAX_ACTIONS_PER_MESSAGE = 10;
const IMAGE_DOCUMENT_SAVE_FALLBACK = 'Recebi sua imagem! Nao identifiquei dados financeiros para registrar. Se quiser guardar essa imagem, me diga o titulo que deseja usar.';
const WEB_CHAT_ALLOWED_ACTIONS = [
    'none',
    'add_transaction',
    'update_transaction',
    'delete_transaction'
];
const WEB_CHAT_EXTRA_SYSTEM_PROMPT = `
Voce esta respondendo no chat web do painel do SaldoPro.
- Responda como assistente do painel. Nao diga que esta no WhatsApp e nao ofereca recursos exclusivos do WhatsApp por padrao.
- Neste chat web, voce pode executar APENAS estas acoes: "add_transaction", "update_transaction", "delete_transaction" e "none".
- Nunca use acoes de recorrencia, lembretes, metas, documentos, midia ou qualquer outra fora dessa lista.
- Se o pedido sair desse escopo, responda de forma curta que, nesta etapa, o chat do painel cuida apenas de transacoes e consultas financeiras, e use "none".
- Quando registrar, editar ou excluir uma transacao, mantenha o "reply" curto e objetivo.`;
const WEB_CHAT_UNSUPPORTED_ACTION_MESSAGE = 'No chat do painel, nesta etapa, eu cuido apenas de transacoes: registrar, editar, excluir e responder consultas financeiras.';
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
 * Supports quick undo for transactions and reminders.
 */
async function undoLastAction(uid) {
    const entry = lastActionByUid.get(uid);
    if (!entry) {
        return 'Nao encontrei nenhuma acao recente para desfazer.';
    }
    if (Date.now() - entry.timestamp > UNDO_TTL_MS) {
        lastActionByUid.delete(uid);
        return 'Consigo desfazer apenas a acao mais recente em curto prazo. Para excluir uma transacao especifica, envie "excluir TX-XXXXXX" ou "cancelar transacao TX-XXXXXX".';
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
        if (entry.actionKind === 'added_reminder') {
            await (0, firestore_1.deleteUserReminder)(uid, entry.resourceId);
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nO ultimo lembrete criado foi excluido com sucesso.';
        }
        if (entry.actionKind === 'updated_reminder' || entry.actionKind === 'completed_reminder') {
            if (!entry.previousReminder) {
                lastActionByUid.delete(uid);
                return 'Nao consegui restaurar o estado anterior do lembrete.';
            }
            await (0, firestore_1.updateUserReminder)(uid, entry.resourceId, {
                title: entry.previousReminder.title,
                reminderKind: entry.previousReminder.reminderKind,
                amount: entry.previousReminder.amount,
                dueDate: entry.previousReminder.dueDate,
                dueTime: entry.previousReminder.dueTime ?? null,
                type: entry.previousReminder.type ?? null,
                status: entry.previousReminder.status
            });
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nO ultimo lembrete voltou ao estado anterior.';
        }
        if (entry.actionKind === 'deleted_reminder') {
            if (!entry.previousReminder) {
                lastActionByUid.delete(uid);
                return 'Nao consegui restaurar o lembrete excluido porque os dados originais nao estavam disponiveis.';
            }
            await (0, firestore_1.addUserReminder)(uid, {
                reminderKind: entry.previousReminder.reminderKind,
                title: entry.previousReminder.title,
                amount: entry.previousReminder.amount,
                dueDate: entry.previousReminder.dueDate,
                dueTime: entry.previousReminder.dueTime ?? null,
                type: entry.previousReminder.type ?? null,
                status: entry.previousReminder.status,
                notifyPhone: entry.previousReminder.notifyPhone ?? null
            });
            invalidateContextCache(uid);
            lastActionByUid.delete(uid);
            return '↩️ *Acao desfeita!*\n\nO lembrete excluido foi restaurado com sucesso.';
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
    return (0, date_utils_1.getBrasiliaISOString)().split('T')[0];
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
function parseYmd(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}
function formatYmd(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatHm(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function normalizeHumanText(text) {
    return (text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}
function extractExplicitTime(normalized) {
    const match = normalized.match(/\b(?:as|a)\s+(\d{1,2})(?::(\d{2}))?\s*h?\b/) ??
        normalized.match(/\b(\d{1,2}):(\d{2})\b/) ??
        normalized.match(/\b(\d{1,2})\s*h\b/);
    if (!match)
        return null;
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function extractPeriodTime(normalized) {
    if (/\b(?:no|ao)\s+almoco\b/.test(normalized))
        return '12:00';
    if (/\bfim\s+da\s+tarde\b/.test(normalized))
        return '18:00';
    if (/\b(?:a|de)\s+manha\b/.test(normalized))
        return '09:00';
    if (/\b(?:a|de)\s+tarde\b/.test(normalized))
        return '15:00';
    if (/\b(?:a|de)\s+noite\b/.test(normalized))
        return '20:00';
    if (/\bao\s+meio\s+dia\b/.test(normalized))
        return '12:00';
    return null;
}
function buildScheduleFromDate(baseDate, dueTime) {
    return {
        dueDate: formatYmd(baseDate),
        dueTime
    };
}
function resolveNextFutureDayOfMonth(dayOfMonth, dueTime) {
    const now = (0, date_utils_1.getBrasiliaDate)();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
        const candidate = new Date(today.getFullYear(), today.getMonth() + monthOffset, dayOfMonth);
        candidate.setHours(0, 0, 0, 0);
        if (candidate.getDate() !== dayOfMonth)
            continue;
        if (candidate.getTime() < today.getTime())
            continue;
        if (candidate.getTime() === today.getTime() && dueTime) {
            const [hour, minute] = dueTime.split(':').map(Number);
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const targetMinutes = hour * 60 + minute;
            if (targetMinutes <= nowMinutes) {
                continue;
            }
        }
        return candidate;
    }
    return today;
}
function parseRelativeReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    const minuteMatch = normalized.match(/\b(?:da\s*qui(?:\s+a)?|daqui(?:\s+a)?|em)\s+(\d+)\s*(min|mins|minuto|minutos)\b/);
    if (minuteMatch) {
        const minutes = Number(minuteMatch[1]);
        if (Number.isFinite(minutes) && minutes > 0) {
            const target = new Date(Date.now() + minutes * 60 * 1000);
            return { dueDate: formatYmd(target), dueTime: formatHm(target) };
        }
    }
    const hourMatch = normalized.match(/\b(?:da\s*qui(?:\s+a)?|daqui(?:\s+a)?|em)\s+(\d+)\s*(h|hr|hrs|hora|horas)\b/);
    if (hourMatch) {
        const hours = Number(hourMatch[1]);
        if (Number.isFinite(hours) && hours > 0) {
            const target = new Date(Date.now() + hours * 60 * 60 * 1000);
            return { dueDate: formatYmd(target), dueTime: formatHm(target) };
        }
    }
    return null;
}
function parseTodayTomorrowReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    const isDayAfterTomorrow = /\bdepois\s+de\s+amanha\b/.test(normalized);
    const isTomorrow = /\bamanha\b/.test(normalized);
    const isToday = /\bhoje\b/.test(normalized);
    if (!isToday && !isTomorrow && !isDayAfterTomorrow)
        return null;
    const baseDate = (0, date_utils_1.getBrasiliaDate)();
    if (isDayAfterTomorrow) {
        baseDate.setDate(baseDate.getDate() + 2);
    }
    else if (isTomorrow) {
        baseDate.setDate(baseDate.getDate() + 1);
    }
    baseDate.setHours(0, 0, 0, 0);
    return buildScheduleFromDate(baseDate, extractExplicitTime(normalized) ?? extractPeriodTime(normalized));
}
function parseDayOfMonthReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    const match = normalized.match(/\bdia\s*(0?[1-9]|[12]\d|3[01])\b/);
    if (!match)
        return null;
    const dayOfMonth = Number(match[1]);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        return null;
    }
    const dueTime = extractExplicitTime(normalized) ?? extractPeriodTime(normalized);
    const target = resolveNextFutureDayOfMonth(dayOfMonth, dueTime);
    return buildScheduleFromDate(target, dueTime);
}
function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
function parseEndOfMonthReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    if (!/\b(?:fim|final)\s+do\s+mes\b/.test(normalized))
        return null;
    const now = (0, date_utils_1.getBrasiliaDate)();
    let target = lastDayOfMonth(now);
    const dueTime = extractExplicitTime(normalized) ?? extractPeriodTime(normalized);
    if (formatYmd(target) === formatYmd(now)) {
        if (!dueTime) {
            target = lastDayOfMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1));
        }
        else {
            const [hour, minute] = dueTime.split(':').map(Number);
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const targetMinutes = hour * 60 + minute;
            if (targetMinutes <= nowMinutes) {
                target = lastDayOfMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1));
            }
        }
    }
    target.setHours(0, 0, 0, 0);
    return buildScheduleFromDate(target, dueTime);
}
function parseDailyReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    if (!/\btodo\s+dia\b/.test(normalized))
        return null;
    const dueTime = extractExplicitTime(normalized) ?? extractPeriodTime(normalized) ?? '09:00';
    const [hour, minute] = dueTime.split(':').map(Number);
    const now = (0, date_utils_1.getBrasiliaDate)();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return buildScheduleFromDate(target, dueTime);
}
function parseWeekdayReminderSchedule(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    const weekdayPatterns = [
        { regex: /\bsegunda(?:-feira)?\b/, day: 1 },
        { regex: /\bterca(?:-feira)?\b/, day: 2 },
        { regex: /\bquarta(?:-feira)?\b/, day: 3 },
        { regex: /\bquinta(?:-feira)?\b/, day: 4 },
        { regex: /\bsexta(?:-feira)?\b/, day: 5 },
        { regex: /\bsabado\b/, day: 6 },
        { regex: /\bdomingo\b/, day: 0 }
    ];
    const match = weekdayPatterns.find((item) => item.regex.test(normalized));
    if (!match)
        return null;
    const now = (0, date_utils_1.getBrasiliaDate)();
    const dueTime = extractExplicitTime(normalized) ?? extractPeriodTime(normalized);
    const target = new Date(now);
    target.setHours(0, 0, 0, 0);
    let diff = (match.day - now.getDay() + 7) % 7;
    if (diff === 0) {
        if (dueTime) {
            const [hour, minute] = dueTime.split(':').map(Number);
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const targetMinutes = hour * 60 + minute;
            diff = targetMinutes > nowMinutes ? 0 : 7;
        }
        else {
            diff = 7;
        }
    }
    target.setDate(target.getDate() + diff);
    return buildScheduleFromDate(target, dueTime);
}
function inferReminderScheduleFromText(text) {
    return (parseRelativeReminderSchedule(text) ??
        parseTodayTomorrowReminderSchedule(text) ??
        parseDayOfMonthReminderSchedule(text) ??
        parseEndOfMonthReminderSchedule(text) ??
        parseDailyReminderSchedule(text) ??
        parseWeekdayReminderSchedule(text));
}
function extractFallbackReminderTitle(text) {
    const cleaned = text
        .replace(/\b(?:da\s*qui(?:\s+a)?|daqui(?:\s+a)?|em)\s+\d+\s*(?:min|mins|minuto|minutos|h|hr|hrs|hora|horas)\b/gi, ' ')
        .replace(/\bdepois\s+de\s+amanh[ãa]\b/gi, ' ')
        .replace(/\b(?:amanh[ãa]|hoje)\b(?:\s+(?:(?:às|as|a)\s+)?\d{1,2}(?::\d{2})?\s*h?)?(?:\s+(?:de|a)\s+(?:manh[ãa]|tarde|noite))?/gi, ' ')
        .replace(/\bdia\s*(0?[1-9]|[12]\d|3[01])\b(?:\s+(?:(?:às|as|a)\s+)?\d{1,2}(?::\d{2})?\s*h?)?(?:\s+(?:de|a)\s+(?:manh[ãa]|tarde|noite))?/gi, ' ')
        .replace(/\b(?:segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|domingo)\b(?:\s+(?:(?:às|as|a)\s+)?\d{1,2}(?::\d{2})?\s*h?)?(?:\s+(?:de|a)\s+(?:manh[ãa]|tarde|noite))?/gi, ' ')
        .replace(/\b(?:fim|final)\s+do\s+m[eê]s\b/gi, ' ')
        .replace(/\btodo\s+dia\b(?:\s+(?:(?:às|as|a)\s+)?\d{1,2}(?::\d{2})?\s*h?)?/gi, ' ')
        .replace(/\b(?:no|ao)\s+alm[oó]co\b/gi, ' ')
        .replace(/\bfim\s+da\s+tarde\b/gi, ' ')
        .replace(/\b(?:me\s+)?(?:lembra(?:r)?|lembre|lembrete)(?:\s+de)?\b/gi, ' ')
        .replace(/[.,;!?]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const title = cleaned.replace(/^(?:de|do|da|dos|das)\s+/i, '').trim();
    return title.slice(0, 120) || 'Lembrete via WhatsApp';
}
function buildFallbackScheduledReminderAction(text) {
    if (!text)
        return null;
    const normalized = normalizeHumanText(text);
    const mentionsReminderIntent = /\b(lembra|lembrar|lembrete|lembre)\b/.test(normalized);
    if (!mentionsReminderIntent)
        return null;
    const schedule = inferReminderScheduleFromText(text);
    if (!schedule)
        return null;
    return {
        action: 'add_reminder',
        title: extractFallbackReminderTitle(text),
        reminderKind: 'general',
        dueDate: schedule.dueDate,
        ...(schedule.dueTime ? { dueTime: schedule.dueTime } : {})
    };
}
function parseLooseAmount(raw) {
    const digits = raw.replace(/[^\d.,]/g, '');
    if (!digits)
        return null;
    let normalized = digits;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    if (hasComma && hasDot) {
        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
            normalized = normalized.replace(/\./g, '').replace(',', '.');
        }
        else {
            normalized = normalized.replace(/,/g, '');
        }
    }
    else if (hasComma) {
        const fractional = normalized.split(',').pop() ?? '';
        normalized = fractional.length <= 2
            ? normalized.replace(/\./g, '').replace(',', '.')
            : normalized.replace(/,/g, '');
    }
    else if (hasDot) {
        const fractional = normalized.split('.').pop() ?? '';
        normalized = fractional.length <= 2
            ? normalized
            : normalized.replace(/\./g, '');
    }
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0)
        return null;
    return amount;
}
function extractAmountFromTransactionText(text) {
    const patterns = [
        /\b(?:gastei|paguei|comprei|recebi|ganhei|vendi|lucrei|depositei|depositaram|caiu)\b(?:\s+(?:um|uma)\s+\w+)?\s+(?:r\$\s*)?([\d.,]+)/i,
        /\b(?:gasto|despesa|receita|ganho|entrada|lancamento)\b(?:\s+de)?\s+(?:r\$\s*)?([\d.,]+)/i,
        /r\$\s*([\d.,]+)/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const amount = match?.[1] ? parseLooseAmount(match[1]) : null;
        if (amount != null) {
            return amount;
        }
    }
    return null;
}
function detectFallbackTransactionType(text) {
    const normalized = normalizeHumanText(text);
    if (/\b(recebi|ganhei|vendi|lucrei|depositei|depositaram|caiu|entrada|receita|salario)\b/.test(normalized)) {
        return 'income';
    }
    return 'expense';
}
function detectFallbackTransactionPaymentMethod(text) {
    const normalized = normalizeHumanText(text);
    if (normalized.includes('boleto'))
        return 'boleto';
    if (normalized.includes('credito') || normalized.includes('cartao de credito'))
        return 'credit';
    if (normalized.includes('debito') || normalized.includes('cartao de debito'))
        return 'debit';
    if (normalized.includes('dinheiro'))
        return 'cash';
    if (normalized.includes('transferencia') || normalized.includes('ted') || normalized.includes('doc')) {
        return 'transfer';
    }
    return 'pix';
}
function parseFallbackTransactionDate(text) {
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (iso)
        return iso;
    const dmy = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
    if (dmy) {
        return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    }
    const normalized = normalizeHumanText(text);
    const baseDate = (0, date_utils_1.getBrasiliaDate)();
    baseDate.setHours(0, 0, 0, 0);
    if (/\banteontem\b/.test(normalized)) {
        baseDate.setDate(baseDate.getDate() - 2);
        return formatYmd(baseDate);
    }
    if (/\bontem\b/.test(normalized)) {
        baseDate.setDate(baseDate.getDate() - 1);
        return formatYmd(baseDate);
    }
    return formatYmd(baseDate);
}
function extractFallbackTransactionDescription(text, type) {
    const cleaned = text
        .replace(/\b(?:gastei|paguei|comprei|recebi|ganhei|vendi|lucrei|depositei|depositaram|caiu|registra(?:r)?|lanca(?:r)?|lança(?:r)?|adiciona(?:r)?|coloca(?:r)?)\b/gi, ' ')
        .replace(/\b(?:gasto|despesa|receita|ganho|entrada|lancamento)\b/gi, ' ')
        .replace(/r\$\s*[\d.,]+/gi, ' ')
        .replace(/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\b/g, ' ')
        .replace(/\b(?:pix|credito|crédito|debito|débito|dinheiro|boleto|transferencia|transferência|ted|doc)\b/gi, ' ')
        .replace(/\b(?:de|do|da|dos|das|no|na|nos|nas|em|por|pra|pro|para|com|via|um|uma)\b/gi, ' ')
        .replace(/[.,;!?]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned) {
        return cleaned.slice(0, 120);
    }
    return type === 'income' ? 'Receita via WhatsApp' : 'Despesa via WhatsApp';
}
function buildFallbackTransactionAction(text) {
    if (!text)
        return null;
    const normalized = normalizeHumanText(text);
    const hasPastTenseIntent = /\b(gastei|paguei|comprei|recebi|ganhei|vendi|lucrei|depositei|depositaram|caiu)\b/.test(normalized);
    const hasExplicitRegisterIntent = /\b(registra(?:r)?|lanca(?:r)?|adiciona(?:r)?|coloca(?:r)?)\b/.test(normalized) &&
        /\b(gasto|despesa|receita|ganho|entrada|lancamento)\b/.test(normalized);
    if (!hasPastTenseIntent && !hasExplicitRegisterIntent) {
        return null;
    }
    const amount = extractAmountFromTransactionText(text);
    if (amount == null) {
        return null;
    }
    const type = detectFallbackTransactionType(text);
    return {
        action: 'add_transaction',
        type,
        amount,
        description: extractFallbackTransactionDescription(text, type),
        categoryId: '',
        date: parseFallbackTransactionDate(text),
        paymentMethod: detectFallbackTransactionPaymentMethod(text)
    };
}
function buildFallbackActionsFromText(text) {
    if (!text)
        return null;
    const normalized = normalizeHumanText(text);
    const reminderAction = buildFallbackScheduledReminderAction(text);
    const transactionAction = buildFallbackTransactionAction(text);
    const candidates = [];
    if (reminderAction) {
        const match = normalized.match(/\b(?:me\s+)?(?:lembra(?:r)?|lembre|lembrete)\b/);
        candidates.push({
            index: match?.index ?? Number.MAX_SAFE_INTEGER,
            action: reminderAction
        });
    }
    if (transactionAction) {
        const match = normalized.match(/\b(?:gastei|paguei|comprei|recebi|ganhei|vendi|lucrei|depositei|depositaram|caiu|registra(?:r)?|lanca(?:r)?|adiciona(?:r)?|coloca(?:r)?)\b/);
        candidates.push({
            index: match?.index ?? Number.MAX_SAFE_INTEGER,
            action: transactionAction
        });
    }
    if (candidates.length === 0) {
        return null;
    }
    return candidates
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.action);
}
function inferRecurringFrequencyFromText(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    if (/\b(?:toda|todo)\s+semana\b|\bsemanal(?:mente)?\b|\bpor\s+semana\b/.test(normalized)) {
        return 'weekly';
    }
    if (/\b(?:todo)\s+ano\b|\banual(?:mente)?\b|\bpor\s+ano\b/.test(normalized)) {
        return 'yearly';
    }
    if (/\btodo\s+mes\b|\bmensal(?:mente)?\b|\bpor\s+mes\b/.test(normalized) ||
        /\btodo\s+dia\s*(0?[1-9]|[12]\d|3[01])\b/.test(normalized) ||
        /\bdia\s*(0?[1-9]|[12]\d|3[01])\s+de\s+cada\s+mes\b/.test(normalized)) {
        return 'monthly';
    }
    return null;
}
function inferRecurringDayOfMonth(text) {
    const normalized = normalizeHumanText(text);
    if (!normalized)
        return null;
    const match = normalized.match(/\btodo\s+dia\s*(0?[1-9]|[12]\d|3[01])\b/)
        ?? normalized.match(/\bdia\s*(0?[1-9]|[12]\d|3[01])\s+de\s+cada\s+mes\b/);
    if (!match)
        return null;
    const day = Number(match[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31)
        return null;
    return day;
}
function resolveNextMonthlyStartDate(dayOfMonth) {
    const today = (0, date_utils_1.getBrasiliaDate)();
    today.setHours(0, 0, 0, 0);
    for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
        const candidate = new Date(today.getFullYear(), today.getMonth() + monthOffset, dayOfMonth);
        candidate.setHours(0, 0, 0, 0);
        if (candidate.getDate() !== dayOfMonth)
            continue;
        if (candidate.getTime() < today.getTime())
            continue;
        return formatYmd(candidate);
    }
    return todayISO();
}
function normalizeRecurringStartDateFromText(text, frequency, fallbackDate) {
    if (frequency === 'monthly') {
        const dayOfMonth = inferRecurringDayOfMonth(text);
        if (dayOfMonth) {
            return resolveNextMonthlyStartDate(dayOfMonth);
        }
    }
    return normalizeDate(fallbackDate);
}
function normalizeTransactionActionsForRecurring(actions, text) {
    const inferredFrequency = inferRecurringFrequencyFromText(text);
    if (!inferredFrequency)
        return actions;
    const transactionCreationCount = actions.filter((action) => action.action === 'add_transaction' || action.action === 'add_recurring_transaction').length;
    return actions.map((action) => {
        if (action.action === 'add_recurring_transaction') {
            const normalizedDate = normalizeRecurringStartDateFromText(text, action.frequency, action.date);
            if (normalizedDate === action.date)
                return action;
            return { ...action, date: normalizedDate };
        }
        if (action.action !== 'add_transaction' || transactionCreationCount !== 1) {
            return action;
        }
        const normalizedDate = normalizeRecurringStartDateFromText(text, inferredFrequency, action.date);
        logger_1.logger.info('Promoting AI transaction to recurring transaction based on user text', {
            inferredFrequency,
            originalDate: action.date,
            normalizedDate
        });
        return {
            action: 'add_recurring_transaction',
            type: action.type,
            amount: action.amount,
            description: action.description,
            categoryId: action.categoryId,
            date: normalizedDate,
            paymentMethod: action.paymentMethod,
            frequency: inferredFrequency,
            endDate: null
        };
    });
}
function isReminderSnoozeIntent(text) {
    const normalized = normalizeHumanText(text);
    return /\b(adiar|adia|adie|soneca|snooze)\b/.test(normalized) || /\bme\s+lembra\s+disso\s+de\s+novo\b/.test(normalized);
}
function buildReminderUndoSnapshot(reminder) {
    return {
        reminderKind: reminder.reminderKind,
        title: reminder.title,
        amount: reminder.amount,
        dueDate: reminder.dueDate,
        dueTime: reminder.dueTime ?? null,
        dueAt: reminder.dueAt ?? null,
        notifiedAt: reminder.notifiedAt ?? null,
        notifyPhone: reminder.notifyPhone ?? null,
        type: reminder.type ?? null,
        status: reminder.status
    };
}
async function resolveReminderForShortcut(uid) {
    const tracked = lastActionByUid.get(uid);
    if (tracked &&
        (tracked.actionKind === 'added_reminder' ||
            tracked.actionKind === 'updated_reminder' ||
            tracked.actionKind === 'completed_reminder')) {
        const recentReminder = await (0, firestore_1.getUserReminderById)(uid, tracked.resourceId);
        if (recentReminder)
            return recentReminder;
    }
    const reminders = await (0, firestore_1.getUserReminders)(uid);
    const pending = reminders.filter((reminder) => reminder.status === 'pending');
    if (pending.length === 0)
        return null;
    pending.sort((a, b) => {
        const aTime = Date.parse(`${a.dueDate}T${a.dueTime ?? '23:59'}:00`);
        const bTime = Date.parse(`${b.dueDate}T${b.dueTime ?? '23:59'}:00`);
        return aTime - bTime;
    });
    return pending[0] ?? null;
}
async function handleReminderShortcut(uid, text) {
    if (!isReminderSnoozeIntent(text))
        return null;
    const schedule = inferReminderScheduleFromText(text);
    if (!schedule) {
        return 'Nao consegui identificar o novo horario. Tente algo como "adiar 10 min", "adiar para amanha 9h" ou "me lembra disso de novo em 1 hora".';
    }
    const reminder = await resolveReminderForShortcut(uid);
    if (!reminder) {
        return 'Nao encontrei um lembrete pendente para adiar agora.';
    }
    const previousReminder = buildReminderUndoSnapshot(reminder);
    await (0, firestore_1.updateUserReminder)(uid, reminder.id, {
        dueDate: schedule.dueDate,
        dueTime: schedule.dueTime,
        status: 'pending'
    });
    invalidateContextCache(uid);
    trackUndoableAction(uid, {
        actionKind: 'updated_reminder',
        resourceId: reminder.id,
        previousReminder
    });
    const updated = await (0, firestore_1.getUserReminderById)(uid, reminder.id);
    const current = updated ?? {
        ...reminder,
        dueDate: schedule.dueDate,
        dueTime: schedule.dueTime,
        status: 'pending'
    };
    const scheduledLabel = formatReminderScheduleLabel(current.dueDate, current.dueTime ?? null);
    const settings = await (0, firestore_1.getUserSettings)(uid);
    return [
        '⏰ *Lembrete adiado*',
        '',
        `*${current.title}*`,
        `Agendado para: ${scheduledLabel}`,
        current.reminderKind === 'general'
            ? null
            : `Valor: ${formatCurrency(current.amount ?? 0, settings.currency)}`,
        '',
        'Se quiser desfazer esse adiamento, e so escrever "desfazer".'
    ].filter((line) => Boolean(line)).join('\n');
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
    return new Date(parsed).toLocaleDateString('pt-BR', {
        timeZone: DISPLAY_TIMEZONE
    });
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
    return new Date(parsed).toLocaleString('pt-BR', {
        hour12: false,
        timeZone: DISPLAY_TIMEZONE
    });
}
function formatReminderScheduleLabel(dueDate, dueTime) {
    const timeLabel = dueTime ? ` às ${dueTime}` : '';
    const today = todayISO();
    const tomorrowDate = (0, date_utils_1.getBrasiliaDate)();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = formatYmd(tomorrowDate);
    if (dueDate === today)
        return `hoje${timeLabel}`;
    if (dueDate === tomorrow)
        return `amanhã${timeLabel}`;
    return `${formatDateBRFromYmd(dueDate)}${timeLabel}`;
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
const FRIENDLY_TRANSACTION_CODE_PATTERN = /^tx[\s-]*([a-z0-9]{6})$/i;
const FRIENDLY_CODE_LOOKUP_LIMIT = Math.max(env_1.env.whatsappAiRecentTransactions * 10, 500);
function normalizeFriendlyTransactionCode(value) {
    const normalized = value.trim();
    if (!normalized)
        return null;
    const match = normalized.match(FRIENDLY_TRANSACTION_CODE_PATTERN);
    if (!match)
        return null;
    return `TX-${match[1].toUpperCase()}`;
}
async function resolveTransactionIdReference(uid, value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const friendlyCode = normalizeFriendlyTransactionCode(trimmed);
    if (!friendlyCode)
        return trimmed;
    const candidates = await (0, firestore_1.getRecentTransactions)(uid, FRIENDLY_CODE_LOOKUP_LIMIT);
    const matched = candidates.find((transaction) => toFriendlyTransactionCode(transaction.id) === friendlyCode);
    if (!matched) {
        logger_1.logger.warn('Transaction code not found in recent list', { uid, friendlyCode });
        return null;
    }
    return matched.id;
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
function goalFieldLabel(field) {
    const labels = {
        title: 'Titulo',
        description: 'Descricao',
        targetAmount: 'Valor alvo',
        currentAmount: 'Progresso',
        deadline: 'Prazo',
        status: 'Status',
        priority: 'Prioridade'
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
    const scheduledLabel = formatReminderScheduleLabel(receipt.dueDate, receipt.dueTime);
    const lines = [
        `⏰ *Lembrete criado*`,
        '',
        `*${receipt.title}*`,
        `Tipo: ${reminderKindLabel(receipt.reminderKind)}`,
        `Agendado para: ${scheduledLabel}`,
        `Vencimento: ${dueLabel}`
    ];
    if (receipt.reminderKind !== 'general') {
        lines.push(`Valor: ${formatCurrency(receipt.amount ?? 0, currency)}`);
    }
    lines.push(`Criado em: ${formatDateTimeBR(receipt.recordedAt)}`);
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', receipt.dueTime
        ? (receipt.reminderKind === 'general'
            ? 'Vou te lembrar no WhatsApp exatamente nesse horario. Se quiser, tambem posso ajustar texto, data ou horario.'
            : 'Vou te lembrar no WhatsApp exatamente nesse horario com esse valor. Se quiser, posso ajustar valor, data, horario ou descricao.')
        : (receipt.reminderKind === 'general'
            ? 'Como nao foi definido um horario, o lembrete fica registrado para essa data. Se quiser, posso adicionar horario, alterar o texto ou mudar a data.'
            : 'Como nao foi definido um horario, o lembrete financeiro fica registrado para essa data. Se quiser, posso adicionar horario, ajustar o valor ou alterar a descricao.'));
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
function goalPriorityLabel(priority) {
    switch (priority) {
        case 'high':
            return '🔴 Alta';
        case 'low':
            return '🟢 Baixa';
        default:
            return '🟡 Média';
    }
}
function goalStatusLabel(status) {
    switch (status) {
        case 'completed':
            return '✅ Concluída';
        case 'cancelled':
            return '❌ Cancelada';
        default:
            return '🔄 Ativa';
    }
}
function buildProgressBar(current, target) {
    const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${pct.toFixed(0)}%`;
}
function buildGoalProgressLine(receipt, currency) {
    if (typeof receipt.targetAmount === 'number' && receipt.targetAmount > 0) {
        const remaining = Math.max(0, receipt.targetAmount - receipt.currentAmount);
        return [
            `💰 ${formatCurrency(receipt.currentAmount, currency)} de ${formatCurrency(receipt.targetAmount, currency)}`,
            `📊 ${buildProgressBar(receipt.currentAmount, receipt.targetAmount)}`,
            `📌 Faltam *${formatCurrency(remaining, currency)}*`
        ].join('\n');
    }
    return `💰 Acumulado: *${formatCurrency(receipt.currentAmount, currency)}*`;
}
function buildGoalMetaDetails(receipt, currency) {
    const lines = [
        `*${receipt.title}*`,
        receipt.description ? `_${receipt.description}_` : '',
        '',
        buildGoalProgressLine(receipt, currency),
        '',
        `⚡ Prioridade: ${goalPriorityLabel(receipt.priority)}`,
        `📋 Status: ${goalStatusLabel(receipt.status)}`
    ].filter(Boolean);
    if (receipt.deadline) {
        lines.push(`📅 Prazo: *${formatDateBRFromYmd(receipt.deadline)}*`);
    }
    return lines;
}
function buildAddedGoalMessage(receipt, aiReply, currency) {
    const lines = [
        '🎯 *Nova meta criada!*',
        '━━━━━━━━━━━━━━━━━',
        '',
        ...buildGoalMetaDetails(receipt, currency)
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', '━━━━━━━━━━━━━━━━━', '', cleanAiReply);
    }
    lines.push('', '━━━━━━━━━━━━━━━━━', '💡 _Posso atualizar o progresso, alterar dados, concluir ou excluir essa meta. É só pedir!_');
    return lines.join('\n');
}
function buildUpdatedGoalMessage(receipt, aiReply, currency) {
    const changedLabels = receipt.changedFields.map(goalFieldLabel).join(', ');
    const lines = [
        '✏️ *Meta atualizada!*',
        '━━━━━━━━━━━━━━━━━',
        '',
        ...buildGoalMetaDetails(receipt, currency),
        '',
        `🔄 Alterado: _${changedLabels}_`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', '━━━━━━━━━━━━━━━━━', '', cleanAiReply);
    }
    lines.push('', '━━━━━━━━━━━━━━━━━', '💡 _Posso concluir, reativar, cancelar ou ajustar essa meta novamente._');
    return lines.join('\n');
}
function buildCompletedGoalMessage(receipt, aiReply, currency) {
    const lines = [
        '🏆 *Meta concluída! Parabéns!*',
        '━━━━━━━━━━━━━━━━━',
        '',
        ...buildGoalMetaDetails(receipt, currency)
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', '━━━━━━━━━━━━━━━━━', '', cleanAiReply);
    }
    lines.push('', '━━━━━━━━━━━━━━━━━', '🚀 _Que tal criar a próxima meta? Posso reativar essa ou montar uma nova etapa!_');
    return lines.join('\n');
}
function buildDeletedGoalMessage(receipt, aiReply) {
    const lines = [
        '🗑️ *Meta excluída*',
        '━━━━━━━━━━━━━━━━━',
        '',
        `*${receipt.title}*`
    ];
    const cleanAiReply = aiReply.trim();
    if (cleanAiReply.length > 0) {
        lines.push('', cleanAiReply);
    }
    lines.push('', '━━━━━━━━━━━━━━━━━', '💡 _Posso criar outra meta no lugar ou montar um novo plano financeiro para você!_');
    return lines.join('\n');
}
function buildMultiActionMessage(results, aiReply, currency) {
    const lines = ['✅ *Ações processadas:*', ''];
    const transactionCodes = [];
    let hasReminderActions = false;
    let hasGoalActions = false;
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
        if (result.kind === 'added_goal') {
            hasGoalActions = true;
            const r = result.receipt;
            const progress = typeof r.targetAmount === 'number' && r.targetAmount > 0
                ? ` (${formatCurrency(r.currentAmount, currency)} de ${formatCurrency(r.targetAmount, currency)})`
                : '';
            lines.push(`- 🎯 Meta criada: *${r.title}*${progress}`);
            continue;
        }
        if (result.kind === 'updated_goal') {
            hasGoalActions = true;
            const r = result.receipt;
            const progress = typeof r.targetAmount === 'number' && r.targetAmount > 0
                ? ` (${Math.min(100, (r.currentAmount / r.targetAmount) * 100).toFixed(0)}%)`
                : '';
            lines.push(`- ✏️ Meta atualizada: *${r.title}*${progress}`);
            continue;
        }
        if (result.kind === 'completed_goal') {
            hasGoalActions = true;
            lines.push(`- 🏆 Meta concluída: *${result.receipt.title}*`);
            continue;
        }
        if (result.kind === 'deleted_goal') {
            hasGoalActions = true;
            lines.push(`- 🗑️ Meta excluída: *${result.receipt.title}*`);
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
    else if (hasGoalActions) {
        lines.push('', '💡 _Posso atualizar progresso, concluir, reativar ou gerenciar outras metas._');
    }
    return lines.join('\n');
}
function isMutatingAiAction(action) {
    return action.action !== 'none' && action.action !== 'send_media';
}
function buildMutationFailureMessage(actions, detail) {
    const firstMutatingAction = actions.find(isMutatingAiAction);
    let baseMessage = 'Nao consegui concluir a acao solicitada.';
    switch (firstMutatingAction?.action) {
        case 'add_transaction':
            baseMessage = 'Nao consegui registrar a transacao solicitada.';
            break;
        case 'add_recurring_transaction':
            baseMessage = 'Nao consegui criar a transacao recorrente solicitada.';
            break;
        case 'add_reminder':
            baseMessage = 'Nao consegui criar o lembrete solicitado.';
            break;
        case 'update_transaction':
            baseMessage = 'Nao consegui atualizar a transacao solicitada.';
            break;
        case 'delete_transaction':
            baseMessage = 'Nao consegui excluir a transacao solicitada.';
            break;
        case 'update_reminder':
            baseMessage = 'Nao consegui atualizar o lembrete solicitado.';
            break;
        case 'complete_reminder':
            baseMessage = 'Nao consegui concluir o lembrete solicitado.';
            break;
        case 'delete_reminder':
            baseMessage = 'Nao consegui excluir o lembrete solicitado.';
            break;
        case 'add_goal':
            baseMessage = 'Nao consegui criar a meta solicitada.';
            break;
        case 'update_goal':
            baseMessage = 'Nao consegui atualizar a meta solicitada.';
            break;
        case 'complete_goal':
            baseMessage = 'Nao consegui concluir a meta solicitada.';
            break;
        case 'delete_goal':
            baseMessage = 'Nao consegui excluir a meta solicitada.';
            break;
        default:
            break;
    }
    const normalizedDetail = detail?.trim();
    if (!normalizedDetail) {
        return baseMessage;
    }
    return `${baseMessage}\n\n${normalizedDetail}`;
}
function prepareActionsForExecution(actions, options) {
    const baseActions = Array.isArray(actions) && actions.length > 0
        ? actions.slice(0, MAX_ACTIONS_PER_MESSAGE)
        : [{ action: 'none' }];
    const fallbackActions = baseActions.every((action) => action.action === 'none')
        ? buildFallbackActionsFromText(options.latestUserMessageText)
        : null;
    const rawActions = fallbackActions ?? baseActions;
    const normalizedActions = normalizeTransactionActionsForRecurring(rawActions, options.latestUserMessageText);
    if (!options.allowedActions || options.allowedActions.length === 0) {
        return { actions: normalizedActions, hadDisallowedAction: false };
    }
    const allowedActions = new Set(options.allowedActions);
    let hadDisallowedAction = false;
    const filteredActions = normalizedActions.map((action) => {
        if (allowedActions.has(action.action)) {
            return action;
        }
        if (action.action !== 'none') {
            hadDisallowedAction = true;
        }
        return { action: 'none' };
    });
    return {
        actions: filteredActions,
        hadDisallowedAction
    };
}
function normalizeWebPanelReply(text, latestUserMessageText) {
    const normalizedUserText = normalizeHumanText(latestUserMessageText);
    if (normalizedUserText.includes('whatsapp')) {
        return text.trim();
    }
    return text
        .replace(/\bno chat do whatsapp\b/gi, 'aqui no painel')
        .replace(/\bno whatsapp\b/gi, 'aqui no painel')
        .replace(/\bpelo whatsapp\b/gi, 'aqui no painel')
        .replace(/\bvia whatsapp\b/gi, 'aqui no painel')
        .replace(/\bdo whatsapp\b/gi, 'do painel')
        .replace(/\bpro whatsapp\b/gi, 'para o painel')
        .trim();
}
async function processWhatsAppAIMessage(uid, messages, options = {}) {
    if (!uid || uid.trim().length === 0) {
        return { text: 'Nao foi possivel identificar a conta vinculada para processar a mensagem.' };
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
    const latestUserMessageText = [...sanitizedMessages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const rawLatestUserMessageText = (options.latestUserMessageText ?? '').trim();
    if (sanitizedMessages.length === 0) {
        return { text: 'Nao consegui interpretar a mensagem recebida.' };
    }
    // Use cached context if available (TTL 2 min), otherwise fetch from Firestore
    const cached = getCachedContext(uid);
    let categories;
    let recentTransactions;
    let recentReminders;
    let settings;
    let profile;
    const userGoals = await (0, firestore_1.getUserGoals)(uid);
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
        userGoals,
        isFirstMessage: Boolean(options.isFirstMessage),
        isGreeting: Boolean(options.isGreeting),
        isCapabilitiesQuestion: Boolean(options.isCapabilitiesQuestion),
        isConversationRestart: Boolean(options.isConversationRestart),
        shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
    };
    const ai = await (0, groq_1.queryGroqAssistant)(sanitizedMessages, context, {
        extraSystemPrompt: options.extraSystemPrompt
    });
    const preparedActions = prepareActionsForExecution(ai.actionObjects, {
        ...options,
        latestUserMessageText
    });
    if (preparedActions.hadDisallowedAction) {
        return {
            text: (options.unsupportedActionMessage ?? WEB_CHAT_UNSUPPORTED_ACTION_MESSAGE).slice(0, env_1.env.maxMessageLength)
        };
    }
    const requestedMutation = preparedActions.actions.some(isMutatingAiAction);
    const actionResults = await executeActions(uid, preparedActions.actions, categories, {
        ...options,
        latestUserMessageText
    });
    const actionableResults = actionResults.filter((result) => result.kind !== 'none');
    let mediaUrl;
    // Handle plain send_media results (non-chart images)
    const sendMediaAction = actionableResults.find((r) => r.kind === 'send_media');
    if (sendMediaAction) {
        mediaUrl = sendMediaAction.url;
        // Don't show send_media in multi action text summary
        const index = actionableResults.indexOf(sendMediaAction);
        if (index > -1)
            actionableResults.splice(index, 1);
    }
    if (actionableResults.length === 0) {
        if (requestedMutation) {
            return {
                text: buildMutationFailureMessage(preparedActions.actions).slice(0, env_1.env.maxMessageLength),
                mediaUrl
            };
        }
        // When image-only message didn't produce any AI action, let the AI's reply pass through.
        // The AI prompt now handles distinguishing receipts from generic images,
        // so its reply will either be a transaction confirmation or a request for a title.
        // Only use the static fallback if the AI's reply is also empty.
        if (options.imageOnlyWithoutDocumentIntent && !rawLatestUserMessageText && !mediaUrl) {
            const aiText = ai.reply.trim();
            if (aiText) {
                return { text: aiText.slice(0, env_1.env.maxMessageLength) };
            }
            return {
                text: IMAGE_DOCUMENT_SAVE_FALLBACK.slice(0, env_1.env.maxMessageLength)
            };
        }
        return { text: ai.reply.slice(0, env_1.env.maxMessageLength), mediaUrl };
    }
    if (actionableResults.length === 1) {
        const [actionResult] = actionableResults;
        if (actionResult.kind === 'error') {
            return {
                text: (requestedMutation
                    ? buildMutationFailureMessage(preparedActions.actions, actionResult.message)
                    : `${(ai.reply.trim() || 'Nao consegui concluir a acao solicitada.')}\n\nAviso: ${actionResult.message}`).slice(0, env_1.env.maxMessageLength),
                mediaUrl
            };
        }
        // Default formatting branch (e.g. added)
        let formattedText = '';
        if (actionResult.kind === 'added')
            formattedText = buildAddedTransactionMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'added_recurring')
            formattedText = buildAddedRecurringTransactionMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'added_reminder')
            formattedText = buildAddedReminderMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'updated_reminder')
            formattedText = buildUpdatedReminderMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'completed_reminder')
            formattedText = buildCompletedReminderMessage(actionResult.receipt, ai.reply);
        else if (actionResult.kind === 'deleted_reminder')
            formattedText = buildDeletedReminderMessage(actionResult.receipt, ai.reply);
        else if (actionResult.kind === 'added_goal')
            formattedText = buildAddedGoalMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'updated_goal')
            formattedText = buildUpdatedGoalMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'completed_goal')
            formattedText = buildCompletedGoalMessage(actionResult.receipt, ai.reply, settings.currency);
        else if (actionResult.kind === 'deleted_goal')
            formattedText = buildDeletedGoalMessage(actionResult.receipt, ai.reply);
        else if (actionResult.kind === 'updated')
            formattedText = buildUpdatedTransactionMessage(actionResult.receipt, ai.reply);
        else if (actionResult.kind === 'deleted')
            formattedText = buildDeletedTransactionMessage(actionResult.receipt, ai.reply);
        return {
            text: formattedText.slice(0, env_1.env.maxMessageLength),
            mediaUrl
        };
    }
    return {
        text: buildMultiActionMessage(actionableResults, ai.reply, settings.currency).slice(0, env_1.env.maxMessageLength),
        mediaUrl
    };
}
async function processWebAIMessage(uid, messages, options = {}) {
    const latestUserMessageText = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const result = await processWhatsAppAIMessage(uid, messages, {
        ...options,
        extraSystemPrompt: WEB_CHAT_EXTRA_SYSTEM_PROMPT,
        allowedActions: WEB_CHAT_ALLOWED_ACTIONS,
        unsupportedActionMessage: WEB_CHAT_UNSUPPORTED_ACTION_MESSAGE
    });
    return {
        text: normalizeWebPanelReply(result.text, latestUserMessageText).slice(0, env_1.env.maxMessageLength),
        ...(result.mediaUrl ? { mediaUrl: result.mediaUrl } : {})
    };
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
            const category = (0, groq_1.resolveBestCategoryId)(action.categoryId, categories, action.type, action.description || '', options.latestUserMessageText);
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
            const transactionId = await resolveTransactionIdReference(uid, action.id);
            if (!transactionId) {
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
            await (0, firestore_1.updateUserTransaction)(uid, transactionId, changes);
            invalidateContextCache(uid);
            trackUndoableAction(uid, { actionKind: 'updated', resourceId: transactionId });
            return {
                kind: 'updated',
                receipt: {
                    transactionCode: toFriendlyTransactionCode(transactionId),
                    changedFields: Object.keys(changes),
                    updatedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'delete_transaction') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const transactionId = await resolveTransactionIdReference(uid, action.id);
            if (!transactionId) {
                return { kind: 'none' };
            }
            const existing = await (0, firestore_1.getUserTransactionById)(uid, transactionId);
            if (!existing) {
                return { kind: 'none' };
            }
            const { id: existingId, ...deletedTransaction } = existing;
            await (0, firestore_1.deleteUserTransaction)(uid, transactionId);
            invalidateContextCache(uid);
            trackUndoableAction(uid, {
                actionKind: 'deleted',
                resourceId: existingId,
                deletedTransaction
            });
            return {
                kind: 'deleted',
                receipt: {
                    transactionCode: toFriendlyTransactionCode(transactionId),
                    deletedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'add_recurring_transaction') {
            if (!Number.isFinite(action.amount) || action.amount <= 0) {
                return { kind: 'none' };
            }
            const category = (0, groq_1.resolveBestCategoryId)(action.categoryId, categories, action.type, action.description || '', options.latestUserMessageText);
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
            const inferredSchedule = inferReminderScheduleFromText(options.latestUserMessageText);
            const explicitDueDate = parseYmd(action.dueDate);
            const explicitDueTime = normalizeDueTime(action.dueTime);
            const payload = {
                reminderKind,
                title: (action.title || 'Lembrete via WhatsApp').toString().slice(0, 120),
                amount: isFinancial ? normalizedAmount : null,
                dueDate: explicitDueDate ?? inferredSchedule?.dueDate ?? todayISO(),
                dueTime: explicitDueTime ?? inferredSchedule?.dueTime ?? null,
                type: isFinancial ? reminderKind : null,
                status: 'pending',
                notifyPhone: options.sourcePhone ?? null
            };
            const now = (0, date_utils_1.getBrasiliaDate)();
            const currentYmd = formatYmd(now);
            const currentHm = formatHm(now);
            if (payload.dueDate < currentYmd || (payload.dueDate === currentYmd && payload.dueTime && payload.dueTime < currentHm)) {
                return {
                    kind: 'error',
                    message: 'Não é possível agendar um lembrete para uma data ou horário no passado. Por favor, informe um horário futuro.'
                };
            }
            const reminderId = await (0, firestore_1.addUserReminder)(uid, payload);
            invalidateContextCache(uid);
            trackUndoableAction(uid, {
                actionKind: 'added_reminder',
                resourceId: reminderId
            });
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
            const existing = await (0, firestore_1.getUserReminderById)(uid, action.id);
            if (!existing) {
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
            trackUndoableAction(uid, {
                actionKind: 'updated_reminder',
                resourceId: action.id,
                previousReminder: buildReminderUndoSnapshot(existing)
            });
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
            const existing = await (0, firestore_1.getUserReminderById)(uid, action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserReminder)(uid, action.id, { status: 'paid' });
            invalidateContextCache(uid);
            trackUndoableAction(uid, {
                actionKind: 'completed_reminder',
                resourceId: action.id,
                previousReminder: buildReminderUndoSnapshot(existing)
            });
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
            trackUndoableAction(uid, {
                actionKind: 'deleted_reminder',
                resourceId: existing.id,
                previousReminder: buildReminderUndoSnapshot(existing)
            });
            return {
                kind: 'deleted_reminder',
                receipt: {
                    reminderId: existing.id,
                    title: existing.title,
                    deletedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'add_goal') {
            const title = (action.title || '').toString().trim().slice(0, 120);
            if (!title) {
                return { kind: 'none' };
            }
            const targetAmount = typeof action.targetAmount === 'number' && Number.isFinite(action.targetAmount) && action.targetAmount > 0
                ? action.targetAmount
                : null;
            const currentAmount = typeof action.currentAmount === 'number' && Number.isFinite(action.currentAmount) && action.currentAmount >= 0
                ? action.currentAmount
                : 0;
            const priority = action.priority === 'low' || action.priority === 'high' ? action.priority : 'medium';
            const deadline = parseYmd(action.deadline) ?? null;
            const description = typeof action.description === 'string' && action.description.trim().length > 0
                ? action.description.trim().slice(0, 500)
                : null;
            const goalId = await (0, firestore_1.addUserGoal)(uid, {
                title,
                description,
                targetAmount,
                currentAmount,
                deadline,
                source: 'manual',
                priority
            });
            invalidateContextCache(uid);
            return {
                kind: 'added_goal',
                receipt: {
                    goalId,
                    title,
                    description,
                    targetAmount,
                    currentAmount,
                    deadline,
                    status: 'active',
                    priority,
                    source: 'manual',
                    updatedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'update_goal') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const existing = (await (0, firestore_1.getUserGoals)(uid)).find((goal) => goal.id === action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            const rawChanges = action.changes ?? {};
            const updates = {};
            if (typeof rawChanges.title === 'string' && rawChanges.title.trim().length > 0) {
                updates.title = rawChanges.title.trim().slice(0, 120);
            }
            if (rawChanges.description === null || typeof rawChanges.description === 'string') {
                updates.description = rawChanges.description == null ? null : rawChanges.description.trim().slice(0, 500);
            }
            if (rawChanges.targetAmount === null) {
                updates.targetAmount = null;
            }
            else if (typeof rawChanges.targetAmount === 'number' && Number.isFinite(rawChanges.targetAmount) && rawChanges.targetAmount > 0) {
                updates.targetAmount = rawChanges.targetAmount;
            }
            if (typeof rawChanges.currentAmount === 'number' && Number.isFinite(rawChanges.currentAmount) && rawChanges.currentAmount >= 0) {
                updates.currentAmount = rawChanges.currentAmount;
            }
            if (rawChanges.deadline === null) {
                updates.deadline = null;
            }
            else if (typeof rawChanges.deadline === 'string') {
                updates.deadline = parseYmd(rawChanges.deadline) ?? null;
            }
            if (rawChanges.status === 'active' || rawChanges.status === 'completed' || rawChanges.status === 'cancelled') {
                updates.status = rawChanges.status;
            }
            if (rawChanges.priority === 'low' || rawChanges.priority === 'medium' || rawChanges.priority === 'high') {
                updates.priority = rawChanges.priority;
            }
            if (Object.keys(updates).length === 0) {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserGoal)(uid, action.id, updates);
            invalidateContextCache(uid);
            const updated = (await (0, firestore_1.getUserGoals)(uid)).find((goal) => goal.id === action.id);
            if (!updated) {
                return { kind: 'none' };
            }
            return {
                kind: 'updated_goal',
                receipt: {
                    goalId: updated.id,
                    title: updated.title,
                    description: updated.description,
                    targetAmount: updated.targetAmount,
                    currentAmount: updated.currentAmount,
                    deadline: updated.deadline,
                    status: updated.status,
                    priority: updated.priority,
                    source: updated.source,
                    updatedAt: updated.updatedAt,
                    changedFields: Object.keys(updates).map(goalFieldLabel)
                }
            };
        }
        if (action.action === 'complete_goal') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const existing = (await (0, firestore_1.getUserGoals)(uid)).find((goal) => goal.id === action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            await (0, firestore_1.updateUserGoal)(uid, action.id, { status: 'completed' });
            invalidateContextCache(uid);
            const updated = (await (0, firestore_1.getUserGoals)(uid)).find((goal) => goal.id === action.id);
            if (!updated) {
                return { kind: 'none' };
            }
            return {
                kind: 'completed_goal',
                receipt: {
                    goalId: updated.id,
                    title: updated.title,
                    description: updated.description,
                    targetAmount: updated.targetAmount,
                    currentAmount: updated.currentAmount,
                    deadline: updated.deadline,
                    status: updated.status,
                    priority: updated.priority,
                    source: updated.source,
                    updatedAt: updated.updatedAt
                }
            };
        }
        if (action.action === 'delete_goal') {
            if (!action.id || typeof action.id !== 'string') {
                return { kind: 'none' };
            }
            const existing = (await (0, firestore_1.getUserGoals)(uid)).find((goal) => goal.id === action.id);
            if (!existing) {
                return { kind: 'none' };
            }
            await (0, firestore_1.deleteUserGoal)(uid, action.id);
            invalidateContextCache(uid);
            return {
                kind: 'deleted_goal',
                receipt: {
                    goalId: existing.id,
                    title: existing.title,
                    deletedAt: new Date().toISOString()
                }
            };
        }
        if (action.action === 'send_media') {
            return { kind: 'send_media', url: action.url };
        }
    }
    catch (error) {
        logger_1.logger.error('Failed executing AI financial action', error);
        return { kind: 'error', message: 'Ocorreu um erro ao salvar a acao solicitada.' };
    }
    return { kind: 'none' };
}
