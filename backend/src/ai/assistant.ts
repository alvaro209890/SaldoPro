import { env } from '../config/env';
import {
  addUserTransaction,
  deleteUserTransaction,
  getRecentTransactions,
  getUserCategories,
  getUserProfile,
  getUserSettings,
  updateUserTransaction,
  type CreateTransactionInput,
  type UserCategory
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

export interface ProcessWhatsAppAIOptions {
  isFirstMessage?: boolean;
  isGreeting?: boolean;
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
      ...(message.imageDataUrl ? { imageDataUrl: message.imageDataUrl } : {})
    }))
    .filter((message) => message.content.trim() || message.imageDataUrl);

  if (sanitizedMessages.length === 0) {
    return 'Nao consegui interpretar a mensagem recebida.';
  }

  const [categories, recentTransactions, settings, profile] = await Promise.all([
    getUserCategories(uid),
    getRecentTransactions(uid, env.whatsappAiRecentTransactions),
    getUserSettings(uid),
    getUserProfile(uid)
  ]);

  const context: UserFinancialContext = {
    profile,
    settings,
    categories,
    recentTransactions,
    isFirstMessage: Boolean(options.isFirstMessage),
    isGreeting: Boolean(options.isGreeting),
    isConversationRestart: Boolean(options.isConversationRestart),
    shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
  };

  const ai = await queryGroqAssistant(sanitizedMessages, context);

  await executeAction(uid, ai.actionObject, categories);
  return `${ai.reply}`.slice(0, env.maxMessageLength);
}

async function executeAction(
  uid: string,
  action: AIAction,
  categories: UserCategory[]
): Promise<void> {
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

      const payload: CreateTransactionInput = {
        type: action.type,
        amount: Number(action.amount),
        description: (action.description || 'Lancamento via WhatsApp').toString().slice(0, 120),
        category,
        date: normalizeDate(action.date),
        paymentMethod: normalizePaymentMethod(action.paymentMethod)
      };

      await addUserTransaction(uid, payload);
      return;
    }

    if (action.action === 'update_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return;
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
          return;
        }
        changes.amount = amount;
      }

      if (Object.keys(changes).length === 0) {
        return;
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
      return;
    }

    if (action.action === 'delete_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return;
      }
      await deleteUserTransaction(uid, action.id);
      return;
    }
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
  }
}
