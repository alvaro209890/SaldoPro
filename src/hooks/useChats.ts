import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onChatMessagesSnapshot, addChatMessage } from '@/supabase/data';
import type { StoredChatMessage } from '@/types';
import { toast } from 'sonner';

export function useChats(sessionId: string | null) {
    const { user } = useAuth();
    const [messages, setMessages] = useState<StoredChatMessage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user || !sessionId) {
            setMessages([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onChatMessagesSnapshot(
            user.id,
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
    }, [user, sessionId]);

    const addMessage = async (data: Omit<StoredChatMessage, 'id' | 'createdAt'>) => {
        if (!user) return;
        try {
            await addChatMessage(user.id, data);
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
