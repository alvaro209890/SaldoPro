import type { Category, Transaction, PaymentMethod } from '@/types';
import { auth } from '@/firebase/config';
import { BACKEND_URL } from '@/config/backend';

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
    role: Role;
    content: string;
    imageBase64?: string;
}

export interface AIActionAdd {
    action: 'add_transaction';
    type: 'income' | 'expense';
    amount: number;
    description: string;
    categoryId: string;
    date: string;
    paymentMethod: PaymentMethod;
}

export interface AIActionUpdate {
    action: 'update_transaction';
    id: string; // The transaction ID
    changes: Partial<Omit<Transaction, 'id' | 'createdAt'>>;
}

export interface AIActionDelete {
    action: 'delete_transaction';
    id: string; // The transaction ID
}

export interface AIActionNone {
    action: 'none';
}

export type AIAction = AIActionAdd | AIActionUpdate | AIActionDelete | AIActionNone;

export interface AIChatResponse {
    message: string;
    parsedActions: AIAction[];
    parsedAction: AIAction;
}

export async function chatWithAI(
    messages: ChatMessage[],
    categories: Category[],
    recentTransactions: Transaction[]
): Promise<AIChatResponse> {
    // Get Firebase ID token for authentication
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Voce precisa estar logado para usar o assistente de IA.');
    }

    const idToken = await user.getIdToken();

    // Build the request payload
    const payload = {
        messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.imageBase64 ? { imageBase64: m.imageBase64 } : {})
        })),
        categories: categories.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type
        })),
        transactions: recentTransactions.slice(0, 50).map(t => ({
            id: t.id,
            date: t.date,
            description: t.description,
            amount: t.amount,
            type: t.type,
            category: t.category
        }))
    };

    const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('[AI] Backend error:', response.status, errorData);
        throw new Error(errorData.error || 'Falha ao comunicar com a inteligencia artificial.');
    }

    const data = await response.json() as {
        reply: string;
        actionObjects?: AIAction[];
        actionObject?: AIAction;
    };

    const firstAction = Array.isArray(data.actionObjects) && data.actionObjects.length > 0
        ? data.actionObjects[0]
        : (data.actionObject || { action: 'none' as const });

    return {
        message: data.reply || 'Nao entendi direito, pode repetir?',
        parsedActions: Array.isArray(data.actionObjects) && data.actionObjects.length > 0
            ? data.actionObjects
            : [firstAction],
        parsedAction: firstAction
    };
}
