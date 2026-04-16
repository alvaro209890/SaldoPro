"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSupabaseAuth = requireSupabaseAuth;
const auth_1 = require("firebase-admin/auth");
const firebase_admin_1 = require("../lib/firebase-admin");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const logger_1 = require("../lib/logger");
async function requireSupabaseAuth(req, res, next) {
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
        let authUser = null;
        let decodedToken = null;
        if ((0, firebase_admin_1.ensureFirebaseAdmin)()) {
            try {
                decodedToken = await (0, auth_1.getAuth)().verifyIdToken(accessToken);
                uid = decodedToken.uid;
                authUser = {
                    uid,
                    email: typeof decodedToken.email === 'string' ? decodedToken.email : null,
                    displayName: typeof decodedToken.name === 'string' ? decodedToken.name : null,
                    createdAt: null
                };
            }
            catch (error) {
                logger_1.logger.warn('Firebase Admin verifyIdToken failed, falling back to Identity Toolkit lookup', {
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }
        if (!authUser) {
            const userState = await (0, firebase_user_access_1.getFirebaseUserAccessStateFromIdToken)(accessToken);
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
        const request = req;
        request.uid = uid;
        request.authAccessToken = accessToken;
        request.authUser = authUser;
        next();
    }
    catch (error) {
        logger_1.logger.warn('Firebase Auth middleware rejected bearer token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
