import { BACKEND_URL } from '@/config/backend';

export interface AuthUser {
    id: string;
    email: string | null;
    created_at: string | null;
    user_metadata: Record<string, unknown>;
}

export interface AuthSession {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    user: AuthUser;
}

interface AuthSessionResponse {
    session: AuthSession;
}

const AUTH_STORAGE_KEY = 'saldopro.auth.session.v1';
const AUTH_CHANGED_EVENT = 'saldopro:auth-changed';

function canUseStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeUser(user: AuthUser): AuthUser {
    return {
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
        user_metadata: user.user_metadata ?? {},
    };
}

function normalizeSession(session: AuthSession): AuthSession {
    return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken ?? null,
        expiresAt: session.expiresAt ?? null,
        user: normalizeUser(session.user),
    };
}

function dispatchAuthChanged(session: AuthSession | null): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: { session } }));
}

function writeSession(session: AuthSession | null): void {
    if (!canUseStorage()) return;
    if (!session) {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        dispatchAuthChanged(null);
        return;
    }

    const normalized = normalizeSession(session);
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
    dispatchAuthChanged(normalized);
}

export function getStoredAuthSession(): AuthSession | null {
    if (!canUseStorage()) return null;

    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    try {
        return normalizeSession(JSON.parse(raw) as AuthSession);
    } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
    }
}

async function parseJson<T>(response: Response, fallbackMessage: string): Promise<T> {
    if (response.ok) {
        return response.json() as Promise<T>;
    }

    const payload = await response.json().catch(() => ({ error: fallbackMessage })) as { error?: string };
    throw new Error(payload.error || fallbackMessage);
}

async function authRequest<T>(path: string, init?: RequestInit, fallbackMessage = 'Erro de autenticação.'): Promise<T> {
    const response = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });

    return parseJson<T>(response, fallbackMessage);
}

async function fetchSessionUser(accessToken: string): Promise<AuthUser> {
    const response = await fetch(`${BACKEND_URL}/api/auth/session`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const payload = await parseJson<{ user: AuthUser }>(response, 'Não foi possível validar a sessão atual.');
    return normalizeUser(payload.user);
}

async function refreshAuthSession(refreshToken: string): Promise<AuthSession> {
    const payload = await authRequest<AuthSessionResponse>(
        '/api/auth/refresh',
        {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
        },
        'Não foi possível renovar a sessão.'
    );

    const session = normalizeSession(payload.session);
    writeSession(session);
    return session;
}

export async function restoreAuthSession(): Promise<AuthSession | null> {
    const stored = getStoredAuthSession();
    if (!stored) {
        return null;
    }

    try {
        const user = await fetchSessionUser(stored.accessToken);
        const session = normalizeSession({
            ...stored,
            user,
        });
        writeSession(session);
        return session;
    } catch {
        if (stored.refreshToken) {
            try {
                return await refreshAuthSession(stored.refreshToken);
            } catch {
                writeSession(null);
                return null;
            }
        }

        writeSession(null);
        return null;
    }
}

export async function getAccessToken(): Promise<string> {
    const session = await restoreAuthSession();
    if (!session?.accessToken) {
        throw new Error('Usuário não autenticado.');
    }
    return session.accessToken;
}

function emitProfileUpdated(uid: string, displayName: string | null): void {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(
        new CustomEvent('saldopro:profile-updated', {
            detail: {
                uid,
                displayName,
            },
        })
    );
}

export async function registerUser(email: string, password: string, displayName: string, phone: string) {
    const payload = await authRequest<AuthSessionResponse>(
        '/api/auth/register',
        {
            method: 'POST',
            body: JSON.stringify({ email, password, displayName, phone }),
        },
        'Não foi possível criar a conta.'
    );

    const session = normalizeSession(payload.session);
    writeSession(session);
    emitProfileUpdated(session.user.id, displayName);
    return session.user;
}

export async function loginUser(email: string, password: string) {
    const payload = await authRequest<AuthSessionResponse>(
        '/api/auth/login',
        {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        },
        'Não foi possível fazer login.'
    );

    const session = normalizeSession(payload.session);
    writeSession(session);
    emitProfileUpdated(session.user.id, (session.user.user_metadata?.display_name as string | undefined) ?? null);
    return session.user;
}

export async function resetPassword(email: string) {
    await authRequest<{ ok: true }>(
        '/api/auth/reset-password',
        {
            method: 'POST',
            body: JSON.stringify({ email }),
        },
        'Não foi possível enviar o email de recuperação.'
    );
}

function getRecoveryParams(): URLSearchParams {
    if (typeof window === 'undefined') {
        return new URLSearchParams();
    }

    const url = new URL(window.location.href);
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    return new URLSearchParams(hash || url.search);
}

export async function validatePasswordResetCode(_oobCode: string) {
    const params = getRecoveryParams();
    const errorDescription = params.get('error_description');
    if (errorDescription) {
        throw new Error(errorDescription);
    }

    const accessToken = params.get('access_token')?.trim() ?? '';
    const refreshToken = params.get('refresh_token')?.trim() ?? '';
    const recoveryType = params.get('type')?.trim() ?? '';

    if (!accessToken || recoveryType !== 'recovery') {
        throw new Error('Este link de recuperação é inválido ou já foi usado.');
    }

    const user = await fetchSessionUser(accessToken);
    writeSession({
        accessToken,
        refreshToken,
        expiresAt: null,
        user,
    });

    if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }

    return user.email ?? '';
}

export async function confirmUserPasswordReset(_oobCode: string, newPassword: string) {
    const accessToken = await getAccessToken();

    await authRequest<{ ok: true }>(
        '/api/auth/update-password',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ password: newPassword }),
        },
        'Não foi possível redefinir a senha.'
    );
}

export async function logoutUser() {
    writeSession(null);
}

export { AUTH_CHANGED_EVENT };
