import { auth } from './config';
import type { Transaction, Category, UserSettings, StoredChatMessage, ChatSession, Reminder, RecurringTransaction } from '@/types';
import { BACKEND_URL } from '@/config/backend';

export type Unsubscribe = () => void;

const SNAPSHOT_POLL_MS = 5000;

const refreshSubscribers = new Set<() => void>();

function subscribeRefresh(listener: () => void): Unsubscribe {
    refreshSubscribers.add(listener);
    return () => refreshSubscribers.delete(listener);
}

function notifyRefresh(): void {
    for (const listener of refreshSubscribers) {
        listener();
    }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Usuario nao autenticado.');
    }

    const idToken = await user.getIdToken();
    return {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
    };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: {
            ...headers,
            ...(init?.headers ?? {}),
        },
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Erro desconhecido.' }));
        throw new Error(payload.error || 'Erro ao acessar API de dados.');
    }

    if (response.status === 204) {
        return null as T;
    }

    return response.json() as Promise<T>;
}

function createPollingSubscription<T>(
    loader: () => Promise<T>,
    callback: (data: T) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    let active = true;
    let inFlight = false;

    const run = async () => {
        if (!active || inFlight) return;
        inFlight = true;
        try {
            const data = await loader();
            if (active) callback(data);
        } catch (error) {
            if (onError) onError(error as Error);
        } finally {
            inFlight = false;
        }
    };

    void run();
    const interval = window.setInterval(() => {
        void run();
    }, SNAPSHOT_POLL_MS);
    const unsubscribeRefresh = subscribeRefresh(() => {
        void run();
    });

    return () => {
        active = false;
        window.clearInterval(interval);
        unsubscribeRefresh();
    };
}

export function onTransactionsSnapshot(
    _uid: string,
    monthKey: string,
    callback: (transactions: Transaction[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<Transaction[]>(`/api/data/transactions?monthKey=${encodeURIComponent(monthKey)}`),
        callback,
        onError
    );
}

export async function addTransaction(
    _uid: string,
    data: Omit<Transaction, 'id' | 'monthKey' | 'createdAt' | 'updatedAt'>
) {
    const result = await apiRequest<{ id: string }>('/api/data/transactions', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    notifyRefresh();
    return result;
}

export async function updateTransaction(
    _uid: string,
    transactionId: string,
    data: Partial<Omit<Transaction, 'id' | 'createdAt'>>
) {
    await apiRequest<{ ok: true }>(`/api/data/transactions/${transactionId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh();
}

export async function deleteTransaction(_uid: string, transactionId: string) {
    await apiRequest<{ ok: true }>(`/api/data/transactions/${transactionId}`, {
        method: 'DELETE'
    });
    notifyRefresh();
}

export function onCategoriesSnapshot(
    _uid: string,
    callback: (categories: Category[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<Category[]>('/api/data/categories'),
        callback,
        onError
    );
}

export async function addCategory(
    _uid: string,
    data: Omit<Category, 'id' | 'createdAt'>
) {
    const result = await apiRequest<{ id: string }>('/api/data/categories', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    notifyRefresh();
    return result;
}

export async function updateCategory(
    _uid: string,
    categoryId: string,
    data: Partial<Omit<Category, 'id' | 'createdAt'>>
) {
    await apiRequest<{ ok: true }>(`/api/data/categories/${categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh();
}

export async function deleteCategory(_uid: string, categoryId: string) {
    await apiRequest<{ ok: true }>(`/api/data/categories/${categoryId}`, {
        method: 'DELETE'
    });
    notifyRefresh();
}

export function onSettingsSnapshot(
    _uid: string,
    callback: (settings: UserSettings | null) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        async () => {
            const settings = await apiRequest<UserSettings>('/api/data/settings');
            return settings ?? null;
        },
        callback,
        onError
    );
}

export async function updateSettings(
    _uid: string,
    data: Partial<UserSettings>
) {
    await apiRequest<UserSettings>('/api/data/settings', {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh();
}

export function onChatSessionsSnapshot(
    _uid: string,
    callback: (sessions: ChatSession[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<ChatSession[]>('/api/data/chat-sessions'),
        callback,
        onError
    );
}

export async function createChatSession(_uid: string, title: string) {
    const result = await apiRequest<{ id: string }>('/api/data/chat-sessions', {
        method: 'POST',
        body: JSON.stringify({ title })
    });
    notifyRefresh();
    return { id: result.id };
}

export async function updateChatSession(_uid: string, sessionId: string, title: string) {
    await apiRequest<{ ok: true }>(`/api/data/chat-sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title })
    });
    notifyRefresh();
}

export async function deleteChatSession(_uid: string, sessionId: string) {
    await apiRequest<{ ok: true }>(`/api/data/chat-sessions/${sessionId}`, {
        method: 'DELETE'
    });
    notifyRefresh();
}

export function onChatMessagesSnapshot(
    _uid: string,
    sessionId: string,
    callback: (messages: StoredChatMessage[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<StoredChatMessage[]>(`/api/data/chat-sessions/${sessionId}/messages`),
        callback,
        onError
    );
}

export async function addChatMessage(
    _uid: string,
    data: Omit<StoredChatMessage, 'id' | 'createdAt'>
) {
    const result = await apiRequest<{ id: string }>(`/api/data/chat-sessions/${data.sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            role: data.role,
            content: data.content,
            ...(data.imageUrl ? { imageUrl: data.imageUrl } : {})
        })
    });
    notifyRefresh();
    return result;
}

export function onRemindersSnapshot(
    _uid: string,
    callback: (reminders: Reminder[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<Reminder[]>('/api/data/reminders'),
        callback,
        onError
    );
}

export async function addReminder(
    _uid: string,
    data: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>
) {
    const result = await apiRequest<{ id: string }>('/api/data/reminders', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    notifyRefresh();
    return result;
}

export async function updateReminder(
    _uid: string,
    reminderId: string,
    data: Partial<Omit<Reminder, 'id' | 'createdAt'>>
) {
    await apiRequest<{ ok: true }>(`/api/data/reminders/${reminderId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh();
}

export async function deleteReminder(_uid: string, reminderId: string) {
    await apiRequest<{ ok: true }>(`/api/data/reminders/${reminderId}`, {
        method: 'DELETE'
    });
    notifyRefresh();
}

export function onRecurringTransactionsSnapshot(
    _uid: string,
    callback: (items: RecurringTransaction[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createPollingSubscription(
        () => apiRequest<RecurringTransaction[]>('/api/data/recurring-transactions'),
        callback,
        onError
    );
}

export async function addRecurringTransaction(
    _uid: string,
    data: Omit<RecurringTransaction, 'id' | 'createdAt' | 'updatedAt'>
) {
    const result = await apiRequest<{ id: string }>('/api/data/recurring-transactions', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    notifyRefresh();
    return result;
}

export async function updateRecurringTransaction(
    _uid: string,
    recurringId: string,
    data: Partial<Omit<RecurringTransaction, 'id' | 'createdAt'>>
) {
    await apiRequest<{ ok: true }>(`/api/data/recurring-transactions/${recurringId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh();
}

export async function deleteRecurringTransaction(_uid: string, recurringId: string) {
    await apiRequest<{ ok: true }>(`/api/data/recurring-transactions/${recurringId}`, {
        method: 'DELETE'
    });
    notifyRefresh();
}
