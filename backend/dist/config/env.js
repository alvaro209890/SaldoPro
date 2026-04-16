"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const node_fs_1 = require("node:fs");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getRequired(name) {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function getRequiredAny(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (value && value.trim().length > 0) {
            return value.trim();
        }
    }
    throw new Error(`Missing required environment variable: one of ${names.join(', ')}`);
}
function parseBoolean(value, fallback) {
    if (value === undefined)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
function parsePort(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid PORT value');
    }
    return parsed;
}
function parseInteger(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('Invalid integer environment value');
    }
    return parsed;
}
function parseHost(value, fallback) {
    const normalized = value?.trim() || fallback;
    if (!normalized) {
        throw new Error('Invalid HOST value');
    }
    return normalized;
}
function normalizeUrl(value) {
    return value.replace(/\/+$/, '');
}
function getOptional(name) {
    const value = process.env[name];
    if (!value || value.trim().length === 0)
        return null;
    return value.trim();
}
function getInlineFirebaseCredentials() {
    const projectId = getOptional('FIREBASE_PROJECT_ID');
    const clientEmail = getOptional('FIREBASE_CLIENT_EMAIL');
    const privateKey = getOptional('FIREBASE_PRIVATE_KEY');
    if (!projectId && !clientEmail && !privateKey) {
        return null;
    }
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase Admin credentials are incomplete. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or use FIREBASE_SERVICE_ACCOUNT_PATH.');
    }
    return {
        projectId,
        clientEmail,
        privateKey,
        source: 'inline',
        path: null
    };
}
function loadFirebaseCredentialsFromPath(path) {
    let parsed;
    try {
        parsed = JSON.parse((0, node_fs_1.readFileSync)(path, 'utf8'));
    }
    catch (error) {
        throw new Error(`Failed to read FIREBASE_SERVICE_ACCOUNT_PATH (${path}): ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Invalid Firebase service account JSON at ${path}`);
    }
    const maybeJson = parsed;
    const projectId = typeof maybeJson.project_id === 'string' ? maybeJson.project_id.trim() : '';
    const clientEmail = typeof maybeJson.client_email === 'string' ? maybeJson.client_email.trim() : '';
    const privateKey = typeof maybeJson.private_key === 'string' ? maybeJson.private_key : '';
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(`Firebase service account JSON at ${path} is missing required keys.`);
    }
    return {
        projectId,
        clientEmail,
        privateKey,
        source: 'file',
        path
    };
}
function getFirebaseCredentials() {
    const inline = getInlineFirebaseCredentials();
    if (inline) {
        return inline;
    }
    const serviceAccountPath = getOptional('FIREBASE_SERVICE_ACCOUNT_PATH') ||
        getOptional('GOOGLE_APPLICATION_CREDENTIALS');
    if (!serviceAccountPath) {
        return null;
    }
    return loadFirebaseCredentialsFromPath(serviceAccountPath);
}
const whatsappAuthDirBase = process.env.WHATSAPP_AUTH_DIR?.trim() ||
    '/opt/render/project/src/backend/.baileys_auth';
const firebaseCredentials = getFirebaseCredentials();
const webAppBaseUrl = (() => {
    const base = getOptional('WEB_APP_URL') || 'https://saldopro-98049.web.app';
    return normalizeUrl(base);
})();
const defaultLocalDataRoot = process.env.LOCAL_DATA_ROOT?.trim() ||
    '/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro';
const defaultLocalDatabasePath = process.env.LOCAL_DATABASE_PATH?.trim() ||
    `${defaultLocalDataRoot}/saldopro.sqlite`;
const defaultLocalDocumentsDir = process.env.LOCAL_DOCUMENTS_DIR?.trim() ||
    `${defaultLocalDataRoot}/documents`;
