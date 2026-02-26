"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getRequired(name) {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
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
function getOptional(name) {
    const value = process.env[name];
    if (!value || value.trim().length === 0)
        return null;
    return value.trim();
}
exports.env = {
    port: parsePort(process.env.PORT, 10000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    whatsappApiToken: getRequired('WHATSAPP_API_TOKEN'),
    whatsappAutoReplyEnabled: parseBoolean(process.env.WHATSAPP_AUTO_REPLY_ENABLED, true),
    whatsappAutoReplyText: process.env.WHATSAPP_AUTO_REPLY_TEXT?.trim() ||
        'Recebemos sua mensagem. Em breve retornamos.',
    whatsappAuthDir: process.env.WHATSAPP_AUTH_DIR?.trim() ||
        '/opt/render/project/src/backend/.baileys_auth',
    firebaseProjectId: getRequired('FIREBASE_PROJECT_ID'),
    firebaseClientEmail: getRequired('FIREBASE_CLIENT_EMAIL'),
    firebasePrivateKey: getRequired('FIREBASE_PRIVATE_KEY'),
    whatsappAiEnabled: parseBoolean(process.env.WHATSAPP_AI_ENABLED, true),
    groqApiKey: getOptional('GROQ_API_KEY'),
    groqModel: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
    groqVisionModel: process.env.GROQ_VISION_MODEL?.trim() || 'meta-llama/llama-4-maverick-17b-128e-instruct',
    whatsappAiRecentTransactions: parseInteger(process.env.WHATSAPP_AI_MAX_RECENT_TX, 50),
    whatsappAiHistoryLimit: parseInteger(process.env.WHATSAPP_AI_HISTORY_LIMIT, 10),
    whatsappAiImageMaxBytes: parseInteger(process.env.WHATSAPP_AI_IMAGE_MAX_BYTES, 5 * 1024 * 1024),
    backendUrl: process.env.BACKEND_URL?.trim() || '',
    qrExpiresSeconds: 60,
    maxMessageLength: 4096
};
if (exports.env.whatsappAiEnabled) {
    if (!exports.env.groqApiKey) {
        throw new Error('Missing required environment variable: GROQ_API_KEY');
    }
}
