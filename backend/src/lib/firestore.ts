import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { logger } from './logger';
import type { WhatsAppMessageRecord } from '../types/whatsapp';
import { brazilianPhoneVariants, normalizePhoneNumber } from '../whatsapp/events';

const COLLECTION_NAME = 'whatsappMessages';
const BINDINGS_COLLECTION_NAME = 'whatsappBindings';
const AUTH_STATE_COLLECTION_NAME = 'whatsappRuntime';
const AUTH_STATE_DOC_ID = 'authState';
const AUTH_STATE_FILES_SUBCOLLECTION = 'files';
const PROFILE_SCAN_CACHE_TTL_MS = 15_000; // reduced to 15s so newly registered phones are picked up quickly
const BINDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LAST_ACTIVITY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes (was 1 min)
const ALLOWED_NUMBERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes per-uid cache

function sanitizeDocId(value: string): string {
  return value.replace(/[^\w.-]/g, '_');
}

function authFileDocId(filename: string): string {
  return Buffer.from(filename, 'utf8').toString('base64url');
}

function getDocId(record: WhatsAppMessageRecord): string {
  const prefix =
    record.direction === 'inbound'
      ? 'in'
      : record.direction === 'outbound'
        ? 'out'
        : 'ar';
  return `${prefix}_${sanitizeDocId(record.messageId)}`;
}

function initFirebaseAdmin(): void {
  if (getApps().length > 0) return;

  initializeApp({
    credential: cert({
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey.replace(/\\n/g, '\n')
    })
  });
}

initFirebaseAdmin();

const db = getFirestore();

export async function saveWhatsAppMessage(record: WhatsAppMessageRecord): Promise<void> {
  const docId = getDocId(record);
  await db.collection(COLLECTION_NAME).doc(docId).set(record, { merge: true });
}

export async function inboundMessageExists(
  messageId: string,
  processedInMemory?: Set<string>
): Promise<boolean> {
  // Avoid network call if we already know this ID from the in-process dedup set
  if (processedInMemory?.has(messageId)) return true;

  const docId = `in_${sanitizeDocId(messageId)}`;
  const snap = await db.collection(COLLECTION_NAME).doc(docId).get();
  return snap.exists;
}

export async function saveMessageSafe(record: WhatsAppMessageRecord): Promise<void> {
  try {
    await saveWhatsAppMessage(record);
  } catch (error) {
    logger.error('Failed to save WhatsApp message in Firestore', error);
  }
}

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

function monthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

export interface UserSettingsBackend {
  budget: number;
  startDay: number;
  currency: string;
}

export interface UserProfileBackend {
  displayName: string;
}

export async function getUserSettings(uid: string): Promise<UserSettingsBackend> {
  const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
  if (!snap.exists) return { budget: 0, startDay: 1, currency: 'BRL' };
  const data = snap.data() as Partial<UserSettingsBackend>;
  return {
    budget: typeof data.budget === 'number' ? data.budget : 0,
    startDay: typeof data.startDay === 'number' ? data.startDay : 1,
    currency: typeof data.currency === 'string' ? data.currency : 'BRL'
  };
}

export async function getUserProfile(uid: string): Promise<UserProfileBackend> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return { displayName: '' };
  const data = snap.data() as Partial<{ displayName: string }>;
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : ''
  };
}

export async function getUserCategories(uid: string): Promise<UserCategory[]> {
  const snap = await db.collection('users').doc(uid).collection('categories').orderBy('name', 'asc').get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<UserCategory, 'id'>)
  }));
}

export async function getRecentTransactions(uid: string, limitCount: number): Promise<UserTransaction[]> {
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('transactions')
    .orderBy('date', 'desc')
    .limit(limitCount)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<UserTransaction, 'id'>)
  }));
}

export async function addUserTransaction(uid: string, input: CreateTransactionInput): Promise<string> {
  const now = new Date().toISOString();
  const ref = await db.collection('users').doc(uid).collection('transactions').add({
    ...input,
    monthKey: monthKeyFromDate(input.date),
    createdAt: now,
    updatedAt: now
  });
  return ref.id;
}

