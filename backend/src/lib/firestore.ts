import { supabaseAdmin as db } from './supabase';
import { logger } from './logger';
import type { WhatsAppMessageRecord, WhatsAppSlotId } from '../types/whatsapp';
import { brazilianPhoneVariants, normalizePhoneNumber } from '../whatsapp/events';
import { getBrasiliaISOString } from './date-utils';

const COLLECTION_NAME = 'whatsapp_messages';
const BINDINGS_COLLECTION_NAME = 'whatsapp_bindings';
const AUTH_STATE_COLLECTION_NAME = 'whatsapp_runtime';
const AUTH_STATE_DOC_ID_LEGACY = 'authState';
const AUTH_STATE_FILES_SUBCOLLECTION = 'whatsapp_runtime_files';
const GLOBAL_CATEGORIES_UID = '__global__';
const PROFILE_SCAN_CACHE_TTL_MS = 15_000;
const BINDING_CACHE_TTL_MS = 5 * 60 * 1000;
const LAST_ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000;
const ALLOWED_NUMBERS_CACHE_TTL_MS = 2 * 60 * 1000;

function assertNoError(error: { message: string } | null, context: string): void {
  if (!error) return;
  throw new Error(`${context}: ${error.message}`);
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeDocId(value: string): string {
  return value.replace(/[^\w.-]/g, '_');
}

function authFileDocId(filename: string): string {
  return Buffer.from(filename, 'utf8').toString('base64url');
}

function authStateDocId(slotId: WhatsAppSlotId): string {
  return `authState_${slotId}`;
}

function getDocId(record: WhatsAppMessageRecord): string {
  const prefix =
    record.direction === 'inbound'
      ? 'in'
      : record.direction === 'outbound'
        ? 'out'
        : 'ar';
  return `${record.clientId}_${prefix}_${sanitizeDocId(record.messageId)}`;
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

  // Interpreta horários dos lembretes em BRT (UTC-03:00).
  const parsed = new Date(`${dueDate}T${normalizedTime}:00-03:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
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

interface DbTransactionRow {
  id: string;
  type: 'income' | 'expense';
  amount: number | string;
  date: string;
  month_key: string;
  category: string;
  description: string;
  payment_method: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  created_at: string;
  updated_at: string;
}

interface DbRecurringRow {
  id: string;
  type: 'income' | 'expense';
  amount: number | string;
  category: string;
  description: string;
  payment_method: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  frequency: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface DbReminderRow {
  id: string;
  title: string;
  amount: number | string | null;
  due_date: string;
  due_time: string | null;
  due_at: string | null;
  notified_at: string | null;
  notify_phone: string | null;
  reminder_kind: 'general' | 'payable' | 'receivable';
  type: 'payable' | 'receivable' | null;
  status: 'pending' | 'paid';
  created_at: string;
  updated_at: string;
}

interface DbChatSessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface DbChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image_url: string | null;
  created_at: string;
}

interface DbUserDocumentRow {
  id: string;
  uid: string;
  source: string;
  title: string;
  description: string | null;
  normalized_title: string;
  normalized_description: string | null;
  search_tokens: string[] | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  status: 'ready' | 'deleted';
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

interface DbPendingDocumentRow {
  id: string;
  uid: string;
  source_phone: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  pending_reason: string;
  expires_at: string;
  created_at: string;
}

interface DbWhatsAppMessageRow {
  id: string;
  client_id: WhatsAppSlotId;
  direction: 'inbound' | 'outbound' | 'auto_reply';
  owner_uid: string | null;
  status: 'received' | 'sent' | 'failed';
  created_at: string;
  text: string;
  metadata: {
    hasImage?: boolean;
  } | null;
}

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

export interface UserCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
  icon: string;
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

export interface BootstrapUserInput {
  email: string;
  displayName: string;
  phone: string;
}

export interface BootstrapUserResult {
  isNewUser: boolean;
  normalizedPhone: string | null;
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

export interface CreatePendingWhatsAppDocumentDraftInput {
  id: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  pendingReason?: string;
}

function normalizeStoredPhoneList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizePhoneNumber(item);
    if (normalized.length < 10) continue;
    unique.add(normalized);
  }
  return [...unique];
}

function incrementCounter(counter: Map<string, number>, uid: string | null | undefined): void {
  const normalizedUid = typeof uid === 'string' ? uid.trim() : '';
  if (!normalizedUid || normalizedUid === GLOBAL_CATEGORIES_UID) return;
  counter.set(normalizedUid, (counter.get(normalizedUid) ?? 0) + 1);
}

export async function saveWhatsAppMessage(record: WhatsAppMessageRecord): Promise<void> {
  const docId = getDocId(record);
  const { error } = await db.from(COLLECTION_NAME).upsert(
    {
      id: docId,
      client_id: record.clientId,
      message_id: record.messageId,
      direction: record.direction,
      owner_uid: record.ownerUid ?? null,
      from_phone: record.from,
      to_phone: record.to,
      text: record.text,
      timestamp: record.timestamp,
      wa_timestamp: record.waTimestamp,
      status: record.status,
      raw_type: record.rawType,
      created_at: record.createdAt,
      metadata: record.metadata
    },
    { onConflict: 'id' }
  );
  assertNoError(error, 'saveWhatsAppMessage');
}

export async function inboundMessageExists(
  messageId: string,
  clientId: WhatsAppSlotId,
  processedInMemory?: Set<string>
): Promise<boolean> {
  if (processedInMemory?.has(messageId)) return true;

  const normalizedId = sanitizeDocId(messageId);
  const docIds =
    clientId === 'wa1'
      ? [`wa1_in_${normalizedId}`, `in_${normalizedId}`]
      : [`${clientId}_in_${normalizedId}`];

  const { data, error } = await db.from(COLLECTION_NAME).select('id').in('id', docIds).limit(1);
  assertNoError(error, 'inboundMessageExists');
  return (data ?? []).length > 0;
}

export async function saveMessageSafe(record: WhatsAppMessageRecord): Promise<void> {
  try {
    await saveWhatsAppMessage(record);
  } catch (error) {
    logger.error('Failed to save WhatsApp message in Supabase', error);
  }
}

async function ensureGlobalCategoriesSeed(): Promise<void> {
  // app_categories.uid references app_users(uid), so the synthetic global owner
  // must always exist before seeding shared categories.
  const { error: ensureGlobalUserError } = await db
    .from('app_users')
    .upsert(
      {
        uid: GLOBAL_CATEGORIES_UID,
        email: null,
        display_name: 'Global Categories',
        created_at: new Date().toISOString()
      },
      { onConflict: 'uid' }
    );
  assertNoError(ensureGlobalUserError, 'ensureGlobalCategoriesSeed.ensureGlobalUser');

  const { count, error: countError } = await db
    .from('app_categories')
    .select('*', { count: 'exact', head: true })
    .eq('uid', GLOBAL_CATEGORIES_UID);
  assertNoError(countError, 'ensureGlobalCategoriesSeed.count');
  if ((count ?? 0) > 0) return;

  const now = new Date().toISOString();
  const rows = DEFAULT_GLOBAL_CATEGORIES.map((item) => ({
    uid: GLOBAL_CATEGORIES_UID,
    name: item.name,
    type: item.type,
    color: item.color,
    icon: item.icon,
    created_at: now
  }));

  const { error: insertError } = await db.from('app_categories').insert(rows);
  if (!insertError) return;

  const code = (insertError as { code?: string }).code;
  if (code === '23505') return;
  throw new Error(`ensureGlobalCategoriesSeed.insert: ${insertError.message}`);
}

export async function bootstrapUserData(uid: string, input: BootstrapUserInput): Promise<BootstrapUserResult> {
  const now = new Date().toISOString();

  const { data: userData, error: userReadError } = await db
    .from('app_users')
    .select('uid')
    .eq('uid', uid)
    .maybeSingle();
  assertNoError(userReadError, 'bootstrapUserData.userRead');
  const isNewUser = !userData;

  if (userData) {
    const { error } = await db
      .from('app_users')
      .update({ email: input.email, display_name: input.displayName })
      .eq('uid', uid);
    assertNoError(error, 'bootstrapUserData.userUpdate');
  } else {
    const { error } = await db.from('app_users').insert({
      uid,
      email: input.email,
      display_name: input.displayName,
      created_at: now
    });
    assertNoError(error, 'bootstrapUserData.userInsert');
  }

  const normalizedPhone = normalizePhoneNumber(input.phone);
  const { data: settingsData, error: settingsReadError } = await db
    .from('app_user_settings')
    .select('uid, whatsapp_allowed_numbers')
    .eq('uid', uid)
    .maybeSingle<{ uid: string; whatsapp_allowed_numbers: string[] | null }>();
  assertNoError(settingsReadError, 'bootstrapUserData.settingsRead');

  if (!settingsData) {
    const numbers = normalizedPhone.length >= 10 ? [normalizedPhone] : [];
    const { error } = await db.from('app_user_settings').insert({
      uid,
      budget: 0,
      start_day: 1,
      currency: 'BRL',
      whatsapp_allowed_numbers: numbers,
      updated_at: now
    });
    assertNoError(error, 'bootstrapUserData.settingsInsert');
  } else if (normalizedPhone.length >= 10) {
    const current = Array.isArray(settingsData.whatsapp_allowed_numbers)
      ? settingsData.whatsapp_allowed_numbers
      : [];
    if (!current.includes(normalizedPhone)) {
      const { error } = await db
        .from('app_user_settings')
        .update({
          whatsapp_allowed_numbers: [...current, normalizedPhone],
          updated_at: now
        })
        .eq('uid', uid);
      assertNoError(error, 'bootstrapUserData.settingsUpdatePhone');
    }
  }

  // Pre-create WhatsApp binding at signup/bootstrap time.
  // This avoids relying on first inbound metadata resolution for new accounts.
  if (normalizedPhone.length >= 10) {
    try {
      await savePhoneBinding(normalizedPhone, uid);
    } catch (error) {
      logger.warn('bootstrapUserData: failed to pre-bind WhatsApp phone', {
        uid,
        phone: normalizedPhone,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
  await ensureGlobalCategoriesSeed();

  allowedNumbersCache.delete(uid);
  profileScanCache = null;

  return {
    isNewUser,
    normalizedPhone: normalizedPhone.length >= 10 ? normalizedPhone : null
  };
}

export async function getUserSettings(uid: string): Promise<UserSettingsBackend> {
  const { data, error } = await db
    .from('app_user_settings')
    .select('budget, start_day, currency, whatsapp_allowed_numbers, updated_at')
    .eq('uid', uid)
    .maybeSingle<{
      budget: number | string;
      start_day: number;
      currency: string;
      whatsapp_allowed_numbers: unknown;
      updated_at: string;
    }>();
  assertNoError(error, 'getUserSettings');
  if (!data) {
    return {
      budget: 0,
      startDay: 1,
      currency: 'BRL',
      whatsappAllowedNumbers: [],
      updatedAt: new Date().toISOString()
    };
  }

  const whatsappAllowedNumbers = Array.isArray(data.whatsapp_allowed_numbers)
    ? data.whatsapp_allowed_numbers
      .filter((value): value is string => typeof value === 'string')
      .map((value) => normalizePhoneNumber(value))
      .filter((value) => value.length >= 10)
    : [];

  return {
    budget: toNumber(data.budget),
    startDay: data.start_day,
    currency: data.currency ?? 'BRL',
    whatsappAllowedNumbers,
    updatedAt: data.updated_at
  };
}

export async function updateUserSettings(
  uid: string,
  changes: Partial<UserSettingsBackend & { whatsappAllowedNumbers: string[] }>
): Promise<void> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };
  if (typeof changes.budget === 'number') updates.budget = changes.budget;
  if (typeof changes.startDay === 'number') updates.start_day = changes.startDay;
  if (typeof changes.currency === 'string') updates.currency = changes.currency;
  if (Array.isArray(changes.whatsappAllowedNumbers)) {
    updates.whatsapp_allowed_numbers = [
      ...new Set(
        changes.whatsappAllowedNumbers
          .map((value) => normalizePhoneNumber(value))
          .filter((value) => value.length >= 10)
      )
    ];
  }

  const { data: existing, error: readError } = await db
    .from('app_user_settings')
    .select('uid')
    .eq('uid', uid)
    .maybeSingle();
  assertNoError(readError, 'updateUserSettings.read');

  if (existing) {
    const { error } = await db.from('app_user_settings').update(updates).eq('uid', uid);
    assertNoError(error, 'updateUserSettings.update');
  } else {
    const { error } = await db.from('app_user_settings').insert({
      uid,
      budget: typeof changes.budget === 'number' ? changes.budget : 0,
      start_day: typeof changes.startDay === 'number' ? changes.startDay : 1,
      currency: typeof changes.currency === 'string' ? changes.currency : 'BRL',
      whatsapp_allowed_numbers: Array.isArray(updates.whatsapp_allowed_numbers)
        ? updates.whatsapp_allowed_numbers
        : [],
      updated_at: now
    });
    assertNoError(error, 'updateUserSettings.insert');
  }

  allowedNumbersCache.delete(uid);
  profileScanCache = null;
}

export async function getUserProfile(uid: string): Promise<UserProfileBackend> {
  const { data, error } = await db
    .from('app_users')
    .select('display_name')
    .eq('uid', uid)
    .maybeSingle<{ display_name: string }>();
  assertNoError(error, 'getUserProfile');
  return { displayName: data?.display_name ?? '' };
}

export async function listAdminUserSnapshots(): Promise<AdminUserSnapshot[]> {
  const [usersRes, settingsRes, transactionsRes, remindersRes, categoriesRes, messagesRes] = await Promise.all([
    db
      .from('app_users')
      .select('uid, email, display_name, created_at')
      .neq('uid', GLOBAL_CATEGORIES_UID)
      .order('created_at', { ascending: false }),
    db
      .from('app_user_settings')
      .select('uid, budget, start_day, currency, whatsapp_allowed_numbers, updated_at'),
    db
      .from('app_transactions')
      .select('uid'),
    db
      .from('app_reminders')
      .select('uid'),
    db
      .from('app_categories')
      .select('uid')
      .neq('uid', GLOBAL_CATEGORIES_UID),
    db
      .from(COLLECTION_NAME)
      .select('owner_uid, created_at')
  ]);

  assertNoError(usersRes.error, 'listAdminUserSnapshots.users');
  assertNoError(settingsRes.error, 'listAdminUserSnapshots.settings');
  assertNoError(transactionsRes.error, 'listAdminUserSnapshots.transactions');
  assertNoError(remindersRes.error, 'listAdminUserSnapshots.reminders');
  assertNoError(categoriesRes.error, 'listAdminUserSnapshots.categories');
  assertNoError(messagesRes.error, 'listAdminUserSnapshots.messages');

  const settingsByUid = new Map<string, AdminUserSnapshot['settings']>();
  for (const row of settingsRes.data ?? []) {
    const uid = row.uid as string;
    settingsByUid.set(uid, {
      budget: toNumber(row.budget as number | string | null | undefined),
      startDay: toNumber(row.start_day as number | string | null | undefined) || 1,
      currency: typeof row.currency === 'string' && row.currency.trim() ? row.currency : 'BRL',
      whatsappAllowedNumbers: normalizeStoredPhoneList(row.whatsapp_allowed_numbers),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null
    });
  }

  const transactionCounts = new Map<string, number>();
  for (const row of transactionsRes.data ?? []) {
    incrementCounter(transactionCounts, row.uid as string | null | undefined);
  }

  const reminderCounts = new Map<string, number>();
  for (const row of remindersRes.data ?? []) {
    incrementCounter(reminderCounts, row.uid as string | null | undefined);
  }

  const categoryCounts = new Map<string, number>();
  for (const row of categoriesRes.data ?? []) {
    incrementCounter(categoryCounts, row.uid as string | null | undefined);
  }

  const whatsappMessageCounts = new Map<string, number>();
  const lastWhatsAppMessageAt = new Map<string, string>();
  for (const row of messagesRes.data ?? []) {
    const uid = typeof row.owner_uid === 'string' ? row.owner_uid.trim() : '';
    if (!uid || uid === GLOBAL_CATEGORIES_UID) continue;
    whatsappMessageCounts.set(uid, (whatsappMessageCounts.get(uid) ?? 0) + 1);

    const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
    if (!createdAt) continue;
    const current = lastWhatsAppMessageAt.get(uid);
    if (!current || createdAt > current) {
      lastWhatsAppMessageAt.set(uid, createdAt);
    }
  }

  return (usersRes.data ?? []).map((row) => {
    const uid = row.uid as string;
    return {
      uid,
      email: typeof row.email === 'string' ? row.email : null,
      displayName: typeof row.display_name === 'string' ? row.display_name : '',
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      settings: settingsByUid.get(uid) ?? null,
      metrics: {
        transactions: transactionCounts.get(uid) ?? 0,
        reminders: reminderCounts.get(uid) ?? 0,
        categories: categoryCounts.get(uid) ?? 0,
        whatsappMessages: whatsappMessageCounts.get(uid) ?? 0,
        lastWhatsAppMessageAt: lastWhatsAppMessageAt.get(uid) ?? null
      }
    };
  });
}

export async function getAdminUserSnapshot(uid: string): Promise<AdminUserSnapshot | null> {
  const snapshots = await listAdminUserSnapshots();
  return snapshots.find((entry) => entry.uid === uid) ?? null;
}

export async function getUserCategories(uid: string): Promise<UserCategory[]> {
  await ensureGlobalCategoriesSeed();

  const { data, error } = await db
    .from('app_categories')
    .select('id, uid, name, type, color, icon')
    .in('uid', [GLOBAL_CATEGORIES_UID, uid])
    .order('name', { ascending: true });
  assertNoError(error, 'getUserCategories');

  const rows = (data ?? []) as Array<{
    id: string;
    uid: string;
    name: string;
    type: 'income' | 'expense';
    color: string;
    icon: string;
  }>;

  const byKey = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.type}:${row.name.trim().toLowerCase()}`;
    const current = byKey.get(key);
    if (!current || row.uid === uid) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      color: row.color,
      icon: row.icon
    }));
}

