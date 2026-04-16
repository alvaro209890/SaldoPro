import { getAccessToken } from '@/supabase/auth';
import type {
    Transaction,
    Category,
    UserSettings,
    StoredChatMessage,
    ChatSession,
    Reminder,
    RecurringTransaction,
    UserDocumentAsset,
    UserDocumentInput,
    UserDocumentUpdateInput,
} from '@/types';
import { BACKEND_URL } from '@/config/backend';

export type Unsubscribe = () => void;

type DataChangeScope =
    | 'categories'
    | 'chat-messages'
    | 'chat-sessions'
    | 'documents'
    | 'financial-profile'
    | 'goals'
    | 'profile'
    | 'recurring-transactions'
    | 'reminders'
    | 'settings'
    | 'transactions';

type RefreshSubscriber = {
    scopes: Set<DataChangeScope> | null;
    listener: () => void;
};

type RealtimeConnectionState = {
    uid: string;
    subscribers: number;
    stop: () => void;
};

type ParsedRealtimeEvent = {
    event: string;
    data: unknown;
};

const FALLBACK_REFRESH_MS = 60000;
const REALTIME_RETRY_BASE_MS = 1000;
const REALTIME_RETRY_MAX_MS = 10000;
const refreshSubscribers = new Set<RefreshSubscriber>();
let realtimeConnection: RealtimeConnectionState | null = null;

function subscribeRefresh(scopes: DataChangeScope[] | null, listener: () => void): Unsubscribe {
    const subscriber: RefreshSubscriber = {
        scopes: scopes ? new Set(scopes) : null,
        listener,
    };
    refreshSubscribers.add(subscriber);
    return () => refreshSubscribers.delete(subscriber);
}

function notifyRefresh(scopes: DataChangeScope[] | null = null): void {
    for (const subscriber of refreshSubscribers) {
        if (
            scopes &&
            subscriber.scopes &&
            !scopes.some((scope) => subscriber.scopes?.has(scope))
        ) {
            continue;
        }
        subscriber.listener();
    }
}

export function triggerDataRefresh(scopes: DataChangeScope[] | null = null): void {
    notifyRefresh(scopes);
}

async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();

    if (!token) {
        throw new Error('Usu\u00e1rio n\u00e3o autenticado.');
    }

    return {
        'Authorization': `Bearer ${token}`,
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

function parseSseEvent(rawEvent: string): ParsedRealtimeEvent | null {
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of rawEvent.split('\n')) {
        if (!line || line.startsWith(':')) {
            continue;
        }
        if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim() || 'message';
            continue;
        }
        if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
        }
    }

    if (dataLines.length === 0) {
        return null;
    }

    const payloadText = dataLines.join('\n');
    try {
        return {
            event,
            data: JSON.parse(payloadText),
        };
    } catch {
        return {
            event,
            data: payloadText,
        };
    }
}

