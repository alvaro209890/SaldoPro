import { randomUUID } from 'node:crypto';
import { db, nowIso, parseJsonArray, parseJsonObject, stringifyJson } from './local-db';
import { logger } from './logger';
import { publishUserDataChange } from './realtime';
import type { WhatsAppMessageRecord, WhatsAppSlotId } from '../types/whatsapp';
import { brazilianPhoneVariants, normalizePhoneNumber } from '../whatsapp/events';

const GLOBAL_CATEGORIES_UID = '__global__';

export class DuplicateCategoryError extends Error {
  constructor(message = 'Categoria ja existe.') {
    super(message);
    this.name = 'DuplicateCategoryError';
  }
}

export class DuplicateUserEmailError extends Error {
  constructor(message = 'Este email ja esta vinculado a outra conta.') {
    super(message);
    this.name = 'DuplicateUserEmailError';
  }
}

export interface UserCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
  createdAt?: string;
}

export interface UserTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  monthKey: string;
  category: string;
  description: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WhatsAppPhoneBinding {
  phone: string;
  uid: string;
  linkedAt: string;
  updatedAt: string;
}

export interface CreateTransactionInput {
  type: 'income' | 'expense';
  amount: number;
  date: string;
  category: string;
  description: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
}

export interface CreateReminderInput {
  reminderKind?: 'general' | 'payable' | 'receivable';
  title: string;
  amount?: number | null;
  dueDate: string;
  dueTime?: string | null;
  type?: 'payable' | 'receivable' | null;
  status?: 'pending' | 'paid';
  notifyPhone?: string | null;
}

export interface UserSettingsBackend {
  budget: number;
  startDay: number;
  currency: string;
  whatsappAllowedNumbers?: string[];
  updatedAt?: string;
}

export interface UserProfileBackend {
  displayName: string;
}

export interface AdminUserMetrics {
  transactions: number;
  reminders: number;
  categories: number;
  whatsappMessages: number;
  lastWhatsAppMessageAt: string | null;
}

export interface AdminUserSettingsSnapshot {
  budget: number;
  startDay: number;
  currency: string;
  whatsappAllowedNumbers: string[];
  updatedAt: string | null;
}

export interface AdminUserSnapshot {
  uid: string;
  email: string | null;
  displayName: string;
  createdAt: string | null;
  settings: AdminUserSettingsSnapshot | null;
  metrics: AdminUserMetrics;
}

export interface LocalUserAccessSnapshot {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string | null;
}

export interface BootstrapUserInput {
  email: string;
  displayName: string;
  phone: string;
}

export interface BootstrapUserResult {
  isNewUser: boolean;
  normalizedPhone: string | null;
}

export interface EnsureLocalUserInput {
  email?: string | null;
  displayName?: string | null;
}

export interface UserChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageUrl?: string;
  createdAt: string;
}

export interface UserReminder {
  id: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime?: string | null;
  dueAt?: string | null;
  notifiedAt?: string | null;
  notifyPhone?: string | null;
  type?: 'payable' | 'receivable' | null;
  status: 'pending' | 'paid';
  createdAt: string;
  updatedAt: string;
}

export interface UserDocument {
  id: string;
  uid: string;
  source: string;
  title: string;
  description?: string | null;
  normalizedTitle: string;
  normalizedDescription?: string | null;
  searchTokens: string[];
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  status: 'ready' | 'deleted';
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
}

