import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    updateProfile,
} from 'firebase/auth';
import { auth } from './config';
import { BACKEND_URL } from '@/config/backend';

export async function registerUser(email: string, password: string, displayName: string, phone: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    await cred.user.reload();
    const idToken = await cred.user.getIdToken();

    const response = await fetch(`${BACKEND_URL}/api/data/bootstrap`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            displayName,
            ...(phone ? { phone } : {})
        })
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Erro ao inicializar dados no Supabase.' }));
        throw new Error(payload.error || 'Erro ao inicializar dados no Supabase.');
    }

    return cred.user;
}

export async function loginUser(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await cred.user.reload();
    return cred.user;
}

export async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
}

export async function logoutUser() {
    await signOut(auth);
}