async function consumeRealtimeStream(signal: AbortSignal): Promise<void> {
    const token = await getAccessToken();
    if (!token) {
        throw new Error('Usuário não autenticado.');
    }

    const response = await fetch(`${BACKEND_URL}/api/data/events`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
        },
        signal,
        cache: 'no-store',
    });

    if (!response.ok || !response.body) {
        throw new Error(`Realtime unavailable (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex >= 0) {
            const rawEvent = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);

            if (rawEvent) {
                const parsed = parseSseEvent(rawEvent);
                const scope = typeof (parsed?.data as { scope?: unknown } | undefined)?.scope === 'string'
                    ? (parsed?.data as { scope: DataChangeScope }).scope
                    : null;

                if (parsed?.event === 'data-changed' && scope) {
                    notifyRefresh([scope]);
                }
            }

            separatorIndex = buffer.indexOf('\n\n');
        }
    }
}

function retainRealtimeConnection(uid: string): Unsubscribe {
    if (realtimeConnection?.uid !== uid) {
        realtimeConnection?.stop();

        const controller = new AbortController();
        let active = true;
        let retryDelay = REALTIME_RETRY_BASE_MS;

        const run = async () => {
            while (active && !controller.signal.aborted) {
                try {
                    await consumeRealtimeStream(controller.signal);
                    retryDelay = REALTIME_RETRY_BASE_MS;
                } catch (error) {
                    if (controller.signal.aborted || !active) {
                        break;
                    }
                    console.error('Realtime stream disconnected:', error);
                    await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
                    retryDelay = Math.min(retryDelay * 2, REALTIME_RETRY_MAX_MS);
                }
            }
        };

        void run();

        realtimeConnection = {
            uid,
            subscribers: 0,
            stop: () => {
                active = false;
                controller.abort();
            },
        };
    }

    realtimeConnection.subscribers += 1;

    return () => {
        if (!realtimeConnection || realtimeConnection.uid !== uid) {
            return;
        }

        realtimeConnection.subscribers -= 1;
        if (realtimeConnection.subscribers <= 0) {
            realtimeConnection.stop();
            realtimeConnection = null;
        }
    };
}

function createLiveSubscription<T>(
    uid: string,
    loader: () => Promise<T>,
    scopes: DataChangeScope[],
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
    }, FALLBACK_REFRESH_MS);
    const releaseRealtime = retainRealtimeConnection(uid);
    const unsubscribeRefresh = subscribeRefresh(scopes, () => {
        void run();
    });

    return () => {
        active = false;
        window.clearInterval(interval);
        releaseRealtime();
        unsubscribeRefresh();
    };
}

export function onTransactionsSnapshot(
    uid: string,
    monthKey: string,
    callback: (transactions: Transaction[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<Transaction[]>(`/api/data/transactions?monthKey=${encodeURIComponent(monthKey)}`),
        ['transactions'],
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
    notifyRefresh(['transactions']);
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
    notifyRefresh(['transactions']);
}

export async function deleteTransaction(_uid: string, transactionId: string) {
    await apiRequest<{ ok: true }>(`/api/data/transactions/${transactionId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['transactions']);
}

export function onCategoriesSnapshot(
    uid: string,
    callback: (categories: Category[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<Category[]>('/api/data/categories'),
        ['categories'],
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
    notifyRefresh(['categories']);
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
    notifyRefresh(['categories']);
}

export async function deleteCategory(_uid: string, categoryId: string) {
    await apiRequest<{ ok: true }>(`/api/data/categories/${categoryId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['categories']);
}

export function onSettingsSnapshot(
    uid: string,
    callback: (settings: UserSettings | null) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        async () => {
            const settings = await apiRequest<UserSettings>('/api/data/settings');
            return settings ?? null;
        },
        ['settings'],
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
    notifyRefresh(['settings']);
}

export async function updateDisplayName(
    uid: string,
    displayName: string
): Promise<void> {
    await apiRequest<{ ok: true; displayName: string }>('/api/data/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName })
    });
    // Dispatch custom event so useAuth picks up the new name immediately
    window.dispatchEvent(
        new CustomEvent('saldopro:profile-updated', {
            detail: { uid, displayName }
        })
    );
}

export function onChatSessionsSnapshot(
    uid: string,
    callback: (sessions: ChatSession[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<ChatSession[]>('/api/data/chat-sessions'),
        ['chat-sessions'],
        callback,
        onError
    );
}

export async function createChatSession(_uid: string, title: string) {
    const result = await apiRequest<{ id: string }>('/api/data/chat-sessions', {
        method: 'POST',
        body: JSON.stringify({ title })
    });
    notifyRefresh(['chat-sessions']);
    return { id: result.id };
}

export async function updateChatSession(_uid: string, sessionId: string, title: string) {
    await apiRequest<{ ok: true }>(`/api/data/chat-sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title })
    });
    notifyRefresh(['chat-sessions']);
}

export async function deleteChatSession(_uid: string, sessionId: string) {
    await apiRequest<{ ok: true }>(`/api/data/chat-sessions/${sessionId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['chat-sessions', 'chat-messages']);
}

export function onChatMessagesSnapshot(
    uid: string,
    sessionId: string,
    callback: (messages: StoredChatMessage[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<StoredChatMessage[]>(`/api/data/chat-sessions/${sessionId}/messages`),
        ['chat-messages'],
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
    notifyRefresh(['chat-messages', 'chat-sessions']);
    return result;
}

export async function getUserDocuments(_uid: string) {
    return apiRequest<UserDocumentAsset[]>('/api/data/documents');
}

export function onUserDocumentsSnapshot(
    uid: string,
    callback: (documents: UserDocumentAsset[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<UserDocumentAsset[]>('/api/data/documents'),
        ['documents'],
        callback,
        onError
    );
}

export async function createUserDocumentAsset(_uid: string, data: UserDocumentInput) {
    const result = await apiRequest<{ id: string }>('/api/data/documents', {
        method: 'POST',
        body: JSON.stringify(data)
    });
    notifyRefresh(['documents']);
    return result;
}

export async function updateUserDocumentAsset(_uid: string, documentId: string, data: UserDocumentUpdateInput) {
    await apiRequest<{ ok: true }>(`/api/data/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
    });
    notifyRefresh(['documents']);
}