export async function updateUserTransaction(
  uid: string,
  transactionId: string,
  changes: Partial<Omit<UserTransaction, 'id' | 'createdAt'>>
): Promise<void> {
  const updates: Record<string, unknown> = {
    ...changes,
    updatedAt: new Date().toISOString()
  };
  if (typeof changes.date === 'string' && changes.date.length >= 7) {
    updates.monthKey = monthKeyFromDate(changes.date);
  }
  await db.collection('users').doc(uid).collection('transactions').doc(transactionId).update(updates);
}

export async function deleteUserTransaction(uid: string, transactionId: string): Promise<void> {
  await db.collection('users').doc(uid).collection('transactions').doc(transactionId).delete();
}

// ---------------------------------------------------------------------------
// Per-UID allowed numbers cache — avoids repeated Firestore reads per message.
// ---------------------------------------------------------------------------
const allowedNumbersCache = new Map<string, { numbers: string[]; cachedAt: number }>();

function invalidateAllowedNumbersCache(uid: string): void {
  allowedNumbersCache.delete(uid);
}

export async function getAllowedWhatsAppNumbers(uid: string): Promise<string[]> {
  const cached = allowedNumbersCache.get(uid);
  if (cached && Date.now() - cached.cachedAt <= ALLOWED_NUMBERS_CACHE_TTL_MS) {
    return cached.numbers;
  }

  const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
  if (!snap.exists) {
    allowedNumbersCache.set(uid, { numbers: [], cachedAt: Date.now() });
    return [];
  }

  const data = snap.data() as { whatsappAllowedNumbers?: unknown };
  // Use normalizeAllowedNumbers to expand each registered number into all Brazilian variants
  const numbers = normalizeAllowedNumbers(data.whatsappAllowedNumbers);
  allowedNumbersCache.set(uid, { numbers, cachedAt: Date.now() });
  return numbers;
}

/** Call this when a user updates their whatsappAllowedNumbers so the cache stays fresh. */
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

  // Expand each stored number into all its Brazilian variants so any format matches
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

function isMissingIndexError(error: unknown): boolean {
  const message = (error as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message.includes('FAILED_PRECONDITION')) return true;

  const code = (error as { code?: unknown } | undefined)?.code;
  return code === 9;
}

async function scanAllProfileSettings(forceRefresh = false): Promise<ProfileSettingsEntry[]> {
  if (!forceRefresh && profileScanCache) {
    const ageMs = Date.now() - profileScanCache.fetchedAt;
    if (ageMs <= PROFILE_SCAN_CACHE_TTL_MS) {
      return profileScanCache.entries;
    }
  }

  const usersSnap = await db.collection('users').get();
  if (usersSnap.empty) {
    profileScanCache = { fetchedAt: Date.now(), entries: [] };
    return [];
  }

  const profileSnaps = await Promise.all(
    usersSnap.docs.map((userDoc) => userDoc.ref.collection('settings').doc('profile').get())
  );

  const entries: ProfileSettingsEntry[] = [];
  for (const profileSnap of profileSnaps) {
    if (!profileSnap.exists) continue;
    const uid = profileSnap.ref.parent.parent?.id;
    if (!uid) continue;
    entries.push({
      uid,
      data: (profileSnap.data() ?? {}) as ProfileSettingsData
    });
  }

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
  const profiles = await scanAllProfileSettings();
  for (const entry of profiles) {
    const allowed = normalizeAllowedNumbers(entry.data.whatsappAllowedNumbers);
    if (variants.some((variant) => allowed.includes(variant))) {
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
    const snaps = await Promise.all(
      variants.map((v) =>
        db.collectionGroup('settings')
          .where('whatsappAllowedNumbers', 'array-contains', v)
          .limit(1)
          .get()
      )
    );
    return snaps.some((snap) => snap.docs.some((doc) => doc.id === 'profile'));
  } catch (error) {
    logger.error('isPhoneAllowedForAnyAccount: collectionGroup query failed (missing Firestore index?)', error);
    if (!isMissingIndexError(error)) {
      return false;
    }

    logger.warn('isPhoneAllowedForAnyAccount: falling back to users profile scan');
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
      // Log all registered numbers for debugging
      const profiles = await scanAllProfileSettings();
      const allNumbers = profiles.flatMap((p) =>
        normalizeAllowedNumbers(p.data.whatsappAllowedNumbers)
      );
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

// ---------------------------------------------------------------------------
// Phone binding cache — avoids repeated Firestore lookups for the same phone.
// ---------------------------------------------------------------------------
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
  const snaps = await Promise.all(
    variants.map((v) => db.collection(BINDINGS_COLLECTION_NAME).doc(v).get())
  );

  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() as Partial<WhatsAppPhoneBinding>;
    if (!data.uid || typeof data.uid !== 'string') continue;

    const result: WhatsAppPhoneBinding = {
      phone: snap.id,
      uid: data.uid,
      linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : new Date().toISOString(),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
    };
    setCachedBinding(normalizedPhone, result);
    return result;
  }

  setCachedBinding(normalizedPhone, null);
  return null;
}

export async function savePhoneBinding(phone: string, uid: string): Promise<void> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) {
    throw new Error('Invalid phone for binding');
  }
  if (!uid || uid.trim().length === 0) {
    throw new Error('Invalid uid for binding');
  }

  const now = new Date().toISOString();
  // Save binding under ALL Brazilian variants so lookups work regardless of format
  const variants = brazilianPhoneVariants(normalizedPhone);
  const canonicalPhone = variants[0] || normalizedPhone; // 13-digit form

  // Check any existing binding for linkedAt
  let linkedAt = now;
  for (const v of variants) {
    const existing = await db.collection(BINDINGS_COLLECTION_NAME).doc(v).get();
    if (existing.exists && typeof existing.data()?.linkedAt === 'string') {
      linkedAt = existing.data()?.linkedAt as string;
      break;
    }
  }

  const bindingData = {
    phone: canonicalPhone,
    uid,
    linkedAt,
    updatedAt: now
  };

  // Write binding under all variants for reliable lookups
  const batch = db.batch();
  for (const v of variants) {
    batch.set(db.collection(BINDINGS_COLLECTION_NAME).doc(v), bindingData, { merge: true });
  }
  await batch.commit();

  // Invalidate binding cache for all variants
  for (const v of variants) {
    bindingCache.delete(v);
  }
  bindingCache.delete(normalizedPhone);
}