export async function addUserCategory(uid: string, input: Omit<UserCategory, 'id'>): Promise<string> {
  const normalizedName = input.name.trim();
  if (!normalizedName) throw new Error('addUserCategory: nome da categoria obrigatorio');

  const { data: existing, error: existingError } = await db
    .from('app_categories')
    .select('id')
    .in('uid', [GLOBAL_CATEGORIES_UID, uid])
    .eq('type', input.type)
    .ilike('name', normalizedName)
    .limit(1);
  assertNoError(existingError, 'addUserCategory.exists');
  if ((existing ?? []).length > 0) {
    throw new Error('Categoria ja existe.');
  }

  const { data, error } = await db
    .from('app_categories')
    .insert({
      uid,
      name: normalizedName,
      type: input.type,
      color: input.color,
      icon: input.icon,
      created_at: new Date().toISOString()
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'addUserCategory');
  if (!data?.id) throw new Error('addUserCategory: response sem id');
  return data.id;
}

export async function updateUserCategory(
  uid: string,
  categoryId: string,
  changes: Partial<Omit<UserCategory, 'id'>>
): Promise<void> {
  const { data: current, error: currentError } = await db
    .from('app_categories')
    .select('name, type')
    .eq('uid', uid)
    .eq('id', categoryId)
    .maybeSingle<{ name: string; type: 'income' | 'expense' }>();
  assertNoError(currentError, 'updateUserCategory.current');
  if (!current) return;

  const targetName = typeof changes.name === 'string' ? changes.name.trim() : current.name;
  const targetType = typeof changes.type === 'string' ? changes.type : current.type;
  if (!targetName) {
    throw new Error('updateUserCategory: nome da categoria obrigatorio');
  }

  if (targetName.toLowerCase() !== current.name.toLowerCase() || targetType !== current.type) {
    const { data: existing, error: existingError } = await db
      .from('app_categories')
      .select('id')
      .in('uid', [GLOBAL_CATEGORIES_UID, uid])
      .eq('type', targetType)
      .ilike('name', targetName)
      .neq('id', categoryId)
      .limit(1);
    assertNoError(existingError, 'updateUserCategory.exists');
    if ((existing ?? []).length > 0) {
      throw new Error('Categoria ja existe.');
    }
  }

  const updates: Record<string, unknown> = {};
  if (typeof changes.name === 'string') updates.name = targetName;
  if (typeof changes.type === 'string') updates.type = changes.type;
  if (typeof changes.color === 'string') updates.color = changes.color;
  if (typeof changes.icon === 'string') updates.icon = changes.icon;
  if (Object.keys(updates).length === 0) return;

  const { error } = await db
    .from('app_categories')
    .update(updates)
    .eq('uid', uid)
    .eq('id', categoryId);
  assertNoError(error, 'updateUserCategory');
}

export async function deleteUserCategory(uid: string, categoryId: string): Promise<void> {
  const { error } = await db
    .from('app_categories')
    .delete()
    .eq('uid', uid)
    .eq('id', categoryId);
  assertNoError(error, 'deleteUserCategory');
}

function mapTransaction(row: DbTransactionRow): UserTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: toNumber(row.amount),
    date: row.date,
    monthKey: row.month_key,
    category: row.category,
    description: row.description,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getRecentTransactions(uid: string, limitCount = 50): Promise<UserTransaction[]> {
  const { data, error } = await db
    .from('app_transactions')
    .select('id, type, amount, date, month_key, category, description, payment_method, created_at, updated_at')
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(limitCount);
  assertNoError(error, 'getRecentTransactions');
  return ((data ?? []) as DbTransactionRow[]).map(mapTransaction);
}

export async function getTransactionsByMonth(uid: string, monthKey: string): Promise<UserTransaction[]> {
  const { data, error } = await db
    .from('app_transactions')
    .select('id, type, amount, date, month_key, category, description, payment_method, created_at, updated_at')
    .eq('uid', uid)
    .eq('month_key', monthKey)
    .order('date', { ascending: false });
  assertNoError(error, 'getTransactionsByMonth');
  return ((data ?? []) as DbTransactionRow[]).map(mapTransaction);
}

export async function addUserTransaction(uid: string, input: CreateTransactionInput): Promise<string> {
  const monthKey = monthKeyFromDate(input.date);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('app_transactions')
    .insert({
      uid,
      type: input.type,
      amount: input.amount,
      date: input.date,
      month_key: monthKey,
      category: input.category,
      description: input.description,
      payment_method: input.paymentMethod,
      created_at: now,
      updated_at: now
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'addUserTransaction');
  if (!data?.id) throw new Error('addUserTransaction: response sem id');
  return data.id;
}

export async function updateUserTransaction(
  uid: string,
  transactionId: string,
  changes: Partial<Omit<UserTransaction, 'id' | 'createdAt'>>
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof changes.type === 'string') updates.type = changes.type;
  if (typeof changes.amount === 'number') updates.amount = changes.amount;
  if (typeof changes.date === 'string') {
    updates.date = changes.date;
    updates.month_key = monthKeyFromDate(changes.date);
  }
  if (typeof changes.monthKey === 'string') updates.month_key = changes.monthKey;
  if (typeof changes.category === 'string') updates.category = changes.category;
  if (typeof changes.description === 'string') {
    updates.description = changes.description.slice(0, 500);
  }
  if (changes.paymentMethod) updates.payment_method = changes.paymentMethod;

  if (Object.keys(updates).length <= 1) return; // Only updated_at

  const { error } = await db
    .from('app_transactions')
    .update(updates)
    .eq('uid', uid)
    .eq('id', transactionId);
  assertNoError(error, 'updateUserTransaction');
}

export async function deleteUserTransaction(uid: string, transactionId: string): Promise<void> {
  const { error } = await db
    .from('app_transactions')
    .delete()
    .eq('uid', uid)
    .eq('id', transactionId);
  assertNoError(error, 'deleteUserTransaction');
}

export async function getUserTransactionById(uid: string, transactionId: string): Promise<UserTransaction | null> {
  const { data, error } = await db
    .from('app_transactions')
    .select('id, type, amount, date, month_key, category, description, payment_method, created_at, updated_at')
    .eq('uid', uid)
    .eq('id', transactionId)
    .maybeSingle<{
      id: string;
      type: 'income' | 'expense';
      amount: number;
      date: string;
      month_key: string;
      category: string;
      description: string;
      payment_method: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
      created_at: string;
      updated_at: string;
    }>();
  assertNoError(error, 'getUserTransactionById');
  return data ? mapTransaction(data) : null;
}

export async function restoreUserTransaction(
  uid: string,
  transactionId: string,
  transaction: Omit<UserTransaction, 'id'>
): Promise<void> {
  const { error } = await db
    .from('app_transactions')
    .upsert(
      {
        id: transactionId,
        uid,
        type: transaction.type,
        amount: transaction.amount,
        date: transaction.date,
        month_key: monthKeyFromDate(transaction.date),
        category: transaction.category,
        description: transaction.description,
        payment_method: transaction.paymentMethod,
        created_at: transaction.createdAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
  assertNoError(error, 'restoreUserTransaction');
}

function mapReminder(row: DbReminderRow): UserReminder {
  return {
    id: row.id,
    reminderKind: row.reminder_kind,
    title: row.title,
    amount: row.amount == null ? null : toNumber(row.amount),
    dueDate: row.due_date,
    dueTime: row.due_time,
    dueAt: row.due_at,
    notifiedAt: row.notified_at,
    notifyPhone: row.notify_phone,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function addUserReminder(uid: string, input: CreateReminderInput): Promise<string> {
  const now = new Date().toISOString();
  const reminderKind = normalizeReminderKind(input.reminderKind, input.type);
  const financialType = reminderKind === 'general' ? null : reminderKind;
  const rawAmount = input.amount;
  const amount = reminderKind === 'general'
    ? null
    : (typeof rawAmount === 'number' && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null);
  if (reminderKind !== 'general' && (amount == null || financialType == null)) {
    throw new Error('addUserReminder: financial reminder requires amount and type');
  }

  const normalizedDueTime = normalizeDueTime(input.dueTime ?? null);
  const dueAt = reminderDueAtFromDateAndTime(input.dueDate, normalizedDueTime);
  const normalizedNotifyPhone = input.notifyPhone ? normalizePhoneNumber(input.notifyPhone) : '';
  const { data, error } = await db
    .from('app_reminders')
    .insert({
      uid,
      reminder_kind: reminderKind,
      title: input.title,
      amount,
      due_date: input.dueDate,
      due_time: normalizedDueTime,
      due_at: dueAt,
      notify_phone: normalizedNotifyPhone.length >= 10 ? normalizedNotifyPhone : null,
      type: financialType,
      status: input.status ?? 'pending',
      created_at: now,
      updated_at: now
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'addUserReminder');
  if (!data?.id) throw new Error('addUserReminder: response sem id');
  return data.id;
}

export async function getUserReminders(uid: string): Promise<UserReminder[]> {
  const { data, error } = await db
    .from('app_reminders')
    .select('id, reminder_kind, title, amount, due_date, due_time, due_at, notified_at, notify_phone, type, status, created_at, updated_at')
    .eq('uid', uid)
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true });
  assertNoError(error, 'getUserReminders');
  return ((data ?? []) as DbReminderRow[]).map(mapReminder);
}

export async function getUserReminderById(uid: string, reminderId: string): Promise<UserReminder | null> {
  const { data, error } = await db
    .from('app_reminders')
    .select('id, reminder_kind, title, amount, due_date, due_time, due_at, notified_at, notify_phone, type, status, created_at, updated_at')
    .eq('uid', uid)
    .eq('id', reminderId)
    .maybeSingle<DbReminderRow>();
  assertNoError(error, 'getUserReminderById');
  return data ? mapReminder(data) : null;
}

export async function updateUserReminder(
  uid: string,
  reminderId: string,
  changes: Partial<Omit<UserReminder, 'id' | 'createdAt'>>
): Promise<void> {
  const { data: currentData, error: currentError } = await db
    .from('app_reminders')
    .select('reminder_kind, amount, due_date, due_time, type')
    .eq('uid', uid)
    .eq('id', reminderId)
    .maybeSingle<{
      reminder_kind: 'general' | 'payable' | 'receivable';
      amount: number | string | null;
      due_date: string;
      due_time: string | null;
      type: 'payable' | 'receivable' | null;
    }>();
  assertNoError(currentError, 'updateUserReminder.loadCurrent');
  if (!currentData) return;

  const nextKind = 'reminderKind' in changes
    ? normalizeReminderKind(changes.reminderKind, changes.type)
    : currentData.reminder_kind;

  const nextDueDate = typeof changes.dueDate === 'string'
    ? changes.dueDate
    : currentData.due_date;
  const nextDueTime = 'dueTime' in changes
    ? normalizeDueTime(changes.dueTime ?? null)
    : currentData.due_time;

  const nextAmount: number | null = nextKind === 'general'
    ? null
    : (typeof changes.amount === 'number'
      ? (Number.isFinite(changes.amount) && changes.amount > 0 ? changes.amount : null)
      : (currentData.amount == null ? null : toNumber(currentData.amount)));
  const nextType: 'payable' | 'receivable' | null = nextKind === 'general'
    ? null
    : nextKind;
  if (nextKind !== 'general' && (nextAmount == null || nextType == null)) {
    throw new Error('updateUserReminder: financial reminder requires amount and type');
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof changes.title === 'string') updates.title = changes.title;
  updates.reminder_kind = nextKind;
  updates.amount = nextAmount;
  updates.type = nextType;
  if (typeof changes.dueDate === 'string') updates.due_date = changes.dueDate;
  if ('dueTime' in changes) updates.due_time = nextDueTime;
  if (typeof changes.status === 'string') {
    updates.status = changes.status;
    if (changes.status === 'pending') {
      updates.notified_at = null;
    }
  }

  if ('dueDate' in changes || 'dueTime' in changes) {
    updates.due_at = reminderDueAtFromDateAndTime(nextDueDate, nextDueTime);
    updates.notified_at = null;
  }

  const { error } = await db
    .from('app_reminders')
    .update(updates)
    .eq('uid', uid)
    .eq('id', reminderId);
  assertNoError(error, 'updateUserReminder');
}

export async function deleteUserReminder(uid: string, reminderId: string): Promise<void> {
  const { error } = await db
    .from('app_reminders')
    .delete()
    .eq('uid', uid)
    .eq('id', reminderId);
  assertNoError(error, 'deleteUserReminder');
}

export interface DueWhatsAppReminder {
  id: string;
  uid: string;
  reminderKind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | null;
  dueDate: string;
  dueTime: string;
  type: 'payable' | 'receivable' | null;
  notifyPhone: string;
}

interface DbDueWhatsAppReminderRow {
  id: string;
  uid: string;
  reminder_kind: 'general' | 'payable' | 'receivable';
  title: string;
  amount: number | string | null;
  due_date: string;
  due_time: string | null;
  type: 'payable' | 'receivable' | null;
  notify_phone: string | null;
}

export async function getDueWhatsAppReminders(
  nowIso: string,
  limitCount: number
): Promise<DueWhatsAppReminder[]> {
  const safeLimit = Math.max(1, Math.min(limitCount, 200));
  const { data, error } = await db
    .from('app_reminders')
    .select('id, uid, reminder_kind, title, amount, due_date, due_time, type, notify_phone')
    .eq('status', 'pending')
    .is('notified_at', null)
    .not('due_at', 'is', null)
    .not('notify_phone', 'is', null)
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(safeLimit);
  assertNoError(error, 'getDueWhatsAppReminders');

  const rows = (data ?? []) as DbDueWhatsAppReminderRow[];
  return rows
    .map((row) => {
      const dueTime = normalizeDueTime(row.due_time);
      const notifyPhone = row.notify_phone ? normalizePhoneNumber(row.notify_phone) : '';
      if (!dueTime || notifyPhone.length < 10) return null;
      return {
        id: row.id,
        uid: row.uid,
        reminderKind: row.reminder_kind,
        title: row.title,
        amount: row.amount == null ? null : toNumber(row.amount),
        dueDate: row.due_date,
        dueTime,
        type: row.type,
        notifyPhone
      } as DueWhatsAppReminder;
    })
    .filter((entry): entry is DueWhatsAppReminder => Boolean(entry));
}

export async function markReminderAsNotified(
  uid: string,
  reminderId: string,
  notifiedAtIso: string
): Promise<boolean> {
  const { data, error } = await db
    .from('app_reminders')
    .update({
      notified_at: notifiedAtIso,
      updated_at: notifiedAtIso
    })
    .eq('uid', uid)
    .eq('id', reminderId)
    .is('notified_at', null)
    .select('id')
    .maybeSingle<{ id: string }>();
  assertNoError(error, 'markReminderAsNotified');
  return Boolean(data?.id);
}

export interface CreateRecurringTransactionInput {
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  paymentMethod: 'pix' | 'credit' | 'debit' | 'cash' | 'transfer' | 'boleto';
  frequency: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  endDate: string | null;
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

function mapRecurring(row: DbRecurringRow): UserRecurringTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: toNumber(row.amount),
    category: row.category,
    description: row.description,
    paymentMethod: row.payment_method,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    nextDueDate: row.next_due_date,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function advanceDateBackend(dateStr: string, frequency: 'weekly' | 'monthly' | 'yearly'): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function addRecurringTransaction(
  uid: string,
  input: CreateRecurringTransactionInput
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('app_recurring_transactions')
    .insert({
      uid,
      type: input.type,
      amount: input.amount,
      category: input.category,
      description: input.description,
      payment_method: input.paymentMethod,
      frequency: input.frequency,
      start_date: input.startDate,
      end_date: input.endDate,
      next_due_date: input.startDate,
      active: true,
      created_at: now,
      updated_at: now
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'addRecurringTransaction');
  if (!data?.id) throw new Error('addRecurringTransaction: response sem id');
  return data.id;
}

export async function getActiveRecurringTransactions(uid: string): Promise<UserRecurringTransaction[]> {
  const { data, error } = await db
    .from('app_recurring_transactions')
    .select('id, type, amount, category, description, payment_method, frequency, start_date, end_date, next_due_date, active, created_at, updated_at')
    .eq('uid', uid)
    .eq('active', true);
  assertNoError(error, 'getActiveRecurringTransactions');
  return ((data ?? []) as DbRecurringRow[]).map(mapRecurring);
}

export async function getRecurringTransactions(uid: string): Promise<UserRecurringTransaction[]> {
  const { data, error } = await db
    .from('app_recurring_transactions')
    .select('id, type, amount, category, description, payment_method, frequency, start_date, end_date, next_due_date, active, created_at, updated_at')
    .eq('uid', uid)
    .order('next_due_date', { ascending: true });
  assertNoError(error, 'getRecurringTransactions');
  return ((data ?? []) as DbRecurringRow[]).map(mapRecurring);
}

export async function deleteRecurringTransaction(uid: string, recurringId: string): Promise<void> {
  const { error } = await db
    .from('app_recurring_transactions')
    .delete()
    .eq('uid', uid)
    .eq('id', recurringId);
  assertNoError(error, 'deleteRecurringTransaction');
}

export async function updateRecurringTransactionBackend(
  uid: string,
  recurringId: string,
  changes: Partial<Omit<UserRecurringTransaction, 'id' | 'createdAt'>>
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof changes.type === 'string') updates.type = changes.type;
  if (typeof changes.amount === 'number') updates.amount = changes.amount;
  if (typeof changes.category === 'string') updates.category = changes.category;
  if (typeof changes.description === 'string') updates.description = changes.description;
  if (typeof changes.paymentMethod === 'string') updates.payment_method = changes.paymentMethod;
  if (typeof changes.frequency === 'string') updates.frequency = changes.frequency;
  if (typeof changes.startDate === 'string') updates.start_date = changes.startDate;
  if (typeof changes.endDate === 'string' || changes.endDate === null) updates.end_date = changes.endDate;
  if (typeof changes.nextDueDate === 'string') updates.next_due_date = changes.nextDueDate;
  if (typeof changes.active === 'boolean') updates.active = changes.active;

  const { error } = await db
    .from('app_recurring_transactions')
    .update(updates)
    .eq('uid', uid)
    .eq('id', recurringId);
  assertNoError(error, 'updateRecurringTransactionBackend');
}

export async function generateOverdueRecurringTransactions(uid: string): Promise<number> {
  const today = getBrasiliaISOString().split('T')[0];
  const active = await getActiveRecurringTransactions(uid);
  let generated = 0;

  for (const rt of active) {
    let nextDate = rt.nextDueDate;
    while (nextDate <= today) {
      await addUserTransaction(uid, {
        type: rt.type,
        amount: rt.amount,
        date: nextDate,
        category: rt.category,
        description: rt.description,
        paymentMethod: rt.paymentMethod
      });
      generated++;
      nextDate = advanceDateBackend(nextDate, rt.frequency);
    }
    const updates: Partial<Omit<UserRecurringTransaction, 'id' | 'createdAt'>> = { nextDueDate: nextDate };
    if (rt.endDate && nextDate > rt.endDate) updates.active = false;
    await updateRecurringTransactionBackend(uid, rt.id, updates);
  }

  return generated;
}

const allowedNumbersCache = new Map<string, { numbers: string[]; cachedAt: number }>();

function invalidateAllowedNumbersCache(uid: string): void {
  allowedNumbersCache.delete(uid);
}

export async function getAllowedWhatsAppNumbers(uid: string): Promise<string[]> {
  const cached = allowedNumbersCache.get(uid);
  if (cached && Date.now() - cached.cachedAt <= ALLOWED_NUMBERS_CACHE_TTL_MS) {
    return cached.numbers;
  }

  const { data, error } = await db
    .from('app_user_settings')
    .select('whatsapp_allowed_numbers')
    .eq('uid', uid)
    .maybeSingle<{ whatsapp_allowed_numbers: unknown }>();
  assertNoError(error, 'getAllowedWhatsAppNumbers');

  const numbers = normalizeAllowedNumbers(data?.whatsapp_allowed_numbers);
  allowedNumbersCache.set(uid, { numbers, cachedAt: Date.now() });
  return numbers;
}

export function invalidateAllowedNumbersCacheForUid(uid: string): void {
  invalidateAllowedNumbersCache(uid);
}

interface ProfileSettingsData {
  whatsappAllowedNumbers?: unknown;
}

interface ProfileSettingsEntry {
  uid: string;
  data: ProfileSettingsData;
}

interface ProfileScanCache {
  fetchedAt: number;
  entries: ProfileSettingsEntry[];
}

let profileScanCache: ProfileScanCache | null = null;

function normalizeAllowedNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const allVariants = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const digits = normalizePhoneNumber(item);
    if (digits.length < 10) continue;
    for (const variant of brazilianPhoneVariants(digits)) {
      allVariants.add(variant);
    }
  }
  return [...allVariants];
}

async function scanAllProfileSettings(forceRefresh = false): Promise<ProfileSettingsEntry[]> {
  if (!forceRefresh && profileScanCache) {
    const ageMs = Date.now() - profileScanCache.fetchedAt;
    if (ageMs <= PROFILE_SCAN_CACHE_TTL_MS) return profileScanCache.entries;
  }

  const { data, error } = await db.from('app_user_settings').select('uid, whatsapp_allowed_numbers');
  assertNoError(error, 'scanAllProfileSettings');

  const entries: ProfileSettingsEntry[] = (data ?? []).map((row) => ({
    uid: row.uid as string,
    data: { whatsappAllowedNumbers: row.whatsapp_allowed_numbers }
  }));
  profileScanCache = { fetchedAt: Date.now(), entries };
  return entries;
}

async function fallbackIsPhoneAllowedForAnyAccount(variants: string[]): Promise<boolean> {
  const profiles = await scanAllProfileSettings();
  return profiles.some((entry) => {
    const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
    return variants.some((variant) => allowed.includes(variant));
  });
}

async function fallbackResolveUidFromPhone(variants: string[]): Promise<string | null> {
  let profiles = await scanAllProfileSettings();
  for (const entry of profiles) {
    const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
    if (variants.some((variant) => allowed.includes(variant))) return entry.uid;
  }

  profiles = await scanAllProfileSettings(true);
  for (const entry of profiles) {
    const rawValue = entry.data.whatsappAllowedNumbers;
    const allowed = normalizeAllowedNumbers(rawValue);
    logger.info('RESOLVE_SCAN_DEBUG: checking profile', {
      uid: entry.uid,
      rawType: typeof rawValue,
      isArray: Array.isArray(rawValue),
      rawPreview: JSON.stringify(rawValue).slice(0, 200),
      allowedVariants: allowed.slice(0, 10),
      searchingFor: variants
    });
    if (variants.some((variant) => allowed.includes(variant))) {
      logger.info('RESOLVE_SCAN_MATCH: phone matched to account', {
        uid: entry.uid,
        matchedVariant: variants.find((v) => allowed.includes(v))
      });
      return entry.uid;
    }
  }

  return null;
}

export async function isPhoneAllowedForUid(uid: string, phone: string): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return false;
  const allowed = await getAllowedWhatsAppNumbers(uid);
  const phoneVariants = brazilianPhoneVariants(normalizedPhone);
  return phoneVariants.some((v) => allowed.includes(v));
}

export async function isPhoneAllowedForAnyAccount(phone: string): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return false;

  const variants = brazilianPhoneVariants(normalizedPhone);
  try {
    const results = await Promise.all(
      variants.map(async (v) => {
        const { data, error } = await db
          .from('app_user_settings')
          .select('uid')
          .contains('whatsapp_allowed_numbers', [v])
          .limit(1);
        assertNoError(error, 'isPhoneAllowedForAnyAccount.query');
        return (data ?? []).length > 0;
      })
    );
    return results.some(Boolean);
  } catch (error) {
    logger.warn('isPhoneAllowedForAnyAccount direct query failed, fallback scan', error);
    try {
      return await fallbackIsPhoneAllowedForAnyAccount(variants);
    } catch (fallbackError) {
      logger.error('isPhoneAllowedForAnyAccount fallback failed', fallbackError);
      return false;
    }
  }
}

export async function resolveUidFromPhone(phone: string): Promise<string | null> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const variants = brazilianPhoneVariants(normalizedPhone);
  try {
    const result = await fallbackResolveUidFromPhone(variants);
    if (!result) {
      const profiles = await scanAllProfileSettings();
      const allNumbers = profiles.flatMap((p) => normalizeAllowedNumbers(p.data.whatsappAllowedNumbers));
      logger.info('MSG_RESOLVE_DEBUG: phone not found in any account', {
        incomingPhone: normalizedPhone,
        variantsTried: variants,
        registeredNumbers: allNumbers.slice(0, 20),
        totalUsers: profiles.length
      });
    }
    return result;
  } catch (error) {
    logger.error('resolveUidFromPhone: failed to scan profiles', error);
    return null;
  }
}

