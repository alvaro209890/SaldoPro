import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
    onGoalsSnapshot,
    addGoal,
    updateGoal,
    deleteGoal,
    generateAIGoals,
} from '@/supabase/data';
import type { Goal, GoalFormData } from '@/types';

export function useGoals() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        if (!uid) return;
        setLoading(true);
        const unsubscribe = onGoalsSnapshot(
            uid,
            (data) => {
                setGoals(data);
                setLoading(false);
            },
            (error) => {
                console.error('Goals snapshot error:', error);
                setLoading(false);
            }
        );
        return unsubscribe;
    }, [uid]);

    const add = useCallback(
        async (data: GoalFormData) => {
            if (!uid) return;
            await addGoal(uid, {
                title: data.title,
                description: data.description || null,
                targetAmount: data.targetAmount,
                currentAmount: data.currentAmount ?? 0,
                deadline: data.deadline || null,
                priority: data.priority,
            });
        },
        [uid]
    );

    const update = useCallback(
        async (goalId: string, data: Partial<Omit<Goal, 'id' | 'createdAt'>>) => {
            if (!uid) return;
            await updateGoal(uid, goalId, data);
        },
        [uid]
    );

    const remove = useCallback(
        async (goalId: string) => {
            if (!uid) return;
            await deleteGoal(uid, goalId);
        },
        [uid]
    );

    const generateAI = useCallback(async () => {
        setGenerating(true);
        try {
            const result = await generateAIGoals();
            return result;
        } finally {
            setGenerating(false);
        }
    }, []);

    return {
        goals,
        loading,
        generating,
        add,
        update,
        remove,
        generateAI,
    };
}
