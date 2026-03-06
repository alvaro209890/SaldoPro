import { auth } from '@/firebase/config';
import { BACKEND_URL } from '@/config/backend';

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
    role: Role;
    content: string;
    imageBase64?: string;
}

export interface AIChatResponse {
    message: string;
}

function normalizeChatText(value: string): string {
    return value.normalize('NFC');
}

export async function chatWithAI(
    messages: ChatMessage[]
): Promise<AIChatResponse> {
    // Get Firebase ID token for authentication
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Você precisa estar logado para usar o assistente de IA.');
    }

    const idToken = await user.getIdToken();

    // Build the request payload
    const payload = {
        messages: messages.map(m => ({
            role: m.role,
            content: normalizeChatText(m.content),
            ...(m.imageBase64 ? { imageBase64: m.imageBase64 } : {})
        }))
    };

    const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json',
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('[AI] Backend error:', response.status, errorData);
        throw new Error(errorData.error || 'Falha ao comunicar com a inteligencia artificial.');
    }

    const data = await response.json() as { reply: string };

    return {
        message: normalizeChatText(data.reply || 'Não entendi direito, pode repetir?')
    };
}
