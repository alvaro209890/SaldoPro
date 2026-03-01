import type { NextFunction, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from '../lib/firebase-admin';
import { getFirebaseUserAccessState } from '../lib/firebase-user-access';
import { logger } from '../lib/logger';

/**
 * Express middleware that validates a Firebase ID token from the Authorization header.
 * On success, attaches the decoded UID to `req.uid`.
 */
export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    ensureFirebaseAdmin();

    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Token de autenticação ausente.' });
        return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken.length === 0) {
        res.status(401).json({ error: 'Token de autenticação vazio.' });
        return;
    }

    try {
        const decoded = await getAuth().verifyIdToken(idToken);
        const userState = await getFirebaseUserAccessState(decoded.uid);
        if (!userState.exists || userState.disabled) {
            res.status(403).json({ error: 'Conta bloqueada ou indisponível.' });
            return;
        }
        (req as Request & { uid: string }).uid = decoded.uid;
        next();
    } catch (error) {
        logger.warn('Firebase Auth: invalid ID token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