export async function deleteUserDocumentAsset(_uid: string, documentId: string) {
    await apiRequest<{ ok: true }>(`/api/data/documents/${documentId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['documents']);
}

export async function getUserDocumentDownloadUrl(_uid: string, documentId: string) {
    const result = await apiRequest<{ url: string; fileName: string }>(`/api/data/documents/${documentId}/download-url`);
    notifyRefresh(['documents']);
    return result;
}

export function onRemindersSnapshot(
    uid: string,
    callback: (reminders: Reminder[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<Reminder[]>('/api/data/reminders'),
        ['reminders'],
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
    notifyRefresh(['reminders']);
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
    notifyRefresh(['reminders']);
}

export async function deleteReminder(_uid: string, reminderId: string) {
    await apiRequest<{ ok: true }>(`/api/data/reminders/${reminderId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['reminders']);
}

export function onRecurringTransactionsSnapshot(
    uid: string,
    callback: (items: RecurringTransaction[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<RecurringTransaction[]>('/api/data/recurring-transactions'),
        ['recurring-transactions'],
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
    notifyRefresh(['recurring-transactions']);
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
    notifyRefresh(['recurring-transactions']);
}

export async function deleteRecurringTransaction(_uid: string, recurringId: string) {
    await apiRequest<{ ok: true }>(`/api/data/recurring-transactions/${recurringId}`, {
        method: 'DELETE'
    });
    notifyRefresh(['recurring-transactions']);
}

// ─── Financial Profile ───────────────────────────────────────────────────────

export async function getFinancialProfile(): Promise<import('@/types').FinancialProfile | null> {
    return apiRequest<import('@/types').FinancialProfile | null>('/api/data/financial-profile');
}

export function onFinancialProfileSnapshot(
    uid: string,
    callback: (profile: import('@/types').FinancialProfile | null) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<import('@/types').FinancialProfile | null>('/api/data/financial-profile'),
        ['financial-profile'],
        callback,
        onError
    );
}

export async function upsertFinancialProfile(data: import('@/types').FinancialProfileFormData): Promise<import('@/types').FinancialProfile> {
    const result = await apiRequest<import('@/types').FinancialProfile>('/api/data/financial-profile', {
        method: 'PUT',
        body: JSON.stringify(data),
    });
    notifyRefresh(['financial-profile']);
    return result;
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export function onGoalsSnapshot(
    uid: string,
    callback: (goals: import('@/types').Goal[]) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return createLiveSubscription(
        uid,
        () => apiRequest<import('@/types').Goal[]>('/api/data/goals'),
        ['goals'],
        callback,
        onError
    );
}

export async function addGoal(
    _uid: string,
    data: Omit<import('@/types').Goal, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'status' | 'currentAmount'> & { currentAmount?: number }
) {
    const result = await apiRequest<{ id: string }>('/api/data/goals', {
        method: 'POST',
        body: JSON.stringify(data),
    });
    notifyRefresh(['goals']);
    return result;
}

export async function updateGoal(
    _uid: string,
    goalId: string,
    data: Partial<Omit<import('@/types').Goal, 'id' | 'createdAt'>>
) {
    await apiRequest<{ ok: true }>(`/api/data/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
    notifyRefresh(['goals']);
}

export async function deleteGoal(_uid: string, goalId: string) {
    await apiRequest<{ ok: true }>(`/api/data/goals/${goalId}`, {
        method: 'DELETE',
    });
    notifyRefresh(['goals']);
}

export async function generateAIGoals(): Promise<{ generated: number; goals: import('@/types').Goal[] }> {
    const result = await apiRequest<{ generated: number; goals: import('@/types').Goal[] }>('/api/data/goals/generate', {
        method: 'POST',
    });
    notifyRefresh(['goals']);
    return result;
}
