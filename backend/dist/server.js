"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const env_1 = require("./config/env");
const logger_1 = require("./lib/logger");
const health_1 = require("./routes/health");
const whatsapp_1 = require("./routes/whatsapp");
const client_1 = require("./whatsapp/client");
const app = (0, express_1.default)();
const whatsappClient = new client_1.WhatsAppClient();
app.use(express_1.default.json({ limit: '1mb' }));
app.use(health_1.healthRouter);
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
const shutdown = async (signal) => {
    logger_1.logger.warn('Shutdown signal received', { signal });
    server.close();
    await whatsappClient.shutdown();
    process.exit(0);
};
process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
    void shutdown('SIGINT');
});
