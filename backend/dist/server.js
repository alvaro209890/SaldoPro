"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const env_1 = require("./config/env");
const logger_1 = require("./lib/logger");
const health_1 = require("./routes/health");
const qr_page_1 = require("./routes/qr-page");
const whatsapp_1 = require("./routes/whatsapp");
const client_1 = require("./whatsapp/client");
const app = (0, express_1.default)();
const whatsappClient = new client_1.WhatsAppClient();
app.use(express_1.default.json({ limit: '1mb' }));
app.use(health_1.healthRouter);
app.use((0, qr_page_1.createQrPageRouter)(whatsappClient));
app.use('/api/whatsapp', (0, whatsapp_1.createWhatsAppRouter)(whatsappClient));
app.use((error, _req, res, _next) => {
    logger_1.logger.error('Unhandled backend error', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
});
const server = app.listen(env_1.env.port, () => {
    logger_1.logger.info('Backend server started', { port: env_1.env.port, nodeEnv: env_1.env.nodeEnv });
});
void whatsappClient.start().catch((error) => {
    logger_1.logger.error('Failed to start WhatsApp client', error);
});
// Keep-alive: pings own /healthz every 5 minutes to prevent Render free-tier spin-down
if (env_1.env.backendUrl) {
    const KEEP_ALIVE_MS = 5 * 60 * 1000;
    setInterval(() => {
        fetch(`${env_1.env.backendUrl}/healthz`).catch(() => { });
    }, KEEP_ALIVE_MS);
    logger_1.logger.info('Keep-alive enabled', { url: `${env_1.env.backendUrl}/healthz`, intervalMs: KEEP_ALIVE_MS });
}
const shutdown = async (signal) => {
    logger_1.logger.warn('Shutdown signal received — closing gracefully', { signal });
    server.close();
    await whatsappClient.shutdown();
    // Brief pause so the WebSocket close frame is sent before the process exits
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(0);
};
process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
    void shutdown('SIGINT');
});
