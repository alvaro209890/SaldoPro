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
function asDisconnectCode(error) {
    const code = error?.output?.statusCode;
    return typeof code === 'number' ? code : null;
}
const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada e registre o lancamento corretamente.';
const LINK_CODE_PROMPT = 'Para ativar seu atendimento por IA, envie o seu codigo da aba Configuracoes do SaldoPro.';
const LINK_CODE_INVALID = 'Codigo invalido para este numero. Confirme o codigo da sua conta e tente novamente.';
const LINK_CODE_SUCCESS = 'Codigo validado com sucesso. Seu numero foi vinculado e agora as mensagens serao processadas pela IA.';
class WhatsAppClient {
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
    requestedLinkCodePhones = new Set();
    async start() {
        await (0, promises_1.mkdir)(env_1.env.whatsappAuthDir, { recursive: true });
        await this.connect();
    }
    async shutdown() {
        this.allowReconnect = false;
        this.clearReconnectTimer();
        if (this.socket) {
            this.socket.ws?.close();
        }
        this.socket = null;
    }
    getStatus() {
        return {
            connected: this.connected,
            state: this.state,
            phone: this.phone,
            lastDisconnectReason: this.lastDisconnectReason
        };
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
        logger_1.logger.warn('Resetting WhatsApp session by API request');
        this.allowReconnect = false;
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
            this.socket.ws?.close();
            this.socket = null;
        }
        await (0, promises_1.rm)(env_1.env.whatsappAuthDir, { recursive: true, force: true });
        await (0, promises_1.mkdir)(env_1.env.whatsappAuthDir, { recursive: true });
        this.allowReconnect = true;
        await this.connect();
    }
    async connect() {
        this.state = 'connecting';
        this.connected = false;
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(env_1.env.whatsappAuthDir);
        const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
        const socket = (0, baileys_1.default)({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: ['SaldoPro', 'Render', '1.0.0']
        });
        this.socket = socket;
        socket.ev.on('creds.update', saveCreds);
        socket.ev.on('connection.update', (update) => {
            void this.handleConnectionUpdate(update);
        });
        socket.ev.on('messages.upsert', (upsert) => {
            void this.handleMessagesUpsert(upsert);
        });
        logger_1.logger.info('WhatsApp socket initialized');
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
            this.clearQr();
            logger_1.logger.info('WhatsApp connection opened', { phone: this.phone });
            return;
        }
        if (connection === 'close') {
            this.state = 'close';
            this.connected = false;
            const code = asDisconnectCode(lastDisconnect?.error);
            const reason = this.mapDisconnectReason(code);
            this.lastDisconnectReason = reason;
            logger_1.logger.warn('WhatsApp connection closed', { code, reason });
            const shouldReconnect = this.allowReconnect && code !== baileys_1.DisconnectReason.loggedOut && code !== baileys_1.DisconnectReason.forbidden;
            if (shouldReconnect) {
                this.scheduleReconnect();
            }
        }
    }
    async handleMessagesUpsert(upsert) {
        if (upsert.type !== 'notify')
            return;
        for (const message of upsert.messages) {
            try {
                await this.handleSingleIncomingMessage(message);
            }
            catch (error) {
                logger_1.logger.error('Failed processing inbound message', error);
            }
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
        const remoteJid = key.remoteJid ?? '';
        if (!remoteJid || (0, events_1.isStatusJid)(remoteJid) || (0, events_1.isGroupJid)(remoteJid))
            return;
        if (key.fromMe)
            return;
        const remotePhone = (0, events_1.jidToPhone)(remoteJid);
        const alreadyInFirestore = await (0, firestore_1.inboundMessageExists)(messageId);
        if (alreadyInFirestore) {
            this.rememberInbound(messageId);
            return;
        }
        const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
        const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
        const text = (0, events_1.extractMessageText)(message);
        const rawType = (0, events_1.extractRawType)(message);
        const imageDataUrl = await this.extractInboundImageDataUrl(message);
        const conversationText = text.trim() || (imageDataUrl ? IMAGE_ONLY_FALLBACK_TEXT : '');
        let binding = await (0, firestore_1.getPhoneBinding)(remotePhone);
        // Se não há binding, tenta auto-vincular pelo número cadastrado na conta
        if (!binding) {
            const resolvedUid = await (0, firestore_1.resolveUidFromPhone)(remotePhone);
            if (resolvedUid) {
                await (0, firestore_1.savePhoneBinding)(remotePhone, resolvedUid);
                binding = {
                    phone: (0, events_1.normalizePhoneNumber)(remotePhone),
                    uid: resolvedUid,
                    linkedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                logger_1.logger.info('WhatsApp: numero auto-vinculado pelo cadastro da conta', {
                    phone: remotePhone,
                    uid: resolvedUid
                });
            }
        }
        const ownerUid = binding?.uid;
        const inboundRecord = {
            messageId,
            direction: 'inbound',
            ...(ownerUid ? { ownerUid } : {}),
            from: remotePhone,
            to: this.phone ?? '',
            text,
            timestamp,
            waTimestamp,
            status: 'received',
            rawType,
            createdAt: new Date().toISOString(),
            metadata: {
                fromMe: false,
                isGroup: false,
                hasImage: Boolean(imageDataUrl)
            }
        };
        await (0, firestore_1.saveMessageSafe)(inboundRecord);
        this.rememberInbound(messageId);
        if (!binding) {
            await this.handleUnlinkedMessage(remoteJid, remotePhone, text);
            return;
        }
        this.requestedLinkCodePhones.delete((0, events_1.normalizePhoneNumber)(remotePhone));
        const stillAllowed = await (0, firestore_1.isPhoneAllowedForUid)(binding.uid, remotePhone);
        if (!stillAllowed) {
            logger_1.logger.info('Ignoring WhatsApp message from number removed from whitelist', {
                from: remotePhone,
                uid: binding.uid
            });
            return;
        }
        if (conversationText || imageDataUrl) {
            await this.appendConversationMessage(binding.uid, remotePhone, {
                role: 'user',
                content: conversationText
            });
        }
        await this.sendSmartReply(binding.uid, remoteJid, remotePhone, conversationText, imageDataUrl);
    }
    async sendSmartReply(ownerUid, remoteJid, remotePhone, inboundText, imageDataUrl) {
        const hasAiInput = inboundText.trim().length > 0 || Boolean(imageDataUrl);
        if (env_1.env.whatsappAiEnabled && hasAiInput) {
            try {
                const conversation = await this.getConversationHistory(ownerUid, remotePhone);
                const aiMessages = conversation.map((entry, index) => ({
                    role: entry.role,
                    content: entry.content,
                    ...(imageDataUrl && index === conversation.length - 1 && entry.role === 'user'
                        ? { imageDataUrl }
                        : {})
                }));
                const aiReply = await (0, assistant_1.processWhatsAppAIMessage)(ownerUid, aiMessages);
                if (aiReply.trim()) {
                    await this.sendWithRetry(remoteJid, aiReply.trim(), 'auto_reply', ownerUid);
                    await this.appendConversationMessage(ownerUid, remotePhone, {
                        role: 'assistant',
                        content: aiReply.trim()
                    });
                    return;
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to process AI WhatsApp message', error);
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
                await (0, firestore_1.saveMessageSafe)(sentRecord);
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
        await (0, firestore_1.saveMessageSafe)(failedRecord);
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
        logger_1.logger.info('  NOVO QR CODE DISPONIVEL — abra no navegador:');
        logger_1.logger.info(`  ${qrPageUrl}`);
        logger_1.logger.info('==================================================');
        // ASCII art apenas para referência em ambientes de terminal local
        qrcode_terminal_1.default.generate(qr, { small: true });
        try {
            this.qrDataUrl = await qrcode_1.default.toDataURL(qr);
            logger_1.logger.info('WhatsApp QR code updated');
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
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        logger_1.logger.info('Scheduling WhatsApp reconnect in 2 seconds');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch((error) => {
                logger_1.logger.error('Reconnect attempt failed', error);
                this.scheduleReconnect();
            });
        }, 2000);
    }
    clearReconnectTimer() {
        if (!this.reconnectTimer)
            return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
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
    async handleUnlinkedMessage(remoteJid, remotePhone, inboundText) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(remotePhone);
        const trimmed = inboundText.trim();
        // Somente processa se parecer um código de acesso manual
        if (!this.looksLikeAccessCode(trimmed)) {
            logger_1.logger.info('Ignoring WhatsApp message from non-authorized number', { from: normalizedPhone });
            return;
        }
        const linkedUid = await this.tryBindPhoneWithCode(normalizedPhone, trimmed);
        if (!linkedUid) {
            await this.sendWithRetry(remoteJid, LINK_CODE_INVALID, 'auto_reply');
            return;
        }
        this.requestedLinkCodePhones.delete(normalizedPhone);
        await this.sendWithRetry(remoteJid, LINK_CODE_SUCCESS, 'auto_reply', linkedUid);
    }
    async extractInboundImageDataUrl(message) {
        if (!(0, events_1.isImageMessage)(message))
            return null;
        const mimeType = (0, events_1.getImageMimeType)(message) || 'image/jpeg';
        try {
            const mediaBuffer = await (0, baileys_1.downloadMediaMessage)(message, 'buffer', {});
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
            logger_1.logger.error('Failed to download inbound WhatsApp image', error);
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
            logger_1.logger.error('Failed to load WhatsApp conversation history', error);
            const empty = [];
            this.conversationByPhone.set(cacheKey, empty);
            return empty;
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
    looksLikeAccessCode(value) {
        const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return normalized.length >= 8;
    }
    async tryBindPhoneWithCode(phone, codeText) {
        try {
            const uid = await (0, firestore_1.resolveUidFromAccessCode)(codeText, phone);
            if (!uid)
                return null;
            await (0, firestore_1.savePhoneBinding)(phone, uid);
            return uid;
        }
        catch (error) {
            logger_1.logger.error('Failed to validate WhatsApp access code', error);
            return null;
        }
    }
    conversationKey(uid, phone) {
        return `${uid}:${phone}`;
    }
}
exports.WhatsAppClient = WhatsAppClient;
