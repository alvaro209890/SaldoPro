import type { NextFunction, Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  uid?: string;
  authUser?: User;
  authAccessToken?: string;
}

/**
 * Validates a Supabase access token from the Authorization header.
 * On success, attaches the authenticated UID and user snapshot to the request.
 */
export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação ausente.' });
    return;
  }

  const accessToken = authHeader.slice('Bearer '.length).trim();
  if (!accessToken) {
    res.status(401).json({ error: 'Token de autenticação vazio.' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data.user) {
      res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
      return;
    }

    const request = req as AuthenticatedRequest;
    request.uid = data.user.id;
    request.authUser = data.user;
    request.authAccessToken = accessToken;
    next();
  } catch (error) {
    logger.warn('Supabase Auth: invalid access token', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }
}
