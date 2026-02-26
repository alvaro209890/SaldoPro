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

type ActionExecutionResult =
  | { kind: 'none' }
  | { kind: 'added'; receipt: AddedTransactionReceipt }
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

function buildFinancialAssistantIntro(isCapabilitiesQuestion: boolean): string {
  const lines = [
    '*Oi! Eu sou a SaldoPro, sua assistente financeira.*',
    '',
    '*Posso te ajudar com:*',
    '- Registrar receitas e despesas por texto',
    '- Ler comprovantes/imagens e lancar automaticamente',
    '- Mostrar resumo financeiro do mes (receitas, despesas e saldo)',
    '- Acompanhar orcamento e alertar excessos',
    '- Editar e excluir lancamentos',
    '- Sugerir melhorias com base nos seus gastos',
    '',
    isCapabilitiesQuestion
      ? '*Exemplos:* "gastei 89,90 no mercado no cartao" ou "quanto ja gastei este mes?"'
      : '*Se quiser, ja me diga um gasto/receita agora e eu registro pra voce.*'
  ];

  return lines.join('\n');
}

function buildAddedTransactionMessage(
  receipt: AddedTransactionReceipt,
  aiReply: string,
  currency: string
): string {
  const lines = [
    '*Transacao registrada com sucesso*',
    '',
    `Numero da transacao: ${receipt.transactionCode}`,
    `Tipo: ${transactionTypeLabel(receipt.type)}`,
    `Valor: ${formatCurrency(receipt.amount, currency)}`,
    `Categoria: ${receipt.categoryName}`,
    `Descricao: ${receipt.description}`,
    `Pagamento: ${paymentMethodLabel(receipt.paymentMethod)}`,
    `Data da transacao: ${formatDateBRFromYmd(receipt.transactionDate)}`,
    `Registrado em: ${formatDateTimeBR(receipt.recordedAt)}`,
    `Status: Salvo no SaldoPro`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', `Observacao: ${cleanAiReply}`);
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
    isCapabilitiesQuestion: Boolean(options.isCapabilitiesQuestion),
    isConversationRestart: Boolean(options.isConversationRestart),
    shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
  };

  const ai = await queryGroqAssistant(sanitizedMessages, context);
  const actionResult = await executeAction(uid, ai.actionObject, categories);

  if (actionResult.kind === 'added') {
    return buildAddedTransactionMessage(actionResult.receipt, ai.reply, settings.currency)
      .slice(0, env.maxMessageLength);
  }

  if (actionResult.kind === 'error') {
    const baseReply = ai.reply.trim() || 'Nao consegui concluir a acao solicitada.';
    return `${baseReply}\n\nAviso: ${actionResult.message}`.slice(0, env.maxMessageLength);
  }

  return `${ai.reply}`.slice(0, env.maxMessageLength);
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
      return { kind: 'none' };
    }

    if (action.action === 'delete_transaction') {
      if (!action.id || typeof action.id !== 'string') {
        return { kind: 'none' };
      }
      await deleteUserTransaction(uid, action.id);
      return { kind: 'none' };
    }
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
    return { kind: 'error', message: 'Ocorreu um erro ao salvar a transacao.' };
  }

  return { kind: 'none' };
}
