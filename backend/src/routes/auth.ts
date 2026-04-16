import { Router, type Request, type Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env';
import { bootstrapUserData, DuplicateUserEmailError } from '../lib/firestore';
import { ensureFirebaseAdmin } from '../lib/firebase-admin';
import { getFirebaseUserAccessState } from '../lib/firebase-user-access';
import { logger } from '../lib/logger';
import { requireSupabaseAuth, type AuthenticatedRequest } from '../middleware/supabase-auth';
import type { SignupWelcomeDispatcher } from '../whatsapp/signup-welcome-dispatcher';

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  phone?: unknown;
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface RefreshBody {
  refreshToken?: unknown;
}

interface UpdatePasswordBody {
  password?: unknown;
}

interface FirebaseIdentitySignInResponse {
  localId: string;
  email?: string;
  idToken: string;
  refreshToken?: string;
  expiresIn?: string;
  displayName?: string;
}

interface FirebaseRefreshResponse {
  user_id: string;
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthErrorMessage(message: string, fallback: string): string {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized.includes('email_exists')) {
    return 'Este email já está em uso.';
  }
  if (normalized.includes('invalid_login_credentials') || normalized.includes('invalid password')) {
    return 'Email ou senha incorretos.';
  }
  if (normalized.includes('email_not_found')) {
    return 'Email ou senha incorretos.';
  }
  if (normalized.includes('weak_password')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (normalized.includes('too_many_attempts_try_later')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  if (normalized.includes('invalid_grant')) {
    return 'Não foi possível renovar a sessão.';
  }

  return fallback;
}

async function requestFirebaseIdentity<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(env.firebaseWebApiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: { message: 'UNKNOWN' } })) as {
      error?: { message?: string };
    };
    throw new Error(payload.error?.message ?? 'UNKNOWN');
  }

  return response.json() as Promise<T>;
}

async function refreshFirebaseSession(refreshToken: string): Promise<FirebaseRefreshResponse> {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.firebaseWebApiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: { message: 'UNKNOWN' } })) as {
      error?: { message?: string };
    };
    throw new Error(payload.error?.message ?? 'UNKNOWN');
  }

  return response.json() as Promise<FirebaseRefreshResponse>;
}

async function serializeFirebaseUser(uid: string, fallbackEmail: string | null = null): Promise<{
  id: string;
  email: string | null;
  created_at: string | null;
  user_metadata: Record<string, unknown>;
}> {
  const state = await getFirebaseUserAccessState(uid, true);
  return {
    id: uid,
    email: state.email ?? fallbackEmail,
    created_at: state.createdAt,
    user_metadata: {
      ...(state.displayName ? { display_name: state.displayName } : {})
    }
  };
}

