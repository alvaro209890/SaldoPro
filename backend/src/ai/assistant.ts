import { env } from '../config/env';
import {
  addUserTransaction,
  deleteUserTransaction,
  getUserTransactionById,
  getRecentTransactions,
  getUserCategories,
  getUserProfile,
  getUserSettings,
  restoreUserTransaction,
  updateUserTransaction,
  addRecurringTransaction as addRecurringTransactionDb,
  deleteRecurringTransaction as deleteRecurringTransactionDb,
  generateOverdueRecurringTransactions,
  type CreateTransactionInput,
  type CreateRecurringTransactionInput,
  type UserCategory,
  type UserProfileBackend,
  type UserSettingsBackend,
  type UserTransaction
} from '../lib/firestore';
import { logger } from '../lib/logger';
import {
  queryGroqAssistant,
  type AIAction,
  type GroqChatMessage,
  type PaymentMethod,
  type UserFinancialContext
} from './groq';

const VALID_PAYMENT_METHODS: PaymentMethod[] = [
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

interface CachedFinancialContext {
  categories: UserCategory[];
  recentTransactions: UserTransaction[];
  settings: UserSettingsBackend;
  profile: UserProfileBackend;
  cachedAt: number;
}

const financialContextCache = new Map<string, CachedFinancialContext>();

function getCachedContext(uid: string): CachedFinancialContext | null {
  const entry = financialContextCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CONTEXT_CACHE_TTL_MS) {
    financialContextCache.delete(uid);
    return null;
  }
  return entry;
}

function setCachedContext(uid: string, ctx: Omit<CachedFinancialContext, 'cachedAt'>): void {
  financialContextCache.set(uid, { ...ctx, cachedAt: Date.now() });
}

/** Invalidate cache after a mutation so the next call gets fresh data. */
function invalidateContextCache(uid: string): void {
  financialContextCache.delete(uid);
}

// ---------------------------------------------------------------------------
// Last-action tracking for quick undo
// ---------------------------------------------------------------------------
const UNDO_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface UndoableAction {
  actionKind: 'added' | 'added_recurring' | 'updated' | 'deleted';
  /** ID of the created/modified/deleted resource */
  resourceId: string;
  timestamp: number;
  deletedTransaction?: Omit<UserTransaction, 'id'>;
}

const lastActionByUid = new Map<string, UndoableAction>();

function trackUndoableAction(
  uid: string,
  action: Omit<UndoableAction, 'timestamp'> & { timestamp?: number }
): void {
  lastActionByUid.set(uid, { ...action, timestamp: action.timestamp ?? Date.now() });
}

/**
 * Undo the last action for a user. Returns a human-friendly message.
 * Supports quick undo for add/add_recurring/delete.
 */
export async function undoLastAction(uid: string): Promise<string> {
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
      await deleteUserTransaction(uid, entry.resourceId);
      invalidateContextCache(uid);
      lastActionByUid.delete(uid);
      return '↩️ *Acao desfeita!*\n\nA ultima transacao registrada foi excluida com sucesso.';
    }

    if (entry.actionKind === 'added_recurring') {
      await deleteRecurringTransactionDb(uid, entry.resourceId);
      invalidateContextCache(uid);
      lastActionByUid.delete(uid);
      return '↩️ *Acao desfeita!*\n\nA transacao recorrente criada foi excluida com sucesso.';
    }

    if (entry.actionKind === 'deleted') {
      if (!entry.deletedTransaction) {
        lastActionByUid.delete(uid);
        return 'Nao consegui restaurar a ultima exclusao porque os dados originais nao estavam disponiveis.';
      }

      await restoreUserTransaction(uid, entry.resourceId, entry.deletedTransaction);
      invalidateContextCache(uid);
      lastActionByUid.delete(uid);
      return '↩️ *Acao desfeita!*\n\nA transacao excluida foi restaurada com sucesso.';
    }

    lastActionByUid.delete(uid);
    return 'Desculpe, essa acao ainda nao pode ser desfeita automaticamente.';
  } catch (error) {
    logger.error('Failed to undo last action', error);
    return 'Ocorreu um erro ao tentar desfazer a acao. Tente novamente.';
  }
}

