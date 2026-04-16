"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuplicateUserEmailError = exports.DuplicateCategoryError = void 0;
exports.saveWhatsAppMessage = saveWhatsAppMessage;
exports.inboundMessageExists = inboundMessageExists;
exports.saveMessageSafe = saveMessageSafe;
exports.bootstrapUserData = bootstrapUserData;
exports.ensureLocalUserData = ensureLocalUserData;
exports.getUserSettings = getUserSettings;
exports.updateUserSettings = updateUserSettings;
exports.getUserProfile = getUserProfile;
exports.updateUserDisplayName = updateUserDisplayName;
exports.listAdminUserSnapshots = listAdminUserSnapshots;
exports.getAdminUserSnapshot = getAdminUserSnapshot;
exports.getLocalUserAccessSnapshot = getLocalUserAccessSnapshot;
exports.listLocalUserAccessSnapshots = listLocalUserAccessSnapshots;
exports.getUserCategories = getUserCategories;
exports.addUserCategory = addUserCategory;
exports.updateUserCategory = updateUserCategory;
exports.deleteUserCategory = deleteUserCategory;
exports.getRecentTransactions = getRecentTransactions;
exports.getTransactionsByMonth = getTransactionsByMonth;
exports.addUserTransaction = addUserTransaction;
exports.updateUserTransaction = updateUserTransaction;
exports.deleteUserTransaction = deleteUserTransaction;
exports.getUserTransactionById = getUserTransactionById;
exports.restoreUserTransaction = restoreUserTransaction;
exports.addUserReminder = addUserReminder;
exports.getUserReminders = getUserReminders;
exports.getUserReminderById = getUserReminderById;
exports.updateUserReminder = updateUserReminder;
exports.deleteUserReminder = deleteUserReminder;
exports.getDueWhatsAppReminders = getDueWhatsAppReminders;
exports.markReminderAsNotified = markReminderAsNotified;
exports.addRecurringTransaction = addRecurringTransaction;
exports.getActiveRecurringTransactions = getActiveRecurringTransactions;
exports.getRecurringTransactions = getRecurringTransactions;
exports.deleteRecurringTransaction = deleteRecurringTransaction;
exports.updateRecurringTransactionBackend = updateRecurringTransactionBackend;
exports.generateOverdueRecurringTransactions = generateOverdueRecurringTransactions;
exports.getAllowedWhatsAppNumbers = getAllowedWhatsAppNumbers;
exports.invalidateAllowedNumbersCacheForUid = invalidateAllowedNumbersCacheForUid;
exports.isPhoneAllowedForUid = isPhoneAllowedForUid;
exports.isPhoneAllowedForAnyAccount = isPhoneAllowedForAnyAccount;
exports.resolveUidFromPhone = resolveUidFromPhone;
exports.getPhoneBinding = getPhoneBinding;
exports.savePhoneBinding = savePhoneBinding;
exports.deletePhoneBinding = deletePhoneBinding;
exports.loadWhatsAppAuthSnapshot = loadWhatsAppAuthSnapshot;
exports.saveWhatsAppAuthSnapshot = saveWhatsAppAuthSnapshot;
exports.clearWhatsAppAuthSnapshot = clearWhatsAppAuthSnapshot;
exports.getRecentConversationByPhone = getRecentConversationByPhone;
exports.getRecentConversationByOwnerUid = getRecentConversationByOwnerUid;
exports.getLastConversationActivityByPhone = getLastConversationActivityByPhone;
exports.getLastConversationClientIdByPhone = getLastConversationClientIdByPhone;
exports.getUserChatSessions = getUserChatSessions;
exports.createUserChatSession = createUserChatSession;
exports.updateUserChatSessionTitle = updateUserChatSessionTitle;
exports.deleteUserChatSession = deleteUserChatSession;
exports.getUserChatMessages = getUserChatMessages;
exports.addUserChatMessage = addUserChatMessage;
exports.createPendingWhatsAppDocumentDraft = createPendingWhatsAppDocumentDraft;
exports.getActivePendingWhatsAppDocumentDraft = getActivePendingWhatsAppDocumentDraft;
exports.deletePendingWhatsAppDocumentDraft = deletePendingWhatsAppDocumentDraft;
exports.deleteExpiredPendingWhatsAppDocumentDrafts = deleteExpiredPendingWhatsAppDocumentDrafts;
exports.createUserDocument = createUserDocument;
exports.getUserDocument = getUserDocument;
exports.updateUserDocument = updateUserDocument;
exports.markUserDocumentDeleted = markUserDocumentDeleted;
exports.touchUserDocumentAccess = touchUserDocumentAccess;
exports.listRecentUserDocuments = listRecentUserDocuments;
exports.listUserDocuments = listUserDocuments;
exports.getUserFinancialProfile = getUserFinancialProfile;
exports.upsertUserFinancialProfile = upsertUserFinancialProfile;
exports.getUserGoals = getUserGoals;
exports.addUserGoal = addUserGoal;
exports.updateUserGoal = updateUserGoal;
exports.deleteUserGoal = deleteUserGoal;
const node_crypto_1 = require("node:crypto");
const local_db_1 = require("./local-db");
const realtime_1 = require("./realtime");
const events_1 = require("../whatsapp/events");
const GLOBAL_CATEGORIES_UID = '__global__';
class DuplicateCategoryError extends Error {
    constructor(message = 'Categoria ja existe.') {
        super(message);
        this.name = 'DuplicateCategoryError';
    }
}
exports.DuplicateCategoryError = DuplicateCategoryError;
class DuplicateUserEmailError extends Error {
    constructor(message = 'Este email ja esta vinculado a outra conta.') {
        super(message);
        this.name = 'DuplicateUserEmailError';
    }
}
exports.DuplicateUserEmailError = DuplicateUserEmailError;
const DEFAULT_EXPENSE_CATEGORIES = [
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
const DEFAULT_INCOME_CATEGORIES = [
    { name: 'Salario', type: 'income', color: '#10b981', icon: 'Briefcase' },
    { name: 'Freela', type: 'income', color: '#06b6d4', icon: 'Laptop' },
    { name: 'Vendas', type: 'income', color: '#f97316', icon: 'ShoppingBag' },
    { name: 'Investimentos', type: 'income', color: '#8b5cf6', icon: 'TrendingUp' },
    { name: 'Outros', type: 'income', color: '#6b7280', icon: 'MoreHorizontal' }
];
const DEFAULT_GLOBAL_CATEGORIES = [
    ...DEFAULT_EXPENSE_CATEGORIES,
    ...DEFAULT_INCOME_CATEGORIES
];
const allowedNumbersCache = new Map();
const bindingCache = new Map();
const lastActivityCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
function cacheValid(cachedAt) {
    return Date.now() - cachedAt <= CACHE_TTL_MS;
}
function normalizeNameForKey(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
function toNumber(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function toBoolean(value) {
    return value === true || value === 1 || value === '1';
}
function monthKeyFromDate(date) {
    return date.slice(0, 7);
}
function normalizeDueTime(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
    if (!match)
        return null;
    return `${match[1]}:${match[2]}`;
}
function reminderDueAtFromDateAndTime(dueDate, dueTime) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
        return null;
    const normalizedTime = normalizeDueTime(dueTime);
    if (!normalizedTime)
        return null;
    const parsed = new Date(`${dueDate}T${normalizedTime}:00-03:00`);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function normalizeReminderKind(reminderKind, reminderType) {
    if (reminderKind === 'general' || reminderKind === 'payable' || reminderKind === 'receivable') {
        return reminderKind;
    }
    if (reminderType === 'payable' || reminderType === 'receivable') {
        return reminderType;
    }
    return 'general';
}
function mapCategoryRow(row) {
    return {
        id: String(row.id),
        name: String(row.name),
        type: row.type === 'income' ? 'income' : 'expense',
        color: String(row.color),
        icon: String(row.icon),
        createdAt: String(row.created_at ?? '')
    };
}
function mapTransactionRow(row) {
    return {
        id: String(row.id),
        type: row.type === 'income' ? 'income' : 'expense',
        amount: toNumber(row.amount),
        date: String(row.date),
        monthKey: String(row.month_key),
        category: String(row.category),
        description: String(row.description),
        paymentMethod: row.payment_method,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function mapReminderRow(row) {
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
function mapRecurringRow(row) {
    return {
        id: String(row.id),
        type: row.type === 'income' ? 'income' : 'expense',
        amount: toNumber(row.amount),
        category: String(row.category),
        description: String(row.description),
        paymentMethod: row.payment_method,
        frequency: row.frequency,
        startDate: String(row.start_date),
        endDate: typeof row.end_date === 'string' ? row.end_date : null,
        nextDueDate: String(row.next_due_date),
        active: toBoolean(row.active),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function mapChatSessionRow(row) {
    return {
        id: String(row.id),
        title: String(row.title),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
    };
}
function mapChatMessageRow(row) {
    return {
        id: String(row.id),
        sessionId: String(row.session_id),
        role: row.role,
        content: String(row.content),
        ...(typeof row.image_url === 'string' ? { imageUrl: row.image_url } : {}),
        createdAt: String(row.created_at)
    };
}
function mapDocumentRow(row) {
    return {
        id: String(row.id),
        uid: String(row.uid),
        source: String(row.source),
        title: String(row.title),
        description: typeof row.description === 'string' ? row.description : null,
        normalizedTitle: String(row.normalized_title),
        normalizedDescription: typeof row.normalized_description === 'string' ? row.normalized_description : null,
        searchTokens: (0, local_db_1.parseJsonArray)(row.search_tokens),
        storagePath: String(row.storage_path),
        mimeType: String(row.mime_type),
        sizeBytes: toNumber(row.size_bytes),
        status: row.status === 'deleted' ? 'deleted' : 'ready',
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        lastAccessedAt: typeof row.last_accessed_at === 'string' ? row.last_accessed_at : null
    };
}
function mapPendingDocumentRow(row) {
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
function mapGoalRow(row) {
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
function mapUserSettingsRow(row) {
    if (!row) {
        return {
            budget: 0,
            startDay: 1,
            currency: 'BRL',
            whatsappAllowedNumbers: [],
            updatedAt: (0, local_db_1.nowIso)()
        };
    }
    return {
        budget: toNumber(row.budget),
        startDay: toNumber(row.start_day) || 1,
        currency: typeof row.currency === 'string' ? row.currency : 'BRL',
        whatsappAllowedNumbers: (0, local_db_1.parseJsonArray)(row.whatsapp_allowed_numbers),
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : (0, local_db_1.nowIso)()
    };
}
function normalizeStoredPhoneList(value) {
    const source = (0, local_db_1.parseJsonArray)(value);
    const unique = new Set();
    for (const item of source) {
        const normalized = (0, events_1.normalizePhoneNumber)(item);
        if (normalized.length >= 10) {
            unique.add(normalized);
        }
    }
    return [...unique];
}
function seedDefaultCategories(uid) {
    const insert = local_db_1.db.prepare(`
    insert or ignore into app_categories (
      id, uid, name, normalized_name, type, color, icon, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const now = (0, local_db_1.nowIso)();
    for (const category of DEFAULT_GLOBAL_CATEGORIES) {
        insert.run((0, node_crypto_1.randomUUID)(), uid, category.name, normalizeNameForKey(category.name), category.type, category.color, category.icon, now);
    }
}
function ensureUserRecord(uid, email, displayName) {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
        const conflict = local_db_1.db.prepare(`
      select uid
      from app_users
      where lower(email) = ?
        and uid <> ?
      limit 1
    `).get(normalizedEmail, uid);
        if (conflict) {
            throw new DuplicateUserEmailError();
        }
    }
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_users (uid, email, display_name, created_at)
    values (?, ?, ?, ?)
    on conflict(uid) do update set
      email = excluded.email,
      display_name = excluded.display_name
  `).run(uid, normalizedEmail || null, displayName, now);
}
function ensureUserSettings(uid, allowedNumbers) {
    const now = (0, local_db_1.nowIso)();
    const existing = local_db_1.db.prepare('select whatsapp_allowed_numbers from app_user_settings where uid = ?').get(uid);
    const mergedNumbers = new Set([
        ...normalizeStoredPhoneList(existing?.whatsapp_allowed_numbers),
        ...allowedNumbers
    ]);
    local_db_1.db.prepare(`
    insert into app_user_settings (uid, budget, start_day, currency, whatsapp_allowed_numbers, updated_at)
    values (?, 0, 1, 'BRL', ?, ?)
    on conflict(uid) do update set
      whatsapp_allowed_numbers = excluded.whatsapp_allowed_numbers,
      updated_at = excluded.updated_at
  `).run(uid, (0, local_db_1.stringifyJson)([...mergedNumbers]), now);
    invalidateAllowedNumbersCacheForUid(uid);
}
function addDays(date, amount) {
    const parsed = new Date(`${date}T12:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + amount);
    return parsed.toISOString().slice(0, 10);
}
function addMonths(date, amount) {
    const parsed = new Date(`${date}T12:00:00Z`);
    parsed.setUTCMonth(parsed.getUTCMonth() + amount);
    return parsed.toISOString().slice(0, 10);
}
function nextRecurringDate(date, frequency) {
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
function getDocId(record) {
    const prefix = record.direction === 'inbound'
        ? 'in'
        : record.direction === 'outbound'
            ? 'out'
            : 'ar';
    const safeMessageId = record.messageId.replace(/[^\w.-]/g, '_');
    return `${record.clientId}_${prefix}_${safeMessageId}`;
}
function authStateDocId(slotId) {
    return `authState_${slotId}`;
}
function authFileDocId(filename) {
    return Buffer.from(filename, 'utf8').toString('base64url');
}
async function saveWhatsAppMessage(record) {
    local_db_1.db.prepare(`
    insert into whatsapp_messages (
      id, client_id, message_id, direction, owner_uid, from_phone, to_phone,
      text, timestamp, wa_timestamp, status, raw_type, created_at, metadata
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      status = excluded.status,
      text = excluded.text,
      metadata = excluded.metadata,
      owner_uid = excluded.owner_uid
  `).run(getDocId(record), record.clientId, record.messageId, record.direction, record.ownerUid ?? null, record.from, record.to, record.text, record.timestamp, record.waTimestamp, record.status, record.rawType, record.createdAt, (0, local_db_1.stringifyJson)(record.metadata));
}
async function inboundMessageExists(messageId, clientId, _processedInboundIds) {
    const safeMessageId = messageId.replace(/[^\w.-]/g, '_');
    const id = `${clientId}_in_${safeMessageId}`;
    const row = local_db_1.db.prepare('select id from whatsapp_messages where id = ? limit 1').get(id);
    return Boolean(row);
}
async function saveMessageSafe(record) {
    const exists = record.direction === 'inbound'
        ? await inboundMessageExists(record.messageId, record.clientId)
        : false;
    if (exists)
        return;
    await saveWhatsAppMessage(record);
}
async function bootstrapUserData(uid, input) {
    const normalizedPhone = (0, events_1.normalizePhoneNumber)(input.phone);
    const existing = local_db_1.db.prepare('select uid from app_users where uid = ? limit 1').get(uid);
    ensureUserRecord(uid, input.email, input.displayName);
    ensureUserSettings(uid, normalizedPhone.length >= 10 ? [normalizedPhone] : []);
    const categoryCount = local_db_1.db.prepare('select count(*) as total from app_categories where uid = ?').get(uid);
    if (Number(categoryCount.total ?? 0) === 0) {
        seedDefaultCategories(uid);
    }
    if (normalizedPhone.length >= 10) {
        await savePhoneBinding(normalizedPhone, uid);
    }
    (0, realtime_1.publishUserDataChange)(uid, 'settings');
    (0, realtime_1.publishUserDataChange)(uid, 'categories');
    return {
        isNewUser: !existing,
        normalizedPhone: normalizedPhone.length >= 10 ? normalizedPhone : null
    };
}
async function ensureLocalUserData(uid, input) {
    const existing = await getLocalUserAccessSnapshot(uid);
    const displayName = input.displayName?.trim() ||
        existing?.displayName?.trim() ||
        input.email?.split('@')[0]?.trim() ||
        'Usuario';
    ensureUserRecord(uid, input.email ?? existing?.email ?? '', displayName);
    ensureUserSettings(uid, []);
    const categoryCount = local_db_1.db.prepare('select count(*) as total from app_categories where uid = ?').get(uid);
    let seededCategories = false;
    if (Number(categoryCount.total ?? 0) === 0) {
        seedDefaultCategories(uid);
        seededCategories = true;
    }
    if (!existing) {
        (0, realtime_1.publishUserDataChange)(uid, 'settings');
    }
    if (seededCategories) {
        (0, realtime_1.publishUserDataChange)(uid, 'categories');
    }
}
async function getUserSettings(uid) {
    const row = local_db_1.db.prepare('select * from app_user_settings where uid = ? limit 1').get(uid);
    return mapUserSettingsRow(row);
}
async function updateUserSettings(uid, input) {
    const current = await getUserSettings(uid);
    const merged = {
        budget: typeof input.budget === 'number' ? input.budget : current.budget,
        startDay: typeof input.startDay === 'number' ? input.startDay : current.startDay,
        currency: typeof input.currency === 'string' ? input.currency : current.currency,
        whatsappAllowedNumbers: Array.isArray(input.whatsappAllowedNumbers)
            ? input.whatsappAllowedNumbers.map((value) => (0, events_1.normalizePhoneNumber)(value)).filter((value) => value.length >= 10)
            : current.whatsappAllowedNumbers ?? []
    };
    local_db_1.db.prepare(`
    insert into app_user_settings (uid, budget, start_day, currency, whatsapp_allowed_numbers, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(uid) do update set
      budget = excluded.budget,
      start_day = excluded.start_day,
      currency = excluded.currency,
      whatsapp_allowed_numbers = excluded.whatsapp_allowed_numbers,
      updated_at = excluded.updated_at
  `).run(uid, merged.budget, merged.startDay, merged.currency, (0, local_db_1.stringifyJson)(merged.whatsappAllowedNumbers), (0, local_db_1.nowIso)());
    invalidateAllowedNumbersCacheForUid(uid);
    (0, realtime_1.publishUserDataChange)(uid, 'settings');
}
async function getUserProfile(uid) {
    const row = local_db_1.db.prepare('select display_name from app_users where uid = ? limit 1').get(uid);
    return {
        displayName: typeof row?.display_name === 'string' ? row.display_name : ''
    };
}
async function updateUserDisplayName(uid, displayName) {
    local_db_1.db.prepare('update app_users set display_name = ? where uid = ?').run(displayName.trim(), uid);
    (0, realtime_1.publishUserDataChange)(uid, 'profile');
}
function getUserMetrics(uid) {
    const tx = local_db_1.db.prepare('select count(*) as total from app_transactions where uid = ?').get(uid);
    const reminders = local_db_1.db.prepare('select count(*) as total from app_reminders where uid = ?').get(uid);
    const categories = local_db_1.db.prepare('select count(*) as total from app_categories where uid = ?').get(uid);
    const whatsapp = local_db_1.db.prepare('select count(*) as total, max(created_at) as lastAt from whatsapp_messages where owner_uid = ?').get(uid);
    return {
        transactions: Number(tx.total ?? 0),
        reminders: Number(reminders.total ?? 0),
        categories: Number(categories.total ?? 0),
        whatsappMessages: Number(whatsapp.total ?? 0),
        lastWhatsAppMessageAt: whatsapp.lastAt ?? null
    };
}
async function listAdminUserSnapshots() {
    const rows = local_db_1.db.prepare(`
    select u.uid, u.email, u.display_name, u.created_at,
           s.budget, s.start_day, s.currency, s.whatsapp_allowed_numbers, s.updated_at as settings_updated_at
    from app_users u
    left join app_user_settings s on s.uid = u.uid
    order by u.created_at desc
  `).all();
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
async function getAdminUserSnapshot(uid) {
    const snapshots = await listAdminUserSnapshots();
    return snapshots.find((item) => item.uid === uid) ?? null;
}
async function getLocalUserAccessSnapshot(uid) {
    const row = local_db_1.db.prepare(`
    select uid, email, display_name, created_at
    from app_users
    where uid = ?
    limit 1
  `).get(uid);
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
async function listLocalUserAccessSnapshots() {
    const rows = local_db_1.db.prepare(`
    select uid, email, display_name, created_at
    from app_users
    order by created_at desc
  `).all();
    return rows.map((row) => ({
        uid: String(row.uid),
        email: typeof row.email === 'string' ? row.email : null,
        displayName: typeof row.display_name === 'string' ? row.display_name : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : null
    }));
}
async function getUserCategories(uid) {
    let rows = local_db_1.db.prepare(`
    select * from app_categories
    where uid = ?
    order by type asc, name asc
  `).all(uid);
    if (rows.length === 0) {
        seedDefaultCategories(uid);
        rows = local_db_1.db.prepare(`
      select * from app_categories
      where uid = ?
      order by type asc, name asc
    `).all(uid);
    }
    return rows.map(mapCategoryRow);
}
async function addUserCategory(uid, input) {
    const normalizedName = normalizeNameForKey(input.name);
    const existing = local_db_1.db.prepare(`
    select id from app_categories where uid = ? and type = ? and normalized_name = ? limit 1
  `).get(uid, input.type, normalizedName);
    if (existing) {
        throw new DuplicateCategoryError();
    }
    const id = (0, node_crypto_1.randomUUID)();
    local_db_1.db.prepare(`
    insert into app_categories (id, uid, name, normalized_name, type, color, icon, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, input.name.trim(), normalizedName, input.type, input.color, input.icon, (0, local_db_1.nowIso)());
    (0, realtime_1.publishUserDataChange)(uid, 'categories');
    return id;
}
async function updateUserCategory(uid, categoryId, input) {
    const current = local_db_1.db.prepare('select * from app_categories where uid = ? and id = ? limit 1').get(uid, categoryId);
    if (!current) {
        return;
    }
    const name = typeof input.name === 'string' ? input.name.trim() : String(current.name);
    const type = input.type ?? current.type;
    const normalizedName = normalizeNameForKey(name);
    const duplicate = local_db_1.db.prepare(`
    select id from app_categories where uid = ? and type = ? and normalized_name = ? and id <> ? limit 1
  `).get(uid, type, normalizedName, categoryId);
    if (duplicate) {
        throw new DuplicateCategoryError();
    }
    local_db_1.db.prepare(`
    update app_categories
    set name = ?, normalized_name = ?, type = ?, color = ?, icon = ?
    where uid = ? and id = ?
  `).run(name, normalizedName, type, typeof input.color === 'string' ? input.color : String(current.color), typeof input.icon === 'string' ? input.icon : String(current.icon), uid, categoryId);
    (0, realtime_1.publishUserDataChange)(uid, 'categories');
}
async function deleteUserCategory(uid, categoryId) {
    local_db_1.db.prepare('delete from app_categories where uid = ? and id = ?').run(uid, categoryId);
    (0, realtime_1.publishUserDataChange)(uid, 'categories');
}
async function getRecentTransactions(uid, limitCount = 50) {
    const rows = local_db_1.db.prepare(`
    select * from app_transactions where uid = ? order by date desc, created_at desc limit ?
  `).all(uid, limitCount);
    return rows.map(mapTransactionRow);
}
async function getTransactionsByMonth(uid, monthKey) {
    const rows = local_db_1.db.prepare(`
    select * from app_transactions
    where uid = ? and month_key = ?
    order by date desc, created_at desc
  `).all(uid, monthKey);
    return rows.map(mapTransactionRow);
}
async function addUserTransaction(uid, input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_transactions (
      id, uid, type, amount, date, month_key, category, description, payment_method, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, input.type, input.amount, input.date, monthKeyFromDate(input.date), input.category, input.description, input.paymentMethod, now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'transactions');
    return id;
}
async function updateUserTransaction(uid, transactionId, input) {
    const current = await getUserTransactionById(uid, transactionId);
    if (!current) {
        return;
    }
    const date = input.date ?? current.date;
    local_db_1.db.prepare(`
    update app_transactions
    set type = ?, amount = ?, date = ?, month_key = ?, category = ?, description = ?, payment_method = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(input.type ?? current.type, typeof input.amount === 'number' ? input.amount : current.amount, date, monthKeyFromDate(date), input.category ?? current.category, input.description ?? current.description, input.paymentMethod ?? current.paymentMethod, (0, local_db_1.nowIso)(), uid, transactionId);
    (0, realtime_1.publishUserDataChange)(uid, 'transactions');
}
async function deleteUserTransaction(uid, transactionId) {
    local_db_1.db.prepare('delete from app_transactions where uid = ? and id = ?').run(uid, transactionId);
    (0, realtime_1.publishUserDataChange)(uid, 'transactions');
}
async function getUserTransactionById(uid, transactionId) {
    const row = local_db_1.db.prepare('select * from app_transactions where uid = ? and id = ? limit 1').get(uid, transactionId);
    return row ? mapTransactionRow(row) : null;
}
async function restoreUserTransaction(uid, transactionId, input) {
    local_db_1.db.prepare(`
    insert into app_transactions (
      id, uid, type, amount, date, month_key, category, description, payment_method, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(transactionId, uid, input.type, input.amount, input.date, input.monthKey, input.category, input.description, input.paymentMethod, input.createdAt, input.updatedAt);
    (0, realtime_1.publishUserDataChange)(uid, 'transactions');
}
async function addUserReminder(uid, input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    const reminderKind = normalizeReminderKind(input.reminderKind, input.type);
    const type = reminderKind === 'general' ? null : reminderKind;
    const dueTime = input.dueTime ?? null;
    const dueAt = reminderDueAtFromDateAndTime(input.dueDate, dueTime);
    const notifyPhone = input.notifyPhone ? (0, events_1.normalizePhoneNumber)(input.notifyPhone) : null;
    local_db_1.db.prepare(`
    insert into app_reminders (
      id, uid, title, amount, due_date, due_time, due_at, notified_at, notify_phone, reminder_kind, type, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, input.title, input.amount ?? null, input.dueDate, dueTime, dueAt, notifyPhone, reminderKind, type, input.status ?? 'pending', now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'reminders');
    return id;
}
async function getUserReminders(uid) {
    const rows = local_db_1.db.prepare(`
    select * from app_reminders where uid = ? order by due_date asc, created_at desc
  `).all(uid);
    return rows.map(mapReminderRow);
}
async function getUserReminderById(uid, reminderId) {
    const row = local_db_1.db.prepare('select * from app_reminders where uid = ? and id = ? limit 1').get(uid, reminderId);
    return row ? mapReminderRow(row) : null;
}
async function updateUserReminder(uid, reminderId, input) {
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
        ? (input.notifyPhone ? (0, events_1.normalizePhoneNumber)(input.notifyPhone) : null)
        : (current.notifyPhone ?? null);
    local_db_1.db.prepare(`
    update app_reminders
    set title = ?, amount = ?, due_date = ?, due_time = ?, due_at = ?, notify_phone = ?, reminder_kind = ?, type = ?, status = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(input.title ?? current.title, input.amount !== undefined ? input.amount : current.amount, dueDate, dueTime ?? null, dueAt, notifyPhone, reminderKind, type, input.status ?? current.status, (0, local_db_1.nowIso)(), uid, reminderId);
    (0, realtime_1.publishUserDataChange)(uid, 'reminders');
}
async function deleteUserReminder(uid, reminderId) {
    local_db_1.db.prepare('delete from app_reminders where uid = ? and id = ?').run(uid, reminderId);
    (0, realtime_1.publishUserDataChange)(uid, 'reminders');
}
async function getDueWhatsAppReminders(nowValue, limitCount = 50) {
    const rows = local_db_1.db.prepare(`
    select * from app_reminders
    where notify_phone is not null
      and due_at is not null
      and notified_at is null
      and status = 'pending'
      and due_at <= ?
    order by due_at asc
    limit ?
  `).all(nowValue, limitCount);
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
async function markReminderAsNotified(uid, reminderId, notifiedAt) {
    const result = local_db_1.db.prepare(`
    update app_reminders
    set notified_at = ?, updated_at = ?
    where uid = ? and id = ? and notified_at is null
  `).run(notifiedAt, (0, local_db_1.nowIso)(), uid, reminderId);
    if (result.changes > 0) {
        (0, realtime_1.publishUserDataChange)(uid, 'reminders');
    }
    return result.changes > 0;
}
async function addRecurringTransaction(uid, input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_recurring_transactions (
      id, uid, type, amount, category, description, payment_method, frequency, start_date, end_date, next_due_date, active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, uid, input.type, input.amount, input.category, input.description, input.paymentMethod, input.frequency, input.startDate, input.endDate ?? null, input.startDate, now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'recurring-transactions');
    return id;
}
async function getActiveRecurringTransactions(uid) {
    const rows = local_db_1.db.prepare(`
    select * from app_recurring_transactions where uid = ? and active = 1 order by next_due_date asc
  `).all(uid);
    return rows.map(mapRecurringRow);
}
async function getRecurringTransactions(uid) {
    const rows = local_db_1.db.prepare(`
    select * from app_recurring_transactions where uid = ? order by created_at desc
  `).all(uid);
    return rows.map(mapRecurringRow);
}
async function deleteRecurringTransaction(uid, recurringId) {
    local_db_1.db.prepare('delete from app_recurring_transactions where uid = ? and id = ?').run(uid, recurringId);
    (0, realtime_1.publishUserDataChange)(uid, 'recurring-transactions');
}
async function updateRecurringTransactionBackend(uid, recurringId, input) {
    const current = local_db_1.db.prepare('select * from app_recurring_transactions where uid = ? and id = ? limit 1').get(uid, recurringId);
    if (!current) {
        return;
    }
    local_db_1.db.prepare(`
    update app_recurring_transactions
    set type = ?, amount = ?, category = ?, description = ?, payment_method = ?, frequency = ?, start_date = ?, end_date = ?, next_due_date = ?, active = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(input.type ?? current.type, typeof input.amount === 'number' ? input.amount : toNumber(current.amount), input.category ?? String(current.category), input.description ?? String(current.description), input.paymentMethod ?? String(current.payment_method), input.frequency ?? String(current.frequency), input.startDate ?? String(current.start_date), input.endDate !== undefined ? input.endDate : (typeof current.end_date === 'string' ? current.end_date : null), input.nextDueDate ?? String(current.next_due_date), input.active !== undefined ? (input.active ? 1 : 0) : Number(current.active ?? 1), (0, local_db_1.nowIso)(), uid, recurringId);
    (0, realtime_1.publishUserDataChange)(uid, 'recurring-transactions');
}
async function generateOverdueRecurringTransactions(uid) {
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
async function getAllowedWhatsAppNumbers(uid) {
    const cached = allowedNumbersCache.get(uid);
    if (cached && cacheValid(cached.cachedAt)) {
        return cached.numbers;
    }
    const settings = await getUserSettings(uid);
    const numbers = settings.whatsappAllowedNumbers ?? [];
    allowedNumbersCache.set(uid, { numbers, cachedAt: Date.now() });
    return numbers;
}
function invalidateAllowedNumbersCacheForUid(uid) {
    allowedNumbersCache.delete(uid);
}
async function isPhoneAllowedForUid(uid, phone) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    const variants = new Set((0, events_1.brazilianPhoneVariants)(normalized));
    const allowed = await getAllowedWhatsAppNumbers(uid);
    return allowed.some((item) => variants.has(item));
}
async function isPhoneAllowedForAnyAccount(phone) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    const variants = (0, events_1.brazilianPhoneVariants)(normalized);
    const rows = local_db_1.db.prepare('select uid, whatsapp_allowed_numbers from app_user_settings').all();
    return rows.some((row) => {
        const allowed = normalizeStoredPhoneList(row.whatsapp_allowed_numbers);
        return allowed.some((item) => variants.includes(item));
    });
}
async function resolveUidFromPhone(phone) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    if (normalized.length < 10) {
        return null;
    }
    const variants = new Set((0, events_1.brazilianPhoneVariants)(normalized));
    const rows = local_db_1.db.prepare(`
    select uid, whatsapp_allowed_numbers, updated_at
    from app_user_settings
    order by updated_at desc
  `).all();
    for (const row of rows) {
        const allowed = normalizeStoredPhoneList(row.whatsapp_allowed_numbers);
        if (allowed.some((item) => variants.has(item))) {
            return typeof row.uid === 'string' ? row.uid : null;
        }
    }
    return null;
}
async function getPhoneBinding(phone) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    const cached = bindingCache.get(normalized);
    if (cached && cacheValid(cached.cachedAt)) {
        return cached.binding;
    }
    const variants = (0, events_1.brazilianPhoneVariants)(normalized);
    for (const variant of variants) {
        const row = local_db_1.db.prepare(`
      select phone, uid, linked_at, updated_at
      from whatsapp_bindings
      where variant_phone = ?
      limit 1
    `).get(variant);
        if (row) {
            const binding = {
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
async function savePhoneBinding(phone, uid) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    if (normalized.length < 10)
        return;
    const now = (0, local_db_1.nowIso)();
    const insert = local_db_1.db.prepare(`
    insert into whatsapp_bindings (variant_phone, phone, uid, linked_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(variant_phone) do update set
      phone = excluded.phone,
      uid = excluded.uid,
      updated_at = excluded.updated_at
  `);
    for (const variant of (0, events_1.brazilianPhoneVariants)(normalized)) {
        insert.run(variant, normalized, uid, now, now);
    }
    bindingCache.delete(normalized);
}
async function deletePhoneBinding(phone) {
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    const variants = (0, events_1.brazilianPhoneVariants)(normalized);
    const placeholders = variants.map(() => '?').join(', ');
    local_db_1.db.prepare(`delete from whatsapp_bindings where variant_phone in (${placeholders})`).run(...variants);
    bindingCache.delete(normalized);
}
async function loadWhatsAppAuthSnapshot(slotId) {
    const runtimeDocId = authStateDocId(slotId);
    const rows = local_db_1.db.prepare(`
    select filename, content_base64
    from whatsapp_runtime_files
    where runtime_doc_id = ?
    order by filename asc
  `).all(runtimeDocId);
    return rows.map((row) => ({
        filename: String(row.filename),
        contentBase64: String(row.content_base64)
    }));
}
async function saveWhatsAppAuthSnapshot(slotId, files) {
    const runtimeDocId = authStateDocId(slotId);
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into whatsapp_runtime (doc_id, file_count, updated_at)
    values (?, ?, ?)
    on conflict(doc_id) do update set
      file_count = excluded.file_count,
      updated_at = excluded.updated_at
  `).run(runtimeDocId, files.length, now);
    local_db_1.db.prepare('delete from whatsapp_runtime_files where runtime_doc_id = ?').run(runtimeDocId);
    const insert = local_db_1.db.prepare(`
    insert into whatsapp_runtime_files (runtime_doc_id, file_doc_id, filename, content_base64, updated_at)
    values (?, ?, ?, ?, ?)
  `);
    for (const file of files) {
        insert.run(runtimeDocId, authFileDocId(file.filename), file.filename, file.contentBase64, now);
    }
}
async function clearWhatsAppAuthSnapshot(slotId) {
    local_db_1.db.prepare('delete from whatsapp_runtime where doc_id = ?').run(authStateDocId(slotId));
}
async function getRecentConversationByPhone(uidOrPhone, phoneOrLimit, maybeLimit) {
    const phone = typeof phoneOrLimit === 'string' ? phoneOrLimit : uidOrPhone;
    const limitCount = typeof phoneOrLimit === 'number' ? phoneOrLimit : maybeLimit ?? 20;
    const variants = (0, events_1.brazilianPhoneVariants)(phone);
    const placeholders = variants.map(() => '?').join(', ');
    const rows = local_db_1.db.prepare(`
    select direction, text
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
    order by created_at desc
    limit ?
  `).all(...variants, ...variants, limitCount);
    return rows
        .reverse()
        .map((row) => ({
        role: row.direction === 'inbound' ? 'user' : 'assistant',
        content: String(row.text ?? '')
    }))
        .filter((item) => item.content.trim().length > 0);
}
async function getRecentConversationByOwnerUid(uid, limitCount = 20) {
    const rows = local_db_1.db.prepare(`
    select direction, text
    from whatsapp_messages
    where owner_uid = ?
    order by created_at desc
    limit ?
  `).all(uid, limitCount);
    return rows
        .reverse()
        .map((row) => ({
        role: row.direction === 'inbound' ? 'user' : 'assistant',
        content: String(row.text ?? '')
    }))
        .filter((item) => item.content.trim().length > 0);
}
async function getLastConversationActivityByPhone(uidOrPhone, maybePhone) {
    const phone = maybePhone ?? uidOrPhone;
    const normalized = (0, events_1.normalizePhoneNumber)(phone);
    const cached = lastActivityCache.get(normalized);
    if (cached && cacheValid(cached.cachedAt)) {
        return cached.value;
    }
    const variants = (0, events_1.brazilianPhoneVariants)(normalized);
    const placeholders = variants.map(() => '?').join(', ');
    const row = local_db_1.db.prepare(`
    select max(created_at) as lastAt
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
  `).get(...variants, ...variants);
    const value = row?.lastAt ?? null;
    lastActivityCache.set(normalized, { value, cachedAt: Date.now() });
    return value;
}
async function getLastConversationClientIdByPhone(phone) {
    const variants = (0, events_1.brazilianPhoneVariants)(phone);
    const placeholders = variants.map(() => '?').join(', ');
    const row = local_db_1.db.prepare(`
    select client_id
    from whatsapp_messages
    where from_phone in (${placeholders}) or to_phone in (${placeholders})
    order by created_at desc
    limit 1
  `).get(...variants, ...variants);
    return row?.client_id === 'wa1' ? 'wa1' : null;
}
async function getUserChatSessions(uid) {
    const rows = local_db_1.db.prepare(`
    select * from app_chat_sessions where uid = ? order by updated_at desc
  `).all(uid);
    return rows.map(mapChatSessionRow);
}
async function createUserChatSession(uid, title) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_chat_sessions (id, uid, title, created_at, updated_at)
    values (?, ?, ?, ?, ?)
  `).run(id, uid, title, now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'chat-sessions');
    return id;
}
async function updateUserChatSessionTitle(uid, sessionId, title) {
    local_db_1.db.prepare(`
    update app_chat_sessions set title = ?, updated_at = ? where uid = ? and id = ?
  `).run(title, (0, local_db_1.nowIso)(), uid, sessionId);
    (0, realtime_1.publishUserDataChange)(uid, 'chat-sessions');
}
async function deleteUserChatSession(uid, sessionId) {
    local_db_1.db.prepare('delete from app_chat_sessions where uid = ? and id = ?').run(uid, sessionId);
    (0, realtime_1.publishUserDataChange)(uid, 'chat-sessions');
    (0, realtime_1.publishUserDataChange)(uid, 'chat-messages');
}
async function getUserChatMessages(uid, sessionId) {
    const rows = local_db_1.db.prepare(`
    select m.*
    from app_chat_messages m
    inner join app_chat_sessions s on s.id = m.session_id
    where s.uid = ? and m.session_id = ?
    order by m.created_at asc
  `).all(uid, sessionId);
    return rows.map(mapChatMessageRow);
}
async function addUserChatMessage(uid, sessionId, input) {
    const session = local_db_1.db.prepare('select id from app_chat_sessions where uid = ? and id = ? limit 1').get(uid, sessionId);
    if (!session) {
        throw new Error('Sessao de chat nao encontrada.');
    }
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_chat_messages (id, uid, session_id, role, content, image_url, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, sessionId, input.role, input.content, input.imageUrl ?? null, now);
    local_db_1.db.prepare('update app_chat_sessions set updated_at = ? where id = ?').run(now, sessionId);
    (0, realtime_1.publishUserDataChange)(uid, 'chat-messages');
    (0, realtime_1.publishUserDataChange)(uid, 'chat-sessions');
    return id;
}
async function createPendingWhatsAppDocumentDraft(uid, sourcePhone, input) {
    local_db_1.db.prepare(`
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
  `).run(input.id, uid, (0, events_1.normalizePhoneNumber)(sourcePhone), input.storagePath, input.mimeType, input.sizeBytes, input.pendingReason ?? 'missing_title', input.expiresAt, (0, local_db_1.nowIso)());
}
async function getActivePendingWhatsAppDocumentDraft(uid, sourcePhone) {
    const row = local_db_1.db.prepare(`
    select * from app_whatsapp_pending_documents
    where uid = ? and source_phone = ? and expires_at > ?
    limit 1
  `).get(uid, (0, events_1.normalizePhoneNumber)(sourcePhone), (0, local_db_1.nowIso)());
    return row ? mapPendingDocumentRow(row) : null;
}
async function deletePendingWhatsAppDocumentDraft(id) {
    local_db_1.db.prepare('delete from app_whatsapp_pending_documents where id = ?').run(id);
}
async function deleteExpiredPendingWhatsAppDocumentDrafts(uid, sourcePhone) {
    local_db_1.db.prepare(`
    delete from app_whatsapp_pending_documents
    where uid = ? and source_phone = ? and expires_at <= ?
  `).run(uid, (0, events_1.normalizePhoneNumber)(sourcePhone), (0, local_db_1.nowIso)());
}
async function createUserDocument(uid, input) {
    const id = input.id ?? (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_user_documents (
      id, uid, source, title, description, normalized_title, normalized_description,
      search_tokens, storage_path, mime_type, size_bytes, status, created_at, updated_at, last_accessed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
  `).run(id, uid, input.source ?? 'whatsapp', input.title, input.description ?? null, input.normalizedTitle, input.normalizedDescription ?? null, (0, local_db_1.stringifyJson)(input.searchTokens ?? []), input.storagePath, input.mimeType, input.sizeBytes, input.status ?? 'ready', now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'documents');
    return id;
}
async function getUserDocument(uid, documentId) {
    const row = local_db_1.db.prepare(`
    select * from app_user_documents where uid = ? and id = ? limit 1
  `).get(uid, documentId);
    return row ? mapDocumentRow(row) : null;
}
async function updateUserDocument(uid, documentId, input) {
    const current = await getUserDocument(uid, documentId);
    if (!current) {
        return;
    }
    local_db_1.db.prepare(`
    update app_user_documents
    set title = ?, description = ?, normalized_title = ?, normalized_description = ?, search_tokens = ?, storage_path = ?, status = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(input.title ?? current.title, input.description !== undefined ? input.description : (current.description ?? null), input.normalizedTitle ?? current.normalizedTitle, input.normalizedDescription !== undefined ? input.normalizedDescription : (current.normalizedDescription ?? null), (0, local_db_1.stringifyJson)(input.searchTokens ?? current.searchTokens), input.storagePath ?? current.storagePath, input.status ?? current.status, (0, local_db_1.nowIso)(), uid, documentId);
    (0, realtime_1.publishUserDataChange)(uid, 'documents');
}
async function markUserDocumentDeleted(uid, documentId) {
    local_db_1.db.prepare(`
    update app_user_documents set status = 'deleted', updated_at = ? where uid = ? and id = ?
  `).run((0, local_db_1.nowIso)(), uid, documentId);
    (0, realtime_1.publishUserDataChange)(uid, 'documents');
}
async function touchUserDocumentAccess(uid, documentId) {
    local_db_1.db.prepare(`
    update app_user_documents set last_accessed_at = ? where uid = ? and id = ?
  `).run((0, local_db_1.nowIso)(), uid, documentId);
    (0, realtime_1.publishUserDataChange)(uid, 'documents');
}
async function listRecentUserDocuments(uid, limitCount) {
    const rows = local_db_1.db.prepare(`
    select * from app_user_documents
    where uid = ? and status = 'ready'
    order by created_at desc
    limit ?
  `).all(uid, limitCount);
    return rows.map(mapDocumentRow);
}
async function listUserDocuments(uid, limitCount = 200) {
    const rows = local_db_1.db.prepare(`
    select * from app_user_documents
    where uid = ? and status = 'ready'
    order by updated_at desc, created_at desc
    limit ?
  `).all(uid, limitCount);
    return rows.map(mapDocumentRow);
}
async function getUserFinancialProfile(uid) {
    const row = local_db_1.db.prepare('select * from app_financial_profiles where uid = ? limit 1').get(uid);
    if (!row)
        return null;
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
async function upsertUserFinancialProfile(uid, input) {
    const existing = await getUserFinancialProfile(uid);
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
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
  `).run(uid, input.monthlyIncome, input.fixedExpenses, input.variableExpenses, input.savingsTargetPct, input.financialGoalsText, now, existing?.createdAt ?? now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'financial-profile');
}
async function getUserGoals(uid) {
    const rows = local_db_1.db.prepare(`
    select * from app_goals where uid = ? order by created_at desc
  `).all(uid);
    return rows.map(mapGoalRow);
}
async function addUserGoal(uid, input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = (0, local_db_1.nowIso)();
    local_db_1.db.prepare(`
    insert into app_goals (
      id, uid, title, description, target_amount, current_amount, deadline, source, status, priority, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, uid, input.title, input.description ?? null, input.targetAmount ?? null, input.currentAmount ?? 0, input.deadline ?? null, input.source, input.status ?? 'active', input.priority ?? 'medium', now, now);
    (0, realtime_1.publishUserDataChange)(uid, 'goals');
    return id;
}
async function updateUserGoal(uid, goalId, input) {
    const current = local_db_1.db.prepare('select * from app_goals where uid = ? and id = ? limit 1').get(uid, goalId);
    if (!current) {
        return;
    }
    local_db_1.db.prepare(`
    update app_goals
    set title = ?, description = ?, target_amount = ?, current_amount = ?, deadline = ?, source = ?, status = ?, priority = ?, updated_at = ?
    where uid = ? and id = ?
  `).run(input.title ?? String(current.title), input.description !== undefined ? input.description : (typeof current.description === 'string' ? current.description : null), input.targetAmount !== undefined ? input.targetAmount : (current.target_amount == null ? null : toNumber(current.target_amount)), input.currentAmount !== undefined ? input.currentAmount : toNumber(current.current_amount), input.deadline !== undefined ? input.deadline : (typeof current.deadline === 'string' ? current.deadline : null), input.source ?? (current.source === 'ai' ? 'ai' : 'manual'), input.status ?? current.status, input.priority ?? current.priority, (0, local_db_1.nowIso)(), uid, goalId);
    (0, realtime_1.publishUserDataChange)(uid, 'goals');
}
async function deleteUserGoal(uid, goalId) {
    local_db_1.db.prepare('delete from app_goals where uid = ? and id = ?').run(uid, goalId);
    (0, realtime_1.publishUserDataChange)(uid, 'goals');
}
