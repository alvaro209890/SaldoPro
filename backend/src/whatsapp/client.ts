import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type proto,
  type WASocket
} from '@whiskeysockets/baileys';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { processWhatsAppAIMessage } from '../ai/assistant';
import type { GroqChatMessage } from '../ai/groq';
import { env } from '../config/env';
import {
  clearWhatsAppAuthSnapshot,
  getPhoneBinding,
  isPhoneAllowedForUid,
  getRecentConversationByPhone,
  inboundMessageExists,
  loadWhatsAppAuthSnapshot,
  resolveUidFromPhone,
  saveWhatsAppAuthSnapshot,
  savePhoneBinding,
  saveMessageSafe
} from '../lib/firestore';
import { logger } from '../lib/logger';
import type { MessageDirection, RuntimeStatus, WhatsAppMessageRecord } from '../types/whatsapp';
import {
  extractMessageText,
  extractRawType,
  getImageMimeType,
  isGroupJid,
  isImageMessage,
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

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada e registre o lancamento corretamente.';

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
  private readonly sentByBotIds = new Set<string>();
  private readonly sentByBotOrder: string[] = [];
  private readonly conversationByPhone = new Map<string, ConversationEntry[]>();
  private authSyncTimer: NodeJS.Timeout | null = null;
  private authSyncInFlight = false;
  private authSyncQueued = false;
  private lastAuthSnapshotHash: string | null = null;

  async start(): Promise<void> {
    await mkdir(env.whatsappAuthDir, { recursive: true });
    await this.restoreAuthStateFromFirestoreIfNeeded();
    const files = await readdir(env.whatsappAuthDir);
    const hasSavedSession = files.some((f) => f.includes('creds'));
    logger.info('WhatsApp auth state', {
      authDir: env.whatsappAuthDir,
      filesFound: files.length,
      hasSavedSession
    });
    await this.connect();
  }

  async shutdown(): Promise<void> {
    this.allowReconnect = false;
    this.clearReconnectTimer();
    this.clearAuthSyncTimer();
    this.authSyncQueued = false;
    await this.syncAuthStateNow();
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

  async sendText(to: string, text: string, ownerUid?: string): Promise<{ messageId: string }> {
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
    const result = await this.sendWithRetry(jid, normalizedText, 'outbound', ownerUid);
    if (ownerUid) {
      await this.appendConversationMessage(ownerUid, jidToPhone(jid), {
        role: 'assistant',
        content: normalizedText
      });
    }
    return result;
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

    this.clearAuthSyncTimer();
    this.authSyncQueued = false;
    this.lastAuthSnapshotHash = null;

    await rm(env.whatsappAuthDir, { recursive: true, force: true });
    await mkdir(env.whatsappAuthDir, { recursive: true });
    try {
      await clearWhatsAppAuthSnapshot();
    } catch (error) {
      logger.error('Failed to clear WhatsApp auth snapshot in Firestore', error);
    }

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

    socket.ev.on('creds.update', () => {
      void saveCreds();
      this.scheduleAuthStateSync();
    });
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
      this.scheduleAuthStateSync();
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

    if (key.fromMe) {
      // Allow self-messages (user typing on phone to their own number)
      // but block messages sent by the bot itself to prevent infinite loops
      const isSelfChat = jidToPhone(remoteJid) === this.phone;
      if (!isSelfChat || this.sentByBotIds.has(messageId)) return;
    }

    const remotePhone = jidToPhone(remoteJid);

    const alreadyInFirestore = await inboundMessageExists(messageId);
    if (alreadyInFirestore) {
      this.rememberInbound(messageId);
      return;
    }

    const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
    const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
    const text = extractMessageText(message);
    const rawType = extractRawType(message);
    const imageDataUrl = await this.extractInboundImageDataUrl(message);
    const conversationText = text.trim() || (imageDataUrl ? IMAGE_ONLY_FALLBACK_TEXT : '');
    let binding = await getPhoneBinding(remotePhone);

    // Se nÃ£o hÃ¡ binding, tenta auto-vincular pelo nÃºmero cadastrado na conta
    if (!binding) {
      const resolvedUid = await resolveUidFromPhone(remotePhone);
      if (resolvedUid) {
        await savePhoneBinding(remotePhone, resolvedUid);
        binding = {
          phone: normalizePhoneNumber(remotePhone),
          uid: resolvedUid,
          linkedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        logger.info('WhatsApp: numero auto-vinculado pelo cadastro da conta', {
          phone: remotePhone,
          uid: resolvedUid
        });
      }
    }

    const ownerUid = binding?.uid;

    const inboundRecord: WhatsAppMessageRecord = {
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

    await saveMessageSafe(inboundRecord);
    this.rememberInbound(messageId);

    if (!binding) {
      await this.handleUnlinkedMessage(remotePhone);
      return;
    }

    const stillAllowed = await isPhoneAllowedForUid(binding.uid, remotePhone);
    if (!stillAllowed) {
      logger.info('Ignoring WhatsApp message from number removed from whitelist', {
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

  private async sendSmartReply(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    inboundText: string,
    imageDataUrl: string | null
  ): Promise<void> {
    const hasAiInput = inboundText.trim().length > 0 || Boolean(imageDataUrl);
    if (env.whatsappAiEnabled && hasAiInput) {
      try {
        const conversation = await this.getConversationHistory(ownerUid, remotePhone);
        const aiMessages: GroqChatMessage[] = conversation.map((entry, index) => ({
          role: entry.role,
          content: entry.content,
          ...(imageDataUrl && index === conversation.length - 1 && entry.role === 'user'
            ? { imageDataUrl }
            : {})
        }));

        const aiReply = await processWhatsAppAIMessage(ownerUid, aiMessages);
        if (aiReply.trim()) {
          await this.sendWithRetry(remoteJid, aiReply.trim(), 'auto_reply', ownerUid);
          await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: aiReply.trim()
          });
          return;
        }
      } catch (error) {
        logger.error('Failed to process AI WhatsApp message', error);
      }
    }

    if (!env.whatsappAutoReplyEnabled) return;
    const sent = await this.sendAutoReply(remoteJid, ownerUid);
    if (sent) {
      await this.appendConversationMessage(ownerUid, remotePhone, {
        role: 'assistant',
        content: env.whatsappAutoReplyText.trim()
      });
    }
  }

  private async sendAutoReply(remoteJid: string, ownerUid?: string): Promise<boolean> {
    if (!this.socket || !this.connected) return false;
    if (!env.whatsappAutoReplyText.trim()) return false;

    try {
      await this.sendWithRetry(remoteJid, env.whatsappAutoReplyText.trim(), 'auto_reply', ownerUid);
      return true;
    } catch (error) {
      logger.error('Failed to send WhatsApp auto-reply', error);
      return false;
    }
  }

  private async sendWithRetry(
    jid: string,
    text: string,
    direction: MessageDirection,
    ownerUid?: string
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
          ...(ownerUid ? { ownerUid } : {}),
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
        this.rememberSentByBot(messageId);
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
      ...(ownerUid ? { ownerUid } : {}),
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

    const qrPageUrl = env.backendUrl
      ? `${env.backendUrl}/api/whatsapp/qr-page?token=${env.whatsappApiToken}`
      : `/api/whatsapp/qr-page?token=${env.whatsappApiToken}`;

    logger.info('==================================================');
    logger.info('  NOVO QR CODE DISPONIVEL â€” abra no navegador:');
    logger.info(`  ${qrPageUrl}`);
    logger.info('==================================================');

    // ASCII art apenas para referÃªncia em ambientes de terminal local
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

  private clearAuthSyncTimer(): void {
    if (!this.authSyncTimer) return;
    clearTimeout(this.authSyncTimer);
    this.authSyncTimer = null;
  }

  private scheduleAuthStateSync(): void {
    this.clearAuthSyncTimer();
    this.authSyncTimer = setTimeout(() => {
      this.authSyncTimer = null;
      void this.syncAuthStateNow();
    }, 1200);
  }

  private async syncAuthStateNow(): Promise<void> {
    if (this.authSyncInFlight) {
      this.authSyncQueued = true;
      return;
    }

    this.authSyncInFlight = true;
    try {
      const files = await readdir(env.whatsappAuthDir);
      const authFiles = files
        .filter((filename) => filename.endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));

      if (authFiles.length === 0) {
        return;
      }

      const snapshotFiles = await Promise.all(
        authFiles.map(async (filename) => {
          const content = await readFile(join(env.whatsappAuthDir, filename));
          return {
            filename,
            contentBase64: content.toString('base64')
          };
        })
      );

      const hash = this.computeAuthSnapshotHash(snapshotFiles);
      if (hash === this.lastAuthSnapshotHash) {
        return;
      }

      await saveWhatsAppAuthSnapshot(snapshotFiles);
      this.lastAuthSnapshotHash = hash;
      logger.info('WhatsApp auth snapshot synced to Firestore', {
        fileCount: snapshotFiles.length
      });
    } catch (error) {
      logger.error('Failed to sync WhatsApp auth snapshot', error);
    } finally {
      this.authSyncInFlight = false;
      if (this.authSyncQueued) {
        this.authSyncQueued = false;
        this.scheduleAuthStateSync();
      }
    }
  }

  private computeAuthSnapshotHash(files: Array<{ filename: string; contentBase64: string }>): string {
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(file.filename);
      hash.update('\0');
      hash.update(file.contentBase64);
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  private async restoreAuthStateFromFirestoreIfNeeded(): Promise<void> {
    const currentFiles = await readdir(env.whatsappAuthDir);
    const hasLocalCreds = currentFiles.some((filename) => filename.includes('creds'));
    if (hasLocalCreds) {
      return;
    }

    const snapshotFiles = await loadWhatsAppAuthSnapshot();
    if (snapshotFiles.length === 0) {
      return;
    }

    let restoredCount = 0;
    for (const file of snapshotFiles) {
      const safeName = basename(file.filename);
      if (!safeName || safeName !== file.filename) {
        continue;
      }

      try {
        const payload = Buffer.from(file.contentBase64, 'base64');
        if (payload.length === 0) continue;
        await writeFile(join(env.whatsappAuthDir, safeName), payload);
        restoredCount += 1;
      } catch (error) {
        logger.warn('Skipping invalid WhatsApp auth snapshot file', {
          file: safeName,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    if (restoredCount > 0) {
      logger.info('Restored WhatsApp auth state from Firestore snapshot', {
        fileCount: restoredCount
      });
    }
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

  private rememberSentByBot(messageId: string): void {
    if (this.sentByBotIds.has(messageId)) return;

    this.sentByBotIds.add(messageId);
    this.sentByBotOrder.push(messageId);

    if (this.sentByBotOrder.length > 5000) {
      const oldest = this.sentByBotOrder.shift();
      if (oldest) this.sentByBotIds.delete(oldest);
    }
  }

  private async handleUnlinkedMessage(remotePhone: string): Promise<void> {
    const normalizedPhone = normalizePhoneNumber(remotePhone);
    logger.info('Ignoring WhatsApp message from non-authorized number', { from: normalizedPhone });
  }

  private async extractInboundImageDataUrl(message: proto.IWebMessageInfo): Promise<string | null> {
    if (!isImageMessage(message)) return null;

    const mimeType = getImageMimeType(message) || 'image/jpeg';
    try {
      const mediaBuffer = await downloadMediaMessage(message, 'buffer', {});
      if (!mediaBuffer || mediaBuffer.length === 0) {
        return null;
      }

      if (mediaBuffer.length > env.whatsappAiImageMaxBytes) {
        logger.warn('Ignoring inbound image because it exceeds max size', {
          size: mediaBuffer.length,
          maxAllowed: env.whatsappAiImageMaxBytes
        });
        return null;
      }

      const base64 = mediaBuffer.toString('base64');
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      logger.error('Failed to download inbound WhatsApp image', error);
      return null;
    }
  }

  private async getConversationHistory(uid: string, phone: string): Promise<ConversationEntry[]> {
    if (!uid || uid.trim().length === 0) return [];

    const normalized = normalizePhoneNumber(phone);
    if (normalized.length < 10) return [];

    const cacheKey = this.conversationKey(uid, normalized);
    const cached = this.conversationByPhone.get(cacheKey);
    if (cached) return cached;

    try {
      const loaded = await getRecentConversationByPhone(uid, normalized, env.whatsappAiHistoryLimit);
      this.conversationByPhone.set(cacheKey, loaded);
      return loaded;
    } catch (error) {
      logger.error('Failed to load WhatsApp conversation history', error);
      const empty: ConversationEntry[] = [];
      this.conversationByPhone.set(cacheKey, empty);
      return empty;
    }
  }

  private async appendConversationMessage(
    uid: string,
    phone: string,
    message: ConversationEntry
  ): Promise<void> {
    if (!uid || uid.trim().length === 0) return;

    const normalized = normalizePhoneNumber(phone);
    if (normalized.length < 10) return;

    const content = message.content.trim().slice(0, 800);
    if (!content) return;

    const current = await this.getConversationHistory(uid, normalized);
    const updated = [...current, { role: message.role, content }].slice(-env.whatsappAiHistoryLimit);
    this.conversationByPhone.set(this.conversationKey(uid, normalized), updated);
  }

  private conversationKey(uid: string, phone: string): string {
    return `${uid}:${phone}`;
  }
}

