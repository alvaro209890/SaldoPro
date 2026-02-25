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
    async sendText(to, text) {
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
        return this.sendWithRetry(jid, normalizedText, 'outbound');
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
        const alreadyInFirestore = await (0, firestore_1.inboundMessageExists)(messageId);
        if (alreadyInFirestore) {
            this.rememberInbound(messageId);
            return;
        }
        const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
        const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
        const text = (0, events_1.extractMessageText)(message);
        const rawType = (0, events_1.extractRawType)(message);
        const inboundRecord = {
            messageId,
            direction: 'inbound',
            from: (0, events_1.jidToPhone)(remoteJid),
            to: this.phone ?? '',
            text,
            timestamp,
            waTimestamp,
            status: 'received',
            rawType,
            createdAt: new Date().toISOString(),
            metadata: {
                fromMe: false,
                isGroup: false
            }
        };
        await (0, firestore_1.saveMessageSafe)(inboundRecord);
        this.rememberInbound(messageId);
        await this.sendSmartReply(remoteJid, text);
    }
    async sendSmartReply(remoteJid, inboundText) {
        if (env_1.env.whatsappAiEnabled && inboundText.trim()) {
            try {
                const aiReply = await (0, assistant_1.processWhatsAppAIMessage)(inboundText.trim());
                if (aiReply.trim()) {
                    await this.sendWithRetry(remoteJid, aiReply.trim(), 'auto_reply');
                    return;
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to process AI WhatsApp message', error);
            }
        }
        if (!env_1.env.whatsappAutoReplyEnabled)
            return;
        await this.sendAutoReply(remoteJid);
    }
    async sendAutoReply(remoteJid) {
        if (!this.socket || !this.connected)
            return;
        if (!env_1.env.whatsappAutoReplyText.trim())
            return;
        try {
            await this.sendWithRetry(remoteJid, env_1.env.whatsappAutoReplyText.trim(), 'auto_reply');
        }
        catch (error) {
            logger_1.logger.error('Failed to send WhatsApp auto-reply', error);
        }
    }
    async sendWithRetry(jid, text, direction) {
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
}
exports.WhatsAppClient = WhatsAppClient;