const bindingCache = new Map<string, { binding: WhatsAppPhoneBinding | null; cachedAt: number }>();

function getCachedBinding(phone: string): WhatsAppPhoneBinding | null | undefined {
  const entry = bindingCache.get(phone);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > BINDING_CACHE_TTL_MS) {
    bindingCache.delete(phone);
    return undefined;
  }
  return entry.binding;
}

function setCachedBinding(phone: string, binding: WhatsAppPhoneBinding | null): void {
  bindingCache.set(phone, { binding, cachedAt: Date.now() });
}

export async function getPhoneBinding(phone: string): Promise<WhatsAppPhoneBinding | null> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const cached = getCachedBinding(normalizedPhone);
  if (cached !== undefined) return cached;

  const variants = brazilianPhoneVariants(normalizedPhone);
  const { data, error } = await db
    .from(BINDINGS_COLLECTION_NAME)
    .select('variant_phone, phone, uid, linked_at, updated_at')
    .in('variant_phone', variants);
  assertNoError(error, 'getPhoneBinding');

  const rows = (data ?? []) as Array<{
    variant_phone: string;
    phone: string;
    uid: string;
    linked_at: string;
    updated_at: string;
  }>;
  const byVariant = new Map(rows.map((row) => [row.variant_phone, row]));

  for (const variant of variants) {
    const row = byVariant.get(variant);
    if (!row) continue;
    const result: WhatsAppPhoneBinding = {
      phone: row.phone,
      uid: row.uid,
      linkedAt: row.linked_at,
      updatedAt: row.updated_at
    };
    setCachedBinding(normalizedPhone, result);
    return result;
  }

  setCachedBinding(normalizedPhone, null);
  return null;
}

