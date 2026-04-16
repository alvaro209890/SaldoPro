"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFirebaseAuth = requireFirebaseAuth;
const auth_1 = require("firebase-admin/auth");
const firebase_admin_1 = require("../lib/firebase-admin");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const logger_1 = require("../lib/logger");
/**
 * Express middleware that validates a Firebase ID token from the Authorization header.
 * On success, attaches the decoded UID to `req.uid`.
 */
async function requireFirebaseAuth(req, res, next) {
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
        if ((0, firebase_admin_1.ensureFirebaseAdmin)()) {
            try {
                const decoded = await (0, auth_1.getAuth)().verifyIdToken(idToken);
                uid = decoded.uid;
                valid = true;
            }
            catch (error) {
                logger_1.logger.warn('Firebase Auth middleware falling back to Identity Toolkit lookup', {
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }
        if (!valid) {
            const userState = await (0, firebase_user_access_1.getFirebaseUserAccessStateFromIdToken)(idToken);
            uid = userState?.uid ?? '';
            valid = Boolean(userState?.exists && !userState.disabled);
        }
        if (!uid || !valid) {
            res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
            return;
        }
        req.uid = uid;
        next();
    }
    catch (error) {
        logger_1.logger.warn('Firebase Auth: invalid ID token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
