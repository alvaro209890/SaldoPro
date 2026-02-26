import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
    onRemindersSnapshot,
    addReminder,
    updateReminder,
    deleteReminder,
} from '@/firebase/firestore';
import type { Reminder } from '@/types';
import { toast } from 'sonner';

export function useReminders() {
    const { user } = useAuth();
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onRemindersSnapshot(
            user.uid,
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
    }, [user]);

    const add = async (data: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>) => {
        if (!user) return;
        try {
            await addReminder(user.uid, data);
            toast.success('Lembrete adicionado com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao adicionar lembrete.');
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<Reminder, 'id' | 'createdAt'>>) => {
        if (!user) return;
        try {
            await updateReminder(user.uid, id, data);
            toast.success('Lembrete atualizado!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar lembrete.');
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!user) return;
        try {
            await deleteReminder(user.uid, id);
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