export async function savePhoneBinding(phone: string, uid: string): Promise<void> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) throw new Error('Invalid phone for binding');
  if (!uid || uid.trim().length === 0) throw new Error('Invalid uid for binding');

  const now = new Date().toISOString();
  const variants = brazilianPhoneVariants(normalizedPhone);
  const canonicalPhone = variants[0] || normalizedPhone;

  const { data: existingRows, error: existingError } = await db
    .from(BINDINGS_COLLECTION_NAME)
    .select('variant_phone, linked_at')
    .in('variant_phone', variants);
  assertNoError(existingError, 'savePhoneBinding.existing');

  const firstLinkedAt = (existingRows ?? [])
    .map((row) => row.linked_at as string | undefined)
    .find((value) => typeof value === 'string' && value.length > 0);
  const linkedAt = firstLinkedAt ?? now;

  const rows = variants.map((variant) => ({
    variant_phone: variant,
    phone: canonicalPhone,
    uid,
    linked_at: linkedAt,
    updated_at: now
  }));

  const { error } = await db.from(BINDINGS_COLLECTION_NAME).upsert(rows, { onConflict: 'variant_phone' });
  assertNoError(error, 'savePhoneBinding.upsert');

  for (const variant of variants) bindingCache.delete(variant);
  bindingCache.delete(normalizedPhone);
}

