import type { NextFunction, Request, Response } from 'express';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from '../lib/firebase-admin';
import { ensureLocalUserData } from '../lib/firestore';
import { getFirebaseUserAccessStateFromIdToken } from '../lib/firebase-user-access';
import { logger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  uid?: string;
  authAccessToken?: string;
  authUser?: {
    uid: string;
    email: string | null;
    displayName: string | null;
    createdAt: string | null;
  };
}

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
    let uid = '';
    let authUser = null as AuthenticatedRequest['authUser'] | null;
    let decodedToken: DecodedIdToken | null = null;

    if (ensureFirebaseAdmin()) {
      try {
        decodedToken = await getAuth().verifyIdToken(accessToken);
        uid = decodedToken.uid;
        authUser = {
          uid,
          email: typeof decodedToken.email === 'string' ? decodedToken.email : null,
          displayName: typeof decodedToken.name === 'string' ? decodedToken.name : null,
          createdAt: null
        };
      } catch (error) {
        logger.warn('Firebase Admin verifyIdToken failed, falling back to Identity Toolkit lookup', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    if (!authUser) {
      const userState = await getFirebaseUserAccessStateFromIdToken(accessToken);
      uid = userState?.uid ?? '';
      authUser = userState
        ? {
            uid,
            email: userState.email,
            displayName: userState.displayName,
            createdAt: userState.createdAt
          }
        : null;
    }

    if (!uid || !authUser) {
      res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
      return;
    }

    const request = req as AuthenticatedRequest;
    request.uid = uid;
    request.authAccessToken = accessToken;
    request.authUser = authUser;

    await ensureLocalUserData(uid, {
      email: authUser.email,
      displayName: authUser.displayName
    });

    next();
  } catch (error) {
    logger.warn('Firebase Auth middleware rejected bearer token', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }
}
