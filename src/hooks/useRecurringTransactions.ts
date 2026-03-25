import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
    onRecurringTransactionsSnapshot,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    addTransaction,
} from '@/supabase/data';
import type { RecurringTransaction, RecurringTransactionFormData } from '@/types';
import { toast } from 'sonner';
import { todayISO, advanceDate } from '@/utils/date';

export function useRecurringTransactions() {
    const { user } = useAuth();
    const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const generatingRef = useRef(false);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onRecurringTransactionsSnapshot(
            user.id,
            (data) => {
                setRecurringTransactions(data);
                setLoading(false);
            },
            (error) => {
                console.error(error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const add = async (data: RecurringTransactionFormData) => {
        if (!user) return;
        try {
            await addRecurringTransaction(user.id, {
                ...data,
                endDate: data.endDate || null,
                nextDueDate: data.startDate,
                active: true,
            });
            toast.success('Transação recorrente criada!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao criar transação recorrente.');
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<RecurringTransaction, 'id' | 'createdAt'>>) => {
        if (!user) return;
        try {
            await updateRecurringTransaction(user.id, id, data);
            toast.success('Transação recorrente atualizada!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar transação recorrente.');
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!user) return;
        try {
            await deleteRecurringTransaction(user.id, id);
            toast.success('Transação recorrente removida!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao remover transação recorrente.');
            throw error;
        }
    };

    const toggleActive = async (item: RecurringTransaction) => {
        await update(item.id, { active: !item.active });
    };

    const generateOverdueTransactions = useCallback(async () => {
        if (!user || generatingRef.current) return;
        generatingRef.current = true;

        try {
            const today = todayISO();
            const overdue = recurringTransactions.filter(
                (rt) => rt.active && rt.nextDueDate <= today
            );

            let generated = 0;
            for (const rt of overdue) {
                let nextDate = rt.nextDueDate;
                while (nextDate <= today) {
                    await addTransaction(user.id, {
                        type: rt.type,
                        amount: rt.amount,
                        date: nextDate,
                        category: rt.category,
                        description: rt.description,
                        paymentMethod: rt.paymentMethod,
                    });
                    generated++;
                    nextDate = advanceDate(nextDate, rt.frequency);
                }

                const updates: Partial<RecurringTransaction> = { nextDueDate: nextDate };
                if (rt.endDate && nextDate > rt.endDate) {
                    updates.active = false;
                }
                await updateRecurringTransaction(user.id, rt.id, updates);
            }

            if (generated > 0) {
                toast.success(`${generated} transação(ões) recorrente(s) gerada(s)!`);
            }
        } finally {
            generatingRef.current = false;
        }
    }, [user, recurringTransactions]);

    return {
        recurringTransactions,
        loading,
        add,
        update,
        remove,
        toggleActive,
        generateOverdueTransactions,
    };
}
