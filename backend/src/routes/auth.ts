import { Router, type Request, type Response } from 'express';
import type { Session, User } from '@supabase/supabase-js';
import { env } from '../config/env';
import { bootstrapUserData } from '../lib/firestore';
import { logger } from '../lib/logger';
import { createSupabaseServerClient } from '../lib/supabase';
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const maybeMessage = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (!maybeMessage) {
    return fallback;
  }

  const normalized = maybeMessage.toLowerCase();
  if (normalized.includes('invalid login credentials')) {
    return 'Email ou senha incorretos.';
  }
  if (normalized.includes('user already registered')) {
    return 'Este email já está em uso.';
  }
  if (normalized.includes('password should be at least')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (normalized.includes('email rate limit exceeded')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }

  return maybeMessage;
}

function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    user_metadata: user.user_metadata ?? {}
  };
}

function serializeSession(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    user: serializeUser(session.user)
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

    const authClient = createSupabaseServerClient();
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      res.status(401).json({
        error: normalizeAuthError(error, 'Não foi possível autenticar com o Supabase.')
      });
      return;
    }

    res.json({ session: serializeSession(data.session) });
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

    const authClient = createSupabaseServerClient();
    const created = await authClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        phone
      }
    });

    if (created.error || !created.data.user) {
      res.status(400).json({
        error: normalizeAuthError(created.error, 'Não foi possível criar a conta no Supabase.')
      });
      return;
    }

    let bootstrapResult;
    try {
      bootstrapResult = await bootstrapUserData(created.data.user.id, {
        email,
        displayName,
        phone
      });
    } catch (error) {
      logger.error('Supabase register: bootstrap failed after account creation', {
        email,
        uid: created.data.user.id,
        error: error instanceof Error ? error.message : 'unknown'
      });

      const cleanupClient = createSupabaseServerClient();
      const { error: deleteError } = await cleanupClient.auth.admin.deleteUser(created.data.user.id);
      if (deleteError) {
        logger.error('Supabase register: failed to rollback account after bootstrap error', {
          email,
          uid: created.data.user.id,
          error: deleteError.message
        });
      }

      res.status(500).json({
        error: 'Não foi possível preparar sua conta agora. Tente novamente em instantes.'
      });
      return;
    }

    const signInClient = createSupabaseServerClient();
    const signedIn = await signInClient.auth.signInWithPassword({
      email,
      password
    });

    if (signedIn.error || !signedIn.data.session) {
      logger.error('Supabase register: account created but sign-in failed', {
        email,
        error: signedIn.error?.message ?? 'unknown'
      });
      res.status(500).json({
        error: 'Conta criada, mas não foi possível iniciar a sessão automaticamente.'
      });
      return;
    }

    if (bootstrapResult.isNewUser && bootstrapResult.normalizedPhone) {
      signupWelcomeDispatcher.enqueue({
        uid: created.data.user.id,
        phone: bootstrapResult.normalizedPhone,
        displayName
      });
    }

    res.status(201).json({ session: serializeSession(signedIn.data.session) });
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RefreshBody;
    const refreshToken = asString(body.refreshToken);

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token é obrigatório.' });
      return;
    }

    const authClient = createSupabaseServerClient();
    const { data, error } = await authClient.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session) {
      res.status(401).json({
        error: normalizeAuthError(error, 'Não foi possível renovar a sessão.')
      });
      return;
    }

    res.json({ session: serializeSession(data.session) });
  });

  router.get('/session', requireSupabaseAuth, async (req: Request, res: Response) => {
    const request = req as AuthenticatedRequest;
    const user = request.authUser;

    if (!user) {
      res.status(401).json({ error: 'Sessão inválida.' });
      return;
    }

    res.json({
      uid: getAuthUid(req),
      user: serializeUser(user)
    });
  });

  router.post('/reset-password', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = asString(body.email);

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Email válido é obrigatório.' });
      return;
    }

    const authClient = createSupabaseServerClient();
    const { error } = await authClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.webAppUrl}/reset-password`
    });

    if (error) {
      res.status(400).json({
        error: normalizeAuthError(error, 'Não foi possível enviar o email de recuperação.')
      });
      return;
    }

    res.json({ ok: true });
  });

  router.post('/update-password', requireSupabaseAuth, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as UpdatePasswordBody;
    const password = asString(body.password);
    const uid = getAuthUid(req);

    if (password.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    const authClient = createSupabaseServerClient();
    const { error } = await authClient.auth.admin.updateUserById(uid, {
      password
    });

    if (error) {
      res.status(400).json({
        error: normalizeAuthError(error, 'Não foi possível atualizar a senha.')
      });
      return;
    }

    res.json({ ok: true });
  });

  return router;
}
