"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthRouter = createAuthRouter;
const express_1 = require("express");
const auth_1 = require("firebase-admin/auth");
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const firebase_admin_1 = require("../lib/firebase-admin");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const logger_1 = require("../lib/logger");
const supabase_auth_1 = require("../middleware/supabase-auth");
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeAuthErrorMessage(message, fallback) {
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
async function requestFirebaseIdentity(path, body) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(env_1.env.firebaseWebApiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: 'UNKNOWN' } }));
        throw new Error(payload.error?.message ?? 'UNKNOWN');
    }
    return response.json();
}
async function refreshFirebaseSession(refreshToken) {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env_1.env.firebaseWebApiKey)}`, {
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
        const payload = await response.json().catch(() => ({ error: { message: 'UNKNOWN' } }));
        throw new Error(payload.error?.message ?? 'UNKNOWN');
    }
    return response.json();
}
async function serializeFirebaseUser(uid, fallbackEmail = null) {
    const state = await (0, firebase_user_access_1.getFirebaseUserAccessState)(uid, true);
    return {
        id: uid,
        email: state.email ?? fallbackEmail,
        created_at: state.createdAt,
        user_metadata: {
            ...(state.displayName ? { display_name: state.displayName } : {})
        }
    };
}
async function serializeFirebaseSession(input) {
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
function getAuthUid(req) {
    const uid = req.uid;
    if (!uid) {
        throw new Error('Authenticated UID not available.');
    }
    return uid;
}
function createAuthRouter(signupWelcomeDispatcher) {
    const router = (0, express_1.Router)();
    router.post('/login', async (req, res) => {
        const body = (req.body ?? {});
        const email = asString(body.email);
        const password = asString(body.password);
        if (!email || !email.includes('@') || password.length < 6) {
            res.status(400).json({ error: 'Email e senha válidos são obrigatórios.' });
            return;
        }
        try {
            const data = await requestFirebaseIdentity('accounts:signInWithPassword', {
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
        }
        catch (error) {
            res.status(401).json({
                error: normalizeAuthErrorMessage(error instanceof Error ? error.message : '', 'Não foi possível autenticar.')
            });
        }
    });
    router.post('/register', async (req, res) => {
        const body = (req.body ?? {});
        const email = asString(body.email);
        const password = asString(body.password);
        const displayName = asString(body.displayName);
        const phone = asString(body.phone);
        if (!email || !email.includes('@') || password.length < 6 || displayName.length < 2 || phone.length < 10) {
            res.status(400).json({ error: 'Email, senha, nome e telefone válidos são obrigatórios.' });
            return;
        }
        if (!(0, firebase_admin_1.ensureFirebaseAdmin)()) {
            res.status(500).json({ error: 'Firebase Admin não está configurado.' });
            return;
        }
        let createdUid = null;
        try {
            const user = await (0, auth_1.getAuth)().createUser({
                email,
                password,
                displayName
            });
            createdUid = user.uid;
            const bootstrapResult = await (0, firestore_1.bootstrapUserData)(user.uid, {
                email,
                displayName,
                phone
            });
            const session = await requestFirebaseIdentity('accounts:signInWithPassword', {
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
        }
        catch (error) {
            if (createdUid) {
                try {
                    await (0, auth_1.getAuth)().deleteUser(createdUid);
                }
                catch (rollbackError) {
                    logger_1.logger.error('Firebase register rollback failed', {
                        uid: createdUid,
                        error: rollbackError instanceof Error ? rollbackError.message : 'unknown'
                    });
                }
            }
            res.status(error instanceof firestore_1.DuplicateUserEmailError ? 409 : 400).json({
                error: normalizeAuthErrorMessage(error instanceof firestore_1.DuplicateUserEmailError
                    ? 'Este email ja esta cadastrado em outra conta.'
                    : error instanceof Error
                        ? error.message
                        : '', 'Não foi possível criar a conta.')
            });
        }
    });
    router.post('/refresh', async (req, res) => {
        const body = (req.body ?? {});
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
        }
        catch (error) {
            res.status(401).json({
                error: normalizeAuthErrorMessage(error instanceof Error ? error.message : '', 'Não foi possível renovar a sessão.')
            });
        }
    });
    router.get('/session', supabase_auth_1.requireSupabaseAuth, async (req, res) => {
        const uid = getAuthUid(req);
        res.json({
            uid,
            user: await serializeFirebaseUser(uid)
        });
    });
    router.post('/reset-password', async (req, res) => {
        const body = (req.body ?? {});
        const email = asString(body.email);
        if (!email || !email.includes('@')) {
            res.status(400).json({ error: 'Email válido é obrigatório.' });
            return;
        }
        try {
            await requestFirebaseIdentity('accounts:sendOobCode', {
                requestType: 'PASSWORD_RESET',
                email,
                continueUrl: `${env_1.env.webAppUrl}/reset-password`
            });
            res.json({ ok: true });
        }
        catch (error) {
            res.status(400).json({
                error: normalizeAuthErrorMessage(error instanceof Error ? error.message : '', 'Não foi possível enviar o email de recuperação.')
            });
        }
    });
    router.post('/update-password', supabase_auth_1.requireSupabaseAuth, async (req, res) => {
        const body = (req.body ?? {});
        const password = asString(body.password);
        const uid = getAuthUid(req);
        if (password.length < 6) {
            res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
            return;
        }
        if (!(0, firebase_admin_1.ensureFirebaseAdmin)()) {
            res.status(500).json({ error: 'Firebase Admin não está configurado.' });
            return;
        }
        await (0, auth_1.getAuth)().updateUser(uid, {
            password
        });
        res.json({ ok: true });
    });
    return router;
}
