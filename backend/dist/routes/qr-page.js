"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQrPageRouter = createQrPageRouter;
const express_1 = require("express");
const manager_1 = require("../whatsapp/manager");
const whatsapp_page_1 = require("./whatsapp-page");
function slotLabel(slotId) {
    return slotId === 'wa1' ? 'WhatsApp' : 'WhatsApp 2';
}
function createQrPageRouter(manager) {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res) => {
        const slots = await Promise.all(manager_1.WHATSAPP_SLOT_IDS.map(async (slotId) => {
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
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send((0, whatsapp_page_1.renderWhatsAppPage)({ slots }));
    });
    return router;
}
