"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWhatsAppRouter = createWhatsAppRouter;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const events_1 = require("../whatsapp/events");
const whatsapp_page_1 = require("./whatsapp-page");
function createWhatsAppRouter(client) {
    const router = (0, express_1.Router)();
    // QR display page - browser-accessible with token as query param (no Bearer header needed)
    router.get('/qr-page', async (req, res) => {
        const token = req.query.token?.trim() ?? '';
        if (!token || token !== env_1.env.whatsappApiToken) {
            res.status(401).send('Unauthorized');
            return;
        }
        const status = client.getStatus();
        let payload = null;
        if (!status.connected) {
            try {
                payload = await client.getQrPayload();
            }
            catch {
                payload = { available: false, reason: 'no_qr' };
            }
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send((0, whatsapp_page_1.renderWhatsAppPage)({ status, payload }));
    });
    router.use(auth_1.requireAuth);
    router.get('/status', (_req, res) => {
        res.json(client.getStatus());
    });
    router.get('/qr', async (_req, res, next) => {
        try {
            const payload = await client.getQrPayload();
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/send', async (req, res, next) => {
        try {
            const body = req.body;
            const to = body.to?.trim() ?? '';
            const text = body.text?.trim() ?? '';
            if (!to || !text) {
                res.status(400).json({ error: '`to` and `text` are required' });
                return;
            }
            if (text.length > env_1.env.maxMessageLength) {
                res.status(400).json({ error: `Text exceeds max length (${env_1.env.maxMessageLength})` });
                return;
            }
            const normalizedTarget = (0, events_1.normalizePhoneNumber)(to);
            const binding = await (0, firestore_1.getPhoneBinding)(normalizedTarget);
            if (!binding) {
                res.status(403).json({ error: 'Target phone is not linked to any account' });
                return;
            }
            const stillAllowed = await (0, firestore_1.isPhoneAllowedForUid)(binding.uid, normalizedTarget);
            if (!stillAllowed) {
                res.status(403).json({ error: 'Target phone is not whitelisted' });
                return;
            }
            const result = await client.sendText(to, text, binding.uid);
            res.json({
                ok: true,
                messageId: result.messageId
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/session/reset', async (_req, res, next) => {
        try {
            await client.resetSession();
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('WhatsApp route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
