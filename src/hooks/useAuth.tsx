import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/firebase/config';

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
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setDisplayName(currentUser?.displayName || null);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleProfileUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ uid?: string; displayName?: string | null }>).detail;
            if (!detail?.uid || detail.uid !== auth.currentUser?.uid) return;
            setDisplayName(detail.displayName || null);
        };

        window.addEventListener('saldopro:profile-updated', handleProfileUpdated);

        return () => {
            window.removeEventListener('saldopro:profile-updated', handleProfileUpdated);
        };
    }, []);

    useEffect(() => {
        if (!user) {
            setDisplayName(null);
            return;
        }

        if (displayName) return;

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let remainingRetries = 5;

        const syncDisplayName = async () => {
            const immediateName = auth.currentUser?.displayName || user.displayName || null;
            if (immediateName) {
                if (!cancelled) setDisplayName(immediateName);
                return;
            }

            try {
                await user.reload();
            } catch {
                // Ignore transient Firebase refresh errors and retry briefly.
            }

            if (cancelled) return;

            const refreshedName = auth.currentUser?.displayName || user.displayName || null;
            if (refreshedName) {
                setDisplayName(refreshedName);
                return;
            }

            if (remainingRetries <= 0) return;

            remainingRetries -= 1;
            retryTimer = setTimeout(() => {
                void syncDisplayName();
            }, 250);
        };

        void syncDisplayName();

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [user, displayName]);

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
