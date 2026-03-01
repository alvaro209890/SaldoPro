import { env } from '../config/env';
import {
  addUserReminder,
  addUserTransaction,
  deleteUserReminder,
  updateUserReminder,
  deleteUserTransaction,
  getUserTransactionById,
  getUserReminderById,
  getUserReminders,
  getRecentTransactions,
  getUserCategories,
  getUserProfile,
  getUserSettings,
  restoreUserTransaction,
  updateUserTransaction,
  addRecurringTransaction as addRecurringTransactionDb,
  deleteRecurringTransaction as deleteRecurringTransactionDb,
  generateOverdueRecurringTransactions,
  type CreateReminderInput,
  type CreateTransactionInput,
  type CreateRecurringTransactionInput,
  type UserCategory,
  type UserProfileBackend,
  type UserReminder,
  type UserSettingsBackend,
  type UserTransaction
} from '../lib/firestore';
import { logger } from '../lib/logger';
import {
  queryGroqAssistant,
  type AIAction,
  type AIActionAddReminder,
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
  recentReminders: UserReminder[];
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

interface AddedReminderReceipt {
  reminderId: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime?: string | null;
  reminderType?: 'payable' | 'receivable' | null;
  recordedAt: string;
}

interface UpdatedReminderReceipt {
  reminderId: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime?: string | null;
  status: 'pending' | 'paid';
  updatedAt: string;
}

interface DeletedReminderReceipt {
  reminderId: string;
  title: string;
  deletedAt: string;
}

type ActionExecutionResult =
  | { kind: 'none' }
  | { kind: 'added'; receipt: AddedTransactionReceipt }
  | { kind: 'added_recurring'; receipt: AddedRecurringTransactionReceipt }
  | { kind: 'added_reminder'; receipt: AddedReminderReceipt }
  | { kind: 'updated_reminder'; receipt: UpdatedReminderReceipt }
  | { kind: 'completed_reminder'; receipt: UpdatedReminderReceipt }
  | { kind: 'deleted_reminder'; receipt: DeletedReminderReceipt }
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

function normalizeDueTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) return null;
  return trimmed;
}

