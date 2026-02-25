import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { logger } from './logger';
import type { WhatsAppMessageRecord } from '../types/whatsapp';

const COLLECTION_NAME = 'whatsappMessages';

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
