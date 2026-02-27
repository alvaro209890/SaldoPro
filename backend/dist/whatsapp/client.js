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
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const events_1 = require("./events");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isExpectedMediaDecryptError(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
    return message.includes('bad decrypt') || message.includes('bad mac');
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
const UNDO_KEYWORDS = ['desfaz', 'desfazer', 'desfaca', 'cancela', 'cancelar', 'errou', 'errei', 'anula', 'anular', 'desfizer'];
function isUndoMessage(text) {
    const normalized = normalizeForGreeting(text);
    if (!normalized || normalized.length > 120)
        return false;
    return UNDO_KEYWORDS.some((kw) => normalized.includes(kw));
}
const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada e registre o lancamento corretamente.';
/** Max number of messages processed concurrently by the AI pipeline. */
const MESSAGE_QUEUE_CONCURRENCY = 3;
/** Refresh typing presence periodically while AI processing is running. */
const COMPOSING_REFRESH_MS = 4000;
/** If the same JID hits repeated Bad MAC in a short window, perform a soft reconnect. */
const BAD_MAC_WINDOW_MS = 2 * 60 * 1000;
const BAD_MAC_RECONNECT_THRESHOLD = 1;
/** After this many soft reconnects without success, escalate to full session reset. */
const BAD_MAC_HARD_RESET_AFTER = 2;
/** How long to keep unresolvable-LID messages buffered before discarding. */
const LID_BUFFER_TTL_MS = 30_000;
const LID_BUFFER_MAX_PER_JID = 5;
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
    sentByBotIds = new Set();
    sentByBotOrder = [];
    conversationByPhone = new Map();
    badMacByJid = new Map();
    lidToPhoneJid = new Map();
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
    async sendText(to, text, ownerUid) {
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
        const jid = (0, events_1.normalizePhoneToJid)(to);
        const result = await this.sendWithRetry(jid, normalizedText, 'outbound', ownerUid);
        if (ownerUid) {
            await this.appendConversationMessage(ownerUid, (0, events_1.jidToPhone)(jid), {
                role: 'assistant',
                content: normalizedText
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
            try {
                await this.socket.logout();
            }
            catch (error) {
                logger_1.logger.warn('Socket logout failed during reset', error);
            }
            try {
                this.socket.ev.removeAllListeners('connection.update');
                this.socket.ev.removeAllListeners('creds.update');
                this.socket.ev.removeAllListeners('messages.upsert');
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
            browser: [`SaldoPro-${this.slotId.toUpperCase()}`, 'Render', '1.0.0']
        });
        this.socket = socket;
        socket.ev.on('creds.update', () => {
            if (this.connectionEpoch !== epoch)
                return;
            void saveCreds();
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
        if (upsert.type !== 'notify')
            return;
        for (const message of upsert.messages) {
            this.enqueueMessage(message);
        }
    }
    /**
     * Enqueue a message for processing with bounded concurrency.
     * Up to MESSAGE_QUEUE_CONCURRENCY messages are processed in parallel;
     * the rest wait in the queue until a slot opens.
     */
    enqueueMessage(message) {
        const task = async () => {
            try {
                await this.handleSingleIncomingMessage(message);
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : '';
                if (errorMsg.includes('Bad MAC')) {
                    // Bad MAC is often transient/noisy (e.g. status updates), do not nuke auth session.
                    const remoteJid = message.key?.remoteJid ?? 'unknown';
                    const messageId = message.key?.id ?? 'unknown';
                    await this.registerBadMac(message, errorMsg);
                    logger_1.logger.warn('Bad MAC decryption error detected; ignoring message without session reset', {
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
    async handleSingleIncomingMessage(message) {
        const key = message.key;
        if (!key)
            return;
        const messageId = key.id ?? '';
        if (!messageId)
            return;
        if (this.alreadyProcessedInbound(messageId))
            return;
        const remoteJid = this.resolveIncomingRemoteJid(key);
        if (!remoteJid || (0, events_1.isStatusJid)(remoteJid) || (0, events_1.isGroupJid)(remoteJid))
            return;
        if (remoteJid.endsWith('@lid')) {
            // Buffer the message — do NOT mark as processed so it can be replayed
            this.bufferLidMessage(remoteJid, message);
            logger_1.logger.warn('MSG_BUFFER: unresolved LID remoteJid, buffered for retry', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                fromMe: Boolean(key.fromMe),
                pendingCount: this.pendingLidMessages.get(remoteJid)?.length ?? 0
            });
            return;
        }
        if (!message.message && this.hasLidIdentity(key)) {
            await this.registerBadMac(message, 'empty_payload_with_lid');
            // Try to extract any phone number info from the message metadata for LID mapping
            this.tryExtractPhoneFromMessageMeta(message);
            this.rememberInbound(messageId);
            logger_1.logger.warn('MSG_SKIP: missing payload with LID identity (Bad MAC decrypt failure)', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                fromMe: Boolean(key.fromMe),
                softReconnectCount: this.softReconnectCount,
                allKeyFields: JSON.stringify(Object.keys(key))
            });
            return;
        }
        // Also handle non-LID messages with empty payload (Bad MAC without LID)
        if (!message.message) {
            this.rememberInbound(messageId);
            logger_1.logger.warn('MSG_SKIP: empty message payload (likely decryption failure)', {
                slotId: this.slotId,
                messageId,
                remoteJid,
                fromMe: Boolean(key.fromMe)
            });
            return;
        }
        // Self-chat detection: compare via phone number AND via the socket's own LID
        const isSelfChatByPhone = (0, events_1.jidToPhone)(remoteJid) === this.phone;
        const isSelfChatByLid = this.isOwnLid(key.remoteJid ?? '');
        const isSelfChat = isSelfChatByPhone || isSelfChatByLid;
        if (key.fromMe) {
            if (!isSelfChat || this.sentByBotIds.has(messageId)) {
                logger_1.logger.info('MSG_SKIP: fromMe message blocked', {
                    messageId,
                    reason: this.sentByBotIds.has(messageId) ? 'sent_by_bot' : 'not_self_chat',
                    remoteJid,
                    isSelfChatByPhone,
                    isSelfChatByLid,
                    selfPhone: this.phone,
                    remotePhone: (0, events_1.jidToPhone)(remoteJid)
                });
                return;
            }
            logger_1.logger.info('MSG_SELF: processing self-chat message for AI testing', {
                messageId,
                phone: this.phone,
                isSelfChatByPhone,
                isSelfChatByLid
            });
        }
        const remotePhone = isSelfChat ? (this.phone ?? (0, events_1.jidToPhone)(remoteJid)) : (0, events_1.jidToPhone)(remoteJid);
        logger_1.logger.info('MSG_RECV: new inbound message', {
            messageId,
            from: remotePhone,
            fromMe: Boolean(key.fromMe),
            isSelfChat,
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
        const imageDataUrl = await this.extractInboundImageDataUrl(message);
        const audioDataUrl = await this.extractInboundAudioDataUrl(message);
        const conversationText = text.trim() || (imageDataUrl ? IMAGE_ONLY_FALLBACK_TEXT : '') || (audioDataUrl ? 'Audio enviado no WhatsApp.' : '');
        // Skip messages with no usable content (e.g. decryption failures)
        if (!conversationText && !imageDataUrl && !audioDataUrl) {
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
            logger_1.logger.info('MSG_UNLINKED: no binding found or allowed, ignoring message', { from: remotePhone });
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
                isSelfChat,
                hasImage: Boolean(imageDataUrl),
                hasAudio: Boolean(audioDataUrl)
            }
        };
        await (0, firestore_1.saveMessageSafe)(inboundRecord);
        this.rememberInbound(messageId);
        logger_1.logger.info('MSG_AI: sending to AI for reply', {
            uid: binding.uid,
            phone: remotePhone,
            textLength: conversationText.length,
            hasImage: Boolean(imageDataUrl),
            hasAudio: Boolean(audioDataUrl)
        });
        await this.sendSmartReply(binding.uid, remoteJid, remotePhone, conversationText, imageDataUrl, audioDataUrl);
    }
    async sendSmartReply(ownerUid, remoteJid, remotePhone, inboundText, imageDataUrl, audioDataUrl = null) {
        const hasAiInput = inboundText.trim().length > 0 || Boolean(imageDataUrl) || Boolean(audioDataUrl);
        if (env_1.env.whatsappAiEnabled && hasAiInput) {
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
    /**
     * Runs the full AI processing pipeline with logging at each step.
     * Extracted so the caller can wrap it in a global timeout.
     */
    async runAiPipeline(ownerUid, remotePhone, inboundText, imageDataUrl, audioDataUrl) {
        logger_1.logger.info('MSG_PIPELINE_START: loading conversation history', { uid: ownerUid, phone: remotePhone });
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
                finalContent = 'Analise a imagem enviada e registre o lançamento corretamente.';
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
            shouldSendCapabilitiesSummary
        });
        logger_1.logger.info('MSG_PIPELINE_AI_DONE: AI response received', {
            uid: ownerUid,
            replyLength: aiReply.length,
            replyPreview: aiReply.slice(0, 80)
        });
        // Save user message AFTER AI processes — enrich media messages with AI-extracted context
        if (inboundText.trim() || imageDataUrl || audioDataUrl) {
            let textForHistory = inboundText.trim();
            if (!textForHistory && aiReply.trim()) {
                const mediaType = imageDataUrl ? 'Imagem' : 'Audio';
                const firstLine = aiReply.trim().split('\n').find((l) => l.replace(/[*_~`]/g, '').trim().length > 0) || '';
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
        return { aiReply };
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
    async sendWithRetry(jid, text, direction, ownerUid) {
        if (!this.socket) {
            throw new Error('WhatsApp socket is not available');
        }
        let lastError;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const response = await this.socket.sendMessage(jid, { text });
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
                        isGroup: (0, events_1.isGroupJid)(jid)
                    }
                };
                if (ownerUid) {
                    await (0, firestore_1.saveMessageSafe)(sentRecord);
                }
                this.rememberSentByBot(messageId);
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
                isGroup: (0, events_1.isGroupJid)(jid)
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
            hardResetAfter: BAD_MAC_HARD_RESET_AFTER,
            errorMessage
        });
        if (count < BAD_MAC_RECONNECT_THRESHOLD) {
            return;
        }
        this.badMacByJid.set(remoteJid, { count: 0, lastAt: now });
        await this.clearSignalSessionsAfterBadMac(message);
        // Escalate: if soft reconnects haven't fixed it, do a FULL session reset
        if (this.softReconnectCount >= BAD_MAC_HARD_RESET_AFTER) {
            logger_1.logger.error('BAD_MAC_ESCALATION: soft reconnects failed, performing full session recovery', {
                slotId: this.slotId,
                remoteJid,
                softReconnectCount: this.softReconnectCount
            });
            this.softReconnectCount = 0;
            void this.recoverFromInvalidSession();
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
            return this.lidToPhoneJid.get(remoteJid) ?? remoteJid;
        }
        return remoteJid;
    }
    normalizePhoneJidCandidate(jid) {
        if (!jid)
            return null;
        if ((0, events_1.isStatusJid)(jid) || (0, events_1.isGroupJid)(jid) || jid.endsWith('@lid'))
            return null;
        const phone = (0, events_1.jidToPhone)(jid);
        if (phone.length < 10)
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
        const previous = this.lidToPhoneJid.get(lidJid);
        this.lidToPhoneJid.set(lidJid, normalizedPhoneJid);
        if (previous !== normalizedPhoneJid) {
            logger_1.logger.info('LID mapping updated', {
                slotId: this.slotId,
                source,
                lidJid,
                phoneJid: normalizedPhoneJid
            });
        }
        // Replay buffered messages that were waiting for this LID mapping
        this.replayBufferedLidMessages(lidJid);
    }
    absorbContactLidMappings(contacts, source) {
        for (const contact of contacts) {
            const contactId = contact.id ?? null;
            const lidRaw = contact.lid ?? null;
            const lidJid = lidRaw
                ? lidRaw.includes('@')
                    ? lidRaw
                    : `${lidRaw}@lid`
                : contactId?.endsWith('@lid')
                    ? contactId
                    : null;
            const phoneJid = contactId && !contactId.endsWith('@lid') ? contactId : null;
            this.rememberLidMapping(lidJid, phoneJid, source);
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
     * Check if a JID (possibly @lid) corresponds to the bot's own user identity.
     * Used for self-chat detection when the remoteJid is LID-based.
     */
    isOwnLid(jid) {
        if (!jid || !this.socket?.user)
            return false;
        // The socket's user object may itself have a LID property
        const socketUser = this.socket.user;
        if (socketUser.lid) {
            const ownLidJid = socketUser.lid.includes('@') ? socketUser.lid : `${socketUser.lid}@lid`;
            if (jid === ownLidJid)
                return true;
        }
        // Also check via the LID→phone mapping: if this LID resolves to our own phone, it's self
        if (jid.endsWith('@lid')) {
            const resolved = this.lidToPhoneJid.get(jid);
            if (resolved && this.phone) {
                return (0, events_1.jidToPhone)(resolved) === this.phone;
            }
        }
        return false;
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
    rememberSentByBot(messageId) {
        if (this.sentByBotIds.has(messageId))
            return;
        this.sentByBotIds.add(messageId);
        this.sentByBotOrder.push(messageId);
        if (this.sentByBotOrder.length > 5000) {
            const oldest = this.sentByBotOrder.shift();
            if (oldest)
                this.sentByBotIds.delete(oldest);
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
    async handleUnlinkedMessage(remotePhone) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(remotePhone);
        logger_1.logger.info('Ignoring WhatsApp message from non-authorized number', { from: normalizedPhone });
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