interface AddedTransactionReceipt {
  transactionId: string;
  transactionCode: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  categoryName: string;
  paymentMethod: PaymentMethod;
  transactionDate: string;
  recordedAt: string;
}

interface UpdatedTransactionReceipt {
  transactionCode: string;
  changedFields: string[];
  updatedAt: string;
}

interface DeletedTransactionReceipt {
  transactionCode: string;
  deletedAt: string;
}

interface AddedRecurringTransactionReceipt {
  recurringId: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  categoryName: string;
  paymentMethod: PaymentMethod;
  frequency: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  recordedAt: string;
}

type ActionExecutionResult =
  | { kind: 'none' }
  | { kind: 'added'; receipt: AddedTransactionReceipt }
  | { kind: 'added_recurring'; receipt: AddedRecurringTransactionReceipt }
  | { kind: 'updated'; receipt: UpdatedTransactionReceipt }
  | { kind: 'deleted'; receipt: DeletedTransactionReceipt }
  | { kind: 'error'; message: string };

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function normalizeDate(date: unknown): string {
  if (typeof date !== 'string') return todayISO();
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return todayISO();
}

function normalizePaymentMethod(method: unknown): PaymentMethod {
  if (typeof method === 'string' && VALID_PAYMENT_METHODS.includes(method as PaymentMethod)) {
    return method as PaymentMethod;
  }
  return 'pix';
}

function formatCurrency(value: number, currency: string): string {
  if (currency === 'BRL') {
    return `R$ ${value.toFixed(2).replace('.', ',')}`;
  }
  return `${currency} ${value.toFixed(2)}`;
}

function formatDateBRFromISO(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString('pt-BR');
}

function formatDateBRFromYmd(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTimeBR(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString('pt-BR', { hour12: false });
}

function paymentMethodLabel(value: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    pix: 'PIX',
    credit: 'Cartao de credito',
    debit: 'Cartao de debito',
    cash: 'Dinheiro',
    transfer: 'Transferencia',
    boleto: 'Boleto'
  };
  return labels[value] ?? value;
}

function frequencyLabel(freq: 'weekly' | 'monthly' | 'yearly'): string {
  const labels = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
  return labels[freq] ?? freq;
}

function transactionTypeLabel(value: 'income' | 'expense'): string {
  return value === 'income' ? 'Receita' : 'Despesa';
}

