"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWhatsAppRouter = createWhatsAppRouter;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const events_1 = require("../whatsapp/events");
const manager_1 = require("../whatsapp/manager");
const whatsapp_page_1 = require("./whatsapp-page");
function slotLabel(slotId) {
    return slotId === 'wa1' ? 'WhatsApp' : 'WhatsApp';
}
async function buildSlotsPageData(manager) {
    return Promise.all(manager_1.WHATSAPP_SLOT_IDS.map(async (slotId) => {
        const status = manager.getStatusBySlot(slotId);
        let payload = null;
        if (!status.connected) {
            try {
                payload = await manager.getQrPayloadBySlot(slotId);
            }
            catch {
                payload = { available: false, reason: 'no_qr' };
            }
        }
        return {
            label: slotLabel(slotId),
            status,
            payload
        };
    }));
}
function createWhatsAppRouter(manager) {
    const router = (0, express_1.Router)();
    // QR display page - browser-accessible with token as query param (no Bearer header needed)
    router.get('/qr-page', async (req, res) => {
        const token = req.query.token?.trim() ?? '';
        if (!token || token !== env_1.env.whatsappApiToken) {
            res.status(401).send('Unauthorized');
            return;
        }
        const slots = await buildSlotsPageData(manager);
        const resetUrl = `/api/whatsapp/qr-page/reset?token=${encodeURIComponent(token)}`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send((0, whatsapp_page_1.renderWhatsAppPage)({ slots, resetUrl }));
    });
    // Reset all WhatsApp sessions from the QR page (token-auth, no Bearer needed)
    router.post('/qr-page/reset', async (req, res, next) => {
        try {
            const token = req.query.token?.trim() ?? '';
            if (!token || token !== env_1.env.whatsappApiToken) {
                res.status(401).send('Unauthorized');
                return;
            }
            await manager.resetSession();
            res.redirect(`/api/whatsapp/qr-page?token=${encodeURIComponent(token)}`);
        }
        catch (error) {
            next(error);
        }
    });
    router.use(auth_1.requireAuth);
    router.get('/status', (_req, res) => {
        res.json({ slots: manager.getStatuses() });
    });
    router.get('/qr', async (_req, res, next) => {
        try {
            const payloads = await manager.getQrPayloads();
            res.json({ slots: payloads });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/send', async (req, res, next) => {
        try {
            const body = (req.body ?? {});
            const to = body.to?.trim() ?? '';
            const text = body.text?.trim() ?? '';
            const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
            if (!to || !text) {
                res.status(400).json({ error: '`to` and `text` are required' });
                return;
            }
            if (text.length > env_1.env.maxMessageLength) {
                res.status(400).json({ error: `Text exceeds max length (${env_1.env.maxMessageLength})` });
                return;
            }
            if (clientId && !(0, manager_1.isWhatsAppSlotId)(clientId)) {
                res.status(400).json({ error: '`clientId` must be `wa1` when provided' });
                return;
            }
            const resolvedClientId = clientId && (0, manager_1.isWhatsAppSlotId)(clientId) ? clientId : undefined;
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
            const result = await manager.sendTextWithRouting({
                to,
                text,
                ownerUid: binding.uid,
                ...(resolvedClientId ? { clientId: resolvedClientId } : {})
            });
            res.json({
                ok: true,
                messageId: result.messageId,
                clientId: result.clientId
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/session/reset', async (req, res, next) => {
        try {
            const body = (req.body ?? {});
            const slotValue = typeof body.slotId === 'string' ? body.slotId.trim() : '';
            if (slotValue && !(0, manager_1.isWhatsAppSlotId)(slotValue)) {
                res.status(400).json({ error: '`slotId` must be `wa1` when provided' });
                return;
            }
            const resolvedSlotId = slotValue && (0, manager_1.isWhatsAppSlotId)(slotValue) ? slotValue : undefined;
            await manager.resetSession(resolvedSlotId);
            res.json({ ok: true, slotId: resolvedSlotId ?? null });
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
