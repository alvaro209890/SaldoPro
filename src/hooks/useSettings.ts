import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onSettingsSnapshot, updateSettings } from '@/supabase/data';
import type { UserSettings } from '@/types';
import { toast } from 'sonner';

export function useSettings() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [settings, setSettings] = useState<UserSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid) {
            setSettings(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onSettingsSnapshot(
            uid,
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
    }, [uid]);

    const update = async (data: Partial<UserSettings>, options?: { silent?: boolean }) => {
        if (!uid) return;
        try {
            await updateSettings(uid, data);
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
