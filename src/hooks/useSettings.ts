import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onSettingsSnapshot, updateSettings } from '@/supabase/data';
import type { UserSettings } from '@/types';
import { toast } from 'sonner';

export function useSettings() {
    const { user } = useAuth();
    const [settings, setSettings] = useState<UserSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onSettingsSnapshot(
            user.id,
            (data) => {
                setSettings(data);
                setLoading(false);
            },
            (error) => {
                console.error(error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const update = async (data: Partial<UserSettings>, options?: { silent?: boolean }) => {
        if (!user) return;
        try {
            await updateSettings(user.id, data);
            if (!options?.silent) {
                toast.success('Configurações atualizadas!');
            }
        } catch (error) {
            console.error(error);
            if (!options?.silent) {
                toast.error('Erro ao atualizar configurações.');
            }
            throw error;
        }
    };

    return {
        settings,
        loading,
        update,
    };
}
