"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClient = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const promises_1 = require("node:fs/promises");
const qrcode_1 = __importDefault(require("qrcode"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const assistant_1 = require("../ai/assistant");
const document_storage_1 = require("../lib/document-storage");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const events_1 = require("./events");
const document_intents_1 = require("./document-intents");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isExpectedMediaDecryptError(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
    return (message.includes('bad decrypt') ||
        message.includes('bad mac') ||
        message.includes('no matching sessions found') ||
        message.includes('no session') ||
        message.includes('sessionerror') ||
        message.includes('prekey'));
}
function asDisconnectCode(error) {
    const code = error?.output?.statusCode;
    return typeof code === 'number' ? code : null;
}
function normalizeForGreeting(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function isGreetingMessage(text) {
    const normalized = normalizeForGreeting(text);
    if (!normalized)
        return false;
    return /^(oi+|ola|opa|bom dia|boa tarde|boa noite|e ai|eae|hello|hey)\b/.test(normalized);
}
function isCapabilitiesIntentMessage(text) {
    const normalized = normalizeForGreeting(text);
    if (!normalized)
        return false;
    return (/\b(o que|oq|o q)\s+(voce|vc)\s+(pode|faz)\b/.test(normalized) ||
        /\bcomo\s+(voce|vc)\s+pode\s+ajudar\b/.test(normalized) ||
        /\bquais?\s+(suas\s+)?(funcoes|funcionalidades|capacidades)\b/.test(normalized) ||
        /\b(o que|oq)\s+faz\b/.test(normalized));
}
function isPanelLinkIntentMessage(text) {
    const normalized = normalizeForGreeting(text);
    if (!normalized)
        return false;
    return (/\b(link|site|acesso|url)\b/.test(normalized) &&
        /\b(painel|dashboard|app)\b/.test(normalized)) || /\bme\s+passe\s+o\s+link\s+do\s+painel\b/.test(normalized);
}
function buildPanelLinkReply() {
    return `Acesse seu painel aqui: ${env_1.env.appPanelUrl}`;
}
function buildRegistrationRequiredReply() {
    return [
        'Oi! Eu sou a IA do SaldoPro.',
        '',
        'Eu posso te ajudar a registrar gastos e receitas, criar lembretes e acompanhar seu controle financeiro pelo WhatsApp.',
        '',
        'Para eu te atender por aqui, primeiro voce precisa fazer seu cadastro no site.',
        `Faca seu cadastro aqui: ${env_1.env.appRegisterUrl}`,
        '',
        'Assim que terminar, pode me mandar mensagem novamente que eu continuo com voce.'
    ].join('\n');
}
const UNDO_KEYWORDS = ['desfaz', 'desfazer', 'desfaca', 'cancela', 'cancelar', 'errou', 'errei', 'anula', 'anular', 'desfizer'];
function isUndoMessage(text) {
    const normalized = normalizeForGreeting(text);
    if (!normalized || normalized.length > 120)
        return false;
    return UNDO_KEYWORDS.some((kw) => normalized.includes(kw));
}
function buildDocumentSavedReply(title) {
    return [
        `Arquivo salvo como "${title}".`,
        '',
        `Para pedir depois, voce pode enviar: "me manda ${title}".`,
        `Tambem funciona: "manda de volta ${title}".`
    ].join('\n');
}
const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada e registre o lancamento corretamente.';
const DOCUMENT_PENDING_TTL_MS = 10 * 60 * 1000;
const DOCUMENT_RECENT_LIMIT = 30;
const DOCUMENT_STRONG_MATCH_MIN_SCORE = 60;
const DOCUMENT_AMBIGUOUS_MIN_SCORE = 25;
const DOCUMENT_RESULT_GAP_MIN = 15;
const DOCUMENT_RECENCY_BONUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DOCUMENT_UNSUPPORTED_MEDIA_REPLY = 'Por enquanto so consigo guardar imagens. PDF e outros tipos ainda nao estao disponiveis.';
const DOCUMENT_PENDING_PROMPT_REPLY = 'Recebi a imagem. Qual nome ou descricao voce quer usar para salvar? Exemplo: logo da empresa ou contrato aluguel.';
const DOCUMENT_PENDING_CANCELLED_REPLY = 'Salvamento cancelado.';
const DOCUMENT_SAVE_ERROR_REPLY = 'Nao consegui concluir essa operacao com arquivos agora. Tente novamente em instantes.';
const DOCUMENT_IMAGE_READ_ERROR_REPLY = 'Recebi seu pedido para guardar a imagem, mas nao consegui ler o arquivo enviado. Tente reenviar a imagem em alguns instantes.';
/** Max number of messages processed concurrently by the AI pipeline. */
const MESSAGE_QUEUE_CONCURRENCY = 5;
/** Refresh typing presence periodically while AI processing is running. */
const COMPOSING_REFRESH_MS = 4000;
/**
 * Debounce window for rapid messages from the same user.
 * When a user sends multiple messages quickly, we wait this long after the
 * LAST message before processing, so all messages get batched into one AI call.
 */
const USER_DEBOUNCE_MS = 1800;
/** If the same JID hits repeated Bad MAC in a short window, perform a soft reconnect. */
const BAD_MAC_WINDOW_MS = 2 * 60 * 1000;
const BAD_MAC_RECONNECT_THRESHOLD = 3;
/** After this many soft reconnects, restart the cycle but preserve auth state. */
const BAD_MAC_RECONNECT_CYCLE_AFTER = 3;
/** How long to keep unresolvable-LID messages buffered before discarding. */
const LID_BUFFER_TTL_MS = 120_000;
const LID_BUFFER_MAX_PER_JID = 15;
/** Debounce for bursts of creds.update events. */
const AUTH_SYNC_DEBOUNCE_MS = 1200;
/** Minimum interval between persisted auth snapshots to reduce write volume. */
const AUTH_SYNC_MIN_INTERVAL_MS = 3 * 60 * 1000;
class WhatsAppClient {
    slotId;
    authDir;
    displayName;
    socket = null;
    state = 'connecting';
    connected = false;
    phone = null;
    lastDisconnectReason = null;
    qrText = null;
    qrDataUrl = null;
    qrGeneratedAt = null;
    reconnectTimer = null;
    allowReconnect = true;
    processedInboundIds = new Set();
    processedInboundOrder = [];
    conversationByPhone = new Map();
    badMacByJid = new Map();
    lidToPhoneJid = new Map();
    sentMessagesCache = new Map();
    authSyncTimer = null;
    authSyncInFlight = false;
    authSyncQueued = false;
    authSyncQueuedForce = false;
    lastAuthSnapshotHash = null;
    lastAuthSyncAt = 0;
    recoveringInvalidSession = false;
    aiCallTimestamps = new Map();
    softReconnectCount = 0;
    connectionEpoch = 0;
    // --- LID message buffer: store messages with unresolved LID for later replay ---
    pendingLidMessages = new Map();
    // --- Message processing queue ---
    messageQueue = [];
    messageQueueActive = 0;
    drainInProgress = false;
    // --- Per-user debounce for rapid messages ---
    userDebounceTimers = new Map();
    userDebouncedMessages = new Map();
    constructor(options) {
        this.slotId = options.slotId;
        this.authDir = options.authDir;
        this.displayName = options.displayName?.trim() || options.slotId.toUpperCase();
    }
    async start() {
        await (0, promises_1.mkdir)(this.authDir, { recursive: true });
        await this.restoreAuthStateFromFirestoreIfNeeded();
        const files = await (0, promises_1.readdir)(this.authDir);
        const hasSavedSession = files.some((f) => f.includes('creds'));
        logger_1.logger.info('WhatsApp auth state', {
            slotId: this.slotId,
            authDir: this.authDir,
            filesFound: files.length,
            hasSavedSession
        });
        await this.connect();
    }
    async shutdown() {
        this.allowReconnect = false;
        this.connectionEpoch++;
        this.clearReconnectTimer();
        this.clearAuthSyncTimer();
        this.authSyncQueued = false;
        await this.syncAuthStateNow(true);
        if (this.socket) {
            try {
                this.socket.ev.removeAllListeners('connection.update');
                this.socket.ev.removeAllListeners('creds.update');
                this.socket.ev.removeAllListeners('messages.upsert');
                this.socket.ev.removeAllListeners('messaging-history.set');
                this.socket.ev.removeAllListeners('chats.phoneNumberShare');
                this.socket.ev.removeAllListeners('contacts.upsert');
                this.socket.ev.removeAllListeners('contacts.update');
                this.socket.ws?.close();
            }
            catch {
                // ignore cleanup errors
            }
        }
        this.socket = null;
    }
    getStatus() {
        return {
            slotId: this.slotId,
            connected: this.connected,
            state: this.state,
            phone: this.phone,
            lastDisconnectReason: this.lastDisconnectReason
        };
    }
    getSlotId() {
        return this.slotId;
    }
    async getQrPayload() {
        if (this.connected) {
            return { available: false, reason: 'already_connected' };
        }
        if (!this.qrText || !this.qrDataUrl || !this.qrGeneratedAt) {
            return { available: false, reason: 'no_qr' };
        }
        const elapsedSeconds = Math.floor((Date.now() - this.qrGeneratedAt) / 1000);
        const expiresInSec = Math.max(0, env_1.env.qrExpiresSeconds - elapsedSeconds);
        if (expiresInSec <= 0) {
            return { available: false, reason: 'expired' };
        }
        return {
            available: true,
            qrPngBase64: this.qrDataUrl,
            expiresInSec
        };
    }
    async sendText(to, text, ownerUid, mediaUrl) {
        const normalizedText = text.trim();
        if (!normalizedText) {
            throw new Error('Message text is required');
        }
        if (normalizedText.length > env_1.env.maxMessageLength) {
            throw new Error(`Message text exceeds max length (${env_1.env.maxMessageLength})`);
        }
        if (!this.socket || !this.connected) {
            throw new Error('WhatsApp is not connected');
        }
        let jid = (0, events_1.normalizePhoneToJid)(to);
        // CRITICAL FIX FOR BRAZILIAN 9TH DIGIT:
        // Before sending a proactive message (like welcome/signup), we MUST ask
        // WhatsApp what the actual registered JID is for this phone number.
        // In Brazil, +55 66 98439-6232 (with 9) might actually be registered
        // internally as +55 66 8439-6232 (without 9). If we send to the 9-digit
        // version blindly, the message goes to an inactive/ghost account.
        try {
            const waResults = await this.socket.onWhatsApp(to);
            if (waResults && waResults.length > 0) {
                // Use the actual JID that WhatsApp says is registered
                jid = waResults[0].jid;
                logger_1.logger.info('MSG_OUTBOUND_RESOLVE: resolved phone to registered JID', {
                    slotId: this.slotId,
                    requestedPhone: to,
                    resolvedJid: jid
                });
            }
        }
        catch (err) {
            logger_1.logger.warn('MSG_OUTBOUND_RESOLVE_FAIL: failed to verify number on WhatsApp, falling back to raw JID', {
                slotId: this.slotId,
                requestedPhone: to,
                error: err instanceof Error ? err.message : 'unknown'
            });
        }
        const customOptions = mediaUrl ? { image: { url: mediaUrl } } : undefined;
        const result = await this.sendWithRetry(jid, normalizedText, 'outbound', ownerUid, customOptions);
        if (ownerUid) {
            await this.appendConversationMessage(ownerUid, (0, events_1.jidToPhone)(jid), {
                role: 'assistant',
                content: mediaUrl ? `[Imagem Enviada] ${normalizedText}` : normalizedText
            });
        }
        return result;
    }
    async resetSession() {
        logger_1.logger.warn('Resetting WhatsApp session by API request', { slotId: this.slotId });
        this.allowReconnect = false;
        this.connectionEpoch++;
        this.clearReconnectTimer();
        this.connected = false;
        this.state = 'connecting';
        this.lastDisconnectReason = 'session_reset';
        this.clearQr();
        this.phone = null;
        if (this.socket) {
            if (this.connected) {
                try {
                    await this.socket.logout();
                }
                catch (error) {
                    logger_1.logger.warn('Socket logout failed during reset', {
                        slotId: this.slotId,
                        error
                    });
                }
            }
            else {
                logger_1.logger.debug('Skipping WhatsApp logout during reset because socket is not connected yet', {
                    slotId: this.slotId
                });
            }
            try {
                this.socket.ev.removeAllListeners('connection.update');
                this.socket.ev.removeAllListeners('creds.update');
                this.socket.ev.removeAllListeners('messages.upsert');
                this.socket.ev.removeAllListeners('messaging-history.set');
                this.socket.ev.removeAllListeners('chats.phoneNumberShare');
                this.socket.ev.removeAllListeners('contacts.upsert');
                this.socket.ev.removeAllListeners('contacts.update');
                this.socket.ws?.close();
            }
            catch {
                // ignore cleanup errors
            }
            this.socket = null;
        }
        this.clearAuthSyncTimer();
        this.authSyncQueued = false;
        this.lastAuthSnapshotHash = null;
        await (0, promises_1.rm)(this.authDir, { recursive: true, force: true });
        await (0, promises_1.mkdir)(this.authDir, { recursive: true });
        try {
            await (0, firestore_1.clearWhatsAppAuthSnapshot)(this.slotId);
        }
        catch (error) {
            logger_1.logger.error('Failed to clear WhatsApp auth snapshot in Firestore', { slotId: this.slotId, error });
        }
        this.allowReconnect = true;
        await this.connect();
    }
    async connect() {
        // Clean up previous socket to prevent stale event handlers from
        // interfering with the new connection (e.g. old socket's 'close' event
        // overwriting state after a new socket is already created).
        if (this.socket) {
            try {
                this.socket.ev.removeAllListeners('connection.update');
                this.socket.ev.removeAllListeners('creds.update');
                this.socket.ev.removeAllListeners('messages.upsert');
                this.socket.ev.removeAllListeners('messaging-history.set');
                this.socket.ev.removeAllListeners('chats.phoneNumberShare');
                this.socket.ev.removeAllListeners('contacts.upsert');
                this.socket.ev.removeAllListeners('contacts.update');
                this.socket.ws?.close();
            }
            catch {
                // ignore cleanup errors
            }
            this.socket = null;
        }
        const epoch = ++this.connectionEpoch;
        this.state = 'connecting';
        this.connected = false;
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(this.authDir);
        let version;
        try {
            ({ version } = await (0, baileys_1.fetchLatestBaileysVersion)());
        }
        catch (error) {
            logger_1.logger.warn('fetchLatestBaileysVersion failed, using fallback', {
                error: error instanceof Error ? error.message : 'unknown'
            });
            version = [2, 3000, 1017531287];
        }
        const socket = (0, baileys_1.default)({
            auth: state,
            version,
            printQRInTerminal: false,
            // Ignore status & groups at socket level: this bot only handles 1:1 chats.
            shouldIgnoreJid: (jid) => (0, events_1.isStatusJid)(jid) || (0, events_1.isGroupJid)(jid),
            // IMPORTANT: Each slot needs a UNIQUE browser fingerprint. If both use the same
            // identifier, WhatsApp may treat them as duplicate linked devices from the same
            // machine and invalidate each other's Signal sessions → Bad MAC errors.
            browser: [`SaldoPro-${this.slotId.toUpperCase()}`, 'Render', '1.0.0'],
            // CRITICAL: Required for Baileys to automatically resolve decryption failures
            // ("Aguardando mensagem") on linked devices by looking up the missing outgoing message.
            getMessage: async (key) => {
                if (key.id && this.sentMessagesCache.has(key.id)) {
                    return this.sentMessagesCache.get(key.id);
                }
                return undefined;
            }
        });
        this.socket = socket;
        socket.ev.on('creds.update', () => {
            if (this.connectionEpoch !== epoch)
                return;
            void saveCreds();
            if (this.lastAuthSyncAt === 0 || this.lastAuthSnapshotHash === null) {
                this.scheduleAuthStateSync(true);
                return;
            }
            this.scheduleAuthStateSync();
        });
        socket.ev.on('connection.update', (update) => {
            if (this.connectionEpoch !== epoch)
                return;
            void this.handleConnectionUpdate(update);
        });
        socket.ev.on('messages.upsert', (upsert) => {
            if (this.connectionEpoch !== epoch)
                return;
            void this.handleMessagesUpsert(upsert);
        });
        socket.ev.on('chats.phoneNumberShare', (event) => {
            if (this.connectionEpoch !== epoch)
                return;
            this.rememberLidMapping(event.lid, event.jid, 'phone_number_share');
        });
        socket.ev.on('contacts.upsert', (contacts) => {
            if (this.connectionEpoch !== epoch)
                return;
            this.absorbContactLidMappings(contacts, 'contacts_upsert');
        });
        socket.ev.on('contacts.update', (contacts) => {
            if (this.connectionEpoch !== epoch)
                return;
            this.absorbContactLidMappings(contacts, 'contacts_update');
        });
        // messaging-history.set carries contacts from history sync — main source of LID→phone mappings
        socket.ev.on('messaging-history.set', (history) => {
            if (this.connectionEpoch !== epoch)
                return;
            if (history.contacts && history.contacts.length > 0) {
                logger_1.logger.info('HISTORY_SYNC: received contacts with potential LID mappings', {
                    slotId: this.slotId,
                    contactCount: history.contacts.length
                });
                this.absorbContactLidMappings(history.contacts, 'contacts_upsert');
            }
        });
        // CRITICAL: Hook into raw WebSocket stanzas to capture sender_pn from node attributes.
        // Baileys has sender_pn in retry receipt nodes but may also include it in some
        // initial message nodes. We intercept it BEFORE Baileys processes the message.
        const ws = socket.ws;
        if (ws && typeof ws.on === 'function') {
            ws.on('CB:message', (node) => {
                if (this.connectionEpoch !== epoch)
                    return;
                const attrs = node?.attrs;
                if (!attrs)
                    return;
                const from = attrs.from;
                const senderPn = attrs.sender_pn;
                if (from && from.endsWith('@lid') && senderPn && senderPn.includes('@s.whatsapp.net')) {
                    this.rememberLidMapping(from, senderPn, 'message_candidate');
                    logger_1.logger.info('CB_MESSAGE_SENDER_PN: extracted phone from raw node', {
                        slotId: this.slotId,
                        lidJid: from,
                        senderPn
                    });
                }
                else if (from && from.endsWith('@lid') && !senderPn) {
                    logger_1.logger.info('CB_MESSAGE_NO_SENDER_PN: LID message without sender_pn', {
                        slotId: this.slotId,
                        lidJid: from,
                        availableAttrs: Object.keys(attrs).join(',')
                    });
                }
            });
            // Also listen for CB:receipt which carries sender_pn in retry receipts
            ws.on('CB:receipt', (node) => {
                if (this.connectionEpoch !== epoch)
                    return;
                const attrs = node?.attrs;
                if (!attrs)
                    return;
                const from = attrs.from;
                const senderPn = attrs.sender_pn;
                if (from && from.endsWith('@lid') && senderPn && senderPn.includes('@s.whatsapp.net')) {
                    this.rememberLidMapping(from, senderPn, 'message_candidate');
                    logger_1.logger.info('CB_RECEIPT_SENDER_PN: extracted phone from receipt node', {
                        slotId: this.slotId,
                        lidJid: from,
                        senderPn
                    });
                }
            });
            logger_1.logger.info('Raw CB:message/CB:receipt listeners registered for sender_pn extraction', { slotId: this.slotId });
        }
        logger_1.logger.info('WhatsApp socket initialized', { slotId: this.slotId, displayName: this.displayName, epoch });
    }
    async handleConnectionUpdate(update) {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            await this.setQr(qr);
        }
        if (connection === 'connecting') {
            this.state = 'connecting';
            this.connected = false;
            return;
        }
        if (connection === 'open') {
            this.state = 'open';
            this.connected = true;
            this.lastDisconnectReason = null;
            this.phone = (0, events_1.jidToPhone)(this.socket?.user?.id) || null;
            this.badMacByJid.clear();
            this.softReconnectCount = 0;
            this.clearQr();
            void this.syncAuthStateNow(true);
            this.scheduleAuthStateSync();
            // Log the bot's own LID for debugging self-chat detection
            const socketUser = this.socket?.user;
            logger_1.logger.info('WhatsApp connection opened', {
                slotId: this.slotId,
                displayName: this.displayName,
                phone: this.phone,
                ownLid: socketUser?.lid ?? 'unknown',
                ownId: socketUser?.id ?? 'unknown'
            });
            return;
        }
        if (connection === 'close') {
            this.state = 'close';
            this.connected = false;
            const code = asDisconnectCode(lastDisconnect?.error);
            const reason = this.mapDisconnectReason(code);
            this.lastDisconnectReason = reason;
            logger_1.logger.warn('WhatsApp connection closed', { slotId: this.slotId, code, reason });
            const shouldForceRelogin = this.allowReconnect &&
                (code === baileys_1.DisconnectReason.loggedOut || code === baileys_1.DisconnectReason.badSession);
            if (shouldForceRelogin) {
                logger_1.logger.warn('Invalid WhatsApp session detected, forcing fresh login to generate new QR', {
                    slotId: this.slotId,
                    code,
                    reason
                });
                void this.recoverFromInvalidSession();
                return;
            }
            // In Render deploys, two instances can overlap briefly and trigger
            // "connection_replaced". Do NOT wipe auth state in this case.
            if (this.allowReconnect && code === baileys_1.DisconnectReason.connectionReplaced) {
                logger_1.logger.warn('WhatsApp connection replaced; preserving auth state and retrying later', {
                    slotId: this.slotId,
                    code,
                    reason
                });
                this.scheduleReconnect(20000);
                return;
            }
            const shouldReconnect = this.allowReconnect &&
                code !== baileys_1.DisconnectReason.loggedOut &&
                code !== baileys_1.DisconnectReason.forbidden;
            if (shouldReconnect) {
                this.scheduleReconnect();
            }
        }
    }
    async handleMessagesUpsert(upsert) {
        if (upsert.type !== 'notify' && upsert.type !== 'append') {
            logger_1.logger.info('MSG_UPSERT_SKIP: unsupported upsert type', {
                slotId: this.slotId,
                type: upsert.type,
                count: upsert.messages.length
            });
            return;
        }
        for (const message of upsert.messages) {
            this.enqueueMessage(message);
        }
    }
    /**
     * Enqueue a message for processing with bounded concurrency.
     * Rapid messages from the SAME user/phone are debounced: we wait
     * USER_DEBOUNCE_MS after the last message before processing, so
     * multiple rapid messages get handled sequentially with fresh context
     * instead of spawning parallel AI calls that overwrite each other.
     */
    enqueueMessage(message) {
        const key = message.key;
        const remoteJid = key?.remoteJid ?? '';
        // Use the raw remoteJid as debounce key — same sender = same key
        const debounceKey = remoteJid || `unknown_${Date.now()}`;
        // If this is a LID, status, group, fromMe, or has no remoteJid, skip debounce
        const shouldDebounce = remoteJid &&
            !(0, events_1.isStatusJid)(remoteJid) &&
            !(0, events_1.isGroupJid)(remoteJid) &&
            !key?.fromMe &&
            !remoteJid.endsWith('@lid');
        if (!shouldDebounce) {
            // Process immediately without debounce (LIDs, non-chat messages, etc.)
            this.enqueueTask(message);
            return;
        }
        // --- Per-user debounce logic ---
        // Clear any existing timer for this user
        const existingTimer = this.userDebounceTimers.get(debounceKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        // Accumulate messages for this user
        const pending = this.userDebouncedMessages.get(debounceKey) ?? [];
        pending.push(message);
        this.userDebouncedMessages.set(debounceKey, pending);
        logger_1.logger.info('MSG_DEBOUNCE: buffering rapid message', {
            slotId: this.slotId,
            debounceKey,
            bufferedCount: pending.length,
            messageId: key?.id ?? 'unknown',
            debounceMs: USER_DEBOUNCE_MS
        });
        // Set a new timer — fires USER_DEBOUNCE_MS after the LAST message
        const timer = setTimeout(() => {
            this.userDebounceTimers.delete(debounceKey);
            const messages = this.userDebouncedMessages.get(debounceKey) ?? [];
            this.userDebouncedMessages.delete(debounceKey);
            if (messages.length === 0)
                return;
            logger_1.logger.info('MSG_DEBOUNCE_FLUSH: processing batched messages', {
                slotId: this.slotId,
                debounceKey,
                messageCount: messages.length
            });
            // Process each message sequentially by enqueueing them in order
            for (const msg of messages) {
                this.enqueueTask(msg);
            }
        }, USER_DEBOUNCE_MS);
        this.userDebounceTimers.set(debounceKey, timer);
    }
    /**
     * Low-level task enqueue: wraps a message handler in error handling
     * and pushes it onto the processing queue.
     */
    enqueueTask(message) {
        const task = async () => {
            try {
                await this.handleSingleIncomingMessage(message);
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : '';
                if (isExpectedMediaDecryptError(error)) {
                    const remoteJid = message.key?.remoteJid ?? 'unknown';
                    const messageId = message.key?.id ?? 'unknown';
                    await this.registerBadMac(message, errorMsg);
                    logger_1.logger.warn('Signal decryption error detected; ignoring message while recovery stays in place', {
                        slotId: this.slotId,
                        remoteJid,
                        messageId,
                        error: error instanceof Error ? error.message : 'unknown'
                    });
                    return;
                }
                logger_1.logger.error('Failed processing inbound message', error);
            }
        };
        this.messageQueue.push(task);
        void this.drainMessageQueue();
    }
    async drainMessageQueue() {
        // Prevent concurrent drain loops from competing for the same slots
        if (this.drainInProgress)
            return;
        this.drainInProgress = true;
        try {
            while (this.messageQueue.length > 0 && this.messageQueueActive < MESSAGE_QUEUE_CONCURRENCY) {
                const task = this.messageQueue.shift();
                if (!task)
                    break;
                this.messageQueueActive += 1;
                task().finally(() => {
                    this.messageQueueActive -= 1;
                    void this.drainMessageQueue();
                });
            }
        }
        finally {
            this.drainInProgress = false;
        }
    }
    async handleSingleIncomingMessage(message) {
        const key = message.key;
        if (!key)
            return;
        const messageId = key.id ?? '';
        if (!messageId)
            return;
        if (this.alreadyProcessedInbound(messageId))
            return;
        const rawRemoteJid = key.remoteJid ?? '';
        const remoteJid = this.resolveIncomingRemoteJid(key);
        if (!remoteJid || (0, events_1.isStatusJid)(remoteJid) || (0, events_1.isGroupJid)(remoteJid))
            return;
        const remotePhone = (0, events_1.jidToPhone)(remoteJid);
        // CRITICAL: Always reply to the resolved phone JID (@s.whatsapp.net).
        // Sending directly to @lid causes encryption session errors ("Aguardando mensagem")
        // on iOS because the mobile app expects replies to arrive on the standard phone jid.
        const replyJid = remoteJid;
        if (this.phone && remotePhone === this.phone) {
            this.rememberInbound(messageId);
            logger_1.logger.info('MSG_SKIP: own-number chat ignored', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                rawRemoteJid,
                remotePhone,
                selfPhone: this.phone
            });
            return;
        }
        if (key.fromMe) {
            this.rememberInbound(messageId);
            logger_1.logger.info('MSG_SKIP: fromMe message ignored', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                rawRemoteJid
            });
            return;
        }
        if (remoteJid.endsWith('@lid')) {
            // Buffer the message — do NOT mark as processed so it can be replayed
            this.bufferLidMessage(remoteJid, message);
            logger_1.logger.warn('MSG_BUFFER: unresolved LID remoteJid, buffered for retry', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                rawRemoteJid,
                fromMe: Boolean(key.fromMe),
                pendingCount: this.pendingLidMessages.get(remoteJid)?.length ?? 0
            });
            // Use multiple strategies to resolve the LID to a phone number
            this.requestPhoneForLidJid(remoteJid, message);
            return;
        }
        if (!message.message && this.hasLidIdentity(key)) {
            await this.registerBadMac(message, 'empty_payload_with_lid');
            // Try to extract any phone number info from the message metadata for LID mapping
            this.tryExtractPhoneFromMessageMeta(message);
            // IMPORTANT: Do NOT call rememberInbound here! When Baileys gets a Bad MAC,
            // it sends retry receipts to the sender, who will re-send the message with
            // a prekey bundle. That re-send arrives as a NEW messages.upsert event with
            // the SAME message ID but now with actual decrypted content. If we mark the
            // ID as processed here, the successfully decrypted retry will be silently dropped.
            logger_1.logger.warn('MSG_DECRYPT_FAIL: missing payload with LID identity (Bad MAC), awaiting retry', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                fromMe: Boolean(key.fromMe),
                softReconnectCount: this.softReconnectCount,
                allKeyFields: JSON.stringify(Object.keys(key))
            });
            return;
        }
        // Handle messages with empty payload — likely Bad MAC or PreKeyError decryption failure.
        // Baileys' built-in retry mechanism will send retry receipts with pre-keys,
        // allowing the sender to re-establish the session and re-send the message.
        // CRITICAL: Do NOT call rememberInbound here — the retry will arrive as a
        // new messages.upsert with the SAME message ID but with actual content.
        // Marking it as processed here would cause the retry to be silently dropped.
        if (!message.message) {
            await this.registerBadMac(message, 'empty_payload_decrypt_failure');
            this.tryExtractPhoneFromMessageMeta(message);
            logger_1.logger.warn('MSG_DECRYPT_FAIL: empty payload (decrypt failure), awaiting Baileys retry', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                rawRemoteJid,
                fromMe: Boolean(key.fromMe),
                isFromLid: rawRemoteJid?.endsWith('@lid') ?? false
            });
            return;
        }
        logger_1.logger.info('MSG_RECV: new inbound message', {
            messageId,
            from: remotePhone,
            fromMe: Boolean(key.fromMe),
            rawRemoteJid,
            replyJid,
            rawType: (0, events_1.extractRawType)(message),
            textPreview: (0, events_1.extractMessageText)(message).slice(0, 50)
        });
        const alreadyInFirestore = await (0, firestore_1.inboundMessageExists)(messageId, this.slotId, this.processedInboundIds);
        if (alreadyInFirestore) {
            this.rememberInbound(messageId);
            logger_1.logger.info('MSG_SKIP: already processed', { messageId });
            return;
        }
        const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
        const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
        const text = (0, events_1.extractMessageText)(message);
        const rawType = (0, events_1.extractRawType)(message);
        const isDocumentUpload = (0, events_1.isDocumentMessage)(message);
        const hasImageAttachment = (0, events_1.isImageMessage)(message);
        const imageDataUrl = await this.extractInboundImageDataUrl(message);
        const audioDataUrl = await this.extractInboundAudioDataUrl(message);
        const inboundText = text.trim();
        // Skip messages with no usable content (e.g. decryption failures)
        if (!inboundText && !imageDataUrl && !audioDataUrl && !isDocumentUpload) {
            this.rememberInbound(messageId);
            logger_1.logger.info('MSG_SKIP: empty message (likely decryption failure or unsupported media), ignoring', {
                messageId,
                rawType,
                hasAudioDataUrl: Boolean(audioDataUrl),
                from: remotePhone
            });
            return;
        }
        let binding = await (0, firestore_1.getPhoneBinding)(remotePhone);
        let bindingJustVerified = false;
        logger_1.logger.info('MSG_BIND: phone binding lookup', {
            phone: remotePhone,
            found: Boolean(binding),
            uid: binding?.uid ?? null
        });
        if (binding) {
            let stillAllowed;
            try {
                stillAllowed = await (0, firestore_1.isPhoneAllowedForUid)(binding.uid, remotePhone);
            }
            catch (allowedError) {
                logger_1.logger.error('MSG_ALLOWED_CHECK_ERROR: isPhoneAllowedForUid threw, treating as allowed to avoid silent drop', {
                    phone: remotePhone,
                    uid: binding.uid,
                    error: allowedError instanceof Error ? allowedError.message : 'unknown'
                });
                stillAllowed = true;
            }
            logger_1.logger.info('MSG_ALLOWED: phone permission check result', {
                phone: remotePhone,
                uid: binding.uid,
                stillAllowed
            });
            if (!stillAllowed) {
                logger_1.logger.info('MSG_STALE_BINDING: old binding no longer allowed, dropping to re-resolve', {
                    phone: remotePhone,
                    oldUid: binding.uid
                });
                binding = null; // force re-resolve below
            }
            else {
                bindingJustVerified = true;
            }
        }
        // Se não há binding (ou era stale), tenta auto-vincular pelo número cadastrado na conta
        if (!binding) {
            logger_1.logger.info('MSG_RESOLVE: attempting resolveUidFromPhone', { phone: remotePhone });
            const resolvedUid = await (0, firestore_1.resolveUidFromPhone)(remotePhone);
            if (resolvedUid) {
                // Verify the phone is actually in the user's allowed numbers before auto-binding
                const isAllowed = await (0, firestore_1.isPhoneAllowedForUid)(resolvedUid, remotePhone);
                if (isAllowed) {
                    await (0, firestore_1.savePhoneBinding)(remotePhone, resolvedUid);
                    binding = {
                        phone: (0, events_1.normalizePhoneNumber)(remotePhone),
                        uid: resolvedUid,
                        linkedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    bindingJustVerified = true;
                    logger_1.logger.info('MSG_RESOLVE: auto-linked phone to account', {
                        phone: remotePhone,
                        uid: resolvedUid
                    });
                }
                else {
                    logger_1.logger.info('MSG_RESOLVE: phone not in allowed list for resolved user, skipping auto-bind', {
                        phone: remotePhone,
                        uid: resolvedUid
                    });
                }
            }
            else {
                logger_1.logger.info('MSG_RESOLVE: no account found for phone', { phone: remotePhone });
            }
        }
        if (!binding) {
            logger_1.logger.info('MSG_UNLINKED: no binding found or allowed, asking user to register', { from: remotePhone });
            await this.handleUnlinkedMessage(replyJid, remotePhone);
            this.rememberInbound(messageId);
            return;
        }
        const ownerActive = await (0, firebase_user_access_1.isFirebaseUserActive)(binding.uid);
        if (!ownerActive) {
            logger_1.logger.warn('MSG_BLOCKED_USER: ignoring inbound WhatsApp message for blocked/unavailable account', {
                uid: binding.uid,
                phone: remotePhone
            });
            this.rememberInbound(messageId);
            return;
        }
        const inboundRecord = {
            clientId: this.slotId,
            messageId,
            direction: 'inbound',
            ownerUid: binding.uid,
            from: remotePhone,
            to: this.phone ?? '',
            text,
            timestamp,
            waTimestamp,
            status: 'received',
            rawType,
            createdAt: new Date().toISOString(),
            metadata: {
                fromMe: Boolean(key.fromMe),
                isGroup: false,
                hasImage: Boolean(imageDataUrl),
                hasAudio: Boolean(audioDataUrl)
            }
        };
        await (0, firestore_1.saveMessageSafe)(inboundRecord);
        this.rememberInbound(messageId);
        if (isDocumentUpload) {
            await this.sendWithRetry(replyJid, DOCUMENT_UNSUPPORTED_MEDIA_REPLY, 'auto_reply', binding.uid);
            await this.appendConversationMessage(binding.uid, remotePhone, {
                role: 'user',
                content: inboundText || 'Documento enviado no WhatsApp.'
            });
            await this.appendConversationMessage(binding.uid, remotePhone, {
                role: 'assistant',
                content: DOCUMENT_UNSUPPORTED_MEDIA_REPLY
            });
            return;
        }
        logger_1.logger.info('MSG_AI: sending to AI for reply', {
            uid: binding.uid,
            phone: remotePhone,
            textLength: inboundText.length,
            hasImage: Boolean(imageDataUrl),
            hadImageAttachment: hasImageAttachment,
            hasAudio: Boolean(audioDataUrl)
        });
        await this.sendSmartReply(binding.uid, replyJid, remotePhone, inboundText, imageDataUrl, audioDataUrl, hasImageAttachment);
    }
    async sendSmartReply(ownerUid, remoteJid, remotePhone, inboundText, imageDataUrl, audioDataUrl = null, hasImageAttachment = false) {
        const hasInboundInput = inboundText.trim().length > 0 || Boolean(imageDataUrl) || Boolean(audioDataUrl);
        if (hasInboundInput) {
            try {
                const handledByDocumentFlow = await this.handleDocumentRouting(ownerUid, remoteJid, remotePhone, inboundText, imageDataUrl, audioDataUrl, hasImageAttachment);
                if (handledByDocumentFlow) {
                    logger_1.logger.info('MSG_DOCUMENT_FLOW_HANDLED', {
                        uid: ownerUid,
                        phone: remotePhone,
                        hasImage: Boolean(imageDataUrl),
                        hadImageAttachment: hasImageAttachment,
                        hasAudio: Boolean(audioDataUrl),
                        textLength: inboundText.trim().length
                    });
                    return;
                }
            }
            catch (documentFlowError) {
                logger_1.logger.error('MSG_DOCUMENT_FLOW_ERROR: Failed to process document flow', {
                    uid: ownerUid,
                    phone: remotePhone,
                    error: documentFlowError instanceof Error ? documentFlowError.message : 'unknown'
                });
                await this.sendWithRetry(remoteJid, DOCUMENT_SAVE_ERROR_REPLY, 'auto_reply', ownerUid);
                return;
            }
        }
        if (env_1.env.whatsappAiEnabled && hasInboundInput) {
            if (isPanelLinkIntentMessage(inboundText)) {
                const panelLinkReply = buildPanelLinkReply();
                await this.sendWithRetry(remoteJid, panelLinkReply, 'auto_reply', ownerUid);
                await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
                await this.appendConversationMessage(ownerUid, remotePhone, {
                    role: 'assistant',
                    content: panelLinkReply
                });
                return;
            }
            // Rate limiting check
            if (this.isRateLimited(ownerUid)) {
                logger_1.logger.warn('MSG_RATE_LIMITED: AI processing skipped due to rate limit', {
                    uid: ownerUid,
                    phone: remotePhone,
                    limitPerMinute: env_1.env.whatsappAiRateLimitPerMinute
                });
                const rateLimitMsg = 'Voce enviou muitas mensagens seguidas. Aguarde um momento antes de enviar a proxima.';
                try {
                    await this.sendWithRetry(remoteJid, rateLimitMsg, 'auto_reply', ownerUid);
                }
                catch (rateLimitSendError) {
                    logger_1.logger.error('Failed to send rate limit notice', rateLimitSendError);
                }
                return;
            }
            // Quick undo: detect "desfaz", "cancela", "errou" etc. and revert last action
            if (isUndoMessage(inboundText)) {
                try {
                    const undoReply = await (0, assistant_1.undoLastAction)(ownerUid);
                    await this.sendWithRetry(remoteJid, undoReply, 'auto_reply', ownerUid);
                    await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
                    await this.appendConversationMessage(ownerUid, remotePhone, { role: 'assistant', content: undoReply });
                    return;
                }
                catch (undoError) {
                    logger_1.logger.error('Failed to process undo action', undoError);
                }
            }
            try {
                const reminderShortcutReply = await (0, assistant_1.handleReminderShortcut)(ownerUid, inboundText);
                if (reminderShortcutReply) {
                    await this.sendWithRetry(remoteJid, reminderShortcutReply, 'auto_reply', ownerUid);
                    await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
                    await this.appendConversationMessage(ownerUid, remotePhone, {
                        role: 'assistant',
                        content: reminderShortcutReply
                    });
                    return;
                }
            }
            catch (shortcutError) {
                logger_1.logger.error('Failed to process reminder shortcut', shortcutError);
            }
            const stopTypingPresence = this.startTypingPresence(remoteJid);
            try {
                // Wrap the entire AI pipeline in a global timeout to prevent infinite "typing..."
                const AI_PIPELINE_TIMEOUT_MS = 45_000;
                const aiPipelineResult = await Promise.race([
                    this.runAiPipeline(ownerUid, remotePhone, inboundText, imageDataUrl, audioDataUrl),
                    sleep(AI_PIPELINE_TIMEOUT_MS).then(() => {
                        throw new Error(`AI pipeline timed out after ${AI_PIPELINE_TIMEOUT_MS}ms`);
                    })
                ]);
                if (aiPipelineResult.mediaUrl) {
                    const payload = aiPipelineResult.aiReply.trim() || 'Aqui está a imagem solicitada:';
                    await this.sendWithRetry(remoteJid, payload, 'auto_reply', ownerUid, { image: { url: aiPipelineResult.mediaUrl } });
                    await this.appendConversationMessage(ownerUid, remotePhone, {
                        role: 'assistant',
                        content: `[Imagem Enviada] ${payload}`
                    });
                    return;
                }
                if (aiPipelineResult.aiReply.trim()) {
                    await this.sendWithRetry(remoteJid, aiPipelineResult.aiReply.trim(), 'auto_reply', ownerUid);
                    await this.appendConversationMessage(ownerUid, remotePhone, {
                        role: 'assistant',
                        content: aiPipelineResult.aiReply.trim()
                    });
                    return;
                }
            }
            catch (error) {
                logger_1.logger.error('MSG_AI_ERROR: Failed to process AI WhatsApp message', {
                    uid: ownerUid,
                    phone: remotePhone,
                    error: error instanceof Error ? error.message : 'unknown',
                    stack: error instanceof Error ? error.stack : undefined
                });
                // Send friendly error message instead of silent failure
                const errorMsg = 'Desculpe, estou com dificuldade para processar agora. Tente novamente em instantes.';
                try {
                    await this.sendWithRetry(remoteJid, errorMsg, 'auto_reply', ownerUid);
                }
                catch (sendError) {
                    logger_1.logger.error('Failed to send AI error fallback message', sendError);
                }
                return;
            }
            finally {
                stopTypingPresence();
            }
        }
        if (!env_1.env.whatsappAutoReplyEnabled)
            return;
        const sent = await this.sendAutoReply(remoteJid, ownerUid);
        if (sent) {
            await this.appendConversationMessage(ownerUid, remotePhone, {
                role: 'assistant',
                content: env_1.env.whatsappAutoReplyText.trim()
            });
        }
    }
    async handleDocumentRouting(ownerUid, remoteJid, remotePhone, inboundText, imageDataUrl, audioDataUrl, hasImageAttachment) {
        const activeDraft = await this.getUsablePendingDocumentDraft(ownerUid, remotePhone);
        const saveIntent = (0, document_intents_1.detectDocumentSaveIntent)(inboundText);
        if (hasImageAttachment && !imageDataUrl && saveIntent.matched) {
            logger_1.logger.warn('DOC_SAVE_SKIPPED_NO_IMAGE_DATA: explicit save requested but image payload was unavailable', {
                uid: ownerUid,
                phone: remotePhone,
                textLength: inboundText.trim().length
            });
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, DOCUMENT_IMAGE_READ_ERROR_REPLY, '[Arquivo nao salvo] falha ao ler imagem');
            return true;
        }
        if (imageDataUrl) {
            if (saveIntent.matched) {
                await this.handleExplicitDocumentSave(ownerUid, remoteJid, remotePhone, imageDataUrl, saveIntent.labelCandidate, activeDraft);
                return true;
            }
        }
        if (activeDraft && inboundText.trim() && !imageDataUrl && !audioDataUrl) {
            await this.handlePendingDocumentFollowUp(ownerUid, remoteJid, remotePhone, inboundText, activeDraft);
            return true;
        }
        if (!imageDataUrl && !audioDataUrl && inboundText.trim()) {
            const fetchIntent = (0, document_intents_1.detectDocumentFetchIntent)(inboundText);
            if (fetchIntent.matched) {
                await this.handleDocumentFetchRequest(ownerUid, remoteJid, remotePhone, fetchIntent.query);
                return true;
            }
        }
        return false;
    }
    async getUsablePendingDocumentDraft(ownerUid, remotePhone) {
        const draft = await (0, firestore_1.getActivePendingWhatsAppDocumentDraft)(ownerUid, remotePhone);
        if (!draft)
            return null;
        const expiresAt = Date.parse(draft.expiresAt);
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
            return draft;
        }
        logger_1.logger.info('DOC_PENDING_EXPIRED: cleaning expired document draft', {
            uid: ownerUid,
            phone: remotePhone,
            draftId: draft.id
        });
        await this.clearPendingDocumentDraft(draft);
        return null;
    }
    async clearPendingDocumentDraft(draft) {
        try {
            await (0, document_storage_1.deleteStoredDocument)(draft.storagePath);
        }
        catch (error) {
            logger_1.logger.warn('DOC_PENDING_DELETE_FILE_FAIL: failed to delete pending document file', {
                draftId: draft.id,
                storagePath: draft.storagePath,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
        try {
            await (0, firestore_1.deletePendingWhatsAppDocumentDraft)(draft.id);
        }
        catch (error) {
            logger_1.logger.warn('DOC_PENDING_DELETE_ROW_FAIL: failed to delete pending document row', {
                draftId: draft.id,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
    }
    buildDocumentMetadata(labelSource) {
        const cleaned = labelSource.trim().replace(/\s+/g, ' ');
        const title = cleaned.slice(0, 80);
        const description = cleaned.slice(0, 300);
        const normalizedTitle = (0, document_intents_1.normalizeDocumentText)(title);
        const normalizedDescription = (0, document_intents_1.normalizeDocumentText)(description);
        const searchTokens = [...new Set([
                ...(0, document_intents_1.tokenizeDocumentSearch)(title),
                ...(0, document_intents_1.tokenizeDocumentSearch)(description)
            ])];
        return {
            title,
            description,
            normalizedTitle,
            normalizedDescription,
            searchTokens
        };
    }
    async saveReadyDocumentFromImage(ownerUid, imageDataUrl, labelSource) {
        const metadata = this.buildDocumentMetadata(labelSource);
        logger_1.logger.info('DOC_SAVE_START', {
            uid: ownerUid,
            title: metadata.title
        });
        const upload = await (0, document_storage_1.uploadPendingDocument)(ownerUid, imageDataUrl);
        const documentId = (0, node_crypto_1.randomUUID)();
        let currentStoragePath = upload.storagePath;
        try {
            currentStoragePath = await (0, document_storage_1.finalizePendingDocumentMove)(ownerUid, upload.storagePath, documentId, upload.mimeType);
            await (0, firestore_1.createUserDocument)(ownerUid, {
                id: documentId,
                source: 'whatsapp',
                title: metadata.title,
                description: metadata.description,
                normalizedTitle: metadata.normalizedTitle,
                normalizedDescription: metadata.normalizedDescription,
                searchTokens: metadata.searchTokens,
                storagePath: currentStoragePath,
                mimeType: upload.mimeType,
                sizeBytes: upload.sizeBytes,
                status: 'ready'
            });
            logger_1.logger.info('DOC_SAVE_SUCCESS', {
                uid: ownerUid,
                documentId,
                storagePath: currentStoragePath,
                title: metadata.title,
                sizeBytes: upload.sizeBytes
            });
            return metadata.title;
        }
        catch (error) {
            try {
                await (0, document_storage_1.deleteStoredDocument)(currentStoragePath);
            }
            catch (cleanupError) {
                logger_1.logger.warn('DOC_SAVE_CLEANUP_FAIL: failed to cleanup storage after save error', {
                    storagePath: currentStoragePath,
                    error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
                });
            }
            throw error;
        }
    }
    async finalizePendingDocumentDraft(ownerUid, draft, labelSource) {
        const metadata = this.buildDocumentMetadata(labelSource);
        logger_1.logger.info('DOC_PENDING_FINALIZE_START', {
            uid: ownerUid,
            draftId: draft.id,
            title: metadata.title
        });
        const documentId = (0, node_crypto_1.randomUUID)();
        let movedToFinal = false;
        let finalStoragePath = draft.storagePath;
        try {
            finalStoragePath = await (0, document_storage_1.finalizePendingDocumentMove)(ownerUid, draft.storagePath, documentId, draft.mimeType);
            movedToFinal = true;
            await (0, firestore_1.createUserDocument)(ownerUid, {
                id: documentId,
                source: 'whatsapp',
                title: metadata.title,
                description: metadata.description,
                normalizedTitle: metadata.normalizedTitle,
                normalizedDescription: metadata.normalizedDescription,
                searchTokens: metadata.searchTokens,
                storagePath: finalStoragePath,
                mimeType: draft.mimeType,
                sizeBytes: draft.sizeBytes,
                status: 'ready'
            });
            await (0, firestore_1.deletePendingWhatsAppDocumentDraft)(draft.id);
            logger_1.logger.info('DOC_PENDING_FINALIZE_SUCCESS', {
                uid: ownerUid,
                draftId: draft.id,
                documentId,
                storagePath: finalStoragePath,
                title: metadata.title,
                sizeBytes: draft.sizeBytes
            });
            return metadata.title;
        }
        catch (error) {
            if (movedToFinal) {
                try {
                    await (0, document_storage_1.deleteStoredDocument)(finalStoragePath);
                }
                catch (cleanupError) {
                    logger_1.logger.warn('DOC_PENDING_FINALIZE_CLEANUP_FAIL: failed to cleanup moved file after error', {
                        storagePath: finalStoragePath,
                        error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
                    });
                }
                try {
                    await (0, firestore_1.deletePendingWhatsAppDocumentDraft)(draft.id);
                }
                catch (cleanupError) {
                    logger_1.logger.warn('DOC_PENDING_FINALIZE_ROW_FAIL: failed to cleanup pending draft after finalize error', {
                        draftId: draft.id,
                        error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
                    });
                }
            }
            throw error;
        }
    }
    async sendDocumentTextReply(ownerUid, remoteJid, remotePhone, reply, syntheticUserContent) {
        await this.sendWithRetry(remoteJid, reply, 'auto_reply', ownerUid);
        if (syntheticUserContent) {
            await this.appendConversationMessage(ownerUid, remotePhone, {
                role: 'user',
                content: syntheticUserContent
            });
        }
        await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: reply
        });
    }
    async handleExplicitDocumentSave(ownerUid, remoteJid, remotePhone, imageDataUrl, labelCandidate, existingDraft) {
        if (existingDraft) {
            await this.clearPendingDocumentDraft(existingDraft);
        }
        if (!(0, document_intents_1.isMeaningfulDocumentLabel)(labelCandidate)) {
            const upload = await (0, document_storage_1.uploadPendingDocument)(ownerUid, imageDataUrl);
            try {
                await (0, firestore_1.createPendingWhatsAppDocumentDraft)(ownerUid, remotePhone, {
                    id: upload.draftId,
                    storagePath: upload.storagePath,
                    mimeType: upload.mimeType,
                    sizeBytes: upload.sizeBytes,
                    expiresAt: new Date(Date.now() + DOCUMENT_PENDING_TTL_MS).toISOString(),
                    pendingReason: 'missing_title'
                });
            }
            catch (error) {
                try {
                    await (0, document_storage_1.deleteStoredDocument)(upload.storagePath);
                }
                catch (cleanupError) {
                    logger_1.logger.warn('DOC_PENDING_CREATE_CLEANUP_FAIL: failed to cleanup pending upload after DB error', {
                        storagePath: upload.storagePath,
                        error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
                    });
                }
                throw error;
            }
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, DOCUMENT_PENDING_PROMPT_REPLY, '[Arquivo pendente] aguardando nome');
            return;
        }
        const title = await this.saveReadyDocumentFromImage(ownerUid, imageDataUrl, labelCandidate);
        await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, buildDocumentSavedReply(title), `[Arquivo salvo] ${title}`);
    }
    async handlePendingDocumentFollowUp(ownerUid, remoteJid, remotePhone, inboundText, draft) {
        const normalized = (0, document_intents_1.normalizeDocumentText)(inboundText);
        if (normalized === 'cancelar' || normalized === 'cancela') {
            await this.clearPendingDocumentDraft(draft);
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, DOCUMENT_PENDING_CANCELLED_REPLY, '[Arquivo pendente] cancelado');
            return;
        }
        if (!(0, document_intents_1.isMeaningfulDocumentLabel)(inboundText)) {
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, DOCUMENT_PENDING_PROMPT_REPLY, '[Arquivo pendente] aguardando nome');
            return;
        }
        const title = await this.finalizePendingDocumentDraft(ownerUid, draft, inboundText);
        await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, buildDocumentSavedReply(title), `[Arquivo salvo] ${title}`);
    }
    scoreRecentDocuments(documents, query) {
        const normalizedQuery = (0, document_intents_1.normalizeDocumentText)(query);
        const queryTokens = [...new Set((0, document_intents_1.tokenizeDocumentSearch)(query))];
        const now = Date.now();
        return documents
            .map((document) => {
            let score = 0;
            const normalizedTitle = document.normalizedTitle;
            const normalizedDescription = document.normalizedDescription ?? '';
            const tokenSet = new Set(document.searchTokens);
            if (normalizedQuery) {
                if (normalizedTitle === normalizedQuery) {
                    score += 100;
                }
                else if (normalizedTitle.includes(normalizedQuery)) {
                    score += 60;
                }
            }
            for (const token of queryTokens) {
                if (normalizedTitle.includes(token))
                    score += 25;
                if (normalizedDescription.includes(token))
                    score += 15;
                if (tokenSet.has(token))
                    score += 10;
            }
            const createdAt = Date.parse(document.createdAt);
            if (Number.isFinite(createdAt) && now - createdAt <= DOCUMENT_RECENCY_BONUS_WINDOW_MS) {
                score += 10;
            }
            return { document, score };
        })
            .sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return b.document.createdAt.localeCompare(a.document.createdAt);
        });
    }
    async handleDocumentFetchRequest(ownerUid, remoteJid, remotePhone, query) {
        logger_1.logger.info('DOC_FETCH_START', {
            uid: ownerUid,
            phone: remotePhone,
            query
        });
        const documents = await (0, firestore_1.listRecentUserDocuments)(ownerUid, DOCUMENT_RECENT_LIMIT);
        if (documents.length === 0) {
            logger_1.logger.info('DOC_FETCH_NONE: user has no saved documents', {
                uid: ownerUid,
                phone: remotePhone
            });
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, 'Nao encontrei nenhum arquivo com esse nome ou descricao.', `[Arquivo solicitado] ${query || '(sem filtro)'}`);
            return;
        }
        const normalizedQuery = (0, document_intents_1.normalizeDocumentText)(query);
        let shouldSendDirect = false;
        let candidates = [];
        if (!normalizedQuery) {
            candidates = documents.map((document) => ({ document, score: 0 }));
            shouldSendDirect = documents.length === 1;
        }
        else {
            const ranked = this.scoreRecentDocuments(documents, query);
            const top = ranked[0];
            const second = ranked[1];
            const diffToSecond = top ? top.score - (second?.score ?? 0) : 0;
            if (!top || top.score < DOCUMENT_AMBIGUOUS_MIN_SCORE) {
                logger_1.logger.info('DOC_FETCH_NONE: no document reached minimum score', {
                    uid: ownerUid,
                    phone: remotePhone,
                    query,
                    topScore: top?.score ?? null
                });
                await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, 'Nao encontrei nenhum arquivo com esse nome ou descricao.', `[Arquivo solicitado] ${query}`);
                return;
            }
            if (top.score >= DOCUMENT_STRONG_MATCH_MIN_SCORE && diffToSecond >= DOCUMENT_RESULT_GAP_MIN) {
                shouldSendDirect = true;
                candidates = [top];
            }
            else {
                candidates = ranked.filter((entry) => entry.score >= DOCUMENT_AMBIGUOUS_MIN_SCORE).slice(0, 3);
            }
        }
        if (!shouldSendDirect && candidates.length === 0) {
            logger_1.logger.info('DOC_FETCH_NONE: no candidates after ranking', {
                uid: ownerUid,
                phone: remotePhone,
                query
            });
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, 'Nao encontrei nenhum arquivo com esse nome ou descricao.', `[Arquivo solicitado] ${query || '(sem filtro)'}`);
            return;
        }
        if (!shouldSendDirect) {
            const summary = candidates
                .slice(0, 3)
                .map((entry, index) => `${index + 1}) "${entry.document.title}"`)
                .join(' ');
            logger_1.logger.info('DOC_FETCH_AMBIGUOUS', {
                uid: ownerUid,
                phone: remotePhone,
                query,
                candidates: candidates.map((entry) => ({ title: entry.document.title, score: entry.score }))
            });
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, `Encontrei mais de um arquivo parecido: ${summary}. Me diga qual nome voce quer.`, `[Arquivo solicitado] ${query || '(sem filtro)'}`);
            return;
        }
        const selected = candidates[0]?.document;
        if (!selected) {
            logger_1.logger.info('DOC_FETCH_NONE: selected document missing after candidate selection', {
                uid: ownerUid,
                phone: remotePhone,
                query
            });
            await this.sendDocumentTextReply(ownerUid, remoteJid, remotePhone, 'Nao encontrei nenhum arquivo com esse nome ou descricao.', `[Arquivo solicitado] ${query || '(sem filtro)'}`);
            return;
        }
        const signedUrl = await (0, document_storage_1.createSignedDocumentUrl)(selected.storagePath);
        logger_1.logger.info('DOC_FETCH_MATCH', {
            uid: ownerUid,
            phone: remotePhone,
            query,
            documentId: selected.id,
            title: selected.title,
            storagePath: selected.storagePath
        });
        try {
            await (0, firestore_1.touchUserDocumentAccess)(ownerUid, selected.id);
        }
        catch (error) {
            logger_1.logger.warn('DOC_FETCH_TOUCH_FAIL: failed to update last accessed timestamp', {
                uid: ownerUid,
                documentId: selected.id,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
        const reply = `Aqui está: "${selected.title}".`;
        await this.sendWithRetry(remoteJid, reply, 'auto_reply', ownerUid, { image: { url: signedUrl } });
        logger_1.logger.info('DOC_FETCH_SEND_SUCCESS', {
            uid: ownerUid,
            phone: remotePhone,
            documentId: selected.id,
            title: selected.title
        });
        await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'user',
            content: `[Arquivo solicitado] ${query || selected.title}`
        });
        await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: `[Imagem Enviada] ${reply}`
        });
    }
    /**
     * Runs the full AI processing pipeline with logging at each step.
     * Extracted so the caller can wrap it in a global timeout.
     */
    async runAiPipeline(ownerUid, remotePhone, inboundText, imageDataUrl, audioDataUrl) {
        logger_1.logger.info('MSG_PIPELINE_START: loading conversation history', { uid: ownerUid, phone: remotePhone });
        // Invalidate cached conversation so we get fresh state from DB.
        // This is critical when multiple messages from the same user are
        // processed sequentially (after debounce) — each must see the
        // previous AI reply in the history.
        const cacheKey = this.conversationKey(ownerUid, (0, events_1.normalizePhoneNumber)(remotePhone));
        this.conversationByPhone.delete(cacheKey);
        const conversation = await this.getConversationHistory(ownerUid, remotePhone);
        const isFirstMessage = conversation.length === 0;
        const isGreeting = isGreetingMessage(inboundText);
        const isCapabilitiesQuestion = isCapabilitiesIntentMessage(inboundText);
        const lastActivityAt = await (0, firestore_1.getLastConversationActivityByPhone)(ownerUid, remotePhone);
        const isConversationRestart = this.isConversationRestart(lastActivityAt, isFirstMessage);
        const shouldSendCapabilitiesSummary = isGreeting || isFirstMessage || isConversationRestart || isCapabilitiesQuestion;
        if (isFirstMessage) {
            logger_1.logger.info('MSG_WELCOME: first message detected, AI will introduce itself', {
                uid: ownerUid,
                phone: remotePhone
            });
        }
        // Build AI messages from history (text only)
        const aiMessages = conversation.map((entry) => ({
            role: entry.role,
            content: entry.content
        }));
        // Always add the current message at the end with the image/audio if present
        let finalContent = inboundText.trim();
        if (!finalContent) {
            if (imageDataUrl)
                finalContent = IMAGE_ONLY_FALLBACK_TEXT;
            else if (audioDataUrl)
                finalContent = 'Transcreva e interprete o audio enviado, e execute a acao de registrar ou responder.';
        }
        aiMessages.push({
            role: 'user',
            content: finalContent,
            ...(imageDataUrl ? { imageDataUrl } : {}),
            ...(audioDataUrl ? { audioDataUrl } : {})
        });
        logger_1.logger.info('MSG_AI_CONTEXT: sending to AI', {
            historyCount: conversation.length,
            totalMessages: aiMessages.length,
            hasImage: Boolean(imageDataUrl),
            hasAudio: Boolean(audioDataUrl),
            isGreeting,
            isCapabilitiesQuestion,
            isConversationRestart,
            shouldSendCapabilitiesSummary
        });
        this.recordAiCall(ownerUid);
        logger_1.logger.info('MSG_PIPELINE_AI_CALL: calling processWhatsAppAIMessage', { uid: ownerUid });
        const aiReply = await (0, assistant_1.processWhatsAppAIMessage)(ownerUid, aiMessages, {
            isFirstMessage,
            isGreeting,
            isCapabilitiesQuestion,
            isConversationRestart,
            shouldSendCapabilitiesSummary,
            sourcePhone: remotePhone,
            latestUserMessageText: inboundText,
            imageOnlyWithoutDocumentIntent: Boolean(imageDataUrl) && !inboundText.trim()
        });
        logger_1.logger.info('MSG_PIPELINE_AI_DONE: AI response received', {
            uid: ownerUid,
            replyLength: aiReply.text.length,
            replyPreview: aiReply.text.slice(0, 80)
        });
        // Save user message AFTER AI processes — enrich media messages with AI-extracted context
        if (inboundText.trim() || imageDataUrl || audioDataUrl) {
            let textForHistory = inboundText.trim();
            if (!textForHistory && aiReply.text.trim()) {
                const mediaType = imageDataUrl ? 'Imagem' : 'Audio';
                const firstLine = aiReply.text.trim().split('\n').find((l) => l.replace(/[*_~`]/g, '').trim().length > 0) || '';
                const cleaned = firstLine.replace(/[*_~`]/g, '').trim().slice(0, 120);
                textForHistory = cleaned ? `[${mediaType}] ${cleaned}` : `${mediaType} enviado no WhatsApp.`;
            }
            else if (!textForHistory) {
                textForHistory = imageDataUrl ? 'Imagem enviada no WhatsApp.' : 'Audio enviado no WhatsApp.';
            }
            await this.appendConversationMessage(ownerUid, remotePhone, {
                role: 'user',
                content: textForHistory
            });
        }
        return { aiReply: aiReply.text, mediaUrl: aiReply.mediaUrl };
    }
    async sendAutoReply(remoteJid, ownerUid) {
        if (!this.socket || !this.connected)
            return false;
        if (!env_1.env.whatsappAutoReplyText.trim())
            return false;
        try {
            await this.sendWithRetry(remoteJid, env_1.env.whatsappAutoReplyText.trim(), 'auto_reply', ownerUid);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to send WhatsApp auto-reply', error);
            return false;
        }
    }
    startTypingPresence(remoteJid) {
        let stopped = false;
        const sendPresence = async (presence) => {
            if (!this.socket || !this.connected)
                return;
            try {
                await this.socket.sendPresenceUpdate(presence, remoteJid);
            }
            catch (error) {
                logger_1.logger.warn('Failed to update WhatsApp presence', {
                    presence,
                    remoteJid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        };
        void sendPresence('composing');
        const interval = setInterval(() => {
            if (stopped)
                return;
            void sendPresence('composing');
        }, COMPOSING_REFRESH_MS);
        return () => {
            if (stopped)
                return;
            stopped = true;
            clearInterval(interval);
            void sendPresence('paused');
        };
    }
    async sendWithRetry(jid, text, direction, ownerUid, customOptions) {
        if (!this.socket) {
            throw new Error('WhatsApp socket is not available');
        }
        let lastError;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                logger_1.logger.info('MSG_SEND: attempting WhatsApp send', {
                    slotId: this.slotId,
                    attempt,
                    jid,
                    ownerUid,
                    textLength: text.length
                });
                // Only assert sessions on RETRY to fix stale Signal keys.
                // On first attempt, skip to reduce latency — the session is
                // usually fine and Baileys handles re-keying automatically.
                if (attempt > 1) {
                    try {
                        await this.socket.assertSessions([jid], true);
                    }
                    catch (sessionError) {
                        logger_1.logger.warn('MSG_SEND: assertSessions failed (continuing anyway)', {
                            slotId: this.slotId,
                            jid,
                            error: sessionError instanceof Error ? sessionError.message : 'unknown'
                        });
                    }
                }
                const payload = customOptions?.image ? { image: { url: customOptions.image.url }, caption: text } : { text };
                const response = await this.socket.sendMessage(jid, payload);
                if (response?.key?.id && response.message) {
                    this.sentMessagesCache.set(response.key.id, response.message);
                    // Prevent memory leaks: cap cache at ~100 messages per instance
                    if (this.sentMessagesCache.size > 100) {
                        const firstKey = this.sentMessagesCache.keys().next().value;
                        if (firstKey)
                            this.sentMessagesCache.delete(firstKey);
                    }
                }
                const messageId = response?.key?.id ?? `generated_${Date.now()}`;
                const now = new Date().toISOString();
                const sentRecord = {
                    clientId: this.slotId,
                    messageId,
                    direction,
                    ...(ownerUid ? { ownerUid } : {}),
                    from: this.phone ?? '',
                    to: (0, events_1.jidToPhone)(jid),
                    text,
                    timestamp: now,
                    waTimestamp: null,
                    status: 'sent',
                    rawType: 'conversation',
                    createdAt: now,
                    metadata: {
                        fromMe: true,
                        isGroup: (0, events_1.isGroupJid)(jid),
                        hasImage: Boolean(customOptions?.image)
                    }
                };
                if (ownerUid) {
                    await (0, firestore_1.saveMessageSafe)(sentRecord);
                }
                logger_1.logger.info('MSG_SEND_OK: WhatsApp send succeeded', {
                    slotId: this.slotId,
                    jid,
                    ownerUid,
                    messageId
                });
                return { messageId };
            }
            catch (error) {
                lastError = error;
                if (attempt < 2) {
                    logger_1.logger.warn('WhatsApp send failed, retrying once', { attempt });
                    await sleep(700);
                    continue;
                }
            }
        }
        const failedRecord = {
            clientId: this.slotId,
            messageId: `failed_${Date.now()}`,
            direction,
            ...(ownerUid ? { ownerUid } : {}),
            from: this.phone ?? '',
            to: (0, events_1.jidToPhone)(jid),
            text,
            timestamp: new Date().toISOString(),
            waTimestamp: null,
            status: 'failed',
            rawType: 'conversation',
            createdAt: new Date().toISOString(),
            metadata: {
                fromMe: true,
                isGroup: (0, events_1.isGroupJid)(jid),
                hasImage: Boolean(customOptions?.image)
            }
        };
        if (ownerUid) {
            await (0, firestore_1.saveMessageSafe)(failedRecord);
        }
        throw lastError instanceof Error ? lastError : new Error('Failed to send WhatsApp message');
    }
    async setQr(qr) {
        this.qrText = qr;
        this.qrGeneratedAt = Date.now();
        this.state = 'connecting';
        this.connected = false;
        const qrPageUrl = env_1.env.backendUrl
            ? `${env_1.env.backendUrl}/api/whatsapp/qr-page?token=${env_1.env.whatsappApiToken}`
            : `/api/whatsapp/qr-page?token=${env_1.env.whatsappApiToken}`;
        logger_1.logger.info('==================================================');
        logger_1.logger.info(`  NOVO QR CODE DISPONIVEL [${this.displayName}] - abra no navegador:`);
        logger_1.logger.info(`  ${qrPageUrl}`);
        logger_1.logger.info('==================================================');
        // ASCII art apenas para referÃªncia em ambientes de terminal local
        qrcode_terminal_1.default.generate(qr, { small: true });
        try {
            this.qrDataUrl = await qrcode_1.default.toDataURL(qr);
            logger_1.logger.info('WhatsApp QR code updated', { slotId: this.slotId });
        }
        catch (error) {
            this.qrDataUrl = null;
            logger_1.logger.error('Failed to create QR data URL', error);
        }
    }
    clearQr() {
        this.qrText = null;
        this.qrDataUrl = null;
        this.qrGeneratedAt = null;
    }
    scheduleReconnect(delayMs = 2000) {
        if (this.reconnectTimer)
            return;
        logger_1.logger.info('Scheduling WhatsApp reconnect', { delayMs });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch((error) => {
                logger_1.logger.error('Reconnect attempt failed', error);
                this.scheduleReconnect();
            });
        }, delayMs);
    }
    clearReconnectTimer() {
        if (!this.reconnectTimer)
            return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
    async recoverFromInvalidSession() {
        if (this.recoveringInvalidSession) {
            return;
        }
        this.recoveringInvalidSession = true;
        try {
            this.clearReconnectTimer();
            this.clearAuthSyncTimer();
            this.authSyncQueued = false;
            this.lastAuthSnapshotHash = null;
            this.badMacByJid.clear();
            this.clearQr();
            this.phone = null;
            // Invalidate the current epoch so any pending events from the old
            // socket are silently ignored (prevents stale close events from
            // overwriting state after we create a new socket).
            this.connectionEpoch++;
            if (this.socket) {
                try {
                    this.socket.ev.removeAllListeners('connection.update');
                    this.socket.ev.removeAllListeners('creds.update');
                    this.socket.ev.removeAllListeners('messages.upsert');
                    this.socket.ev.removeAllListeners('messaging-history.set');
                    this.socket.ev.removeAllListeners('chats.phoneNumberShare');
                    this.socket.ev.removeAllListeners('contacts.upsert');
                    this.socket.ev.removeAllListeners('contacts.update');
                    this.socket.ws?.close();
                }
                catch {
                    // ignore cleanup errors
                }
                this.socket = null;
            }
            await (0, promises_1.rm)(this.authDir, { recursive: true, force: true });
            await (0, promises_1.mkdir)(this.authDir, { recursive: true });
            try {
                await (0, firestore_1.clearWhatsAppAuthSnapshot)(this.slotId);
            }
            catch (error) {
                logger_1.logger.error('Failed to clear invalid WhatsApp auth snapshot in Firestore', {
                    slotId: this.slotId,
                    error
                });
            }
            if (this.allowReconnect) {
                this.state = 'connecting';
                await this.connect();
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to recover from invalid WhatsApp session', error);
            if (this.allowReconnect) {
                this.scheduleReconnect();
            }
        }
        finally {
            this.recoveringInvalidSession = false;
        }
    }
    clearAuthSyncTimer() {
        if (!this.authSyncTimer)
            return;
        clearTimeout(this.authSyncTimer);
        this.authSyncTimer = null;
    }
    scheduleAuthStateSync(force = false) {
        this.clearAuthSyncTimer();
        const cooldownRemaining = Math.max(0, this.lastAuthSyncAt + AUTH_SYNC_MIN_INTERVAL_MS - Date.now());
        const waitMs = force ? 0 : Math.max(AUTH_SYNC_DEBOUNCE_MS, cooldownRemaining);
        this.authSyncTimer = setTimeout(() => {
            this.authSyncTimer = null;
            void this.syncAuthStateNow(force);
        }, waitMs);
    }
    async syncAuthStateNow(force = false) {
        if (this.authSyncInFlight) {
            this.authSyncQueued = true;
            if (force)
                this.authSyncQueuedForce = true;
            return;
        }
        if (!force && Date.now() - this.lastAuthSyncAt < AUTH_SYNC_MIN_INTERVAL_MS) {
            this.scheduleAuthStateSync(false);
            return;
        }
        this.authSyncInFlight = true;
        try {
            const files = await (0, promises_1.readdir)(this.authDir);
            const authFiles = files
                .filter((filename) => filename.endsWith('.json'))
                .sort((a, b) => a.localeCompare(b));
            if (authFiles.length === 0) {
                return;
            }
            const snapshotFiles = await Promise.all(authFiles.map(async (filename) => {
                const content = await (0, promises_1.readFile)((0, node_path_1.join)(this.authDir, filename));
                return {
                    filename,
                    contentBase64: content.toString('base64')
                };
            }));
            const hash = this.computeAuthSnapshotHash(snapshotFiles);
            if (hash === this.lastAuthSnapshotHash) {
                return;
            }
            await (0, firestore_1.saveWhatsAppAuthSnapshot)(this.slotId, snapshotFiles);
            this.lastAuthSnapshotHash = hash;
            this.lastAuthSyncAt = Date.now();
            logger_1.logger.info('WhatsApp auth snapshot synced to Firestore', {
                slotId: this.slotId,
                fileCount: snapshotFiles.length
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to sync WhatsApp auth snapshot', error);
        }
        finally {
            this.authSyncInFlight = false;
            if (this.authSyncQueued) {
                const queuedForce = this.authSyncQueuedForce;
                this.authSyncQueued = false;
                this.authSyncQueuedForce = false;
                this.scheduleAuthStateSync(queuedForce);
            }
        }
    }
    computeAuthSnapshotHash(files) {
        const hash = (0, node_crypto_1.createHash)('sha256');
        for (const file of files) {
            hash.update(file.filename);
            hash.update('\0');
            hash.update(file.contentBase64);
            hash.update('\0');
        }
        return hash.digest('hex');
    }
    async restoreAuthStateFromFirestoreIfNeeded() {
        const currentFiles = await (0, promises_1.readdir)(this.authDir);
        const hasLocalCreds = currentFiles.some((filename) => filename.includes('creds'));
        if (hasLocalCreds) {
            return;
        }
        const snapshotFiles = await (0, firestore_1.loadWhatsAppAuthSnapshot)(this.slotId);
        if (snapshotFiles.length === 0) {
            return;
        }
        let restoredCount = 0;
        for (const file of snapshotFiles) {
            const safeName = (0, node_path_1.basename)(file.filename);
            if (!safeName || safeName !== file.filename) {
                continue;
            }
            try {
                const payload = Buffer.from(file.contentBase64, 'base64');
                if (payload.length === 0)
                    continue;
                await (0, promises_1.writeFile)((0, node_path_1.join)(this.authDir, safeName), payload);
                restoredCount += 1;
            }
            catch (error) {
                logger_1.logger.warn('Skipping invalid WhatsApp auth snapshot file', {
                    file: safeName,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }
        if (restoredCount > 0) {
            logger_1.logger.info('Restored WhatsApp auth state from Firestore snapshot', {
                slotId: this.slotId,
                fileCount: restoredCount
            });
        }
    }
    async registerBadMac(message, errorMessage) {
        const key = message.key;
        const remoteJid = key?.remoteJid ?? 'unknown';
        const messageId = key?.id ?? 'unknown';
        const now = Date.now();
        const previous = this.badMacByJid.get(remoteJid);
        const count = previous && now - previous.lastAt <= BAD_MAC_WINDOW_MS
            ? previous.count + 1
            : 1;
        this.badMacByJid.set(remoteJid, { count, lastAt: now });
        logger_1.logger.warn('Bad MAC counter updated', {
            slotId: this.slotId,
            remoteJid,
            messageId,
            count,
            threshold: BAD_MAC_RECONNECT_THRESHOLD,
            softReconnectCount: this.softReconnectCount,
            reconnectCycleAfter: BAD_MAC_RECONNECT_CYCLE_AFTER,
            errorMessage
        });
        if (count < BAD_MAC_RECONNECT_THRESHOLD) {
            return;
        }
        this.badMacByJid.set(remoteJid, { count: 0, lastAt: now });
        await this.clearSignalSessionsAfterBadMac(message);
        // Repeated decrypt failures should not wipe the linked-device auth state.
        if (this.softReconnectCount >= BAD_MAC_RECONNECT_CYCLE_AFTER) {
            logger_1.logger.error('BAD_MAC_ESCALATION: repeated decrypt failures detected, preserving auth and recycling socket', {
                slotId: this.slotId,
                remoteJid,
                softReconnectCount: this.softReconnectCount
            });
            this.softReconnectCount = 0;
            this.triggerSoftReconnectAfterBadMac(remoteJid);
            return;
        }
        this.triggerSoftReconnectAfterBadMac(remoteJid);
    }
    hasLidIdentity(key) {
        const enriched = key;
        return Boolean(enriched.senderLid || enriched.participantLid);
    }
    extractBadMacPeerJids(message) {
        const key = message.key;
        if (!key)
            return [];
        const candidates = [key.remoteJid, key.participant, key.senderLid, key.participantLid];
        return [
            ...new Set(candidates.filter((jid) => typeof jid === 'string' &&
                jid.includes('@') &&
                !(0, events_1.isStatusJid)(jid) &&
                !(0, events_1.isGroupJid)(jid)))
        ];
    }
    async clearSignalSessionsAfterBadMac(message) {
        const socket = this.socket;
        if (!socket)
            return;
        const peerJids = this.extractBadMacPeerJids(message);
        if (peerJids.length === 0)
            return;
        const sessionsToClear = {};
        for (const jid of peerJids) {
            try {
                const signalAddress = socket.signalRepository.jidToSignalProtocolAddress(jid);
                sessionsToClear[signalAddress] = null;
            }
            catch (error) {
                logger_1.logger.warn('Failed deriving Signal address for Bad MAC session cleanup', {
                    slotId: this.slotId,
                    jid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
        }
        const sessionIds = Object.keys(sessionsToClear);
        if (sessionIds.length === 0)
            return;
        try {
            await socket.authState.keys.set({ session: sessionsToClear });
            this.scheduleAuthStateSync();
            logger_1.logger.warn('Cleared Signal sessions after repeated Bad MAC', {
                slotId: this.slotId,
                sessionIds,
                peerJids
            });
        }
        catch (error) {
            logger_1.logger.warn('Failed clearing Signal sessions after Bad MAC', {
                slotId: this.slotId,
                peerJids,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
    }
    resolveIncomingRemoteJid(key) {
        const enriched = key;
        const remoteJid = key.remoteJid ?? '';
        const candidates = [remoteJid, enriched.remoteJidAlt, enriched.participantPn, key.participant];
        for (const candidate of candidates) {
            const normalized = this.normalizePhoneJidCandidate(candidate);
            if (normalized) {
                if (remoteJid.endsWith('@lid')) {
                    this.rememberLidMapping(remoteJid, normalized, 'message_candidate');
                }
                return normalized;
            }
        }
        if (remoteJid.endsWith('@lid')) {
            // Try exact match first, then try base LID (without device suffix)
            const exact = this.lidToPhoneJid.get(remoteJid);
            if (exact)
                return exact;
            const baseLid = remoteJid.replace(/:\d+@lid$/, '@lid');
            if (baseLid !== remoteJid) {
                const baseMatch = this.lidToPhoneJid.get(baseLid);
                if (baseMatch)
                    return baseMatch;
            }
            // Search for any key that shares the same base LID number
            const lidNumber = remoteJid.split('@')[0].split(':')[0];
            for (const [key, value] of this.lidToPhoneJid.entries()) {
                if (key.startsWith(lidNumber))
                    return value;
            }
            return remoteJid;
        }
        return remoteJid;
    }
    normalizePhoneJidCandidate(jid) {
        if (!jid)
            return null;
        if ((0, events_1.isStatusJid)(jid) || (0, events_1.isGroupJid)(jid) || jid.endsWith('@lid'))
            return null;
        const phone = (0, events_1.jidToPhone)(jid);
        // Accept only Brazilian-like personal numbers (10-13 digits with/without country code).
        if (phone.length < 10 || phone.length > 13)
            return null;
        try {
            return (0, events_1.normalizePhoneToJid)(phone);
        }
        catch {
            return null;
        }
    }
    rememberLidMapping(lidJid, phoneJid, source) {
        if (!lidJid || !lidJid.endsWith('@lid'))
            return;
        const normalizedPhoneJid = this.normalizePhoneJidCandidate(phoneJid);
        if (!normalizedPhoneJid)
            return;
        // Normalize LID: strip device suffix (e.g. "71756035416162:47@lid" → "71756035416162@lid")
        // WhatsApp sends LID with device suffix in CB:message but without suffix in message.key.remoteJid
        const baseLidJid = lidJid.replace(/:\d+@lid$/, '@lid');
        // Store under BOTH the original key and the base key so lookups always succeed
        const previous = this.lidToPhoneJid.get(baseLidJid);
        this.lidToPhoneJid.set(baseLidJid, normalizedPhoneJid);
        if (baseLidJid !== lidJid) {
            this.lidToPhoneJid.set(lidJid, normalizedPhoneJid);
        }
        if (previous !== normalizedPhoneJid) {
            logger_1.logger.info('LID mapping updated', {
                slotId: this.slotId,
                source,
                lidJid,
                baseLidJid,
                phoneJid: normalizedPhoneJid
            });
        }
        // Replay buffered messages that were waiting for this LID mapping
        this.replayBufferedLidMessages(baseLidJid);
        if (baseLidJid !== lidJid) {
            this.replayBufferedLidMessages(lidJid);
        }
    }
    absorbContactLidMappings(contacts, source) {
        let mappedCount = 0;
        for (const contact of contacts) {
            const contactId = contact.id ?? null;
            const lidRaw = contact.lid ?? null;
            // Determine which field is the LID and which is the phone JID.
            // Baileys may provide:
            //   Case A: id = "55...@s.whatsapp.net", lid = "123...@lid"  (most common)
            //   Case B: id = "123...@lid",           lid = null          (LID-only contact)
            //   Case C: id = "55...@s.whatsapp.net", lid = "123..."      (raw LID without @)
            let lidJid = null;
            let phoneJid = null;
            // Parse the explicit lid field
            if (lidRaw) {
                lidJid = lidRaw.includes('@') ? lidRaw : `${lidRaw}@lid`;
            }
            // Parse the id field
            if (contactId) {
                if (contactId.endsWith('@lid')) {
                    // id is a LID — use it as lidJid if we don't have one from the lid field
                    if (!lidJid)
                        lidJid = contactId;
                }
                else if (contactId.endsWith('@s.whatsapp.net')) {
                    phoneJid = contactId;
                }
            }
            if (lidJid && phoneJid) {
                this.rememberLidMapping(lidJid, phoneJid, source);
                mappedCount++;
            }
        }
        if (mappedCount > 0) {
            logger_1.logger.info('LID_ABSORB: absorbed contact LID mappings', {
                slotId: this.slotId,
                source,
                totalContacts: contacts.length,
                mappedCount,
                totalKnownMappings: this.lidToPhoneJid.size
            });
        }
    }
    /**
     * Buffer a message whose remoteJid is an unresolved @lid.
     * When the LID→phone mapping arrives (via contacts.upsert, phone_number_share, etc.),
     * `replayBufferedLidMessages` will re-enqueue them.
     */
    bufferLidMessage(lidJid, message) {
        const now = Date.now();
        let entries = this.pendingLidMessages.get(lidJid);
        if (!entries) {
            entries = [];
            this.pendingLidMessages.set(lidJid, entries);
        }
        // Evict expired entries
        const fresh = entries.filter((e) => now - e.bufferedAt < LID_BUFFER_TTL_MS);
        // Cap per-JID buffer to avoid memory leaks
        if (fresh.length >= LID_BUFFER_MAX_PER_JID) {
            logger_1.logger.warn('LID buffer full for JID, dropping oldest', {
                slotId: this.slotId,
                lidJid,
                dropped: fresh[0]?.message.key?.id
            });
            fresh.shift();
        }
        fresh.push({ message, bufferedAt: now });
        this.pendingLidMessages.set(lidJid, fresh);
    }
    /**
     * When a LID→phone mapping arrives, replay any buffered messages for that LID.
     * The messages are re-enqueued into the normal processing queue.
     */
    replayBufferedLidMessages(lidJid) {
        const entries = this.pendingLidMessages.get(lidJid);
        if (!entries || entries.length === 0)
            return;
        this.pendingLidMessages.delete(lidJid);
        const validEntries = entries.filter((e) => Date.now() - e.bufferedAt < LID_BUFFER_TTL_MS);
        if (validEntries.length === 0)
            return;
        logger_1.logger.info('LID_REPLAY: replaying buffered messages after LID mapping resolved', {
            slotId: this.slotId,
            lidJid,
            resolvedTo: this.lidToPhoneJid.get(lidJid) ?? 'unknown',
            count: validEntries.length,
            messageIds: validEntries.map((e) => e.message.key?.id ?? 'unknown')
        });
        for (const entry of validEntries) {
            this.enqueueMessage(entry.message);
        }
    }
    /**
     * Actively request phone number resolution for an unresolved LID JID.
     * Uses multiple strategies:
     * 1. presenceSubscribe — subscribing to the LID's presence can trigger contacts.upsert
     * 2. readMessages — reading the message triggers Baileys' retry mechanism where sender_pn
     *    appears in the retry receipt node attributes
     * 3. fetchStatus — fetching status may trigger contact resolution events
     * 4. Delayed retry — re-check the mapping after a delay
     */
    requestPhoneForLidJid(lidJid, message) {
        if (!this.socket || this.lidToPhoneJid.has(lidJid))
            return;
        const socket = this.socket;
        const slotId = this.slotId;
        void (async () => {
            // Strategy 1: Subscribe to presence — may trigger contacts.upsert with LID→phone
            try {
                await socket.presenceSubscribe(lidJid);
                logger_1.logger.info('LID_RESOLVE_SUBSCRIBE: subscribed to LID presence', { slotId, lidJid });
            }
            catch (error) {
                logger_1.logger.warn('LID_RESOLVE_SUBSCRIBE: failed (best-effort)', {
                    slotId,
                    lidJid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
            // Strategy 2: Read/acknowledge the message — triggers Baileys retry mechanism
            // which reveals sender_pn in the retry receipt (captured by our CB:receipt hook)
            if (message?.key) {
                try {
                    await socket.readMessages([message.key]);
                    logger_1.logger.info('LID_RESOLVE_READ: sent read receipt to trigger retry with sender_pn', { slotId, lidJid });
                }
                catch (error) {
                    logger_1.logger.warn('LID_RESOLVE_READ: failed (best-effort)', {
                        slotId,
                        lidJid,
                        error: error instanceof Error ? error.message : 'unknown'
                    });
                }
            }
            // Strategy 3: Fetch status — may trigger contact events
            try {
                await socket.fetchStatus(lidJid);
                logger_1.logger.info('LID_RESOLVE_STATUS: fetched status for LID', { slotId, lidJid });
            }
            catch (error) {
                logger_1.logger.warn('LID_RESOLVE_STATUS: failed (best-effort)', {
                    slotId,
                    lidJid,
                    error: error instanceof Error ? error.message : 'unknown'
                });
            }
            // Strategy 4: Delayed retry — check if the mapping arrived after 5 seconds
            await sleep(5000);
            if (this.lidToPhoneJid.has(lidJid)) {
                logger_1.logger.info('LID_RESOLVE_DELAYED: mapping resolved, triggering replay', { slotId, lidJid });
                this.replayBufferedLidMessages(lidJid);
            }
            else {
                // Try again after 15 seconds total
                await sleep(10_000);
                if (this.lidToPhoneJid.has(lidJid)) {
                    logger_1.logger.info('LID_RESOLVE_DELAYED_2: mapping resolved on second check', { slotId, lidJid });
                    this.replayBufferedLidMessages(lidJid);
                }
                else {
                    // FALLBACK: Search for any existing mapping that shares the same base LID number.
                    // CB_MESSAGE_SENDER_PN stores with device suffix (e.g. "123:47@lid")
                    // but handleSingleIncomingMessage looks up base form ("123@lid").
                    const lidNumber = lidJid.split('@')[0].split(':')[0];
                    let fallbackPhone;
                    for (const [key, value] of this.lidToPhoneJid.entries()) {
                        if (key.startsWith(lidNumber)) {
                            fallbackPhone = value;
                            break;
                        }
                    }
                    if (fallbackPhone) {
                        logger_1.logger.info('LID_RESOLVE_FALLBACK: found phone via prefix scan of stored mappings', {
                            slotId,
                            lidJid,
                            lidNumber,
                            resolvedPhone: fallbackPhone
                        });
                        // Store the mapping under the base LID so future lookups succeed
                        this.lidToPhoneJid.set(lidJid, fallbackPhone);
                        this.replayBufferedLidMessages(lidJid);
                    }
                    else {
                        logger_1.logger.warn('LID_RESOLVE_FAILED: could not resolve LID after all strategies', {
                            slotId,
                            lidJid,
                            pendingCount: this.pendingLidMessages.get(lidJid)?.length ?? 0,
                            knownMappings: this.lidToPhoneJid.size
                        });
                    }
                }
            }
        })();
    }
    /**
     * Try to extract phone number information from any available field in the message.
     * Even when Bad MAC prevents decryption, some metadata fields may contain
     * phone numbers that we can use to build LID→phone mappings.
     */
    tryExtractPhoneFromMessageMeta(message) {
        const key = message.key;
        if (!key)
            return;
        const lidJid = key.remoteJid;
        if (!lidJid || !lidJid.endsWith('@lid'))
            return;
        // Check all known fields that may contain phone numbers
        const phoneCandidates = [
            key.participantPn,
            key.remoteJidAlt,
            key.participant
        ];
        // Baileys may include userReceipt with phone JIDs
        const msgAny = message;
        if (Array.isArray(msgAny.userReceipt)) {
            for (const receipt of msgAny.userReceipt) {
                if (receipt?.userJid)
                    phoneCandidates.push(receipt.userJid);
            }
        }
        // messageStubParameters may also contain phone numbers
        if (Array.isArray(message.messageStubParameters)) {
            for (const param of message.messageStubParameters) {
                if (typeof param === 'string' && param.includes('@s.whatsapp.net')) {
                    phoneCandidates.push(param);
                }
            }
        }
        // Log all available data for debugging
        logger_1.logger.info('MSG_META_EXTRACT: scanning message for phone info', {
            slotId: this.slotId,
            lidJid,
            candidatesFound: phoneCandidates.filter(Boolean).length,
            participantPn: key.participantPn ?? null,
            remoteJidAlt: key.remoteJidAlt ?? null,
            participant: key.participant ?? null,
            messageId: key.id ?? 'unknown'
        });
        for (const candidate of phoneCandidates) {
            if (!candidate)
                continue;
            const normalized = this.normalizePhoneJidCandidate(candidate);
            if (normalized) {
                this.rememberLidMapping(lidJid, normalized, 'message_candidate');
                return;
            }
        }
    }
    triggerSoftReconnectAfterBadMac(remoteJid) {
        if (!this.allowReconnect)
            return;
        if (this.reconnectTimer)
            return;
        this.softReconnectCount += 1;
        logger_1.logger.warn('Triggering soft reconnect after repeated Bad MAC', {
            slotId: this.slotId,
            remoteJid,
            softReconnectCount: this.softReconnectCount
        });
        this.connected = false;
        this.state = 'connecting';
        this.lastDisconnectReason = 'bad_mac_reconnect';
        this.connectionEpoch++;
        try {
            if (this.socket) {
                this.socket.ev.removeAllListeners('connection.update');
                this.socket.ev.removeAllListeners('creds.update');
                this.socket.ev.removeAllListeners('messages.upsert');
                this.socket.ev.removeAllListeners('messaging-history.set');
                this.socket.ev.removeAllListeners('chats.phoneNumberShare');
                this.socket.ev.removeAllListeners('contacts.upsert');
                this.socket.ev.removeAllListeners('contacts.update');
                this.socket.ws?.close();
            }
        }
        catch (error) {
            logger_1.logger.warn('Failed closing websocket during soft reconnect', {
                slotId: this.slotId,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
        this.socket = null;
        this.scheduleReconnect(1500);
    }
    mapDisconnectReason(code) {
        if (code === null)
            return 'unknown';
        if (code === baileys_1.DisconnectReason.loggedOut)
            return 'logged_out';
        if (code === baileys_1.DisconnectReason.connectionClosed)
            return 'connection_closed';
        if (code === baileys_1.DisconnectReason.connectionLost)
            return 'connection_lost';
        if (code === baileys_1.DisconnectReason.connectionReplaced)
            return 'connection_replaced';
        if (code === baileys_1.DisconnectReason.timedOut)
            return 'connection_timed_out';
        if (code === baileys_1.DisconnectReason.multideviceMismatch)
            return 'multidevice_mismatch';
        if (code === baileys_1.DisconnectReason.restartRequired)
            return 'restart_required';
        if (code === baileys_1.DisconnectReason.badSession)
            return 'bad_session';
        if (code === baileys_1.DisconnectReason.forbidden)
            return 'forbidden';
        if (code === baileys_1.DisconnectReason.unavailableService)
            return 'unavailable_service';
        return `code_${code}`;
    }
    alreadyProcessedInbound(messageId) {
        return this.processedInboundIds.has(messageId);
    }
    rememberInbound(messageId) {
        if (this.processedInboundIds.has(messageId))
            return;
        this.processedInboundIds.add(messageId);
        this.processedInboundOrder.push(messageId);
        if (this.processedInboundOrder.length > 5000) {
            const oldest = this.processedInboundOrder.shift();
            if (oldest)
                this.processedInboundIds.delete(oldest);
        }
    }
    isRateLimited(uid) {
        const now = Date.now();
        const timestamps = this.aiCallTimestamps.get(uid);
        if (!timestamps)
            return false;
        // Keep only timestamps within the last 60 seconds
        const recent = timestamps.filter((t) => now - t < 60_000);
        this.aiCallTimestamps.set(uid, recent);
        return recent.length >= env_1.env.whatsappAiRateLimitPerMinute;
    }
    recordAiCall(uid) {
        const timestamps = this.aiCallTimestamps.get(uid) ?? [];
        timestamps.push(Date.now());
        this.aiCallTimestamps.set(uid, timestamps);
    }
    async handleUnlinkedMessage(remoteJid, remotePhone) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(remotePhone);
        const reply = buildRegistrationRequiredReply();
        try {
            await this.sendWithRetry(remoteJid, reply, 'auto_reply');
            logger_1.logger.info('Sent registration guidance to unlinked WhatsApp number', {
                from: normalizedPhone
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to send registration guidance to unlinked WhatsApp number', {
                from: normalizedPhone,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
    }
    getMediaDownloadContext() {
        const socket = this.socket;
        if (!socket)
            return undefined;
        return {
            reuploadRequest: socket.updateMediaMessage,
            logger: socket.logger
        };
    }
    async extractInboundImageDataUrl(message) {
        if (!(0, events_1.isImageMessage)(message))
            return null;
        const mimeType = (0, events_1.getImageMimeType)(message) || 'image/jpeg';
        try {
            const mediaBuffer = await (0, baileys_1.downloadMediaMessage)(message, 'buffer', {}, this.getMediaDownloadContext());
            if (!mediaBuffer || mediaBuffer.length === 0) {
                return null;
            }
            if (mediaBuffer.length > env_1.env.whatsappAiImageMaxBytes) {
                logger_1.logger.warn('Ignoring inbound image because it exceeds max size', {
                    size: mediaBuffer.length,
                    maxAllowed: env_1.env.whatsappAiImageMaxBytes
                });
                return null;
            }
            const base64 = mediaBuffer.toString('base64');
            return `data:${mimeType};base64,${base64}`;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : '';
            if (errorMsg.includes('Bad MAC')) {
                await this.registerBadMac(message, errorMsg);
            }
            if (isExpectedMediaDecryptError(error)) {
                logger_1.logger.warn('Skipping inbound image due to decrypt failure', {
                    slotId: this.slotId,
                    messageId: message.key?.id ?? 'unknown',
                    error: errorMsg || 'unknown'
                });
            }
            else {
                logger_1.logger.error('Failed to download inbound WhatsApp image', error);
            }
            return null;
        }
    }
    async extractInboundAudioDataUrl(message) {
        const rawType = (0, events_1.extractRawType)(message);
        const isAudio = (0, events_1.isAudioMessage)(message);
        logger_1.logger.info('AUDIO_EXTRACT_START', { messageId: message.key.id, rawType, isAudio });
        if (!isAudio)
            return null;
        const mimeType = (0, events_1.getAudioMimeType)(message) || 'audio/ogg';
        try {
            const mediaBuffer = await (0, baileys_1.downloadMediaMessage)(message, 'buffer', {}, this.getMediaDownloadContext());
            if (!mediaBuffer || mediaBuffer.length === 0) {
                logger_1.logger.warn('AUDIO_EXTRACT_FAIL: buffer is empty');
                return null;
            }
            // Max 10MB for audio
            const maxAudioBytes = 10 * 1024 * 1024;
            if (mediaBuffer.length > maxAudioBytes) {
                logger_1.logger.warn('AUDIO_EXTRACT_FAIL: exceeds max size', {
                    size: mediaBuffer.length,
                    maxAllowed: maxAudioBytes
                });
                return null;
            }
            const base64 = mediaBuffer.toString('base64');
            logger_1.logger.info('AUDIO_EXTRACT_SUCCESS', { size: mediaBuffer.length, mimeType });
            return `data:${mimeType};base64,${base64}`;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : '';
            if (errorMsg.includes('Bad MAC')) {
                await this.registerBadMac(message, errorMsg);
            }
            if (isExpectedMediaDecryptError(error)) {
                logger_1.logger.warn('AUDIO_EXTRACT_SKIP: decrypt failure on inbound audio', {
                    slotId: this.slotId,
                    messageId: message.key?.id ?? 'unknown',
                    error: errorMsg || 'unknown'
                });
            }
            else {
                logger_1.logger.error('AUDIO_EXTRACT_ERROR: Failed to download inbound WhatsApp audio', error);
            }
            return null;
        }
    }
    async getConversationHistory(uid, phone) {
        if (!uid || uid.trim().length === 0)
            return [];
        const normalized = (0, events_1.normalizePhoneNumber)(phone);
        if (normalized.length < 10)
            return [];
        const cacheKey = this.conversationKey(uid, normalized);
        const cached = this.conversationByPhone.get(cacheKey);
        if (cached)
            return cached;
        try {
            const loaded = await (0, firestore_1.getRecentConversationByPhone)(uid, normalized, env_1.env.whatsappAiHistoryLimit);
            this.conversationByPhone.set(cacheKey, loaded);
            return loaded;
        }
        catch (error) {
            logger_1.logger.warn('Failed to load WhatsApp conversation history (will retry next message)', error);
            // Do NOT cache empty on error — allow retry on next message (e.g. index still building)
            return [];
        }
    }
    async appendConversationMessage(uid, phone, message) {
        if (!uid || uid.trim().length === 0)
            return;
        const normalized = (0, events_1.normalizePhoneNumber)(phone);
        if (normalized.length < 10)
            return;
        const content = message.content.trim().slice(0, 800);
        if (!content)
            return;
        const current = await this.getConversationHistory(uid, normalized);
        const updated = [...current, { role: message.role, content }].slice(-env_1.env.whatsappAiHistoryLimit);
        this.conversationByPhone.set(this.conversationKey(uid, normalized), updated);
    }
    isConversationRestart(lastActivityAt, isFirstMessage) {
        if (isFirstMessage)
            return true;
        if (!lastActivityAt)
            return false;
        const parsed = Date.parse(lastActivityAt);
        if (!Number.isFinite(parsed))
            return false;
        const elapsedMinutes = (Date.now() - parsed) / (60 * 1000);
        return elapsedMinutes >= env_1.env.whatsappAiNewConversationMinutes;
    }
    conversationKey(uid, phone) {
        // Shared across slots so conversation context is not lost when messages arrive on a different number
        return `${uid}:${phone}`;
    }
}
exports.WhatsAppClient = WhatsAppClient;
