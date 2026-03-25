import { supabase } from './client';
import { BACKEND_URL } from '@/config/backend';

export async function registerUser(email: string, password: string, displayName: string, phone: string) {
    const { data: authData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                display_name: displayName,
                phone: phone,
            }
        }
    });

    if (error) {
        throw new Error(error.message);
    }
    
    if (!authData.user) {
        throw new Error('Falha ao criar usuário no Supabase.');
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('saldopro:profile-updated', {
                detail: {
                    uid: authData.user.id,
                    displayName,
                },
            })
        );
    }

    // Attempt to get the session token to bootstrap data
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (token) {
        const response = await fetch(`${BACKEND_URL}/api/data/bootstrap`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                displayName,
                phone
            })
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: 'Erro ao inicializar dados no Supabase (Backend).' }));
            throw new Error(payload.error || 'Erro ao inicializar dados no Supabase (Backend).');
        }
    }

    return authData.user;
}

export async function loginUser(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) throw new Error(error.message);
    return data.user;
}

export async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
}

// Em Supabase o fluxo de update de senha é um pouco diferente,
// o usuário já é logado se ele clica no link de reset. 
// Deixamos a assinatura de validatePasswordResetCode como mock para evitar quebra no front.
export async function validatePasswordResetCode(oobCode: string) {
    return oobCode; // Mock pass-through
}

export async function confirmUserPasswordReset(_oobCode: string, newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
}

export async function logoutUser() {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
}
