import { useState, useEffect, useCallback } from 'react';
import { getFinancialProfile, upsertFinancialProfile } from '@/supabase/data';
import type { FinancialProfile, FinancialProfileFormData } from '@/types';

export function useFinancialProfile() {
    const [profile, setProfile] = useState<FinancialProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getFinancialProfile();
            setProfile(data);
        } catch (error) {
            console.error('Failed to load financial profile:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

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
