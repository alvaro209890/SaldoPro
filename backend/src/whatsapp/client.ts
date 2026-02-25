import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type proto,
  type WASocket
} from '@whiskeysockets/baileys';
import { mkdir, rm } from 'node:fs/promises';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { processWhatsAppAIMessage } from '../ai/assistant';
import { env } from '../config/env';
import { getAllowedWhatsAppNumbers, inboundMessageExists, saveMessageSafe } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { MessageDirection, RuntimeStatus, WhatsAppMessageRecord } from '../types/whatsapp';
import {
  extractMessageText,
  extractRawType,
  isGroupJid,
  isStatusJid,
  jidToPhone,
  normalizePhoneNumber,
  normalizePhoneToJid
} from './events';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asDisconnectCode(error: unknown): number | null {
  const code = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
  return typeof code === 'number' ? code : null;
}

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private state: RuntimeStatus['state'] = 'connecting';
  private connected = false;
  private phone: string | null = null;
  private lastDisconnectReason: string | null = null;
  private qrText: string | null = null;
  private qrDataUrl: string | null = null;
  private qrGeneratedAt: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private allowReconnect = true;
  private readonly processedInboundIds = new Set<string>();
  private readonly processedInboundOrder: string[] = [];
  private allowedNumbersCache = new Set<string>();
  private allowedNumbersCacheAt = 0;

  async start(): Promise<void> {
    await mkdir(env.whatsappAuthDir, { recursive: true });
    await this.connect();
  }

  async shutdown(): Promise<void> {
    this.allowReconnect = false;
    this.clearReconnectTimer();
    if (this.socket) {
      (this.socket as { ws?: { close: () => void } }).ws?.close();
    }
    this.socket = null;
  }

  getStatus(): RuntimeStatus {
    return {
      connected: this.connected,
      state: this.state,
      phone: this.phone,
      lastDisconnectReason: this.lastDisconnectReason
    };
  }

  async getQrPayload(): Promise<
    | { available: true; qrPngBase64: string; expiresInSec: number }
    | { available: false; reason: 'already_connected' | 'no_qr' | 'expired' }
  > {
    if (this.connected) {
      return { available: false, reason: 'already_connected' };
    }

    if (!this.qrText || !this.qrDataUrl || !this.qrGeneratedAt) {
      return { available: false, reason: 'no_qr' };
    }

    const elapsedSeconds = Math.floor((Date.now() - this.qrGeneratedAt) / 1000);
    const expiresInSec = Math.max(0, env.qrExpiresSeconds - elapsedSeconds);
    if (expiresInSec <= 0) {
      return { available: false, reason: 'expired' };
    }

    return {
      available: true,
      qrPngBase64: this.qrDataUrl,
      expiresInSec
    };
  }

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Message text is required');
    }
    if (normalizedText.length > env.maxMessageLength) {
      throw new Error(`Message text exceeds max length (${env.maxMessageLength})`);
    }
    if (!this.socket || !this.connected) {
      throw new Error('WhatsApp is not connected');
    }

    const jid = normalizePhoneToJid(to);
    return this.sendWithRetry(jid, normalizedText, 'outbound');
  }

  async resetSession(): Promise<void> {
    logger.warn('Resetting WhatsApp session by API request');
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
      } catch (error) {
        logger.warn('Socket logout failed during reset', error);
      }
      (this.socket as { ws?: { close: () => void } }).ws?.close();
      this.socket = null;
    }

    await rm(env.whatsappAuthDir, { recursive: true, force: true });
    await mkdir(env.whatsappAuthDir, { recursive: true });

    this.allowReconnect = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    this.state = 'connecting';
    this.connected = false;

    const { state, saveCreds } = await useMultiFileAuthState(env.whatsappAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
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
      void this.handleMessagesUpsert(upsert as { type: string; messages: proto.IWebMessageInfo[] });
    });

    logger.info('WhatsApp socket initialized');
  }

  private async handleConnectionUpdate(update: {
    connection?: 'open' | 'close' | 'connecting';
    lastDisconnect?: { error?: unknown };
    qr?: string;
  }): Promise<void> {
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
      this.phone = jidToPhone(this.socket?.user?.id) || null;
      this.clearQr();
      logger.info('WhatsApp connection opened', { phone: this.phone });
      return;
    }

    if (connection === 'close') {
      this.state = 'close';
      this.connected = false;

      const code = asDisconnectCode(lastDisconnect?.error);
      const reason = this.mapDisconnectReason(code);
      this.lastDisconnectReason = reason;
      logger.warn('WhatsApp connection closed', { code, reason });

      const shouldReconnect =
        this.allowReconnect && code !== DisconnectReason.loggedOut && code !== DisconnectReason.forbidden;

      if (shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private async handleMessagesUpsert(upsert: {
    type: string;
    messages: proto.IWebMessageInfo[];
  }): Promise<void> {
    if (upsert.type !== 'notify') return;

    for (const message of upsert.messages) {
      try {
        await this.handleSingleIncomingMessage(message);
      } catch (error) {
        logger.error('Failed processing inbound message', error);
      }
    }
  }

  private async handleSingleIncomingMessage(message: proto.IWebMessageInfo): Promise<void> {
    const key = message.key;
    if (!key) return;

    const messageId = key.id ?? '';
    if (!messageId) return;

    if (this.alreadyProcessedInbound(messageId)) return;

    const remoteJid = key.remoteJid ?? '';
    if (!remoteJid || isStatusJid(remoteJid) || isGroupJid(remoteJid)) return;
    if (key.fromMe) return;
    const remotePhone = jidToPhone(remoteJid);
    if (!(await this.isAllowedSender(remotePhone))) {
      this.rememberInbound(messageId);
      logger.info('Ignoring WhatsApp message from non-whitelisted number', {
        from: remotePhone
      });
      return;
    }

    const alreadyInFirestore = await inboundMessageExists(messageId);
    if (alreadyInFirestore) {
      this.rememberInbound(messageId);
      return;
    }

    const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
    const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
    const text = extractMessageText(message);
    const rawType = extractRawType(message);

    const inboundRecord: WhatsAppMessageRecord = {
      messageId,
      direction: 'inbound',
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
        isGroup: false
      }
    };

    await saveMessageSafe(inboundRecord);
    this.rememberInbound(messageId);

    await this.sendSmartReply(remoteJid, text);
  }

  private async sendSmartReply(remoteJid: string, inboundText: string): Promise<void> {
    if (env.whatsappAiEnabled && inboundText.trim()) {
      try {
        const aiReply = await processWhatsAppAIMessage(inboundText.trim());
        if (aiReply.trim()) {
          await this.sendWithRetry(remoteJid, aiReply.trim(), 'auto_reply');
          return;
        }
      } catch (error) {
        logger.error('Failed to process AI WhatsApp message', error);
      }
    }

    if (!env.whatsappAutoReplyEnabled) return;
    await this.sendAutoReply(remoteJid);
  }

  private async sendAutoReply(remoteJid: string): Promise<void> {
    if (!this.socket || !this.connected) return;
    if (!env.whatsappAutoReplyText.trim()) return;

    try {
      await this.sendWithRetry(remoteJid, env.whatsappAutoReplyText.trim(), 'auto_reply');
    } catch (error) {
      logger.error('Failed to send WhatsApp auto-reply', error);
    }
  }

  private async sendWithRetry(
    jid: string,
    text: string,
    direction: MessageDirection
  ): Promise<{ messageId: string }> {
    if (!this.socket) {
      throw new Error('WhatsApp socket is not available');
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.socket.sendMessage(jid, { text });
        const messageId = response?.key?.id ?? `generated_${Date.now()}`;
        const now = new Date().toISOString();

        const sentRecord: WhatsAppMessageRecord = {
          messageId,
          direction,
          from: this.phone ?? '',
          to: jidToPhone(jid),
          text,
          timestamp: now,
          waTimestamp: null,
          status: 'sent',
          rawType: 'conversation',
          createdAt: now,
          metadata: {
            fromMe: true,
            isGroup: isGroupJid(jid)
          }
        };

        await saveMessageSafe(sentRecord);
        return { messageId };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          logger.warn('WhatsApp send failed, retrying once', { attempt });
          await sleep(700);
          continue;
        }
      }
    }

    const failedRecord: WhatsAppMessageRecord = {
      messageId: `failed_${Date.now()}`,
      direction,
      from: this.phone ?? '',
      to: jidToPhone(jid),
      text,
      timestamp: new Date().toISOString(),
      waTimestamp: null,
      status: 'failed',
      rawType: 'conversation',
      createdAt: new Date().toISOString(),
      metadata: {
        fromMe: true,
        isGroup: isGroupJid(jid)
      }
    };
    await saveMessageSafe(failedRecord);

    throw lastError instanceof Error ? lastError : new Error('Failed to send WhatsApp message');
  }

  private async setQr(qr: string): Promise<void> {
    this.qrText = qr;
    this.qrGeneratedAt = Date.now();
    this.state = 'connecting';
    this.connected = false;

    qrcodeTerminal.generate(qr, { small: true });

    try {
      this.qrDataUrl = await QRCode.toDataURL(qr);
      logger.info('WhatsApp QR code updated');
    } catch (error) {
      this.qrDataUrl = null;
      logger.error('Failed to create QR data URL', error);
    }
  }

  private clearQr(): void {
    this.qrText = null;
    this.qrDataUrl = null;
    this.qrGeneratedAt = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    logger.info('Scheduling WhatsApp reconnect in 2 seconds');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        logger.error('Reconnect attempt failed', error);
        this.scheduleReconnect();
      });
    }, 2000);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private mapDisconnectReason(code: number | null): string {
    if (code === null) return 'unknown';
    if (code === DisconnectReason.loggedOut) return 'logged_out';
    if (code === DisconnectReason.connectionClosed) return 'connection_closed';
    if (code === DisconnectReason.connectionLost) return 'connection_lost';
    if (code === DisconnectReason.connectionReplaced) return 'connection_replaced';
    if (code === DisconnectReason.timedOut) return 'connection_timed_out';
    if (code === DisconnectReason.multideviceMismatch) return 'multidevice_mismatch';
    if (code === DisconnectReason.restartRequired) return 'restart_required';
    if (code === DisconnectReason.badSession) return 'bad_session';
    if (code === DisconnectReason.forbidden) return 'forbidden';
    if (code === DisconnectReason.unavailableService) return 'unavailable_service';
    return `code_${code}`;
  }

  private alreadyProcessedInbound(messageId: string): boolean {
    return this.processedInboundIds.has(messageId);
  }

  private rememberInbound(messageId: string): void {
    if (this.processedInboundIds.has(messageId)) return;

    this.processedInboundIds.add(messageId);
    this.processedInboundOrder.push(messageId);

    if (this.processedInboundOrder.length > 5000) {
      const oldest = this.processedInboundOrder.shift();
      if (oldest) this.processedInboundIds.delete(oldest);
    }
  }

  private async isAllowedSender(phone: string): Promise<boolean> {
    const normalized = normalizePhoneNumber(phone);
    if (normalized.length < 10) return false;

    if (Date.now() - this.allowedNumbersCacheAt > 30000) {
      await this.refreshAllowedNumbers();
    }

    return this.allowedNumbersCache.has(normalized);
  }

  private async refreshAllowedNumbers(): Promise<void> {
    const uid = env.whatsappOwnerUid;
    if (!uid) {
      this.allowedNumbersCache = new Set();
      this.allowedNumbersCacheAt = Date.now();
      return;
    }

    try {
      const numbers = await getAllowedWhatsAppNumbers(uid);
      this.allowedNumbersCache = new Set(numbers.map((number) => normalizePhoneNumber(number)));
      this.allowedNumbersCacheAt = Date.now();
    } catch (error) {
      logger.error('Failed to refresh WhatsApp allowed numbers', error);
      this.allowedNumbersCache = new Set();
      this.allowedNumbersCacheAt = Date.now();
    }
  }
}
