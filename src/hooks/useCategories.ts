import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
    onCategoriesSnapshot,
    addCategory,
    updateCategory,
    deleteCategory,
} from '@/supabase/data';
import type { Category } from '@/types';
import { toast } from 'sonner';

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
}

export function useCategories() {
    const { user } = useAuth();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onCategoriesSnapshot(
            user.id,
            (data) => {
                setCategories(data);
                setLoading(false);
            },
            (error) => {
                console.error(error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const incomeCategories = categories.filter((c) => c.type === 'income');
    const expenseCategories = categories.filter((c) => c.type === 'expense');

    const add = async (data: Omit<Category, 'id' | 'createdAt'>) => {
        if (!user) return;
        try {
            await addCategory(user.id, data);
            toast.success('Categoria adicionada!');
        } catch (error) {
            console.error(error);
            toast.error(getErrorMessage(error, 'Erro ao adicionar categoria.'));
            throw error;
        }
    };

    const update = async (id: string, data: Partial<Omit<Category, 'id' | 'createdAt'>>) => {
        if (!user) return;
        try {
            await updateCategory(user.id, id, data);
            toast.success('Categoria atualizada!');
        } catch (error) {
            console.error(error);
            toast.error(getErrorMessage(error, 'Erro ao atualizar categoria.'));
            throw error;
        }
    };

    const remove = async (id: string) => {
        if (!user) return;
        try {
            await deleteCategory(user.id, id);
            toast.success('Categoria removida!');
        } catch (error) {
            console.error(error);
            toast.error(getErrorMessage(error, 'Erro ao remover categoria.'));
            throw error;
        }
    };

    return {
        categories,
        incomeCategories,
        expenseCategories,
        loading,
        add,
        update,
        remove,
    };
}