export interface WhatsAppAuthSnapshotFile {
  filename: string;
  contentBase64: string;
}

export async function loadWhatsAppAuthSnapshot(): Promise<WhatsAppAuthSnapshotFile[]> {
  try {
    const filesSnap = await db
      .collection(AUTH_STATE_COLLECTION_NAME)
      .doc(AUTH_STATE_DOC_ID)
      .collection(AUTH_STATE_FILES_SUBCOLLECTION)
      .get();

    return filesSnap.docs
      .map((doc) => {
        const data = doc.data() as Partial<WhatsAppAuthSnapshotFile>;
        const filename = typeof data.filename === 'string' ? data.filename.trim() : '';
        const contentBase64 = typeof data.contentBase64 === 'string' ? data.contentBase64.trim() : '';
        if (!filename || !contentBase64) return null;
        return { filename, contentBase64 };
      })
      .filter((entry): entry is WhatsAppAuthSnapshotFile => Boolean(entry))
      .sort((a, b) => a.filename.localeCompare(b.filename));
  } catch (error) {
    logger.error('Failed to load WhatsApp auth snapshot from Firestore', error);
    return [];
  }
}

export async function saveWhatsAppAuthSnapshot(files: WhatsAppAuthSnapshotFile[]): Promise<void> {
  const now = new Date().toISOString();
  const normalized = files
    .map((file) => ({
      filename: file.filename.trim(),
      contentBase64: file.contentBase64.trim()
    }))
    .filter((file) => file.filename.length > 0 && file.contentBase64.length > 0);

  const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(AUTH_STATE_DOC_ID);
  const filesRef = rootRef.collection(AUTH_STATE_FILES_SUBCOLLECTION);

  const existingSnap = await filesRef.get();
  const batch = db.batch();
  const keptDocIds = new Set<string>();

  for (const file of normalized) {
    const docId = authFileDocId(file.filename);
    keptDocIds.add(docId);
    batch.set(
      filesRef.doc(docId),
      {
        filename: file.filename,
        contentBase64: file.contentBase64,
        updatedAt: now
      },
      { merge: true }
    );
  }

  for (const doc of existingSnap.docs) {
    if (!keptDocIds.has(doc.id)) {
      batch.delete(doc.ref);
    }
  }

  batch.set(
    rootRef,
    {
      fileCount: normalized.length,
      updatedAt: now
    },
    { merge: true }
  );

  await batch.commit();
}

