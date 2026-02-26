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

function findCategoryName(categories: UserCategory[], categoryId: string): string {
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.name || categoryId;
}

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export async function processWhatsAppAIMessage(uid: string, messages: GroqChatMessage[]): Promise<string> {
  if (!uid || uid.trim().length === 0) {
    return 'Não foi possível identificar a conta vinculada para processar a mensagem.';
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
    return 'Não consegui interpretar a mensagem recebida.';
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
    recentTransactions
  };

  const ai = await queryGroqAssistant(sanitizedMessages, context);

  const actionMessage = await executeAction(uid, ai.actionObject, categories);
  if (!actionMessage) {
    return ai.reply;
  }

  // If the AI reply already contains a confirmation (based on the prompt),
  // only append the action status if the action needed extra info
  return `${ai.reply}`.slice(0, env.maxMessageLength);
}

async function executeAction(
  uid: string,
  action: AIAction,
  categories: UserCategory[]
): Promise<string | null> {
  try {
    if (action.action === 'none') {
      return null;
    }

    if (action.action === 'add_transaction') {
      if (!Number.isFinite(action.amount) || action.amount <= 0) {
        return null; // Silent — let the AI handle the reply
      }

      const categoryExists = categories.find((c) => c.id === action.categoryId);
      const fallbackCategory = categories.find((c) => c.type === action.type);
      const category = categoryExists?.id ?? fallbackCategory?.id;
      if (!category) {
        return null;
      }

      const payload: CreateTransactionInput = {
        type: action.type,
        amount: Number(action.amount),
        description: (action.description || 'Lançamento via WhatsApp').toString().slice(0, 120),
        category,
        date: normalizeDate(action.date),
        paymentMethod: normalizePaymentMethod(action.paymentMethod)
      };

      await addUserTransaction(uid, payload);
      // Don't return anything — the AI reply already confirms the transaction
      return null;
    }

    if (action.action === 'update_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return null;
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
          return null;
        }
        changes.amount = amount;
      }

      if (Object.keys(changes).length === 0) {
        return null;
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
      return null;
    }

    if (action.action === 'delete_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return null;
      }
      await deleteUserTransaction(uid, action.id);
      return null;
    }
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
    return '⚠️ Entendi o pedido, mas ocorreu um erro ao salvar. Tente novamente em instantes.';
  }

  return null;
}

