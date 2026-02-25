"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const env_1 = require("../config/env");
function requireAuth(req, res, next) {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.length === 0 || token !== env_1.env.whatsappApiToken) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}
