import dotenv from 'dotenv';

dotenv.config();

function getRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getRequiredAny(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  throw new Error(`Missing required environment variable: one of ${names.join(', ')}`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid PORT value');
  }
  return parsed;
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid integer environment value');
  }
  return parsed;
}

function getOptional(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return null;
  return value.trim();
}

const whatsappAuthDirBase =
  process.env.WHATSAPP_AUTH_DIR?.trim() ||
  '/opt/render/project/src/backend/.baileys_auth';

export const env = {
  port: parsePort(process.env.PORT, 10000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  whatsappApiToken: getRequired('WHATSAPP_API_TOKEN'),
  whatsappAutoReplyEnabled: parseBoolean(process.env.WHATSAPP_AUTO_REPLY_ENABLED, true),
  whatsappAutoReplyText:
    process.env.WHATSAPP_AUTO_REPLY_TEXT?.trim() ||
    'Recebemos sua mensagem. Em breve retornamos.',
  whatsappAuthDir: whatsappAuthDirBase,
  whatsappAuthDirWa1: process.env.WHATSAPP_AUTH_DIR_WA1?.trim() || `${whatsappAuthDirBase}_wa1`,
  supabaseUrl: getRequired('SUPABASE_URL'),
  supabaseServiceRoleKey: getRequiredAny('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
  firebaseProjectId: getRequired('FIREBASE_PROJECT_ID'),
  firebaseClientEmail: getRequired('FIREBASE_CLIENT_EMAIL'),
  firebasePrivateKey: getRequired('FIREBASE_PRIVATE_KEY'),
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
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'
};

if (env.whatsappAiEnabled) {
  if (!env.groqApiKey) {
    throw new Error('Missing required environment variable: GROQ_API_KEY');
  }
}
