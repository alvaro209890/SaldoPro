import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onChatSessionsSnapshot, createChatSession, updateChatSession, deleteChatSession } from '@/supabase/data';
import type { ChatSession } from '@/types';
import { toast } from 'sonner';

export function useChatSessions() {
    const { user } = useAuth();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setSessions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onChatSessionsSnapshot(
            user.id,
            (data) => {
                setSessions(data);
                setLoading(false);
            },
            (error) => {
                console.error('Error fetching chat sessions:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const addSession = async (title: string): Promise<string> => {
        if (!user) throw new Error("Usuário não autenticado");
        try {
            const docRef = await createChatSession(user.id, title);
            return docRef.id;
        } catch (error) {
            console.error('Error creating chat session:', error);
            toast.error('Erro ao criar nova conversa.');
            throw error;
        }
    };

    const editSession = async (sessionId: string, title: string) => {
        if (!user) return;
        try {
            await updateChatSession(user.id, sessionId, title);
        } catch (error) {
            console.error('Error updating chat session:', error);
            toast.error('Erro ao renomear conversa.');
            throw error;
        }
    };

    const removeSession = async (sessionId: string) => {
        if (!user) return;
        try {
            await deleteChatSession(user.id, sessionId);
            // Note: Cloud function should ideally delete all sub-messages when parent is deleted,
            // or we just leave them orphaned if it's fine for simple use cases.
        } catch (error) {
            console.error('Error deleting chat session:', error);
            toast.error('Erro ao apagar conversa.');
            throw error;
        }
    };

    return {
        sessions,
        loading,
        addSession,
        editSession,
        removeSession,
    };
}