export interface PendingWhatsAppDocumentDraft {
  id: string;
  uid: string;
  sourcePhone: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  pendingReason: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateUserDocumentInput {
  id?: string;
  source?: string;
  title: string;
  description?: string | null;
  normalizedTitle: string;
  normalizedDescription?: string | null;
  searchTokens?: string[];
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  status?: 'ready' | 'deleted';
}

export interface UpdateUserDocumentInput {
  title?: string;
  description?: string | null;
  normalizedTitle?: string;
  normalizedDescription?: string | null;
  searchTokens?: string[];
  storagePath?: string;
  status?: 'ready' | 'deleted';
}

export interface CreatePendingWhatsAppDocumentDraftInput {
  id: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  pendingReason?: string;
}

export interface DueWhatsAppReminder {
  id: string;
  uid: string;
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime: string | null;
  notifyPhone: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  type: 'payable' | 'receivable' | null;
}

export interface CreateRecurringTransactionInput {
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  frequency: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  endDate?: string | null;
}

export interface UserRecurringTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  frequency: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  endDate: string | null;
  nextDueDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppAuthSnapshotFile {
  filename: string;
  contentBase64: string;
}

export interface UserFinancialProfile {
  monthlyIncome: number;
  fixedExpenses: number;
  variableExpenses: number;
  savingsTargetPct: number;
  financialGoalsText: string | null;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFinancialProfileInput {
  monthlyIncome: number;
  fixedExpenses: number;
  variableExpenses: number;
  savingsTargetPct: number;
  financialGoalsText: string | null;
}

export interface UserGoal {
  id: string;
  title: string;
  description: string | null;
  targetAmount: number | null;
  currentAmount: number;
  deadline: string | null;
  source: 'ai' | 'manual';
  status: 'active' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  targetAmount?: number | null;
  currentAmount?: number;
  deadline?: string | null;
  source: 'ai' | 'manual';
  priority?: 'low' | 'medium' | 'high';
  status?: 'active' | 'completed' | 'cancelled';
}

type SqlRow = Record<string, unknown>;

const DEFAULT_EXPENSE_CATEGORIES: Omit<UserCategory, 'id'>[] = [
  { name: 'Alimentacao', type: 'expense', color: '#f97316', icon: 'UtensilsCrossed' },
  { name: 'Combustivel', type: 'expense', color: '#eab308', icon: 'Fuel' },
  { name: 'Moradia', type: 'expense', color: '#8b5cf6', icon: 'Home' },
  { name: 'Internet', type: 'expense', color: '#06b6d4', icon: 'Wifi' },
  { name: 'Lazer', type: 'expense', color: '#ec4899', icon: 'Gamepad2' },
  { name: 'Saude', type: 'expense', color: '#10b981', icon: 'Heart' },
  { name: 'Transporte', type: 'expense', color: '#3b82f6', icon: 'Car' },
  { name: 'Educacao', type: 'expense', color: '#a855f7', icon: 'GraduationCap' },
  { name: 'Outros', type: 'expense', color: '#6b7280', icon: 'MoreHorizontal' }
];

const DEFAULT_INCOME_CATEGORIES: Omit<UserCategory, 'id'>[] = [
  { name: 'Salario', type: 'income', color: '#10b981', icon: 'Briefcase' },
  { name: 'Freela', type: 'income', color: '#06b6d4', icon: 'Laptop' },
  { name: 'Vendas', type: 'income', color: '#f97316', icon: 'ShoppingBag' },
  { name: 'Investimentos', type: 'income', color: '#8b5cf6', icon: 'TrendingUp' },
  { name: 'Outros', type: 'income', color: '#6b7280', icon: 'MoreHorizontal' }
];

const DEFAULT_GLOBAL_CATEGORIES: Omit<UserCategory, 'id'>[] = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES
];

const allowedNumbersCache = new Map<string, { numbers: string[]; cachedAt: number }>();
const bindingCache = new Map<string, { binding: WhatsAppPhoneBinding | null; cachedAt: number }>();
const lastActivityCache = new Map<string, { value: string | null; cachedAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

function cacheValid(cachedAt: number): boolean {
  return Date.now() - cachedAt <= CACHE_TTL_MS;
}

function normalizeNameForKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function monthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

function normalizeDueTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function reminderDueAtFromDateAndTime(dueDate: string, dueTime: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const normalizedTime = normalizeDueTime(dueTime);
  if (!normalizedTime) return null;
  const parsed = new Date(`${dueDate}T${normalizedTime}:00-03:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeReminderKind(
  reminderKind: unknown,
  reminderType: unknown
): 'general' | 'payable' | 'receivable' {
  if (reminderKind === 'general' || reminderKind === 'payable' || reminderKind === 'receivable') {
    return reminderKind;
  }
  if (reminderType === 'payable' || reminderType === 'receivable') {
    return reminderType;
  }
  return 'general';
}

function mapCategoryRow(row: SqlRow): UserCategory {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type === 'income' ? 'income' : 'expense',
    color: String(row.color),
    icon: String(row.icon),
    createdAt: String(row.created_at ?? '')
  };
}

function mapTransactionRow(row: SqlRow): UserTransaction {
  return {
    id: String(row.id),
    type: row.type === 'income' ? 'income' : 'expense',
    amount: toNumber(row.amount),
    date: String(row.date),
    monthKey: String(row.month_key),
    category: String(row.category),
    description: String(row.description),
    paymentMethod: row.payment_method as UserTransaction['paymentMethod'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapReminderRow(row: SqlRow): UserReminder {
  return {
    id: String(row.id),
    reminderKind: normalizeReminderKind(row.reminder_kind, row.type),
    title: String(row.title),
    amount: row.amount == null ? null : toNumber(row.amount),
    dueDate: String(row.due_date),
    dueTime: typeof row.due_time === 'string' ? row.due_time : null,
    dueAt: typeof row.due_at === 'string' ? row.due_at : null,
    notifiedAt: typeof row.notified_at === 'string' ? row.notified_at : null,
    notifyPhone: typeof row.notify_phone === 'string' ? row.notify_phone : null,
    type: row.type === 'payable' || row.type === 'receivable' ? row.type : null,
    status: row.status === 'paid' ? 'paid' : 'pending',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRecurringRow(row: SqlRow): UserRecurringTransaction {
  return {
    id: String(row.id),
    type: row.type === 'income' ? 'income' : 'expense',
    amount: toNumber(row.amount),
    category: String(row.category),
    description: String(row.description),
    paymentMethod: row.payment_method as UserRecurringTransaction['paymentMethod'],
    frequency: row.frequency as UserRecurringTransaction['frequency'],
    startDate: String(row.start_date),
    endDate: typeof row.end_date === 'string' ? row.end_date : null,
    nextDueDate: String(row.next_due_date),
    active: toBoolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapChatSessionRow(row: SqlRow): UserChatSession {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapChatMessageRow(row: SqlRow): UserChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as UserChatMessage['role'],
    content: String(row.content),
    ...(typeof row.image_url === 'string' ? { imageUrl: row.image_url } : {}),
    createdAt: String(row.created_at)
  };
}

function mapDocumentRow(row: SqlRow): UserDocument {
  return {
    id: String(row.id),
    uid: String(row.uid),
    source: String(row.source),
    title: String(row.title),
    description: typeof row.description === 'string' ? row.description : null,
    normalizedTitle: String(row.normalized_title),
    normalizedDescription: typeof row.normalized_description === 'string' ? row.normalized_description : null,
    searchTokens: parseJsonArray(row.search_tokens),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    sizeBytes: toNumber(row.size_bytes),
    status: row.status === 'deleted' ? 'deleted' : 'ready',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAccessedAt: typeof row.last_accessed_at === 'string' ? row.last_accessed_at : null
  };
}

function mapPendingDocumentRow(row: SqlRow): PendingWhatsAppDocumentDraft {
  return {
    id: String(row.id),
    uid: String(row.uid),
    sourcePhone: String(row.source_phone),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    sizeBytes: toNumber(row.size_bytes),
    pendingReason: String(row.pending_reason),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at)
  };
}

function mapGoalRow(row: SqlRow): UserGoal {
  return {
    id: String(row.id),
    title: String(row.title),
    description: typeof row.description === 'string' ? row.description : null,
    targetAmount: row.target_amount == null ? null : toNumber(row.target_amount),
    currentAmount: toNumber(row.current_amount),
    deadline: typeof row.deadline === 'string' ? row.deadline : null,
    source: row.source === 'ai' ? 'ai' : 'manual',
    status: row.status === 'completed' || row.status === 'cancelled' ? row.status : 'active',
    priority: row.priority === 'low' || row.priority === 'high' ? row.priority : 'medium',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapUserSettingsRow(row: SqlRow | undefined): UserSettingsBackend {
  if (!row) {
    return {
      budget: 0,
      startDay: 1,
      currency: 'BRL',
      whatsappAllowedNumbers: [],
      updatedAt: nowIso()
    };
  }

  return {
    budget: toNumber(row.budget),
    startDay: toNumber(row.start_day) || 1,
    currency: typeof row.currency === 'string' ? row.currency : 'BRL',
    whatsappAllowedNumbers: parseJsonArray(row.whatsapp_allowed_numbers),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : nowIso()
  };
}

function normalizeStoredPhoneList(value: unknown): string[] {
  const source = parseJsonArray(value);
  const unique = new Set<string>();
  for (const item of source) {
    const normalized = normalizePhoneNumber(item);
    if (normalized.length >= 10) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function seedDefaultCategories(uid: string): void {
  const insert = db.prepare(`
    insert or ignore into app_categories (
      id, uid, name, normalized_name, type, color, icon, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = nowIso();
  for (const category of DEFAULT_GLOBAL_CATEGORIES) {
    insert.run(
      randomUUID(),
      uid,
      category.name,
      normalizeNameForKey(category.name),
      category.type,
      category.color,
      category.icon,
      now
    );
  }
}

function ensureUserRecord(uid: string, email: string, displayName: string): void {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail) {
    const conflict = db.prepare(`
      select uid
      from app_users
      where lower(email) = ?
        and uid <> ?
      limit 1
    `).get(normalizedEmail, uid) as SqlRow | undefined;

    if (conflict) {
      throw new DuplicateUserEmailError();
    }
  }

  const now = nowIso();
  db.prepare(`
    insert into app_users (uid, email, display_name, created_at)
    values (?, ?, ?, ?)
    on conflict(uid) do update set
      email = excluded.email,
      display_name = excluded.display_name
  `).run(uid, normalizedEmail || null, displayName, now);
}

function ensureUserSettings(uid: string, allowedNumbers: string[]): void {
  const now = nowIso();
  const existing = db.prepare('select whatsapp_allowed_numbers from app_user_settings where uid = ?').get(uid) as SqlRow | undefined;
  const mergedNumbers = new Set<string>([
    ...normalizeStoredPhoneList(existing?.whatsapp_allowed_numbers),
    ...allowedNumbers
  ]);

  db.prepare(`
    insert into app_user_settings (uid, budget, start_day, currency, whatsapp_allowed_numbers, updated_at)
    values (?, 0, 1, 'BRL', ?, ?)
    on conflict(uid) do update set
      whatsapp_allowed_numbers = excluded.whatsapp_allowed_numbers,
      updated_at = excluded.updated_at
  `).run(uid, stringifyJson([...mergedNumbers]), now);

  invalidateAllowedNumbersCacheForUid(uid);
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + amount);
  return parsed.toISOString().slice(0, 10);
}

function nextRecurringDate(date: string, frequency: UserRecurringTransaction['frequency']): string {
  switch (frequency) {
    case 'weekly':
      return addDays(date, 7);
    case 'yearly':
      return addMonths(date, 12);
    case 'monthly':
    default:
      return addMonths(date, 1);
  }
}

function getDocId(record: WhatsAppMessageRecord): string {
  const prefix =
    record.direction === 'inbound'
      ? 'in'
      : record.direction === 'outbound'
        ? 'out'
        : 'ar';
  const safeMessageId = record.messageId.replace(/[^\w.-]/g, '_');
  return `${record.clientId}_${prefix}_${safeMessageId}`;
}

function authStateDocId(slotId: WhatsAppSlotId): string {
  return `authState_${slotId}`;
}

function authFileDocId(filename: string): string {
  return Buffer.from(filename, 'utf8').toString('base64url');
}

export async function saveWhatsAppMessage(record: WhatsAppMessageRecord): Promise<void> {
  db.prepare(`
    insert into whatsapp_messages (
      id, client_id, message_id, direction, owner_uid, from_phone, to_phone,
      text, timestamp, wa_timestamp, status, raw_type, created_at, metadata
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      status = excluded.status,
      text = excluded.text,
      metadata = excluded.metadata,
      owner_uid = excluded.owner_uid
  `).run(
    getDocId(record),
    record.clientId,
    record.messageId,
    record.direction,
    record.ownerUid ?? null,
    record.from,
    record.to,
    record.text,
    record.timestamp,
    record.waTimestamp,
    record.status,
    record.rawType,
    record.createdAt,
    stringifyJson(record.metadata)
  );
}

export async function inboundMessageExists(
  messageId: string,
  clientId: string,
  _processedInboundIds?: Set<string>
): Promise<boolean> {
  const safeMessageId = messageId.replace(/[^\w.-]/g, '_');
  const id = `${clientId}_in_${safeMessageId}`;
  const row = db.prepare('select id from whatsapp_messages where id = ? limit 1').get(id) as SqlRow | undefined;
  return Boolean(row);
}

export async function saveMessageSafe(record: WhatsAppMessageRecord): Promise<void> {
  const exists = record.direction === 'inbound'
    ? await inboundMessageExists(record.messageId, record.clientId)
    : false;
  if (exists) return;
  await saveWhatsAppMessage(record);
}

export async function bootstrapUserData(uid: string, input: BootstrapUserInput): Promise<BootstrapUserResult> {
  const normalizedPhone = normalizePhoneNumber(input.phone);
  const existing = db.prepare('select uid from app_users where uid = ? limit 1').get(uid) as SqlRow | undefined;

  ensureUserRecord(uid, input.email, input.displayName);
  ensureUserSettings(uid, normalizedPhone.length >= 10 ? [normalizedPhone] : []);

  const categoryCount = db.prepare('select count(*) as total from app_categories where uid = ?').get(uid) as { total: number };
  if (Number(categoryCount.total ?? 0) === 0) {
    seedDefaultCategories(uid);
  }

  if (normalizedPhone.length >= 10) {
    await savePhoneBinding(normalizedPhone, uid);
  }

  publishUserDataChange(uid, 'settings');
  publishUserDataChange(uid, 'categories');

  return {
    isNewUser: !existing,
    normalizedPhone: normalizedPhone.length >= 10 ? normalizedPhone : null
  };
}

export async function ensureLocalUserData(uid: string, input: EnsureLocalUserInput): Promise<void> {
  const existing = await getLocalUserAccessSnapshot(uid);
  const displayName =
    input.displayName?.trim() ||
    existing?.displayName?.trim() ||
    input.email?.split('@')[0]?.trim() ||
    'Usuario';

  ensureUserRecord(uid, input.email ?? existing?.email ?? '', displayName);
  ensureUserSettings(uid, []);

  const categoryCount = db.prepare('select count(*) as total from app_categories where uid = ?').get(uid) as { total: number };
  let seededCategories = false;
  if (Number(categoryCount.total ?? 0) === 0) {
    seedDefaultCategories(uid);
    seededCategories = true;
  }

  if (!existing) {
    publishUserDataChange(uid, 'settings');
  }
  if (seededCategories) {
    publishUserDataChange(uid, 'categories');
  }
}

export async function getUserSettings(uid: string): Promise<UserSettingsBackend> {
  const row = db.prepare('select * from app_user_settings where uid = ? limit 1').get(uid) as SqlRow | undefined;
  return mapUserSettingsRow(row);
}

export async function updateUserSettings(
  uid: string,
  input: Partial<UserSettingsBackend>
): Promise<void> {
  const current = await getUserSettings(uid);
  const merged = {
    budget: typeof input.budget === 'number' ? input.budget : current.budget,
    startDay: typeof input.startDay === 'number' ? input.startDay : current.startDay,
    currency: typeof input.currency === 'string' ? input.currency : current.currency,
    whatsappAllowedNumbers: Array.isArray(input.whatsappAllowedNumbers)
      ? input.whatsappAllowedNumbers.map((value) => normalizePhoneNumber(value)).filter((value) => value.length >= 10)
      : current.whatsappAllowedNumbers ?? []
  };

  db.prepare(`
    insert into app_user_settings (uid, budget, start_day, currency, whatsapp_allowed_numbers, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(uid) do update set
      budget = excluded.budget,
      start_day = excluded.start_day,
      currency = excluded.currency,
      whatsapp_allowed_numbers = excluded.whatsapp_allowed_numbers,
      updated_at = excluded.updated_at
  `).run(uid, merged.budget, merged.startDay, merged.currency, stringifyJson(merged.whatsappAllowedNumbers), nowIso());

  invalidateAllowedNumbersCacheForUid(uid);
  publishUserDataChange(uid, 'settings');
}

export async function getUserProfile(uid: string): Promise<UserProfileBackend> {
  const row = db.prepare('select display_name from app_users where uid = ? limit 1').get(uid) as SqlRow | undefined;
  return {
    displayName: typeof row?.display_name === 'string' ? row.display_name : ''
  };
}

export async function updateUserDisplayName(uid: string, displayName: string): Promise<void> {
  db.prepare('update app_users set display_name = ? where uid = ?').run(displayName.trim(), uid);
  publishUserDataChange(uid, 'profile');
}

function getUserMetrics(uid: string): AdminUserMetrics {
  const tx = db.prepare('select count(*) as total from app_transactions where uid = ?').get(uid) as { total: number };
  const reminders = db.prepare('select count(*) as total from app_reminders where uid = ?').get(uid) as { total: number };
  const categories = db.prepare('select count(*) as total from app_categories where uid = ?').get(uid) as { total: number };
  const whatsapp = db.prepare('select count(*) as total, max(created_at) as lastAt from whatsapp_messages where owner_uid = ?').get(uid) as {
    total: number;
    lastAt: string | null;
  };

  return {
    transactions: Number(tx.total ?? 0),
    reminders: Number(reminders.total ?? 0),
    categories: Number(categories.total ?? 0),
    whatsappMessages: Number(whatsapp.total ?? 0),
    lastWhatsAppMessageAt: whatsapp.lastAt ?? null
  };
}

export async function listAdminUserSnapshots(): Promise<AdminUserSnapshot[]> {
  const rows = db.prepare(`
    select u.uid, u.email, u.display_name, u.created_at,
           s.budget, s.start_day, s.currency, s.whatsapp_allowed_numbers, s.updated_at as settings_updated_at
    from app_users u
    left join app_user_settings s on s.uid = u.uid
    order by u.created_at desc
  `).all() as SqlRow[];

  return rows.map((row) => ({
    uid: String(row.uid),
    email: typeof row.email === 'string' ? row.email : null,
    displayName: String(row.display_name ?? ''),
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    settings: row.budget == null
      ? null
      : {
          budget: toNumber(row.budget),
          startDay: toNumber(row.start_day) || 1,
          currency: typeof row.currency === 'string' ? row.currency : 'BRL',
          whatsappAllowedNumbers: normalizeStoredPhoneList(row.whatsapp_allowed_numbers),
          updatedAt: typeof row.settings_updated_at === 'string' ? row.settings_updated_at : null
        },
    metrics: getUserMetrics(String(row.uid))
  }));
}

export async function getAdminUserSnapshot(uid: string): Promise<AdminUserSnapshot | null> {
  const snapshots = await listAdminUserSnapshots();
  return snapshots.find((item) => item.uid === uid) ?? null;
}

export async function getLocalUserAccessSnapshot(uid: string): Promise<LocalUserAccessSnapshot | null> {
  const row = db.prepare(`
    select uid, email, display_name, created_at
    from app_users
    where uid = ?
    limit 1
  `).get(uid) as SqlRow | undefined;

  if (!row) {
    return null;
  }

  return {
    uid: String(row.uid),
    email: typeof row.email === 'string' ? row.email : null,
    displayName: typeof row.display_name === 'string' ? row.display_name : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null
  };
}

export async function listLocalUserAccessSnapshots(): Promise<LocalUserAccessSnapshot[]> {
  const rows = db.prepare(`
    select uid, email, display_name, created_at
    from app_users
    order by created_at desc
  `).all() as SqlRow[];

  return rows.map((row) => ({
    uid: String(row.uid),
    email: typeof row.email === 'string' ? row.email : null,
    displayName: typeof row.display_name === 'string' ? row.display_name : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null
  }));
}

export async function getUserCategories(uid: string): Promise<UserCategory[]> {
  let rows = db.prepare(`
    select * from app_categories
    where uid = ?
    order by type asc, name asc
  `).all(uid) as SqlRow[];

  if (rows.length === 0) {
    seedDefaultCategories(uid);
    rows = db.prepare(`
      select * from app_categories
      where uid = ?
      order by type asc, name asc
    `).all(uid) as SqlRow[];
  }

  return rows.map(mapCategoryRow);
}

export async function addUserCategory(uid: string, input: Omit<UserCategory, 'id'>): Promise<string> {
  const normalizedName = normalizeNameForKey(input.name);
  const existing = db.prepare(`
    select id from app_categories where uid = ? and type = ? and normalized_name = ? limit 1
  `).get(uid, input.type, normalizedName) as SqlRow | undefined;
  if (existing) {
    throw new DuplicateCategoryError();
  }

  const id = randomUUID();
  db.prepare(`
    insert into app_categories (id, uid, name, normalized_name, type, color, icon, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, input.name.trim(), normalizedName, input.type, input.color, input.icon, nowIso());
  publishUserDataChange(uid, 'categories');
  return id;
}

export async function updateUserCategory(
  uid: string,
  categoryId: string,
  input: Partial<Omit<UserCategory, 'id'>>
): Promise<void> {
  const current = db.prepare('select * from app_categories where uid = ? and id = ? limit 1').get(uid, categoryId) as SqlRow | undefined;
  if (!current) {
    return;
  }

  const name = typeof input.name === 'string' ? input.name.trim() : String(current.name);
  const type = input.type ?? (current.type as UserCategory['type']);
  const normalizedName = normalizeNameForKey(name);
  const duplicate = db.prepare(`
    select id from app_categories where uid = ? and type = ? and normalized_name = ? and id <> ? limit 1
  `).get(uid, type, normalizedName, categoryId) as SqlRow | undefined;
  if (duplicate) {
    throw new DuplicateCategoryError();
  }

  db.prepare(`
    update app_categories
    set name = ?, normalized_name = ?, type = ?, color = ?, icon = ?
    where uid = ? and id = ?
  `).run(
    name,
    normalizedName,
    type,
    typeof input.color === 'string' ? input.color : String(current.color),
    typeof input.icon === 'string' ? input.icon : String(current.icon),
    uid,
    categoryId
  );
  publishUserDataChange(uid, 'categories');
}

export async function deleteUserCategory(uid: string, categoryId: string): Promise<void> {
  db.prepare('delete from app_categories where uid = ? and id = ?').run(uid, categoryId);
  publishUserDataChange(uid, 'categories');
}

export async function getRecentTransactions(uid: string, limitCount = 50): Promise<UserTransaction[]> {
  const rows = db.prepare(`
    select * from app_transactions where uid = ? order by date desc, created_at desc limit ?
  `).all(uid, limitCount) as SqlRow[];
  return rows.map(mapTransactionRow);
}

export async function getTransactionsByMonth(uid: string, monthKey: string): Promise<UserTransaction[]> {
  const rows = db.prepare(`
    select * from app_transactions
    where uid = ? and month_key = ?
    order by date desc, created_at desc
  `).all(uid, monthKey) as SqlRow[];
  return rows.map(mapTransactionRow);
}

export async function addUserTransaction(uid: string, input: CreateTransactionInput): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_transactions (
      id, uid, type, amount, date, month_key, category, description, payment_method, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    uid,
    input.type,
    input.amount,
    input.date,
    monthKeyFromDate(input.date),
    input.category,
    input.description,
    input.paymentMethod,
    now,
    now
  );
  publishUserDataChange(uid, 'transactions');
  return id;
}

export async function updateUserTransaction(
  uid: string,
  transactionId: string,
  input: Partial<CreateTransactionInput>
): Promise<void> {
  const current = await getUserTransactionById(uid, transactionId);
  if (!current) {
    return;
  }

  const date = input.date ?? current.date;
  db.prepare(`
    update app_transactions
    set type = ?, amount = ?, date = ?, month_key = ?, category = ?, description = ?, payment_method = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(
    input.type ?? current.type,
    typeof input.amount === 'number' ? input.amount : current.amount,
    date,
    monthKeyFromDate(date),
    input.category ?? current.category,
    input.description ?? current.description,
    input.paymentMethod ?? current.paymentMethod,
    nowIso(),
    uid,
    transactionId
  );
  publishUserDataChange(uid, 'transactions');
}

export async function deleteUserTransaction(uid: string, transactionId: string): Promise<void> {
  db.prepare('delete from app_transactions where uid = ? and id = ?').run(uid, transactionId);
  publishUserDataChange(uid, 'transactions');
}

export async function getUserTransactionById(uid: string, transactionId: string): Promise<UserTransaction | null> {
  const row = db.prepare('select * from app_transactions where uid = ? and id = ? limit 1').get(uid, transactionId) as SqlRow | undefined;
  return row ? mapTransactionRow(row) : null;
}

export async function restoreUserTransaction(
  uid: string,
  transactionId: string,
  input: Omit<UserTransaction, 'id'>
): Promise<void> {
  db.prepare(`
    insert into app_transactions (
      id, uid, type, amount, date, month_key, category, description, payment_method, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    transactionId,
    uid,
    input.type,
    input.amount,
    input.date,
    input.monthKey,
    input.category,
    input.description,
    input.paymentMethod,
    input.createdAt,
    input.updatedAt
  );
  publishUserDataChange(uid, 'transactions');
}

export async function addUserReminder(uid: string, input: CreateReminderInput): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  const reminderKind = normalizeReminderKind(input.reminderKind, input.type);
  const type = reminderKind === 'general' ? null : reminderKind;
  const dueTime = input.dueTime ?? null;
  const dueAt = reminderDueAtFromDateAndTime(input.dueDate, dueTime);
  const notifyPhone = input.notifyPhone ? normalizePhoneNumber(input.notifyPhone) : null;

  db.prepare(`
    insert into app_reminders (
      id, uid, title, amount, due_date, due_time, due_at, notified_at, notify_phone, reminder_kind, type, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    uid,
    input.title,
    input.amount ?? null,
    input.dueDate,
    dueTime,
    dueAt,
    notifyPhone,
    reminderKind,
    type,
    input.status ?? 'pending',
    now,
    now
  );
  publishUserDataChange(uid, 'reminders');
  return id;
}

export async function getUserReminders(uid: string): Promise<UserReminder[]> {
  const rows = db.prepare(`
    select * from app_reminders where uid = ? order by due_date asc, created_at desc
  `).all(uid) as SqlRow[];
  return rows.map(mapReminderRow);
}

export async function getUserReminderById(uid: string, reminderId: string): Promise<UserReminder | null> {
  const row = db.prepare('select * from app_reminders where uid = ? and id = ? limit 1').get(uid, reminderId) as SqlRow | undefined;
  return row ? mapReminderRow(row) : null;
}

export async function updateUserReminder(
  uid: string,
  reminderId: string,
  input: Partial<CreateReminderInput>
): Promise<void> {
  const current = await getUserReminderById(uid, reminderId);
  if (!current) {
    return;
  }

  const reminderKind = normalizeReminderKind(input.reminderKind ?? current.reminderKind, input.type ?? current.type);
  const type = reminderKind === 'general' ? null : reminderKind;
  const dueDate = input.dueDate ?? current.dueDate;
  const dueTime = input.dueTime !== undefined ? input.dueTime : (current.dueTime ?? null);
  const dueAt = reminderDueAtFromDateAndTime(dueDate, dueTime ?? null);
  const notifyPhone = input.notifyPhone !== undefined
    ? (input.notifyPhone ? normalizePhoneNumber(input.notifyPhone) : null)
    : (current.notifyPhone ?? null);

  db.prepare(`
    update app_reminders
    set title = ?, amount = ?, due_date = ?, due_time = ?, due_at = ?, notify_phone = ?, reminder_kind = ?, type = ?, status = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(
    input.title ?? current.title,
    input.amount !== undefined ? input.amount : current.amount,
    dueDate,
    dueTime ?? null,
    dueAt,
    notifyPhone,
    reminderKind,
    type,
    input.status ?? current.status,
    nowIso(),
    uid,
    reminderId
  );
  publishUserDataChange(uid, 'reminders');
}

export async function deleteUserReminder(uid: string, reminderId: string): Promise<void> {
  db.prepare('delete from app_reminders where uid = ? and id = ?').run(uid, reminderId);
  publishUserDataChange(uid, 'reminders');
}

export async function getDueWhatsAppReminders(
  nowValue: string,
  limitCount = 50
): Promise<DueWhatsAppReminder[]> {
  const rows = db.prepare(`
    select * from app_reminders
    where notify_phone is not null
      and due_at is not null
      and notified_at is null
      and status = 'pending'
      and due_at <= ?
    order by due_at asc
    limit ?
  `).all(nowValue, limitCount) as SqlRow[];

  return rows.map((row) => ({
    id: String(row.id),
    uid: String(row.uid),
    title: String(row.title),
    amount: row.amount == null ? null : toNumber(row.amount),
    dueDate: String(row.due_date),
    dueTime: typeof row.due_time === 'string' ? row.due_time : null,
    notifyPhone: String(row.notify_phone),
    reminderKind: normalizeReminderKind(row.reminder_kind, row.type),
    type: row.type === 'payable' || row.type === 'receivable' ? row.type : null
  }));
}

export async function markReminderAsNotified(
  uid: string,
  reminderId: string,
  notifiedAt: string
): Promise<boolean> {
  const result = db.prepare(`
    update app_reminders
    set notified_at = ?, updated_at = ?
    where uid = ? and id = ? and notified_at is null
  `).run(notifiedAt, nowIso(), uid, reminderId);
  if (result.changes > 0) {
    publishUserDataChange(uid, 'reminders');
  }
  return result.changes > 0;
}

export async function addRecurringTransaction(
  uid: string,
  input: CreateRecurringTransactionInput
): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_recurring_transactions (
      id, uid, type, amount, category, description, payment_method, frequency, start_date, end_date, next_due_date, active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    uid,
    input.type,
    input.amount,
    input.category,
    input.description,
    input.paymentMethod,
    input.frequency,
    input.startDate,
    input.endDate ?? null,
    input.startDate,
    now,
    now
  );
  publishUserDataChange(uid, 'recurring-transactions');
  return id;
}

export async function getActiveRecurringTransactions(uid: string): Promise<UserRecurringTransaction[]> {
  const rows = db.prepare(`
    select * from app_recurring_transactions where uid = ? and active = 1 order by next_due_date asc
  `).all(uid) as SqlRow[];
  return rows.map(mapRecurringRow);
}

export async function getRecurringTransactions(uid: string): Promise<UserRecurringTransaction[]> {
  const rows = db.prepare(`
    select * from app_recurring_transactions where uid = ? order by created_at desc
  `).all(uid) as SqlRow[];
  return rows.map(mapRecurringRow);
}

export async function deleteRecurringTransaction(uid: string, recurringId: string): Promise<void> {
  db.prepare('delete from app_recurring_transactions where uid = ? and id = ?').run(uid, recurringId);
  publishUserDataChange(uid, 'recurring-transactions');
}

export async function updateRecurringTransactionBackend(
  uid: string,
  recurringId: string,
  input: Partial<UserRecurringTransaction>
): Promise<void> {
  const current = db.prepare('select * from app_recurring_transactions where uid = ? and id = ? limit 1').get(uid, recurringId) as SqlRow | undefined;
  if (!current) {
    return;
  }

  db.prepare(`
    update app_recurring_transactions
    set type = ?, amount = ?, category = ?, description = ?, payment_method = ?, frequency = ?, start_date = ?, end_date = ?, next_due_date = ?, active = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(
    input.type ?? (current.type as string),
    typeof input.amount === 'number' ? input.amount : toNumber(current.amount),
    input.category ?? String(current.category),
    input.description ?? String(current.description),
    input.paymentMethod ?? String(current.payment_method),
    input.frequency ?? String(current.frequency),
    input.startDate ?? String(current.start_date),
    input.endDate !== undefined ? input.endDate : (typeof current.end_date === 'string' ? current.end_date : null),
    input.nextDueDate ?? String(current.next_due_date),
    input.active !== undefined ? (input.active ? 1 : 0) : Number(current.active ?? 1),
    nowIso(),
    uid,
    recurringId
  );
  publishUserDataChange(uid, 'recurring-transactions');
}

export async function generateOverdueRecurringTransactions(uid: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const items = await getActiveRecurringTransactions(uid);
  let generated = 0;

  for (const item of items) {
    let nextDue = item.nextDueDate;
    let active = item.active;

    while (active && nextDue <= today) {
      await addUserTransaction(uid, {
        type: item.type,
        amount: item.amount,
        date: nextDue,
        category: item.category,
        description: item.description,
        paymentMethod: item.paymentMethod
      });
      generated += 1;

      const advanced = nextRecurringDate(nextDue, item.frequency);
      if (item.endDate && advanced > item.endDate) {
        active = false;
        nextDue = advanced;
        break;
      }
      nextDue = advanced;
    }

    await updateRecurringTransactionBackend(uid, item.id, {
      nextDueDate: nextDue,
      active
    });
  }

  return generated;
}

export async function getAllowedWhatsAppNumbers(uid: string): Promise<string[]> {
  const cached = allowedNumbersCache.get(uid);
  if (cached && cacheValid(cached.cachedAt)) {
    return cached.numbers;
  }

  const settings = await getUserSettings(uid);
  const numbers = settings.whatsappAllowedNumbers ?? [];
  allowedNumbersCache.set(uid, { numbers, cachedAt: Date.now() });
  return numbers;
}

export function invalidateAllowedNumbersCacheForUid(uid: string): void {
  allowedNumbersCache.delete(uid);
}

export async function isPhoneAllowedForUid(uid: string, phone: string): Promise<boolean> {
  const normalized = normalizePhoneNumber(phone);
  const variants = new Set(brazilianPhoneVariants(normalized));
  const allowed = await getAllowedWhatsAppNumbers(uid);
  return allowed.some((item) => variants.has(item));
}

export async function isPhoneAllowedForAnyAccount(phone: string): Promise<boolean> {
  const normalized = normalizePhoneNumber(phone);
  const variants = brazilianPhoneVariants(normalized);
  const rows = db.prepare('select uid, whatsapp_allowed_numbers from app_user_settings').all() as SqlRow[];
  return rows.some((row) => {
    const allowed = normalizeStoredPhoneList(row.whatsapp_allowed_numbers);
    return allowed.some((item) => variants.includes(item));
  });
}

export async function resolveUidFromPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length < 10) {
    return null;
  }

  const variants = new Set(brazilianPhoneVariants(normalized));
  const rows = db.prepare(`
    select uid, whatsapp_allowed_numbers, updated_at
    from app_user_settings
    order by updated_at desc
  `).all() as SqlRow[];

  for (const row of rows) {
    const allowed = normalizeStoredPhoneList(row.whatsapp_allowed_numbers);
    if (allowed.some((item) => variants.has(item))) {
      return typeof row.uid === 'string' ? row.uid : null;
    }
  }

  return null;
}

export async function getPhoneBinding(phone: string): Promise<WhatsAppPhoneBinding | null> {
  const normalized = normalizePhoneNumber(phone);
  const cached = bindingCache.get(normalized);
  if (cached && cacheValid(cached.cachedAt)) {
    return cached.binding;
  }

  const variants = brazilianPhoneVariants(normalized);
  for (const variant of variants) {
    const row = db.prepare(`
      select phone, uid, linked_at, updated_at
      from whatsapp_bindings
      where variant_phone = ?
      limit 1
    `).get(variant) as SqlRow | undefined;
    if (row) {
      const binding: WhatsAppPhoneBinding = {
        phone: String(row.phone),
        uid: String(row.uid),
        linkedAt: String(row.linked_at),
        updatedAt: String(row.updated_at)
      };
      bindingCache.set(normalized, { binding, cachedAt: Date.now() });
      return binding;
    }
  }

  bindingCache.set(normalized, { binding: null, cachedAt: Date.now() });
  return null;
}

export async function savePhoneBinding(phone: string, uid: string): Promise<void> {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length < 10) return;

  const now = nowIso();
  const insert = db.prepare(`
    insert into whatsapp_bindings (variant_phone, phone, uid, linked_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(variant_phone) do update set
      phone = excluded.phone,
      uid = excluded.uid,
      updated_at = excluded.updated_at
  `);

  for (const variant of brazilianPhoneVariants(normalized)) {
    insert.run(variant, normalized, uid, now, now);
  }

  bindingCache.delete(normalized);
}

export async function deletePhoneBinding(phone: string): Promise<void> {
  const normalized = normalizePhoneNumber(phone);
  const variants = brazilianPhoneVariants(normalized);
  const placeholders = variants.map(() => '?').join(', ');
  db.prepare(`delete from whatsapp_bindings where variant_phone in (${placeholders})`).run(...variants);
  bindingCache.delete(normalized);
}

export async function loadWhatsAppAuthSnapshot(slotId: WhatsAppSlotId): Promise<WhatsAppAuthSnapshotFile[]> {
  const runtimeDocId = authStateDocId(slotId);
  const rows = db.prepare(`
    select filename, content_base64
    from whatsapp_runtime_files
    where runtime_doc_id = ?
    order by filename asc
  `).all(runtimeDocId) as SqlRow[];

  return rows.map((row) => ({
    filename: String(row.filename),
    contentBase64: String(row.content_base64)
  }));
}

export async function saveWhatsAppAuthSnapshot(
  slotId: WhatsAppSlotId,
  files: WhatsAppAuthSnapshotFile[]
): Promise<void> {
  const runtimeDocId = authStateDocId(slotId);
  const now = nowIso();
  db.prepare(`
    insert into whatsapp_runtime (doc_id, file_count, updated_at)
    values (?, ?, ?)
    on conflict(doc_id) do update set
      file_count = excluded.file_count,
      updated_at = excluded.updated_at
  `).run(runtimeDocId, files.length, now);
  db.prepare('delete from whatsapp_runtime_files where runtime_doc_id = ?').run(runtimeDocId);

  const insert = db.prepare(`
    insert into whatsapp_runtime_files (runtime_doc_id, file_doc_id, filename, content_base64, updated_at)
    values (?, ?, ?, ?, ?)
  `);
  for (const file of files) {
    insert.run(runtimeDocId, authFileDocId(file.filename), file.filename, file.contentBase64, now);
  }
}

export async function clearWhatsAppAuthSnapshot(slotId: WhatsAppSlotId): Promise<void> {
  db.prepare('delete from whatsapp_runtime where doc_id = ?').run(authStateDocId(slotId));
}

export async function getRecentConversationByPhone(
  uidOrPhone: string,
  phoneOrLimit?: string | number,
  maybeLimit?: number
): Promise<WhatsAppConversationMessage[]> {
  const phone = typeof phoneOrLimit === 'string' ? phoneOrLimit : uidOrPhone;
  const limitCount = typeof phoneOrLimit === 'number' ? phoneOrLimit : maybeLimit ?? 20;
  const variants = brazilianPhoneVariants(phone);
  const placeholders = variants.map(() => '?').join(', ');
  const rows = db.prepare(`
    select direction, text
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
    order by created_at desc
    limit ?
  `).all(...variants, ...variants, limitCount) as SqlRow[];

  return rows
    .reverse()
    .map((row): WhatsAppConversationMessage => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: String(row.text ?? '')
    }))
    .filter((item) => item.content.trim().length > 0);
}

