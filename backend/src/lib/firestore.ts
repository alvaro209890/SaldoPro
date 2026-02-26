import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { logger } from './logger';
import type { WhatsAppMessageRecord } from '../types/whatsapp';
import { normalizePhoneNumber } from '../whatsapp/events';

const COLLECTION_NAME = 'whatsappMessages';
const BINDINGS_COLLECTION_NAME = 'whatsappBindings';

function sanitizeDocId(value: string): string {
  return value.replace(/[^\w.-]/g, '_');
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

export async function inboundMessageExists(messageId: string): Promise<boolean> {
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

export async function getAllowedWhatsAppNumbers(uid: string): Promise<string[]> {
  const snap = await db.collection('users').doc(uid).collection('settings').doc('profile').get();
  if (!snap.exists) return [];

  const data = snap.data() as { whatsappAllowedNumbers?: unknown };
  if (!Array.isArray(data.whatsappAllowedNumbers)) return [];

  return [...new Set(data.whatsappAllowedNumbers
    .map((value) => (typeof value === 'string' ? normalizePhoneNumber(value) : ''))
    .filter((value) => value.length >= 10))];
}

function normalizeAccessCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function extractUidFromSettingsDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): string | null {
  return doc.ref.parent.parent?.id ?? null;
}

export async function isPhoneAllowedForUid(uid: string, phone: string): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return false;

  const allowed = await getAllowedWhatsAppNumbers(uid);
  return allowed.includes(normalizedPhone);
}

export async function isPhoneAllowedForAnyAccount(phone: string): Promise<boolean> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return false;

  const snap = await db
    .collectionGroup('settings')
    .where('whatsappAllowedNumbers', 'array-contains', normalizedPhone)
    .limit(1)
    .get();

  return snap.docs.some((doc) => doc.id === 'profile');
}

export async function resolveUidFromPhone(phone: string): Promise<string | null> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const snap = await db
    .collectionGroup('settings')
    .where('whatsappAllowedNumbers', 'array-contains', normalizedPhone)
    .limit(5)
    .get();

  for (const settingsDoc of snap.docs) {
    if (settingsDoc.id !== 'profile') continue;
    const uid = extractUidFromSettingsDoc(settingsDoc);
    if (uid) return uid;
  }

  return null;
}

export async function resolveUidFromAccessCode(
  accessCodeText: string,
  phone: string
): Promise<string | null> {
  const normalizedCode = normalizeAccessCode(accessCodeText);
  const normalizedPhone = normalizePhoneNumber(phone);
  // Minimum 8 chars to match looksLikeAccessCode() in WhatsAppClient
  if (normalizedCode.length < 8 || normalizedPhone.length < 10) {
    return null;
  }

  const snap = await db
    .collectionGroup('settings')
    .where('whatsappAccessCodeNormalized', '==', normalizedCode)
    .limit(5)
    .get();

  for (const settingsDoc of snap.docs) {
    if (settingsDoc.id !== 'profile') continue;

    const uid = extractUidFromSettingsDoc(settingsDoc);
    if (!uid) continue;

    const data = settingsDoc.data() as { whatsappAllowedNumbers?: unknown };
    const allowed = Array.isArray(data.whatsappAllowedNumbers)
      ? data.whatsappAllowedNumbers
          .map((value) => (typeof value === 'string' ? normalizePhoneNumber(value) : ''))
          .filter((value) => value.length >= 10)
      : [];

    if (allowed.includes(normalizedPhone)) {
      return uid;
    }
  }

  return null;
}

export async function getPhoneBinding(phone: string): Promise<WhatsAppPhoneBinding | null> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 10) return null;

  const snap = await db.collection(BINDINGS_COLLECTION_NAME).doc(normalizedPhone).get();
  if (!snap.exists) return null;

  const data = snap.data() as Partial<WhatsAppPhoneBinding>;
  if (!data.uid || typeof data.uid !== 'string') return null;

  return {
    phone: normalizedPhone,
    uid: data.uid,
    linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
  };
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
  const docRef = db.collection(BINDINGS_COLLECTION_NAME).doc(normalizedPhone);
  const existing = await docRef.get();
  const linkedAt =
    existing.exists && typeof existing.data()?.linkedAt === 'string'
      ? (existing.data()?.linkedAt as string)
      : now;

  await docRef.set(
    {
      phone: normalizedPhone,
      uid,
      linkedAt,
      updatedAt: now
    },
    { merge: true }
  );
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