function hashBase36(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function toFriendlyTransactionCode(transactionId: string): string {
  const normalized = transactionId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (normalized.length >= 6) {
    return `TX-${normalized.slice(0, 6)}`;
  }

  const hash = hashBase36(transactionId).padStart(6, '0').slice(0, 6);
  return `TX-${hash}`;
}

function buildAddedTransactionMessage(
  receipt: AddedTransactionReceipt,
  aiReply: string,
  currency: string
): string {
  const typeEmoji = receipt.type === 'income' ? '📥' : '📤';
  const lines = [
    `${typeEmoji} *${transactionTypeLabel(receipt.type)} registrada*`,
    '',
    `*${formatCurrency(receipt.amount, currency)}* - ${receipt.description}`,
    `${receipt.categoryName} | ${paymentMethodLabel(receipt.paymentMethod)} | ${formatDateBRFromYmd(receipt.transactionDate)}`,
    `Cod: ${receipt.transactionCode}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  return lines.join('\n');
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    amount: 'Valor',
    description: 'Descricao',
    category: 'Categoria',
    date: 'Data',
    type: 'Tipo',
    paymentMethod: 'Pagamento'
  };
  return labels[field] ?? field;
}

function buildUpdatedTransactionMessage(
  receipt: UpdatedTransactionReceipt,
  aiReply: string
): string {
  const lines = [
    `✏️ *Transacao atualizada*`,
    '',
    `Alterado: ${receipt.changedFields.map(fieldLabel).join(', ')}`,
    `Cod: ${receipt.transactionCode}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  return lines.join('\n');
}

function buildDeletedTransactionMessage(
  receipt: DeletedTransactionReceipt,
  aiReply: string
): string {
  const lines = [
    `🗑️ *Transacao excluida*`,
    '',
    `Cod: ${receipt.transactionCode}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  return lines.join('\n');
}

function buildAddedRecurringTransactionMessage(
  receipt: AddedRecurringTransactionReceipt,
  aiReply: string,
  currency: string
): string {
  const typeEmoji = receipt.type === 'income' ? '📥' : '📤';
  const lines = [
    `${typeEmoji} *${transactionTypeLabel(receipt.type)} recorrente criada*`,
    '',
    `*${formatCurrency(receipt.amount, currency)}* - ${receipt.description}`,
    `${receipt.categoryName} | ${paymentMethodLabel(receipt.paymentMethod)}`,
    `Frequencia: ${frequencyLabel(receipt.frequency)} | Inicio: ${formatDateBRFromYmd(receipt.startDate)}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  return lines.join('\n');
}

function buildMultiActionMessage(
  results: ActionExecutionResult[],
  aiReply: string,
  currency: string
): string {
  const lines: string[] = ['✅ *Acoes processadas:*', ''];

  for (const result of results) {
    if (result.kind === 'added') {
      lines.push(
        `- ${transactionTypeLabel(result.receipt.type)}: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (Cod: ${result.receipt.transactionCode})`
      );
      continue;
    }

    if (result.kind === 'added_recurring') {
      lines.push(
        `- ${transactionTypeLabel(result.receipt.type)} recorrente: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (${frequencyLabel(result.receipt.frequency)})`
      );
      continue;
    }

    if (result.kind === 'updated') {
      lines.push(
        `- Transacao atualizada (Cod: ${result.receipt.transactionCode}) - Campos: ${result.receipt.changedFields.map(fieldLabel).join(', ')}`
      );
      continue;
    }

    if (result.kind === 'deleted') {
      lines.push(`- Transacao excluida (Cod: ${result.receipt.transactionCode})`);
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

  return lines.join('\n');
}

export interface ProcessWhatsAppAIOptions {
  isFirstMessage?: boolean;
  isGreeting?: boolean;
  isCapabilitiesQuestion?: boolean;
  isConversationRestart?: boolean;
  shouldSendCapabilitiesSummary?: boolean;
}

export async function processWhatsAppAIMessage(
  uid: string,
  messages: GroqChatMessage[],
  options: ProcessWhatsAppAIOptions = {}
): Promise<string> {
  if (!uid || uid.trim().length === 0) {
    return 'Nao foi possivel identificar a conta vinculada para processar a mensagem.';
  }

  const sanitizedMessages = messages
    .slice(-env.whatsappAiHistoryLimit)
    .map((message) => ({
      role: message.role,
      content: (message.content ?? '').toString().slice(0, env.maxMessageLength),
      ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {}),
      ...(message.audioDataUrl ? { audioDataUrl: message.audioDataUrl } : {})
    }))
    .filter((message) => message.content.trim() || message.imageDataUrl || message.audioDataUrl);

  if (sanitizedMessages.length === 0) {
    return 'Nao consegui interpretar a mensagem recebida.';
  }

  // Use cached context if available (TTL 2 min), otherwise fetch from Firestore
  const cached = getCachedContext(uid);
  let categories: UserCategory[];
  let recentTransactions: UserTransaction[];
  let settings: UserSettingsBackend;
  let profile: UserProfileBackend;

  if (cached) {
    logger.info('Using cached financial context', { uid });
    ({ categories, recentTransactions, settings, profile } = cached);
  } else {
    [categories, recentTransactions, settings, profile] = await Promise.all([
      getUserCategories(uid),
      getRecentTransactions(uid, env.whatsappAiRecentTransactions),
      getUserSettings(uid),
      getUserProfile(uid)
    ]);
    setCachedContext(uid, { categories, recentTransactions, settings, profile });

    // Generate overdue recurring transactions when context is freshly loaded
    try {
      const generatedCount = await generateOverdueRecurringTransactions(uid);
      if (generatedCount > 0) {
        logger.info('Generated overdue recurring transactions', { uid, count: generatedCount });
        recentTransactions = await getRecentTransactions(uid, env.whatsappAiRecentTransactions);
        setCachedContext(uid, { categories, recentTransactions, settings, profile });
      }
    } catch (error) {
      logger.error('Failed to generate overdue recurring transactions', error);
    }
  }

  const context: UserFinancialContext = {
    profile,
    settings,
    categories,
    recentTransactions,
    isFirstMessage: Boolean(options.isFirstMessage),
    isGreeting: Boolean(options.isGreeting),
    isCapabilitiesQuestion: Boolean(options.isCapabilitiesQuestion),
    isConversationRestart: Boolean(options.isConversationRestart),
    shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
  };

  const ai = await queryGroqAssistant(sanitizedMessages, context);
  const actionResults = await executeActions(uid, ai.actionObjects, categories);
  const actionableResults = actionResults.filter((result) => result.kind !== 'none');

  if (actionableResults.length === 0) {
    return `${ai.reply}`.slice(0, env.maxMessageLength);
  }

  if (actionableResults.length === 1) {
    const [actionResult] = actionableResults;

    if (actionResult.kind === 'added') {
      return buildAddedTransactionMessage(actionResult.receipt, ai.reply, settings.currency)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'added_recurring') {
      return buildAddedRecurringTransactionMessage(actionResult.receipt, ai.reply, settings.currency)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'updated') {
      return buildUpdatedTransactionMessage(actionResult.receipt, ai.reply)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'deleted') {
      return buildDeletedTransactionMessage(actionResult.receipt, ai.reply)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'error') {
      const baseReply = ai.reply.trim() || 'Nao consegui concluir a acao solicitada.';
      return `${baseReply}\n\nAviso: ${actionResult.message}`.slice(0, env.maxMessageLength);
    }
  }

  return buildMultiActionMessage(actionableResults, ai.reply, settings.currency)
    .slice(0, env.maxMessageLength);
}

async function executeActions(
  uid: string,
  actions: AIAction[],
  categories: UserCategory[]
): Promise<ActionExecutionResult[]> {
  const safeActions = Array.isArray(actions) && actions.length > 0
    ? actions.slice(0, MAX_ACTIONS_PER_MESSAGE)
    : [{ action: 'none' as const }];

  const results: ActionExecutionResult[] = [];
  for (const action of safeActions) {
    const result = await executeAction(uid, action, categories);
    results.push(result);
  }
  return results;
}

async function executeAction(
  uid: string,
  action: AIAction,
  categories: UserCategory[]
): Promise<ActionExecutionResult> {
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

      const payload: CreateTransactionInput = {
        type: action.type,
        amount: Number(action.amount),
        description: (action.description || 'Lancamento via WhatsApp').toString().slice(0, 120),
        category,
        date: normalizeDate(action.date),
        paymentMethod: normalizePaymentMethod(action.paymentMethod)
      };

      const transactionId = await addUserTransaction(uid, payload);
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

      const changes: Record<string, unknown> = { ...(action.changes ?? {}) };
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

      await updateUserTransaction(
        uid,
        action.id,
        changes as Partial<{
          type: 'income' | 'expense';
          amount: number;
          date: string;
          monthKey: string;
          category: string;
          description: string;
          paymentMethod: PaymentMethod;
          updatedAt: string;
        }>
      );
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

      const existing = await getUserTransactionById(uid, action.id);
      if (!existing) {
        return { kind: 'none' };
      }

      const { id: existingId, ...deletedTransaction } = existing;
      await deleteUserTransaction(uid, action.id);
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

      const payload: CreateRecurringTransactionInput = {
        type: action.type,
        amount: Number(action.amount),
        description: (action.description || 'Recorrente via WhatsApp').toString().slice(0, 120),
        category,
        paymentMethod: normalizePaymentMethod(action.paymentMethod),
        frequency: action.frequency,
        startDate: normalizeDate(action.date),
        endDate: action.endDate ?? null,
      };

      const recurringId = await addRecurringTransactionDb(uid, payload);
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
          paymentMethod: payload.paymentMethod as PaymentMethod,
          frequency: payload.frequency,
          startDate: payload.startDate,
          recordedAt: new Date().toISOString(),
        },
      };
    }
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
    return { kind: 'error', message: 'Ocorreu um erro ao salvar a transacao.' };
  }

  return { kind: 'none' };
}
