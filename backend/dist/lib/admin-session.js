"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidAdminPassword = isValidAdminPassword;
exports.createAdminSessionToken = createAdminSessionToken;
exports.verifyAdminSessionToken = verifyAdminSessionToken;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
function toBase64Url(value) {
    return Buffer.from(value, 'utf8').toString('base64url');
}
function fromBase64Url(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}
function signPayload(payloadBase64) {
    return (0, node_crypto_1.createHmac)('sha256', env_1.env.adminPanelSessionSecret).update(payloadBase64).digest('base64url');
}
function secureDigest(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest();
}
function isValidAdminPassword(password) {
    const provided = secureDigest(password);
    const expected = secureDigest(env_1.env.adminPanelPassword);
    return (0, node_crypto_1.timingSafeEqual)(provided, expected);
}
function createAdminSessionToken() {
    const expiresAtMs = Date.now() + env_1.env.adminPanelSessionTtlHours * 60 * 60 * 1000;
    const payload = {
        role: 'admin',
        exp: expiresAtMs
    };
    const payloadBase64 = toBase64Url(JSON.stringify(payload));
    const signature = signPayload(payloadBase64);
    return {
        token: `${payloadBase64}.${signature}`,
        expiresAt: new Date(expiresAtMs).toISOString()
    };
}
function verifyAdminSessionToken(token) {
    const trimmed = token.trim();
    if (!trimmed)
        return { valid: false };
    const [payloadBase64, signature] = trimmed.split('.');
    if (!payloadBase64 || !signature)
        return { valid: false };
    const expectedSignature = signPayload(payloadBase64);
    const provided = Buffer.from(signature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (provided.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(provided, expected)) {
        return { valid: false };
    }
    try {
        const payload = JSON.parse(fromBase64Url(payloadBase64));
        if (payload.role !== 'admin' || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
            return { valid: false };
        }
        return {
            valid: true,
            expiresAt: new Date(payload.exp).toISOString()
        };
    }
    catch {
        return { valid: false };
    }
}
