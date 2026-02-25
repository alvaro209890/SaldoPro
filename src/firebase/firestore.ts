import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    type Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import type { Transaction, Category, UserSettings } from '@/types';
import { generateMonthKey } from '@/utils/date';

// ─── Transactions ────────────────────────────────────────────

export function onTransactionsSnapshot(
    uid: string,
    monthKey: string,
    callback: (transactions: Transaction[]) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'transactions');
    const q = query(
        ref,
        where('monthKey', '==', monthKey),
        orderBy('date', 'desc')
    );

    return onSnapshot(q, (snap) => {
        const transactions = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        })) as Transaction[];
        callback(transactions);
    });
}

export async function addTransaction(
    uid: string,
    data: Omit<Transaction, 'id' | 'monthKey' | 'createdAt' | 'updatedAt'>
) {
    const ref = collection(db, 'users', uid, 'transactions');
    const now = new Date().toISOString();
    return addDoc(ref, {
        ...data,
        monthKey: generateMonthKey(data.date),
        createdAt: now,
        updatedAt: now,
    });
}

export async function updateTransaction(
    uid: string,
    transactionId: string,
    data: Partial<Omit<Transaction, 'id' | 'createdAt'>>
) {
    const ref = doc(db, 'users', uid, 'transactions', transactionId);
    const updates: Record<string, unknown> = {
        ...data,
        updatedAt: new Date().toISOString(),
    };
    if (data.date) {
        updates.monthKey = generateMonthKey(data.date);
    }
    return updateDoc(ref, updates);
}

export async function deleteTransaction(uid: string, transactionId: string) {
    const ref = doc(db, 'users', uid, 'transactions', transactionId);
    return deleteDoc(ref);
}

// ─── Categories ──────────────────────────────────────────────

export function onCategoriesSnapshot(
    uid: string,
    callback: (categories: Category[]) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'categories');
    const q = query(ref, orderBy('name', 'asc'));

    return onSnapshot(q, (snap) => {
        const categories = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        })) as Category[];
        callback(categories);
    });
}

export async function addCategory(
    uid: string,
    data: Omit<Category, 'id' | 'createdAt'>
) {
    const ref = collection(db, 'users', uid, 'categories');
    return addDoc(ref, {
        ...data,
        createdAt: new Date().toISOString(),
    });
}

export async function updateCategory(
    uid: string,
    categoryId: string,
    data: Partial<Omit<Category, 'id' | 'createdAt'>>
) {
    const ref = doc(db, 'users', uid, 'categories', categoryId);
    return updateDoc(ref, data);
}

export async function deleteCategory(uid: string, categoryId: string) {
    const ref = doc(db, 'users', uid, 'categories', categoryId);
    return deleteDoc(ref);
}

// ─── Settings ────────────────────────────────────────────────

export function onSettingsSnapshot(
    uid: string,
    callback: (settings: UserSettings | null) => void
): Unsubscribe {
    const ref = doc(db, 'users', uid, 'settings', 'profile');
    return onSnapshot(ref, (snap) => {
        if (snap.exists()) {
            callback(snap.data() as UserSettings);
        } else {
            callback(null);
        }
    });
}

export async function updateSettings(
    uid: string,
    data: Partial<UserSettings>
) {
    const ref = doc(db, 'users', uid, 'settings', 'profile');
    return updateDoc(ref, {
        ...data,
        updatedAt: new Date().toISOString(),
    });
}