export async function clearWhatsAppAuthSnapshot(): Promise<void> {
  const rootRef = db.collection(AUTH_STATE_COLLECTION_NAME).doc(AUTH_STATE_DOC_ID);
  const filesRef = rootRef.collection(AUTH_STATE_FILES_SUBCOLLECTION);
  const filesSnap = await filesRef.get();

  const batch = db.batch();
  for (const doc of filesSnap.docs) {
    batch.delete(doc.ref);
  }
  batch.set(
    rootRef,
    {
      fileCount: 0,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );

  await batch.commit();
}

export async function getRecentConversationByPhone(
  uid: string,
  phone: string,
  limitCount: number
): Promise<WhatsAppConversationMessage[]> {
  if (!uid || uid.trim().length === 0) return [];

  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return [];

  const [inboundSnap, outboundSnap] = await Promise.all([
    db
      .collection(COLLECTION_NAME)
      .where('ownerUid', '==', uid)
      .where('from', '==', normalizedPhone)
      .orderBy('createdAt', 'desc')
      .limit(limitCount)
      .get(),
    db
      .collection(COLLECTION_NAME)
      .where('ownerUid', '==', uid)
      .where('to', '==', normalizedPhone)
      .orderBy('createdAt', 'desc')
      .limit(limitCount)
      .get()
  ]);

  const docsById = new Map<string, { createdAt: string; role: 'user' | 'assistant'; content: string }>();
  const pushDoc = (snap: FirebaseFirestore.QuerySnapshot): void => {
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<WhatsAppMessageRecord>;
      if (data.status === 'failed') continue;
      if (typeof data.createdAt !== 'string' || data.createdAt.length === 0) continue;
      if (data.ownerUid !== uid) continue;

      const hasImage = Boolean(data.metadata?.hasImage);
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      const content = text || (hasImage ? 'Imagem enviada no WhatsApp.' : '');
      if (!content) continue;

      docsById.set(doc.id, {
        createdAt: data.createdAt,
        role: data.direction === 'inbound' ? 'user' : 'assistant',
        content: content.slice(0, 800)
      });
    }
  };

  pushDoc(inboundSnap);
  pushDoc(outboundSnap);

  return [...docsById.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limitCount)
    .map((entry) => ({
      role: entry.role,
      content: entry.content
    }));
}

// ---------------------------------------------------------------------------
// Last conversation activity cache — avoids 2 Firestore queries per message.
// ---------------------------------------------------------------------------
const lastActivityCache = new Map<string, { activity: string | null; cachedAt: number }>();

function lastActivityCacheKey(uid: string, phone: string): string {
  return `${uid}:${phone}`;
}

export async function getLastConversationActivityByPhone(
  uid: string,
  phone: string
): Promise<string | null> {
  if (!uid || uid.trim().length === 0) return null;

  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const cacheKey = lastActivityCacheKey(uid, normalizedPhone);
  const cached = lastActivityCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt <= LAST_ACTIVITY_CACHE_TTL_MS) {
    return cached.activity;
  }

  try {
    const [inboundSnap, outboundSnap] = await Promise.all([
      db
        .collection(COLLECTION_NAME)
        .where('ownerUid', '==', uid)
        .where('from', '==', normalizedPhone)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
      db
        .collection(COLLECTION_NAME)
        .where('ownerUid', '==', uid)
        .where('to', '==', normalizedPhone)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
    ]);

    const inboundCreatedAt =
      inboundSnap.empty ? null : (inboundSnap.docs[0].data() as Partial<WhatsAppMessageRecord>).createdAt;
    const outboundCreatedAt =
      outboundSnap.empty ? null : (outboundSnap.docs[0].data() as Partial<WhatsAppMessageRecord>).createdAt;

    const inboundIso = typeof inboundCreatedAt === 'string' ? inboundCreatedAt : null;
    const outboundIso = typeof outboundCreatedAt === 'string' ? outboundCreatedAt : null;

    let result: string | null = null;
    if (!inboundIso && !outboundIso) result = null;
    else if (!inboundIso) result = outboundIso;
    else if (!outboundIso) result = inboundIso;
    else result = inboundIso > outboundIso ? inboundIso : outboundIso;

    lastActivityCache.set(cacheKey, { activity: result, cachedAt: Date.now() });
    return result;
  } catch (error) {
    logger.warn('getLastConversationActivityByPhone failed (index may still be building)', error);
    return null;
  }
}