export interface WhatsAppAuthSnapshotFile {
  filename: string;
  contentBase64: string;
}

async function loadAuthSnapshotByDocId(docId: string): Promise<WhatsAppAuthSnapshotFile[]> {
  try {
    const { data, error } = await db
      .from(AUTH_STATE_FILES_SUBCOLLECTION)
      .select('filename, content_base64')
      .eq('runtime_doc_id', docId)
      .order('filename', { ascending: true });
    assertNoError(error, 'loadAuthSnapshotByDocId');

    return (data ?? [])
      .map((row) => {
        const filename = typeof row.filename === 'string' ? row.filename.trim() : '';
        const contentBase64 = typeof row.content_base64 === 'string' ? row.content_base64.trim() : '';
        if (!filename || !contentBase64) return null;
        return { filename, contentBase64 };
      })
      .filter((entry): entry is WhatsAppAuthSnapshotFile => Boolean(entry));
  } catch (error) {
    logger.error('Failed to load WhatsApp auth snapshot from Supabase', { docId, error });
    return [];
  }
}

export async function loadWhatsAppAuthSnapshot(slotId: WhatsAppSlotId): Promise<WhatsAppAuthSnapshotFile[]> {
  const slotDocId = authStateDocId(slotId);
  const slotSnapshot = await loadAuthSnapshotByDocId(slotDocId);
  if (slotSnapshot.length > 0) return slotSnapshot;
  if (slotId !== 'wa1') return [];

  const legacySnapshot = await loadAuthSnapshotByDocId(AUTH_STATE_DOC_ID_LEGACY);
  if (legacySnapshot.length > 0) {
    logger.info('Using legacy WhatsApp auth snapshot for wa1 fallback', {
      legacyDocId: AUTH_STATE_DOC_ID_LEGACY,
      fileCount: legacySnapshot.length
    });
  }
  return legacySnapshot;
}

