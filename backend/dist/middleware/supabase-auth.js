"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSupabaseAuth = requireSupabaseAuth;
const supabase_1 = require("../lib/supabase");
const logger_1 = require("../lib/logger");
/**
 * Validates a Supabase access token from the Authorization header.
 * On success, attaches the authenticated UID and user snapshot to the request.
 */
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
        const { data, error } = await supabase_1.supabaseAdmin.auth.getUser(accessToken);
        if (error || !data.user) {
            res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
            return;
        }
        const request = req;
        request.uid = data.user.id;
        request.authUser = data.user;
        request.authAccessToken = accessToken;
        next();
    }
    catch (error) {
        logger_1.logger.warn('Supabase Auth: invalid access token', {
            error: error instanceof Error ? error.message : 'unknown'
        });
        res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
}
