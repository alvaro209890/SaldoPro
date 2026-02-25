"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWhatsAppRouter = createWhatsAppRouter;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
function createWhatsAppRouter(client) {
    const router = (0, express_1.Router)();
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
            const result = await client.sendText(to, text);
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
