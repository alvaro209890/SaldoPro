import { env } from '../config/env';
import {
  addUserTransaction,
  deleteUserTransaction,
  getRecentTransactions,
  getUserCategories,
  updateUserTransaction,
  type CreateTransactionInput
} from '../lib/firestore';
import { logger } from '../lib/logger';
import {
  queryGroqAssistant,
  type AIAction,
  type GroqChatMessage,
  type PaymentMethod
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

export async function processWhatsAppAIMessage(messages: GroqChatMessage[]): Promise<string> {
  const uid = env.whatsappOwnerUid;
  if (!uid) {
    return 'Configuracao incompleta do assistente. Defina WHATSAPP_OWNER_UID no backend.';
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

  const categories = await getUserCategories(uid);
  const recentTransactions = await getRecentTransactions(uid, env.whatsappAiRecentTransactions);
  const ai = await queryGroqAssistant(sanitizedMessages, categories, recentTransactions);

  const actionMessage = await executeAction(uid, ai.actionObject, categories);
  if (!actionMessage) {
    return ai.reply;
  }

  return `${ai.reply}\n\n${actionMessage}`.slice(0, env.maxMessageLength);
}

async function executeAction(
  uid: string,
  action: AIAction,
  categories: Array<{ id: string; type: 'income' | 'expense' }>
): Promise<string | null> {
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

      const payload: CreateTransactionInput = {
        type: action.type,
        amount: Number(action.amount),
        description: (action.description || 'Lancamento via WhatsApp').toString().slice(0, 120),
        category,
        date: normalizeDate(action.date),
        paymentMethod: normalizePaymentMethod(action.paymentMethod)
      };

      const transactionId = await addUserTransaction(uid, payload);
      return `Lancamento criado com sucesso (ID: ${transactionId}).`;
    }

    if (action.action === 'update_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return 'Nao executei a edicao porque o ID da transacao nao foi informado.';
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
          return 'Nao executei a edicao porque o novo valor esta invalido.';
        }
        changes.amount = amount;
      }

      if (Object.keys(changes).length === 0) {
        return 'Nao executei a edicao porque nao houve campos validos para atualizar.';
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
      return `Transacao ${action.id} atualizada com sucesso.`;
    }

    if (action.action === 'delete_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return 'Nao executei a exclusao porque o ID da transacao nao foi informado.';
      }
      await deleteUserTransaction(uid, action.id);
      return `Transacao ${action.id} removida com sucesso.`;
    }
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
    return 'Entendi o pedido, mas ocorreu erro ao salvar no banco.';
  }

  return null;
}
