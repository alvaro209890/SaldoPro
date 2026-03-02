import {
    confirmPasswordReset,
    createUserWithEmailAndPassword,
    type ActionCodeSettings,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    updateProfile,
    verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from './config';
import { BACKEND_URL } from '@/config/backend';

const configuredAppUrl = (import.meta.env.VITE_APP_URL ?? '').trim();

function getPasswordResetUrl(): string {
    if (configuredAppUrl) {
        return new URL('/reset-password', configuredAppUrl).toString();
    }

    if (typeof window !== 'undefined') {
        return new URL('/reset-password', window.location.origin).toString();
    }

    return `https://${import.meta.env.VITE_FIREBASE_AUTH_DOMAIN}/reset-password`;
}

export async function registerUser(email: string, password: string, displayName: string, phone: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    await cred.user.reload();

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('saldopro:profile-updated', {
                detail: {
                    uid: cred.user.uid,
                    displayName,
                },
            })
        );
    }

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
            phone
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
    const actionCodeSettings: ActionCodeSettings = {
        url: getPasswordResetUrl(),
        handleCodeInApp: false,
    };

    await sendPasswordResetEmail(auth, email, actionCodeSettings);
}

export async function validatePasswordResetCode(oobCode: string) {
    return verifyPasswordResetCode(auth, oobCode);
}

export async function confirmUserPasswordReset(oobCode: string, newPassword: string) {
    await confirmPasswordReset(auth, oobCode, newPassword);
}

export async function logoutUser() {
    await signOut(auth);
}