export async function getRecentConversationByOwnerUid(
  uid: string,
  limitCount = 20
): Promise<WhatsAppConversationMessage[]> {
  const rows = db.prepare(`
    select direction, text
    from whatsapp_messages
    where owner_uid = ?
    order by created_at desc
    limit ?
  `).all(uid, limitCount) as SqlRow[];

  return rows
    .reverse()
    .map((row): WhatsAppConversationMessage => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: String(row.text ?? '')
    }))
    .filter((item) => item.content.trim().length > 0);
}

export async function getLastConversationActivityByPhone(
  uidOrPhone: string,
  maybePhone?: string
): Promise<string | null> {
  const phone = maybePhone ?? uidOrPhone;
  const normalized = normalizePhoneNumber(phone);
  const cached = lastActivityCache.get(normalized);
  if (cached && cacheValid(cached.cachedAt)) {
    return cached.value;
  }

  const variants = brazilianPhoneVariants(normalized);
  const placeholders = variants.map(() => '?').join(', ');
  const row = db.prepare(`
    select max(created_at) as lastAt
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
  `).get(...variants, ...variants) as { lastAt: string | null };
  const value = row?.lastAt ?? null;
  lastActivityCache.set(normalized, { value, cachedAt: Date.now() });
  return value;
}

export async function getLastConversationClientIdByPhone(
  phone: string
): Promise<WhatsAppSlotId | null> {
  const variants = brazilianPhoneVariants(phone);
  const placeholders = variants.map(() => '?').join(', ');
  const row = db.prepare(`
    select client_id
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
    order by created_at desc
    limit 1
  `).get(...variants, ...variants) as SqlRow | undefined;
  return row?.client_id === 'wa1' ? 'wa1' : null;
}

