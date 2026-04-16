import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { onFinancialProfileSnapshot, triggerDataRefresh, upsertFinancialProfile } from '@/supabase/data';
import type { FinancialProfile, FinancialProfileFormData } from '@/types';

export function useFinancialProfile() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [profile, setProfile] = useState<FinancialProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!uid) {
            setProfile(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        triggerDataRefresh(['financial-profile']);
    }, [uid]);

    useEffect(() => {
        if (!uid) {
            setProfile(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onFinancialProfileSnapshot(
            uid,
            (data) => {
                setProfile(data);
                setLoading(false);
            },
            (error) => {
                console.error('Failed to load financial profile:', error);
                setLoading(false);
            }
        );

        return unsubscribe;
    }, [uid]);

    const save = useCallback(async (data: FinancialProfileFormData) => {
        const result = await upsertFinancialProfile(data);
        setProfile(result);
        return result;
    }, []);

    return {
        profile,
        loading,
        hasCompleted: profile !== null,
        save,
        reload: load,
    };
}
