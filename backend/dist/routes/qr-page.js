"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQrPageRouter = createQrPageRouter;
const express_1 = require("express");
const whatsapp_page_1 = require("./whatsapp-page");
function createQrPageRouter(client) {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res) => {
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
    return router;
}
