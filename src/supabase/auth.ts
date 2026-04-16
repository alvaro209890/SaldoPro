import {
  browserLocalPersistence,
  confirmPasswordReset as firebaseConfirmPasswordReset,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyPasswordResetCode,
  type User
} from 'firebase/auth';
import { BACKEND_URL } from '@/config/backend';
import { firebaseAuth } from '@/lib/firebase';

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

const AUTH_STORAGE_KEY = 'saldopro.auth.session.v1';
const AUTH_CHANGED_EVENT = 'saldopro:auth-changed';

let initialized = false;
let restorePromise: Promise<AuthSession | null> | null = null;

function normalizeFirebaseClientError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = `${error.name} ${error.message}`.toLowerCase();
  if (raw.includes('email-already-in-use')) {
    return 'Este email ja esta em uso.';
  }
  if (raw.includes('invalid-email')) {
    return 'Email invalido.';
  }
  if (raw.includes('weak-password')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (raw.includes('too-many-requests')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }

  return error.message || fallback;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  dispatchAuthChanged(session);
}

export function getStoredAuthSession(): AuthSession | null {
  if (!canUseStorage()) return null;

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function mapFirebaseUser(user: User, accessToken: string): AuthSession {
  return {
    accessToken,
    refreshToken: user.refreshToken ?? null,
    expiresAt: null,
    user: {
      id: user.uid,
      email: user.email ?? null,
      created_at: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
      user_metadata: {
        ...(user.displayName ? { display_name: user.displayName } : {})
      }
    }
  };
}

async function buildSession(user: User | null): Promise<AuthSession | null> {
  if (!user) {
    return null;
  }

  const accessToken = await user.getIdToken();
  return mapFirebaseUser(user, accessToken);
}

async function bootstrapUserProfile(session: AuthSession, displayName: string, phone: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/data/bootstrap`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: session.user.email,
      displayName,
      phone
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Não foi possível preparar sua conta.' })) as {
      error?: string;
    };
    throw new Error(payload.error || 'Não foi possível preparar sua conta.');
  }
}

function emitProfileUpdated(uid: string, displayName: string | null): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent('saldopro:profile-updated', {
      detail: {
        uid,
        displayName
      }
    })
  );
}

function ensureFirebaseAuthListener(): void {
  if (initialized) return;
  initialized = true;

  onIdTokenChanged(firebaseAuth, async (user) => {
    const session = await buildSession(user);
    writeSession(session);
  });
}

export async function restoreAuthSession(): Promise<AuthSession | null> {
  ensureFirebaseAuthListener();

  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = new Promise<AuthSession | null>((resolve) => {
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (user) => {
      unsubscribe();
      resolve(await buildSession(user));
    });
  }).finally(() => {
    restorePromise = null;
  });

  return restorePromise;
}

export async function getAccessToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Usuário não autenticado.');
  }

  const accessToken = await user.getIdToken();
  const session = mapFirebaseUser(user, accessToken);
  writeSession(session);
  return accessToken;
}

export async function registerUser(email: string, password: string, displayName: string, phone: string) {
  ensureFirebaseAuthListener();
  try {
    await setPersistence(firebaseAuth, browserLocalPersistence);
    const result = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    await updateProfile(result.user, { displayName });
    const session = await buildSession(result.user);
    if (!session) {
      throw new Error('Não foi possível iniciar a sessão.');
    }

    await bootstrapUserProfile(session, displayName, phone);
    writeSession(session);
    emitProfileUpdated(session.user.id, displayName);
    return session.user;
  } catch (error) {
    if (firebaseAuth.currentUser) {
      await signOut(firebaseAuth);
    }
    throw new Error(normalizeFirebaseClientError(error, 'Não foi possível criar a conta.'));
  }
}

export async function loginUser(email: string, password: string) {
  ensureFirebaseAuthListener();
  await setPersistence(firebaseAuth, browserLocalPersistence);
  const result = await signInWithEmailAndPassword(firebaseAuth, email, password);
  const session = await buildSession(result.user);
  if (!session) {
    throw new Error('Não foi possível fazer login.');
  }
  writeSession(session);
  emitProfileUpdated(session.user.id, (session.user.user_metadata?.display_name as string | undefined) ?? null);
  return session.user;
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(firebaseAuth, email, {
    url: `${window.location.origin}/reset-password`,
    handleCodeInApp: false
  });
}

export async function validatePasswordResetCode(oobCode: string) {
  return verifyPasswordResetCode(firebaseAuth, oobCode);
}

export async function confirmUserPasswordReset(oobCode: string, newPassword: string) {
  await firebaseConfirmPasswordReset(firebaseAuth, oobCode, newPassword);
}

export async function logoutUser() {
  await signOut(firebaseAuth);
  writeSession(null);
}

export { AUTH_CHANGED_EVENT };
