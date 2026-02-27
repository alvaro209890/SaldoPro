"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFirebaseAuth = requireFirebaseAuth;
const auth_1 = require("firebase-admin/auth");
const firebase_admin_1 = require("../lib/firebase-admin");
const logger_1 = require("../lib/logger");
/**
 * Express middleware that validates a Firebase ID token from the Authorization header.
 * On success, attaches the decoded UID to `req.uid`.
 */
async function requireFirebaseAuth(req, res, next) {
    (0, firebase_admin_1.ensureFirebaseAdmin)();
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
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        req.uid = decoded.uid;
        next();
    }
    catch (error) {
        logger_1.logger.warn('Firebase Auth: invalid ID token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