async function serializeFirebaseSession(input: {
  uid: string;
  idToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: string | number | null;
  fallbackEmail?: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  user: {
    id: string;
    email: string | null;
    created_at: string | null;
    user_metadata: Record<string, unknown>;
  };
}> {
  const expiresIn = Number(input.expiresInSeconds ?? 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken: input.idToken,
    refreshToken: input.refreshToken ?? null,
    expiresAt,
    user: await serializeFirebaseUser(input.uid, input.fallbackEmail ?? null)
  };
}

function getAuthUid(req: Request): string {
  const uid = (req as AuthenticatedRequest).uid;
  if (!uid) {
    throw new Error('Authenticated UID not available.');
  }
  return uid;
}

export function createAuthRouter(signupWelcomeDispatcher: SignupWelcomeDispatcher): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginBody;
    const email = asString(body.email);
    const password = asString(body.password);

    if (!email || !email.includes('@') || password.length < 6) {
      res.status(400).json({ error: 'Email e senha válidos são obrigatórios.' });
      return;
    }

    try {
      const data = await requestFirebaseIdentity<FirebaseIdentitySignInResponse>('accounts:signInWithPassword', {
        email,
        password,
        returnSecureToken: true
      });

      res.json({
        session: await serializeFirebaseSession({
          uid: data.localId,
          idToken: data.idToken,
          refreshToken: data.refreshToken ?? null,
          expiresInSeconds: data.expiresIn,
          fallbackEmail: data.email ?? email
        })
      });
    } catch (error) {
      res.status(401).json({
        error: normalizeAuthErrorMessage(
          error instanceof Error ? error.message : '',
          'Não foi possível autenticar.'
        )
      });
    }
  });

  router.post('/register', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RegisterBody;
    const email = asString(body.email);
    const password = asString(body.password);
    const displayName = asString(body.displayName);
    const phone = asString(body.phone);

    if (!email || !email.includes('@') || password.length < 6 || displayName.length < 2 || phone.length < 10) {
      res.status(400).json({ error: 'Email, senha, nome e telefone válidos são obrigatórios.' });
      return;
    }

    if (!ensureFirebaseAdmin()) {
      res.status(500).json({ error: 'Firebase Admin não está configurado.' });
      return;
    }

    let createdUid: string | null = null;

    try {
      const user = await getAuth().createUser({
        email,
        password,
        displayName
      });
      createdUid = user.uid;

      const bootstrapResult = await bootstrapUserData(user.uid, {
        email,
        displayName,
        phone
      });

      const session = await requestFirebaseIdentity<FirebaseIdentitySignInResponse>('accounts:signInWithPassword', {
        email,
        password,
        returnSecureToken: true
      });

      if (bootstrapResult.isNewUser && bootstrapResult.normalizedPhone) {
        signupWelcomeDispatcher.enqueue({
          uid: user.uid,
          phone: bootstrapResult.normalizedPhone,
          displayName
        });
      }

      res.status(201).json({
        session: await serializeFirebaseSession({
          uid: session.localId,
          idToken: session.idToken,
          refreshToken: session.refreshToken ?? null,
          expiresInSeconds: session.expiresIn,
          fallbackEmail: session.email ?? email
        })
      });
    } catch (error) {
      if (createdUid) {
        try {
          await getAuth().deleteUser(createdUid);
        } catch (rollbackError) {
          logger.error('Firebase register rollback failed', {
            uid: createdUid,
            error: rollbackError instanceof Error ? rollbackError.message : 'unknown'
          });
        }
      }

      res.status(error instanceof DuplicateUserEmailError ? 409 : 400).json({
        error: normalizeAuthErrorMessage(
          error instanceof DuplicateUserEmailError
            ? 'Este email ja esta cadastrado em outra conta.'
            : error instanceof Error
              ? error.message
              : '',
          'Não foi possível criar a conta.'
        )
      });
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RefreshBody;
    const refreshToken = asString(body.refreshToken);

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token é obrigatório.' });
      return;
    }

    try {
      const data = await refreshFirebaseSession(refreshToken);
      res.json({
        session: await serializeFirebaseSession({
          uid: data.user_id,
          idToken: data.id_token,
          refreshToken: data.refresh_token,
          expiresInSeconds: data.expires_in
        })
      });
    } catch (error) {
      res.status(401).json({
        error: normalizeAuthErrorMessage(
          error instanceof Error ? error.message : '',
          'Não foi possível renovar a sessão.'
        )
      });
    }
  });

  router.get('/session', requireSupabaseAuth, async (req: Request, res: Response) => {
    const uid = getAuthUid(req);
    res.json({
      uid,
      user: await serializeFirebaseUser(uid)
    });
  });

  router.post('/reset-password', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = asString(body.email);

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Email válido é obrigatório.' });
      return;
    }

    try {
      await requestFirebaseIdentity('accounts:sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email,
        continueUrl: `${env.webAppUrl}/reset-password`
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: normalizeAuthErrorMessage(
          error instanceof Error ? error.message : '',
          'Não foi possível enviar o email de recuperação.'
        )
      });
    }
  });

  router.post('/update-password', requireSupabaseAuth, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as UpdatePasswordBody;
    const password = asString(body.password);
    const uid = getAuthUid(req);

    if (password.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    if (!ensureFirebaseAdmin()) {
      res.status(500).json({ error: 'Firebase Admin não está configurado.' });
      return;
    }

    await getAuth().updateUser(uid, {
      password
    });

    res.json({ ok: true });
  });

  return router;
}