export async function getUserChatSessions(uid: string): Promise<UserChatSession[]> {
  const rows = db.prepare(`
    select * from app_chat_sessions where uid = ? order by updated_at desc
  `).all(uid) as SqlRow[];
  return rows.map(mapChatSessionRow);
}

export async function createUserChatSession(uid: string, title: string): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_chat_sessions (id, uid, title, created_at, updated_at)
    values (?, ?, ?, ?, ?)
  `).run(id, uid, title, now, now);
  publishUserDataChange(uid, 'chat-sessions');
  return id;
}

export async function updateUserChatSessionTitle(uid: string, sessionId: string, title: string): Promise<void> {
  db.prepare(`
    update app_chat_sessions set title = ?, updated_at = ? where uid = ? and id = ?
  `).run(title, nowIso(), uid, sessionId);
  publishUserDataChange(uid, 'chat-sessions');
}

export async function deleteUserChatSession(uid: string, sessionId: string): Promise<void> {
  db.prepare('delete from app_chat_sessions where uid = ? and id = ?').run(uid, sessionId);
  publishUserDataChange(uid, 'chat-sessions');
  publishUserDataChange(uid, 'chat-messages');
}

export async function getUserChatMessages(uid: string, sessionId: string): Promise<UserChatMessage[]> {
  const rows = db.prepare(`
    select m.*
    from app_chat_messages m
    inner join app_chat_sessions s on s.id = m.session_id
    where s.uid = ? and m.session_id = ?
    order by m.created_at asc
  `).all(uid, sessionId) as SqlRow[];
  return rows.map(mapChatMessageRow);
}

export async function addUserChatMessage(
  uid: string,
  sessionId: string,
  input: { role: UserChatMessage['role']; content: string; imageUrl?: string }
): Promise<string> {
  const session = db.prepare('select id from app_chat_sessions where uid = ? and id = ? limit 1').get(uid, sessionId) as SqlRow | undefined;
  if (!session) {
    throw new Error('Sessao de chat nao encontrada.');
  }

  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_chat_messages (id, uid, session_id, role, content, image_url, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, sessionId, input.role, input.content, input.imageUrl ?? null, now);
  db.prepare('update app_chat_sessions set updated_at = ? where id = ?').run(now, sessionId);
  publishUserDataChange(uid, 'chat-messages');
  publishUserDataChange(uid, 'chat-sessions');
  return id;
}

export async function createPendingWhatsAppDocumentDraft(
  uid: string,
  sourcePhone: string,
  input: CreatePendingWhatsAppDocumentDraftInput
): Promise<void> {
  db.prepare(`
    insert into app_whatsapp_pending_documents (
      id, uid, source_phone, storage_path, mime_type, size_bytes, pending_reason, expires_at, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(uid, source_phone) do update set
      id = excluded.id,
      storage_path = excluded.storage_path,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      pending_reason = excluded.pending_reason,
      expires_at = excluded.expires_at
  `).run(
    input.id,
    uid,
    normalizePhoneNumber(sourcePhone),
    input.storagePath,
    input.mimeType,
    input.sizeBytes,
    input.pendingReason ?? 'missing_title',
    input.expiresAt,
    nowIso()
  );
}

export async function getActivePendingWhatsAppDocumentDraft(
  uid: string,
  sourcePhone: string
): Promise<PendingWhatsAppDocumentDraft | null> {
  const row = db.prepare(`
    select * from app_whatsapp_pending_documents
    where uid = ? and source_phone = ? and expires_at > ?
    limit 1
  `).get(uid, normalizePhoneNumber(sourcePhone), nowIso()) as SqlRow | undefined;
  return row ? mapPendingDocumentRow(row) : null;
}

export async function deletePendingWhatsAppDocumentDraft(id: string): Promise<void> {
  db.prepare('delete from app_whatsapp_pending_documents where id = ?').run(id);
}

export async function deleteExpiredPendingWhatsAppDocumentDrafts(uid: string, sourcePhone: string): Promise<void> {
  db.prepare(`
    delete from app_whatsapp_pending_documents
    where uid = ? and source_phone = ? and expires_at <= ?
  `).run(uid, normalizePhoneNumber(sourcePhone), nowIso());
}

export async function createUserDocument(uid: string, input: CreateUserDocumentInput): Promise<string> {
  const id = input.id ?? randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_user_documents (
      id, uid, source, title, description, normalized_title, normalized_description,
      search_tokens, storage_path, mime_type, size_bytes, status, created_at, updated_at, last_accessed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
  `).run(
    id,
    uid,
    input.source ?? 'whatsapp',
    input.title,
    input.description ?? null,
    input.normalizedTitle,
    input.normalizedDescription ?? null,
    stringifyJson(input.searchTokens ?? []),
    input.storagePath,
    input.mimeType,
    input.sizeBytes,
    input.status ?? 'ready',
    now,
    now
  );
  publishUserDataChange(uid, 'documents');
  return id;
}

