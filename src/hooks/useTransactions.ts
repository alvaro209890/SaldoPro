import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
    onTransactionsSnapshot,
    addTransaction,
    updateTransaction,
    deleteTransaction,
} from '@/supabase/data';
import type { Transaction } from '@/types';
import { toast } from 'sonner';

export function useTransactions(monthKey: string) {
    const { user } = useAuth();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onTransactionsSnapshot(
            user.id,
            monthKey,
            (data) => {
                setTransactions(data);
                setLoading(false);
            },
            (error) => {
                console.error(error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user, monthKey]);

    const add = async (data: Omit<Transaction, 'id' | 'monthKey' | 'createdAt' | 'updatedAt'>) => {
        if (!user) return;
        try {
            await addTransaction(user.id, data);
            toast.success('Transação adicionada com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao adicionar transação.');
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => {
        if (!user) return;
        try {
            await updateTransaction(user.id, id, data);
            toast.success('Transação atualizada!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar transação.');
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!user) return;
        try {
            await deleteTransaction(user.id, id);
            toast.success('Transação removida!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao remover transação.');
            throw error;
        }
    };

    return {
        transactions,
        loading,
        add,
        update,
        remove,
    };
}
