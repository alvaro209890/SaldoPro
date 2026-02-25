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
import type { Transaction, Category, UserSettings, StoredChatMessage, ChatSession } from '@/types';
import { generateMonthKey } from '@/utils/date';

// ─── Transactions ────────────────────────────────────────────

export function onTransactionsSnapshot(
    uid: string,
    monthKey: string,
    callback: (transactions: Transaction[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'transactions');
    const q = query(
        ref,
        where('monthKey', '==', monthKey),
        orderBy('date', 'desc')
    );

    return onSnapshot(
        q,
        (snap) => {
            const transactions = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as Transaction[];
            callback(transactions);
        },
        (error) => {
            console.error('Error fetching transactions:', error);
            if (onError) onError(error);
        }
    );
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
    callback: (categories: Category[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'categories');
    const q = query(ref, orderBy('name', 'asc'));

    return onSnapshot(
        q,
        (snap) => {
            const categories = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as Category[];
            callback(categories);
        },
        (error) => {
            console.error('Error fetching categories:', error);
            if (onError) onError(error);
        }
    );
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
    callback: (settings: UserSettings | null) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    const ref = doc(db, 'users', uid, 'settings', 'profile');
    return onSnapshot(
        ref,
        (snap) => {
            if (snap.exists()) {
                callback(snap.data() as UserSettings);
            } else {
                callback(null);
            }
        },
        (error) => {
            console.error('Error fetching settings:', error);
            if (onError) onError(error);
        }
    );
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

// ─── Chat Sessions ──────────────────────────────────────────────

export function onChatSessionsSnapshot(
    uid: string,
    callback: (sessions: ChatSession[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'chatSessions');
    const q = query(ref, orderBy('updatedAt', 'desc'));

    return onSnapshot(
        q,
        (snap) => {
            const sessions = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as ChatSession[];
            callback(sessions);
        },
        (error) => {
            console.error('Error fetching chat sessions:', error);
            if (onError) onError(error);
        }
    );
}

export async function createChatSession(uid: string, title: string) {
    const ref = collection(db, 'users', uid, 'chatSessions');
    const now = new Date().toISOString();
    return addDoc(ref, {
        title,
        createdAt: now,
        updatedAt: now,
    });
}

export async function updateChatSession(uid: string, sessionId: string, title: string) {
    const ref = doc(db, 'users', uid, 'chatSessions', sessionId);
    return updateDoc(ref, {
        title,
        updatedAt: new Date().toISOString(),
    });
}

export async function deleteChatSession(uid: string, sessionId: string) {
    const ref = doc(db, 'users', uid, 'chatSessions', sessionId);
    return deleteDoc(ref);
}

// ─── Chat Messages ──────────────────────────────────────────────

export function onChatMessagesSnapshot(
    uid: string,
    sessionId: string,
    callback: (messages: StoredChatMessage[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    const ref = collection(db, 'users', uid, 'chatSessions', sessionId, 'messages');
    const q = query(
        ref,
        orderBy('createdAt', 'asc')
    );

    return onSnapshot(
        q,
        (snap) => {
            const messages = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as StoredChatMessage[];
            callback(messages);
        },
        (error) => {
            console.error('Error fetching chat messages:', error);
            if (onError) onError(error);
        }
    );
}

export async function addChatMessage(
    uid: string,
    data: Omit<StoredChatMessage, 'id' | 'createdAt'>
) {
    const ref = collection(db, 'users', uid, 'chatSessions', data.sessionId, 'messages');
    const sessionRef = doc(db, 'users', uid, 'chatSessions', data.sessionId);

    // Create the message
    const addPromise = addDoc(ref, {
        ...data,
        createdAt: new Date().toISOString(),
    });

    // Update the parent session's updatedAt timestamp
    const updateSessionPromise = updateDoc(sessionRef, {
        updatedAt: new Date().toISOString(),
    });

    return Promise.all([addPromise, updateSessionPromise]);
}