export async function saveWhatsAppAuthSnapshot(
  slotId: WhatsAppSlotId,
  files: WhatsAppAuthSnapshotFile[]
): Promise<void> {
  const now = new Date().toISOString();
  const normalized = files
    .map((file) => ({
      filename: file.filename.trim(),
      contentBase64: file.contentBase64.trim()
    }))
    .filter((file) => file.filename.length > 0 && file.contentBase64.length > 0);

  const docId = authStateDocId(slotId);
  // Ensure parent row exists before touching child rows to satisfy FK.
  const { error: ensureRootError } = await db
    .from(AUTH_STATE_COLLECTION_NAME)
    .upsert({ doc_id: docId, file_count: normalized.length, updated_at: now }, { onConflict: 'doc_id' });
  assertNoError(ensureRootError, 'saveWhatsAppAuthSnapshot.ensureRoot');

  const { data: existingRows, error: existingError } = await db
    .from(AUTH_STATE_FILES_SUBCOLLECTION)
    .select('file_doc_id')
    .eq('runtime_doc_id', docId);
  assertNoError(existingError, 'saveWhatsAppAuthSnapshot.existing');

  const keepIds = new Set<string>();
  const upsertRows = normalized.map((file) => {
    const fileDocId = authFileDocId(file.filename);
    keepIds.add(fileDocId);
    return {
      runtime_doc_id: docId,
      file_doc_id: fileDocId,
      filename: file.filename,
      content_base64: file.contentBase64,
      updated_at: now
    };
  });

  if (upsertRows.length > 0) {
    const { error } = await db
      .from(AUTH_STATE_FILES_SUBCOLLECTION)
      .upsert(upsertRows, { onConflict: 'runtime_doc_id,file_doc_id' });
    assertNoError(error, 'saveWhatsAppAuthSnapshot.upsertFiles');
  }

  const deleteIds = (existingRows ?? [])
    .map((row) => row.file_doc_id as string)
    .filter((id) => !keepIds.has(id));
  if (deleteIds.length > 0) {
    const { error } = await db
      .from(AUTH_STATE_FILES_SUBCOLLECTION)
      .delete()
      .eq('runtime_doc_id', docId)
      .in('file_doc_id', deleteIds);
    assertNoError(error, 'saveWhatsAppAuthSnapshot.deleteOld');
  }

  const { error: rootError } = await db
    .from(AUTH_STATE_COLLECTION_NAME)
    .upsert({ doc_id: docId, file_count: normalized.length, updated_at: now }, { onConflict: 'doc_id' });
  assertNoError(rootError, 'saveWhatsAppAuthSnapshot.rootUpsert');
}

