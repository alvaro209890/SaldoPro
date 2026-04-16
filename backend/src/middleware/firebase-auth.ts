import type { NextFunction, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from '../lib/firebase-admin';
import { getFirebaseUserAccessStateFromIdToken } from '../lib/firebase-user-access';
import { logger } from '../lib/logger';

/**
 * Express middleware that validates a Firebase ID token from the Authorization header.
 * On success, attaches the decoded UID to `req.uid`.
 */
export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        let uid = '';
        let valid = false;

        if (ensureFirebaseAdmin()) {
            try {
                const decoded = await getAuth().verifyIdToken(idToken);
                uid = decoded.uid;
                valid = true;
            } catch (error) {
                logger.warn('Firebase Auth middleware falling back to Identity Toolkit lookup', {
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }

        if (!valid) {
            const userState = await getFirebaseUserAccessStateFromIdToken(idToken);
            uid = userState?.uid ?? '';
            valid = Boolean(userState?.exists && !userState.disabled);
        }

        if (!uid || !valid) {
            res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
            return;
        }
        (req as Request & { uid: string }).uid = uid;
        next();
    } catch (error) {
        logger.warn('Firebase Auth: invalid ID token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
