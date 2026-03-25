import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/supabase/client';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    displayName: string | null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    displayName: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [displayName, setDisplayName] = useState<string | null>(null);

    useEffect(() => {
        // Initial session fetch
        supabase.auth.getSession().then(({ data: { session } }) => {
            const currentUser = session?.user ?? null;
            setUser(currentUser);
            setDisplayName(currentUser?.user_metadata?.display_name || null);
            setLoading(false);
        });

        // Listen for auth changes (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                const currentUser = session?.user ?? null;
                setUser(currentUser);
                setDisplayName(currentUser?.user_metadata?.display_name || null);
                setLoading(false);
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    // Custom event to update display name across the app without reloading
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleProfileUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ uid?: string; displayName?: string | null }>).detail;
            if (!user || detail?.uid !== user.id) return;
            setDisplayName(detail.displayName || null);
        };

        window.addEventListener('saldopro:profile-updated', handleProfileUpdated);

        return () => {
            window.removeEventListener('saldopro:profile-updated', handleProfileUpdated);
        };
    }, [user]);

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                displayName,
            }}
        >
            {!loading && children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
