import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { onSettingsSnapshot, updateSettings } from '@/firebase/firestore';
import type { UserSettings } from '@/types';
import { toast } from 'sonner';

export function useSettings() {
    const { user } = useAuth();
    const [settings, setSettings] = useState<UserSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const unsubscribe = onSettingsSnapshot(user.uid, (data) => {
            setSettings(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const update = async (data: Partial<UserSettings>) => {
        if (!user) return;
        try {
            await updateSettings(user.uid, data);
            toast.success('Configurações atualizadas!');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar configurações.');
            throw error;
        }
    };

    return {
        settings,
        loading,
        update,
    };
}