exports.env = {
    host: parseHost(process.env.HOST, '127.0.0.1'),
    port: parsePort(process.env.PORT, 10000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    whatsappApiToken: getRequired('WHATSAPP_API_TOKEN'),
    mercadoPagoAccessToken: getOptional('MERCADO_PAGO_ACCESS_TOKEN'),
    mercadoPagoWebhookSecret: getOptional('MERCADO_PAGO_WEBHOOK_SECRET'),
    mercadoPagoStatementDescriptor: getOptional('MERCADO_PAGO_STATEMENT_DESCRIPTOR'),
    adminPanelPassword: process.env.ADMIN_PANEL_PASSWORD?.trim() || '7464584657364dccddc',
    adminPanelSessionSecret: process.env.ADMIN_PANEL_SESSION_SECRET?.trim() || `${getRequired('WHATSAPP_API_TOKEN')}:admin-panel`,
    adminPanelSessionTtlHours: parseInteger(process.env.ADMIN_PANEL_SESSION_TTL_HOURS, 12),
    whatsappEnabled: parseBoolean(process.env.WHATSAPP_ENABLED, true),
    whatsappAutoReplyEnabled: parseBoolean(process.env.WHATSAPP_AUTO_REPLY_ENABLED, true),
    whatsappAutoReplyText: process.env.WHATSAPP_AUTO_REPLY_TEXT?.trim() ||
        'Recebemos sua mensagem. Em breve retornamos.',
    whatsappAuthDir: whatsappAuthDirBase,
    whatsappAuthDirWa1: process.env.WHATSAPP_AUTH_DIR_WA1?.trim() || `${whatsappAuthDirBase}_wa1`,
    firebaseCredentials,
    firebaseWebApiKey: getRequired('FIREBASE_WEB_API_KEY'),
    firebaseProjectId: firebaseCredentials?.projectId ?? null,
    firebaseClientEmail: firebaseCredentials?.clientEmail ?? null,
    firebasePrivateKey: firebaseCredentials?.privateKey ?? null,
    firebaseCredentialsSource: firebaseCredentials?.source ?? null,
    firebaseServiceAccountPath: firebaseCredentials?.path ?? null,
    localDataRoot: defaultLocalDataRoot,
    localDatabasePath: defaultLocalDatabasePath,
    localDocumentsDir: defaultLocalDocumentsDir,
    localStorageSigningSecret: process.env.LOCAL_STORAGE_SIGNING_SECRET?.trim() || `${getRequired('WHATSAPP_API_TOKEN')}:storage`,
    whatsappAiEnabled: parseBoolean(process.env.WHATSAPP_AI_ENABLED, true),
    groqApiKey: getOptional('GROQ_API_KEY'),
    groqModel: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
    groqVisionModel: process.env.GROQ_VISION_MODEL?.trim() || 'meta-llama/llama-4-maverick-17b-128e-instruct',
    whatsappAiRecentTransactions: parseInteger(process.env.WHATSAPP_AI_MAX_RECENT_TX, 50),
    whatsappAiHistoryLimit: parseInteger(process.env.WHATSAPP_AI_HISTORY_LIMIT, 10),
    whatsappAiNewConversationMinutes: parseInteger(process.env.WHATSAPP_AI_NEW_CONVERSATION_MINUTES, 180),
    whatsappAiImageMaxBytes: parseInteger(process.env.WHATSAPP_AI_IMAGE_MAX_BYTES, 5 * 1024 * 1024),
    backendUrl: process.env.BACKEND_URL?.trim() || '',
    qrExpiresSeconds: 60,
    maxMessageLength: 4096,
    groqTimeoutMs: parseInteger(process.env.GROQ_TIMEOUT_MS, 15000),
    groqMaxRetries: parseInteger(process.env.GROQ_MAX_RETRIES, 2),
    whatsappAiRateLimitPerMinute: parseInteger(process.env.WHATSAPP_AI_RATE_LIMIT_PER_MINUTE, 10),
    geminiApiKey: getOptional('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    webAppUrl: webAppBaseUrl,
    appRegisterUrl: (() => {
        const explicit = getOptional('APP_REGISTER_URL');
        if (explicit)
            return normalizeUrl(explicit);
        return `${webAppBaseUrl}/register`;
    })(),
    appPanelUrl: (() => {
        const explicit = getOptional('APP_PANEL_URL');
        if (explicit)
            return normalizeUrl(explicit);
        return `${webAppBaseUrl}/app/dashboard`;
    })()
};
if (exports.env.whatsappAiEnabled) {
    if (!exports.env.groqApiKey) {
        throw new Error('Missing required environment variable: GROQ_API_KEY');
    }
}
