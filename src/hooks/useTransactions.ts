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
    const uid = user?.id ?? null;
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid) {
            setTransactions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onTransactionsSnapshot(
            uid,
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
    }, [uid, monthKey]);

    const add = async (data: Omit<Transaction, 'id' | 'monthKey' | 'createdAt' | 'updatedAt'>) => {
        if (!uid) return;
        try {
            await addTransaction(uid, data);
            toast.success('Transação adicionada com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao adicionar transação.');
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => {
        if (!uid) return;
        try {
            await updateTransaction(uid, id, data);
            toast.success('Transação atualizada!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar transação.');
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!uid) return;
        try {
            await deleteTransaction(uid, id);
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
