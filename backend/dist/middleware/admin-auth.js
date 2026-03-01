"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminAuth = requireAdminAuth;
const admin_session_1 = require("../lib/admin-session");
function requireAdminAuth(req, res, next) {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Admin session missing.' });
        return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const verification = (0, admin_session_1.verifyAdminSessionToken)(token);
    if (!verification.valid) {
        res.status(401).json({ error: 'Admin session invalid or expired.' });
        return;
    }
    req.adminExpiresAt = verification.expiresAt;
    next();
}
