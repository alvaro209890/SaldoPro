import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onChatMessagesSnapshot, addChatMessage } from '@/supabase/data';
import type { StoredChatMessage } from '@/types';
import { toast } from 'sonner';

export function useChats(sessionId: string | null) {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [messages, setMessages] = useState<StoredChatMessage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid || !sessionId) {
            setMessages([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onChatMessagesSnapshot(
            uid,
            sessionId,
            (data) => {
                setMessages(data);
                setLoading(false);
            },
            (error) => {
                console.error('Error fetching chats:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [uid, sessionId]);

    const addMessage = async (data: Omit<StoredChatMessage, 'id' | 'createdAt'>) => {
        if (!uid) return;
        try {
            await addChatMessage(uid, data);
        } catch (error) {
            console.error('Error saving chat message:', error);
            toast.error('Erro ao salvar o histórico no banco de dados.');
            throw error;
        }
    };

    return {
        messages,
        loading,
        addMessage,
    };
}
