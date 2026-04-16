"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_1 = require("./config/env");
const logger_1 = require("./lib/logger");
const health_1 = require("./routes/health");
const auth_1 = require("./routes/auth");
const qr_page_1 = require("./routes/qr-page");
const storage_1 = require("./routes/storage");
const whatsapp_1 = require("./routes/whatsapp");
const admin_1 = require("./routes/admin");
const billing_1 = require("./routes/billing");
const ai_chat_1 = require("./routes/ai-chat");
const data_1 = require("./routes/data");
const manager_1 = require("./whatsapp/manager");
const reminder_notifier_1 = require("./whatsapp/reminder-notifier");
const signup_welcome_dispatcher_1 = require("./whatsapp/signup-welcome-dispatcher");
const app = (0, express_1.default)();
const whatsappManager = new manager_1.WhatsAppClientsManager();
const disabledSignupWelcomeDispatcher = {
    enqueue() { },
    stop() { }
};
const stopReminderNotifier = env_1.env.whatsappEnabled
    ? (0, reminder_notifier_1.startWhatsAppReminderNotifier)(whatsappManager)
    : () => { };
const signupWelcomeDispatcher = env_1.env.whatsappEnabled
    ? (0, signup_welcome_dispatcher_1.startSignupWelcomeDispatcher)(whatsappManager)
    : disabledSignupWelcomeDispatcher;
app.use((0, cors_1.default)());
app.use(express_1.default.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
        if (buf.length > 0) {
            req.rawBody = buf.toString('utf8');
        }
    }
}));
app.use(health_1.healthRouter);
app.use('/api/auth', (0, auth_1.createAuthRouter)(signupWelcomeDispatcher));
app.use((0, storage_1.createStorageRouter)());
app.use((0, qr_page_1.createQrPageRouter)(whatsappManager));
app.use('/api/whatsapp', (0, whatsapp_1.createWhatsAppRouter)(whatsappManager));
app.use('/api/admin', (0, admin_1.createAdminRouter)(whatsappManager));
app.use('/api/billing', (0, billing_1.createBillingRouter)());
app.use('/api/ai', (0, ai_chat_1.createAiChatRouter)());
app.use('/api/data', (0, data_1.createDataRouter)(signupWelcomeDispatcher));
app.use((error, _req, res, _next) => {
    logger_1.logger.error('Unhandled backend error', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
});
const server = app.listen(env_1.env.port, env_1.env.host, () => {
    logger_1.logger.info('Backend server started', {
        host: env_1.env.host,
        port: env_1.env.port,
        nodeEnv: env_1.env.nodeEnv,
        firebaseConfigured: Boolean(env_1.env.firebaseCredentials)
    });
});
if (env_1.env.whatsappEnabled) {
    void whatsappManager.startAll().catch((error) => {
        logger_1.logger.error('Failed to start WhatsApp clients manager', error);
    });
}
else {
    logger_1.logger.info('WhatsApp background services disabled by configuration');
}
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
    stopReminderNotifier();
    signupWelcomeDispatcher.stop();
    server.close();
    await whatsappManager.shutdownAll();
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
// Prevent Baileys internal errors (Boom, SessionError, etc.) from crashing the process
process.on('uncaughtException', (error) => {
    const isBoom = error.isBoom === true;
    const isSessionError = error.name === 'SessionError' || error.message?.includes('No session record');
    const isConnectionClosed = error.message?.includes('Connection Closed');
    if (isBoom || isSessionError || isConnectionClosed) {
        logger_1.logger.warn('Caught non-fatal Baileys error (process stays alive)', {
            name: error.name,
            message: error.message
        });
        return;
    }
    logger_1.logger.error('Uncaught exception — process will exit', {
        name: error.name,
        message: error.message,
        stack: error.stack
    });
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const isBoom = err.isBoom === true;
    if (isBoom || err.message?.includes('Connection Closed') || err.message?.includes('No session record')) {
        logger_1.logger.warn('Caught non-fatal unhandled rejection (Baileys)', {
            message: err.message
        });
        return;
    }
    logger_1.logger.error('Unhandled rejection', {
        name: err.name,
        message: err.message,
        stack: err.stack
    });
});