function parseYmd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function formatYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatHm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseRelativeReminderDateTime(text: string | undefined): { dueDate: string; dueTime: string } | null {
  if (!text) return null;

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

function extractFallbackReminderTitle(text: string): string {
  const cleaned = text
    .replace(/\b(?:da\s*qui(?:\s+a)?|daqui(?:\s+a)?|em)\s+\d+\s*(?:min|mins|minuto|minutos|h|hr|hrs|hora|horas)\b/gi, ' ')
    .replace(/\b(?:me\s+)?(?:lembra(?:r)?|lembrete)(?:\s+de)?\b/gi, ' ')
    .replace(/[.,;!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, 120) || 'Lembrete via WhatsApp';
}

function buildFallbackRelativeReminderAction(text: string | undefined): AIActionAddReminder | null {
  if (!text) return null;

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const mentionsReminderIntent =
    /\b(lembra|lembrar|lembrete|lembre)\b/.test(normalized);

  if (!mentionsReminderIntent) return null;

  const schedule = parseRelativeReminderDateTime(text);
  if (!schedule) return null;

  return {
    action: 'add_reminder',
    title: extractFallbackReminderTitle(text),
    reminderKind: 'general',
    dueDate: schedule.dueDate,
    dueTime: schedule.dueTime
  };
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
    credit: 'Cartão de crédito',
    debit: 'Cartão de débito',
    cash: 'Dinheiro',
    transfer: 'Transferência',
    boleto: 'Boleto'
  };
  return labels[value] ?? value;
}

function frequencyLabel(freq: 'weekly' | 'monthly' | 'yearly'): string {
  const labels = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
  return labels[freq] ?? freq;
}

function reminderTypeLabel(value: 'payable' | 'receivable'): string {
  return value === 'payable' ? 'A pagar' : 'A receber';
}

function reminderKindLabel(value: 'general' | 'payable' | 'receivable'): string {
  if (value === 'general') return 'Lembrete';
  return reminderTypeLabel(value);
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

function buildEditDeleteHint(transactionCodes: string[]): string {
  const uniqueCodes = [...new Set(transactionCodes.filter((code) => code.trim().length > 0))];

  if (uniqueCodes.length === 1) {
    const code = uniqueCodes[0];
    return `Se quiser excluir, digite "excluir ${code}". Se quiser editar, me diga o que deseja alterar na transação ${code}.`;
  }

  return 'Se quiser excluir, digite "excluir" e informe o código da transação. Se quiser editar, me diga o que deseja alterar em cada transação.';
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
    `Código: ${receipt.transactionCode}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  lines.push('', buildEditDeleteHint([receipt.transactionCode]));
  return lines.join('\n');
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    amount: 'Valor',
    description: 'Descrição',
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

function buildDeletedTransactionMessage(
  receipt: DeletedTransactionReceipt,
  aiReply: string
): string {
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
    `Frequência: ${frequencyLabel(receipt.frequency)} | Início: ${formatDateBRFromYmd(receipt.startDate)}`
  ];

  const cleanAiReply = aiReply.trim();
  if (cleanAiReply.length > 0) {
    lines.push('', cleanAiReply);
  }

  lines.push('', 'Para editar, me diga o que você quer alterar na recorrência. Para excluir, digite "excluir recorrente".');
  return lines.join('\n');
}

function buildAddedReminderMessage(
  receipt: AddedReminderReceipt,
  aiReply: string,
  currency: string
): string {
  const dueLabel = receipt.dueTime
    ? `${formatDateBRFromYmd(receipt.dueDate)} ${receipt.dueTime}`
    : formatDateBRFromYmd(receipt.dueDate);
  const lines = [
    `⏰ *Lembrete criado*`,
    '',
    `*${receipt.title}*`,
    `Tipo: ${reminderKindLabel(receipt.reminderKind)}`,
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

  lines.push(
    '',
    receipt.dueTime
      ? (receipt.reminderKind === 'general'
        ? 'Vou te lembrar no WhatsApp exatamente nesse horario. Se quiser, tambem posso ajustar texto, data ou horario.'
        : 'Vou te lembrar no WhatsApp exatamente nesse horario com esse valor. Se quiser, posso ajustar valor, data, horario ou descricao.')
      : (receipt.reminderKind === 'general'
        ? 'Como nao foi definido um horario, o lembrete fica registrado para essa data. Se quiser, posso adicionar horario, alterar o texto ou mudar a data.'
        : 'Como nao foi definido um horario, o lembrete financeiro fica registrado para essa data. Se quiser, posso adicionar horario, ajustar o valor ou alterar a descricao.')
  );
  return lines.join('\n');
}

function buildReminderDetailLine(
  receipt: Pick<UpdatedReminderReceipt, 'reminderKind' | 'amount' | 'dueDate' | 'dueTime'>,
  currency: string
): string {
  const dueLabel = receipt.dueTime
    ? `${formatDateBRFromYmd(receipt.dueDate)} ${receipt.dueTime}`
    : formatDateBRFromYmd(receipt.dueDate);
  if (receipt.reminderKind === 'general') {
    return `Vencimento: ${dueLabel}`;
  }
  return `${reminderKindLabel(receipt.reminderKind)} | ${formatCurrency(receipt.amount ?? 0, currency)} | ${dueLabel}`;
}

function buildUpdatedReminderMessage(
  receipt: UpdatedReminderReceipt,
  aiReply: string,
  currency: string
): string {
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

function buildCompletedReminderMessage(
  receipt: UpdatedReminderReceipt,
  aiReply: string
): string {
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

function buildDeletedReminderMessage(
  receipt: DeletedReminderReceipt,
  aiReply: string
): string {
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

function buildMultiActionMessage(
  results: ActionExecutionResult[],
  aiReply: string,
  currency: string
): string {
  const lines: string[] = ['✅ *Ações processadas:*', ''];
  const transactionCodes: string[] = [];
  let hasReminderActions = false;

  for (const result of results) {
    if (result.kind === 'added') {
      transactionCodes.push(result.receipt.transactionCode);
      lines.push(
        `- ${transactionTypeLabel(result.receipt.type)}: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (Código: ${result.receipt.transactionCode})`
      );
      continue;
    }

    if (result.kind === 'added_recurring') {
      lines.push(
        `- ${transactionTypeLabel(result.receipt.type)} recorrente: ${formatCurrency(result.receipt.amount, currency)} - ${result.receipt.description} (${frequencyLabel(result.receipt.frequency)})`
      );
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
      lines.push(
        `- Lembrete: ${reminderSummary}`
      );
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
      lines.push(
        `- Transação atualizada (Código: ${result.receipt.transactionCode}) - Campos: ${result.receipt.changedFields.map(fieldLabel).join(', ')}`
      );
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
  } else if (hasReminderActions) {
    lines.push('', 'Se quiser, posso concluir, reabrir, editar ou excluir outros lembretes.');
  }
  return lines.join('\n');
}

export interface ProcessWhatsAppAIOptions {
  isFirstMessage?: boolean;
  isGreeting?: boolean;
  isCapabilitiesQuestion?: boolean;
  isConversationRestart?: boolean;
  shouldSendCapabilitiesSummary?: boolean;
  sourcePhone?: string;
  latestUserMessageText?: string;
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
  const latestUserMessageText =
    [...sanitizedMessages].reverse().find((message) => message.role === 'user')?.content ?? '';

  if (sanitizedMessages.length === 0) {
    return 'Nao consegui interpretar a mensagem recebida.';
  }

  // Use cached context if available (TTL 2 min), otherwise fetch from Firestore
  const cached = getCachedContext(uid);
  let categories: UserCategory[];
  let recentTransactions: UserTransaction[];
  let recentReminders: UserReminder[];
  let settings: UserSettingsBackend;
  let profile: UserProfileBackend;

  if (cached) {
    logger.info('Using cached financial context', { uid });
    ({ categories, recentTransactions, recentReminders, settings, profile } = cached);
  } else {
    [categories, recentTransactions, recentReminders, settings, profile] = await Promise.all([
      getUserCategories(uid),
      getRecentTransactions(uid, env.whatsappAiRecentTransactions),
      getUserReminders(uid),
      getUserSettings(uid),
      getUserProfile(uid)
    ]);
    setCachedContext(uid, { categories, recentTransactions, recentReminders, settings, profile });

    // Generate overdue recurring transactions when context is freshly loaded
    try {
      const generatedCount = await generateOverdueRecurringTransactions(uid);
      if (generatedCount > 0) {
        logger.info('Generated overdue recurring transactions', { uid, count: generatedCount });
        recentTransactions = await getRecentTransactions(uid, env.whatsappAiRecentTransactions);
        setCachedContext(uid, { categories, recentTransactions, recentReminders, settings, profile });
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
    recentReminders,
    isFirstMessage: Boolean(options.isFirstMessage),
    isGreeting: Boolean(options.isGreeting),
    isCapabilitiesQuestion: Boolean(options.isCapabilitiesQuestion),
    isConversationRestart: Boolean(options.isConversationRestart),
    shouldSendCapabilitiesSummary: Boolean(options.shouldSendCapabilitiesSummary)
  };

  const ai = await queryGroqAssistant(sanitizedMessages, context);
  const actionResults = await executeActions(uid, ai.actionObjects, categories, {
    ...options,
    latestUserMessageText
  });
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

    if (actionResult.kind === 'added_reminder') {
      return buildAddedReminderMessage(actionResult.receipt, ai.reply, settings.currency)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'updated_reminder') {
      return buildUpdatedReminderMessage(actionResult.receipt, ai.reply, settings.currency)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'completed_reminder') {
      return buildCompletedReminderMessage(actionResult.receipt, ai.reply)
        .slice(0, env.maxMessageLength);
    }

    if (actionResult.kind === 'deleted_reminder') {
      return buildDeletedReminderMessage(actionResult.receipt, ai.reply)
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
  categories: UserCategory[],
  options: ProcessWhatsAppAIOptions
): Promise<ActionExecutionResult[]> {
  const baseActions = Array.isArray(actions) && actions.length > 0
    ? actions.slice(0, MAX_ACTIONS_PER_MESSAGE)
    : [{ action: 'none' as const }];
  const fallbackReminderAction =
    baseActions.every((action) => action.action === 'none')
      ? buildFallbackRelativeReminderAction(options.latestUserMessageText)
      : null;
  const safeActions = fallbackReminderAction
    ? [fallbackReminderAction]
    : baseActions;

  const results: ActionExecutionResult[] = [];
  for (const action of safeActions) {
    const result = await executeAction(uid, action, categories, options);
    results.push(result);
  }
  return results;
}

async function executeAction(
  uid: string,
  action: AIAction,
  categories: UserCategory[],
  options: ProcessWhatsAppAIOptions
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

    if (action.action === 'add_reminder') {
      const reminderKind = action.reminderKind ?? action.reminderType ?? 'general';
      const isFinancial = reminderKind === 'payable' || reminderKind === 'receivable';
      const normalizedAmount = typeof action.amount === 'number' ? Number(action.amount) : Number.NaN;
      if (isFinancial && (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0)) {
        return { kind: 'none' };
      }
      const relativeSchedule = parseRelativeReminderDateTime(options.latestUserMessageText);
      const explicitDueDate = parseYmd(action.dueDate);
      const explicitDueTime = normalizeDueTime(action.dueTime);

      const payload: CreateReminderInput = {
        reminderKind,
        title: (action.title || 'Lembrete via WhatsApp').toString().slice(0, 120),
        amount: isFinancial ? normalizedAmount : null,
        dueDate: explicitDueDate ?? relativeSchedule?.dueDate ?? todayISO(),
        dueTime: explicitDueTime ?? relativeSchedule?.dueTime ?? null,
        type: isFinancial ? reminderKind : null,
        status: 'pending',
        notifyPhone: options.sourcePhone ?? null
      };

      const reminderId = await addUserReminder(uid, payload);
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
      const updates: Partial<Omit<UserReminder, 'id' | 'createdAt'>> = {};
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
      } else if (rawChanges.reminderType === 'payable' || rawChanges.reminderType === 'receivable') {
        updates.reminderKind = rawChanges.reminderType;
        updates.type = rawChanges.reminderType;
      } else if (rawChanges.reminderType === null) {
        updates.type = null;
      }
      if ('amount' in rawChanges) {
        if (rawChanges.amount == null) {
          updates.amount = null;
        } else {
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

      await updateUserReminder(uid, action.id, updates);
      invalidateContextCache(uid);
      const updated = await getUserReminderById(uid, action.id);
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

      await updateUserReminder(uid, action.id, { status: 'paid' });
      invalidateContextCache(uid);
      const updated = await getUserReminderById(uid, action.id);
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

      const existing = await getUserReminderById(uid, action.id);
      if (!existing) {
        return { kind: 'none' };
      }

      await deleteUserReminder(uid, action.id);
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
  } catch (error) {
    logger.error('Failed executing AI financial action', error);
    return { kind: 'error', message: 'Ocorreu um erro ao salvar a acao solicitada.' };
  }

  return { kind: 'none' };
}
