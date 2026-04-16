import { createContext, useContext, useEffect, useState } from 'react';
import {
    AUTH_CHANGED_EVENT,
    getStoredAuthSession,
    restoreAuthSession,
    type AuthSession,
    type AuthUser,
} from '@/supabase/auth';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    displayName: string | null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    displayName: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [displayName, setDisplayName] = useState<string | null>(null);

    const applySession = (session: AuthSession | null) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setDisplayName((currentUser?.user_metadata?.display_name as string | undefined) ?? null);
    };

    useEffect(() => {
        let cancelled = false;
        applySession(getStoredAuthSession());

        void restoreAuthSession().then((session) => {
            if (cancelled) return;
            applySession(session);
            setLoading(false);
        });

        const handleAuthChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ session?: AuthSession | null }>).detail;
            applySession(detail?.session ?? null);
            setLoading(false);
        };

        window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);

        return () => {
            cancelled = true;
            window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
        };
    }, []);

    // Custom event to update display name across the app without reloading
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const uid = user?.id ?? null;

        const handleProfileUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ uid?: string; displayName?: string | null }>).detail;
            if (!uid || detail?.uid !== uid) return;
            setDisplayName(detail.displayName || null);
        };

        window.addEventListener('saldopro:profile-updated', handleProfileUpdated);

        return () => {
            window.removeEventListener('saldopro:profile-updated', handleProfileUpdated);
        };
    }, [user?.id]);

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
