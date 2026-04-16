import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
    onRemindersSnapshot,
    addReminder,
    updateReminder,
    deleteReminder,
} from '@/supabase/data';
import type { Reminder } from '@/types';
import { toast } from 'sonner';

export function useReminders() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid) {
            setReminders([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onRemindersSnapshot(
            uid,
            (data) => {
                setReminders(data);
                setLoading(false);
            },
            (error) => {
                console.error(error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [uid]);

    const add = async (data: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!uid) return;
        try {
            await addReminder(uid, data);
            toast.success('Lembrete adicionado com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao adicionar lembrete.');
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<Reminder, 'id' | 'createdAt'>>) => {
        if (!uid) return;
        try {
            await updateReminder(uid, id, data);
            toast.success('Lembrete atualizado!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar lembrete.');
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!uid) return;
        try {
            await deleteReminder(uid, id);
            toast.success('Lembrete removido!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao remover lembrete.');
            throw error;
        }
    };

    const toggleStatus = async (reminder: Reminder) => {
        const newStatus = reminder.status === 'pending' ? 'paid' : 'pending';
        await update(reminder.id, { status: newStatus });
    };

    return {
        reminders,
        loading,
        add,
        update,
        remove,
        toggleStatus
    };
}