export async function clearWhatsAppAuthSnapshot(slotId: WhatsAppSlotId): Promise<void> {
  const docId = authStateDocId(slotId);
  const { error: deleteError } = await db
    .from(AUTH_STATE_FILES_SUBCOLLECTION)
    .delete()
    .eq('runtime_doc_id', docId);
  assertNoError(deleteError, 'clearWhatsAppAuthSnapshot.delete');

  const { error: rootError } = await db
    .from(AUTH_STATE_COLLECTION_NAME)
    .upsert({ doc_id: docId, file_count: 0, updated_at: new Date().toISOString() }, { onConflict: 'doc_id' });
  assertNoError(rootError, 'clearWhatsAppAuthSnapshot.root');
}

export async function getRecentConversationByPhone(
  uid: string,
  phone: string,
  limitCount: number,
  _clientId?: WhatsAppSlotId
): Promise<WhatsAppConversationMessage[]> {
  if (!uid || uid.trim().length === 0) return [];
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return [];

  const [inboundRes, outboundRes] = await Promise.all([
    db
      .from(COLLECTION_NAME)
      .select('id, direction, owner_uid, status, created_at, text, metadata')
      .eq('owner_uid', uid)
      .eq('from_phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(limitCount),
    db
      .from(COLLECTION_NAME)
      .select('id, direction, owner_uid, status, created_at, text, metadata')
      .eq('owner_uid', uid)
      .eq('to_phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(limitCount)
  ]);
  assertNoError(inboundRes.error, 'getRecentConversationByPhone.inbound');
  assertNoError(outboundRes.error, 'getRecentConversationByPhone.outbound');

  return mapWhatsAppRowsToConversation(
    [
      ...((inboundRes.data ?? []) as DbWhatsAppMessageRow[]),
      ...((outboundRes.data ?? []) as DbWhatsAppMessageRow[])
    ],
    uid,
    limitCount
  );
}

function mapWhatsAppRowsToConversation(
  rows: DbWhatsAppMessageRow[],
  uid: string,
  limitCount: number
): WhatsAppConversationMessage[] {
  const docsById = new Map<string, { createdAt: string; role: 'user' | 'assistant'; content: string }>();
  const pushRows = (rows: DbWhatsAppMessageRow[]): void => {
    for (const row of rows) {
      if (row.status === 'failed') continue;
      if (!row.created_at) continue;
      if (row.owner_uid !== uid) continue;
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      const content = text || (row.metadata?.hasImage ? 'Imagem enviada no WhatsApp.' : '');
      if (!content) continue;
      docsById.set(row.id, {
        createdAt: row.created_at,
        role: row.direction === 'inbound' ? 'user' : 'assistant',
        content: content.slice(0, 800)
      });
    }
  };

  pushRows(rows);

  return [...docsById.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limitCount)
    .map((entry) => ({ role: entry.role, content: entry.content }));
}

export async function getRecentConversationByOwnerUid(
  uid: string,
  limitCount: number
): Promise<WhatsAppConversationMessage[]> {
  if (!uid || uid.trim().length === 0) return [];

  const { data, error } = await db
    .from(COLLECTION_NAME)
    .select('id, direction, owner_uid, status, created_at, text, metadata')
    .eq('owner_uid', uid)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, limitCount * 2));
  assertNoError(error, 'getRecentConversationByOwnerUid');

  return mapWhatsAppRowsToConversation((data ?? []) as DbWhatsAppMessageRow[], uid, limitCount);
}

const lastActivityCache = new Map<string, { activity: string | null; cachedAt: number }>();

function lastActivityCacheKey(uid: string, phone: string): string {
  return `${uid}:${phone}`;
}

export async function getLastConversationActivityByPhone(
  uid: string,
  phone: string,
  _clientId?: WhatsAppSlotId
): Promise<string | null> {
  if (!uid || uid.trim().length === 0) return null;
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const cacheKey = lastActivityCacheKey(uid, normalizedPhone);
  const cached = lastActivityCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt <= LAST_ACTIVITY_CACHE_TTL_MS) return cached.activity;

  try {
    const [inboundRes, outboundRes] = await Promise.all([
      db
        .from(COLLECTION_NAME)
        .select('created_at')
        .eq('owner_uid', uid)
        .eq('from_phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(1),
      db
        .from(COLLECTION_NAME)
        .select('created_at')
        .eq('owner_uid', uid)
        .eq('to_phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(1)
    ]);
    assertNoError(inboundRes.error, 'getLastConversationActivityByPhone.inbound');
    assertNoError(outboundRes.error, 'getLastConversationActivityByPhone.outbound');

    const inboundIso = (inboundRes.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
    const outboundIso = (outboundRes.data?.[0] as { created_at?: string } | undefined)?.created_at ?? null;

    let result: string | null = null;
    if (!inboundIso && !outboundIso) result = null;
    else if (!inboundIso) result = outboundIso;
    else if (!outboundIso) result = inboundIso;
    else result = inboundIso > outboundIso ? inboundIso : outboundIso;

    lastActivityCache.set(cacheKey, { activity: result, cachedAt: Date.now() });
    return result;
  } catch (error) {
    logger.warn('getLastConversationActivityByPhone failed', error);
    return null;
  }
}

function asSlotId(value: unknown): WhatsAppSlotId | null {
  return value === 'wa1' ? value : null;
}

export async function getLastConversationClientIdByPhone(
  uid: string,
  phone: string
): Promise<WhatsAppSlotId | null> {
  if (!uid || uid.trim().length === 0) return null;
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  try {
    const [inboundRes, outboundRes] = await Promise.all([
      db
        .from(COLLECTION_NAME)
        .select('created_at, status, client_id')
        .eq('owner_uid', uid)
        .eq('from_phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(5),
      db
        .from(COLLECTION_NAME)
        .select('created_at, status, client_id')
        .eq('owner_uid', uid)
        .eq('to_phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(5)
    ]);
    assertNoError(inboundRes.error, 'getLastConversationClientIdByPhone.inbound');
    assertNoError(outboundRes.error, 'getLastConversationClientIdByPhone.outbound');

    let latestTimestamp = '';
    let latestSlot: WhatsAppSlotId | null = null;
    const inspect = (rows: Array<{ created_at?: string; status?: string; client_id?: string }>): void => {
      for (const row of rows) {
        if (row.status === 'failed') continue;
        if (typeof row.created_at !== 'string' || row.created_at.length === 0) continue;
        const slotId = asSlotId(row.client_id);
        if (!slotId) continue;
        if (row.created_at > latestTimestamp) {
          latestTimestamp = row.created_at;
          latestSlot = slotId;
        }
      }
    };
    inspect((inboundRes.data ?? []) as Array<{ created_at?: string; status?: string; client_id?: string }>);
    inspect((outboundRes.data ?? []) as Array<{ created_at?: string; status?: string; client_id?: string }>);
    return latestSlot;
  } catch (error) {
    logger.warn('getLastConversationClientIdByPhone failed', error);
    return null;
  }
}

function mapChatSession(row: DbChatSessionRow): UserChatSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapChatMessage(row: DbChatMessageRow): UserChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    createdAt: row.created_at
  };
}

export async function getUserChatSessions(uid: string): Promise<UserChatSession[]> {
  const { data, error } = await db
    .from('app_chat_sessions')
    .select('id, title, created_at, updated_at')
    .eq('uid', uid)
    .order('updated_at', { ascending: false });
  assertNoError(error, 'getUserChatSessions');
  return ((data ?? []) as DbChatSessionRow[]).map(mapChatSession);
}

export async function createUserChatSession(uid: string, title: string): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('app_chat_sessions')
    .insert({ uid, title, created_at: now, updated_at: now })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'createUserChatSession');
  if (!data?.id) throw new Error('createUserChatSession: response sem id');
  return data.id;
}

