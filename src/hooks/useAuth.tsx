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
        if (!user || displayName) return;

        let cancelled = false;
        void user.reload().then(() => {
            if (cancelled) return;
            setDisplayName(auth.currentUser?.displayName || null);
        }).catch(() => {
            if (cancelled) return;
            setDisplayName(user.displayName || null);
        });

        return () => {
            cancelled = true;
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