export async function getUserDocument(uid: string, documentId: string): Promise<UserDocument | null> {
  const row = db.prepare(`
    select * from app_user_documents where uid = ? and id = ? limit 1
  `).get(uid, documentId) as SqlRow | undefined;
  return row ? mapDocumentRow(row) : null;
}

export async function updateUserDocument(
  uid: string,
  documentId: string,
  input: UpdateUserDocumentInput
): Promise<void> {
  const current = await getUserDocument(uid, documentId);
  if (!current) {
    return;
  }

  db.prepare(`
    update app_user_documents
    set title = ?, description = ?, normalized_title = ?, normalized_description = ?, search_tokens = ?, storage_path = ?, status = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(
    input.title ?? current.title,
    input.description !== undefined ? input.description : (current.description ?? null),
    input.normalizedTitle ?? current.normalizedTitle,
    input.normalizedDescription !== undefined ? input.normalizedDescription : (current.normalizedDescription ?? null),
    stringifyJson(input.searchTokens ?? current.searchTokens),
    input.storagePath ?? current.storagePath,
    input.status ?? current.status,
    nowIso(),
    uid,
    documentId
  );
  publishUserDataChange(uid, 'documents');
}

export async function markUserDocumentDeleted(uid: string, documentId: string): Promise<void> {
  db.prepare(`
    update app_user_documents set status = 'deleted', updated_at = ? where uid = ? and id = ?
  `).run(nowIso(), uid, documentId);
  publishUserDataChange(uid, 'documents');
}

export async function touchUserDocumentAccess(uid: string, documentId: string): Promise<void> {
  db.prepare(`
    update app_user_documents set last_accessed_at = ? where uid = ? and id = ?
  `).run(nowIso(), uid, documentId);
  publishUserDataChange(uid, 'documents');
}

export async function listRecentUserDocuments(uid: string, limitCount: number): Promise<UserDocument[]> {
  const rows = db.prepare(`
    select * from app_user_documents
    where uid = ? and status = 'ready'
    order by created_at desc
    limit ?
  `).all(uid, limitCount) as SqlRow[];
  return rows.map(mapDocumentRow);
}

export async function listUserDocuments(uid: string, limitCount = 200): Promise<UserDocument[]> {
  const rows = db.prepare(`
    select * from app_user_documents
    where uid = ? and status = 'ready'
    order by updated_at desc, created_at desc
    limit ?
  `).all(uid, limitCount) as SqlRow[];
  return rows.map(mapDocumentRow);
}

export async function getUserFinancialProfile(uid: string): Promise<UserFinancialProfile | null> {
  const row = db.prepare('select * from app_financial_profiles where uid = ? limit 1').get(uid) as SqlRow | undefined;
  if (!row) return null;
  return {
    monthlyIncome: toNumber(row.monthly_income),
    fixedExpenses: toNumber(row.fixed_expenses),
    variableExpenses: toNumber(row.variable_expenses),
    savingsTargetPct: toNumber(row.savings_target_pct),
    financialGoalsText: typeof row.financial_goals_text === 'string' ? row.financial_goals_text : null,
    completedAt: String(row.completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function upsertUserFinancialProfile(uid: string, input: UpsertFinancialProfileInput): Promise<void> {
  const existing = await getUserFinancialProfile(uid);
  const now = nowIso();
  db.prepare(`
    insert into app_financial_profiles (
      uid, monthly_income, fixed_expenses, variable_expenses, savings_target_pct,
      financial_goals_text, completed_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(uid) do update set
      monthly_income = excluded.monthly_income,
      fixed_expenses = excluded.fixed_expenses,
      variable_expenses = excluded.variable_expenses,
      savings_target_pct = excluded.savings_target_pct,
      financial_goals_text = excluded.financial_goals_text,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `).run(
    uid,
    input.monthlyIncome,
    input.fixedExpenses,
    input.variableExpenses,
    input.savingsTargetPct,
    input.financialGoalsText,
    now,
    existing?.createdAt ?? now,
    now
  );
  publishUserDataChange(uid, 'financial-profile');
}

export async function getUserGoals(uid: string): Promise<UserGoal[]> {
  const rows = db.prepare(`
    select * from app_goals where uid = ? order by created_at desc
  `).all(uid) as SqlRow[];
  return rows.map(mapGoalRow);
}

export async function addUserGoal(uid: string, input: CreateGoalInput): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    insert into app_goals (
      id, uid, title, description, target_amount, current_amount, deadline, source, status, priority, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    uid,
    input.title,
    input.description ?? null,
    input.targetAmount ?? null,
    input.currentAmount ?? 0,
    input.deadline ?? null,
    input.source,
    input.status ?? 'active',
    input.priority ?? 'medium',
    now,
    now
  );
  publishUserDataChange(uid, 'goals');
  return id;
}

export async function updateUserGoal(
  uid: string,
  goalId: string,
  input: Partial<CreateGoalInput & Pick<UserGoal, 'currentAmount' | 'status'>>
): Promise<void> {
  const current = db.prepare('select * from app_goals where uid = ? and id = ? limit 1').get(uid, goalId) as SqlRow | undefined;
  if (!current) {
    return;
  }

  db.prepare(`
    update app_goals
    set title = ?, description = ?, target_amount = ?, current_amount = ?, deadline = ?, source = ?, status = ?, priority = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(
    input.title ?? String(current.title),
    input.description !== undefined ? input.description : (typeof current.description === 'string' ? current.description : null),
    input.targetAmount !== undefined ? input.targetAmount : (current.target_amount == null ? null : toNumber(current.target_amount)),
    input.currentAmount !== undefined ? input.currentAmount : toNumber(current.current_amount),
    input.deadline !== undefined ? input.deadline : (typeof current.deadline === 'string' ? current.deadline : null),
    input.source ?? (current.source === 'ai' ? 'ai' : 'manual'),
    input.status ?? (current.status as UserGoal['status']),
    input.priority ?? (current.priority as UserGoal['priority']),
    nowIso(),
    uid,
    goalId
  );
  publishUserDataChange(uid, 'goals');
}

export async function deleteUserGoal(uid: string, goalId: string): Promise<void> {
  db.prepare('delete from app_goals where uid = ? and id = ?').run(uid, goalId);
  publishUserDataChange(uid, 'goals');
}