export async function updateUserChatSessionTitle(uid: string, sessionId: string, title: string): Promise<void> {
  const { error } = await db
    .from('app_chat_sessions')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('uid', uid)
    .eq('id', sessionId);
  assertNoError(error, 'updateUserChatSessionTitle');
}

export async function deleteUserChatSession(uid: string, sessionId: string): Promise<void> {
  const { error } = await db
    .from('app_chat_sessions')
    .delete()
    .eq('uid', uid)
    .eq('id', sessionId);
  assertNoError(error, 'deleteUserChatSession');
}

export async function getUserChatMessages(uid: string, sessionId: string): Promise<UserChatMessage[]> {
  const { data, error } = await db
    .from('app_chat_messages')
    .select('id, session_id, role, content, image_url, created_at')
    .eq('uid', uid)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  assertNoError(error, 'getUserChatMessages');
  return ((data ?? []) as DbChatMessageRow[]).map(mapChatMessage);
}

export async function addUserChatMessage(
  uid: string,
  sessionId: string,
  input: { role: 'user' | 'assistant' | 'system'; content: string; imageUrl?: string }
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('app_chat_messages')
    .insert({
      uid,
      session_id: sessionId,
      role: input.role,
      content: input.content,
      image_url: input.imageUrl ?? null,
      created_at: now
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'addUserChatMessage.insert');

  const { error: sessionError } = await db
    .from('app_chat_sessions')
    .update({ updated_at: now })
    .eq('uid', uid)
    .eq('id', sessionId);
  assertNoError(sessionError, 'addUserChatMessage.sessionUpdate');

  if (!data?.id) throw new Error('addUserChatMessage: response sem id');
  return data.id;
}

function mapUserDocument(row: DbUserDocumentRow): UserDocument {
  return {
    id: row.id,
    uid: row.uid,
    source: row.source,
    title: row.title,
    description: row.description,
    normalizedTitle: row.normalized_title,
    normalizedDescription: row.normalized_description,
    searchTokens: Array.isArray(row.search_tokens) ? row.search_tokens.filter((token): token is string => typeof token === 'string') : [],
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at
  };
}

function mapPendingDocument(row: DbPendingDocumentRow): PendingWhatsAppDocumentDraft {
  return {
    id: row.id,
    uid: row.uid,
    sourcePhone: row.source_phone,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    pendingReason: row.pending_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function createPendingWhatsAppDocumentDraft(
  uid: string,
  sourcePhone: string,
  input: CreatePendingWhatsAppDocumentDraftInput
): Promise<string> {
  const now = new Date().toISOString();
  const normalizedPhone = normalizePhoneNumber(sourcePhone);
  const { data, error } = await db
    .from('app_whatsapp_pending_documents')
    .insert({
      id: input.id,
      uid,
      source_phone: normalizedPhone,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      pending_reason: input.pendingReason ?? 'missing_title',
      expires_at: input.expiresAt,
      created_at: now
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'createPendingWhatsAppDocumentDraft');
  if (!data?.id) throw new Error('createPendingWhatsAppDocumentDraft: response sem id');
  return data.id;
}

export async function getActivePendingWhatsAppDocumentDraft(
  uid: string,
  sourcePhone: string
): Promise<PendingWhatsAppDocumentDraft | null> {
  const normalizedPhone = normalizePhoneNumber(sourcePhone);
  const { data, error } = await db
    .from('app_whatsapp_pending_documents')
    .select('id, uid, source_phone, storage_path, mime_type, size_bytes, pending_reason, expires_at, created_at')
    .eq('uid', uid)
    .eq('source_phone', normalizedPhone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DbPendingDocumentRow>();
  assertNoError(error, 'getActivePendingWhatsAppDocumentDraft');
  return data ? mapPendingDocument(data) : null;
}

export async function deletePendingWhatsAppDocumentDraft(id: string): Promise<void> {
  const { error } = await db
    .from('app_whatsapp_pending_documents')
    .delete()
    .eq('id', id);
  assertNoError(error, 'deletePendingWhatsAppDocumentDraft');
}

export async function deleteExpiredPendingWhatsAppDocumentDrafts(uid: string, sourcePhone: string): Promise<void> {
  const normalizedPhone = normalizePhoneNumber(sourcePhone);
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from('app_whatsapp_pending_documents')
    .delete()
    .eq('uid', uid)
    .eq('source_phone', normalizedPhone)
    .lt('expires_at', nowIso);
  assertNoError(error, 'deleteExpiredPendingWhatsAppDocumentDrafts');
}

export async function createUserDocument(uid: string, input: CreateUserDocumentInput): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('app_user_documents')
    .insert({
      ...(input.id ? { id: input.id } : {}),
      uid,
      source: input.source ?? 'whatsapp',
      title: input.title,
      description: input.description ?? null,
      normalized_title: input.normalizedTitle,
      normalized_description: input.normalizedDescription ?? null,
      search_tokens: Array.isArray(input.searchTokens) ? input.searchTokens : [],
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      status: input.status ?? 'ready',
      created_at: now,
      updated_at: now,
      last_accessed_at: null
    })
    .select('id')
    .single<{ id: string }>();
  assertNoError(error, 'createUserDocument');
  if (!data?.id) throw new Error('createUserDocument: response sem id');
  return data.id;
}

export async function touchUserDocumentAccess(uid: string, documentId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from('app_user_documents')
    .update({
      last_accessed_at: now,
      updated_at: now
    })
    .eq('uid', uid)
    .eq('id', documentId);
  assertNoError(error, 'touchUserDocumentAccess');
}

export async function listRecentUserDocuments(uid: string, limitCount: number): Promise<UserDocument[]> {
  const safeLimit = Math.max(1, Math.min(limitCount, 50));
  const { data, error } = await db
    .from('app_user_documents')
    .select('id, uid, source, title, description, normalized_title, normalized_description, search_tokens, storage_path, mime_type, size_bytes, status, created_at, updated_at, last_accessed_at')
    .eq('uid', uid)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  assertNoError(error, 'listRecentUserDocuments');
  return ((data ?? []) as DbUserDocumentRow[]).map(mapUserDocument);
}
