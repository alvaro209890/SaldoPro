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
  getLastConversationActivityByPhone,
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

function normalizeForGreeting(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingMessage(text: string): boolean {
  const normalized = normalizeForGreeting(text);
  if (!normalized) return false;

  return /^(oi+|ola|opa|bom dia|boa tarde|boa noite|e ai|eae|hello|hey)\b/.test(normalized);
}

function isCapabilitiesIntentMessage(text: string): boolean {
  const normalized = normalizeForGreeting(text);
  if (!normalized) return false;

  return (
    /\b(o que|oq|o q)\s+(voce|vc)\s+(pode|faz)\b/.test(normalized) ||
    /\bcomo\s+(voce|vc)\s+pode\s+ajudar\b/.test(normalized) ||
    /\bquais?\s+(suas\s+)?(funcoes|funcionalidades|capacidades)\b/.test(normalized) ||
    /\b(o que|oq)\s+faz\b/.test(normalized)
  );
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada e registre o lancamento corretamente.';

/** Max number of messages processed concurrently by the AI pipeline. */
const MESSAGE_QUEUE_CONCURRENCY = 3;

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
  private recoveringInvalidSession = false;
  private readonly aiCallTimestamps = new Map<string, number[]>();

  // --- Message processing queue ---
  private readonly messageQueue: Array<() => Promise<void>> = [];
  private messageQueueActive = 0;

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

      const shouldForceRelogin =
        this.allowReconnect &&
        (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession);

      if (shouldForceRelogin) {
        logger.warn('Invalid WhatsApp session detected, forcing fresh login to generate new QR', {
          code,
          reason
        });
        void this.recoverFromInvalidSession();
        return;
      }

      const shouldReconnect =
        this.allowReconnect &&
        code !== DisconnectReason.loggedOut &&
        code !== DisconnectReason.forbidden &&
        code !== DisconnectReason.connectionReplaced;

      if (shouldReconnect) {
        this.scheduleReconnect();
      } else if (code === DisconnectReason.connectionReplaced) {
        logger.warn(
          'Connection was replaced by another session. Not reconnecting to avoid loop. ' +
            'If this is unexpected, check for multiple server instances or use /api/whatsapp/session/reset.'
        );
      }
    }
  }

  private async handleMessagesUpsert(upsert: {
    type: string;
    messages: proto.IWebMessageInfo[];
  }): Promise<void> {
    if (upsert.type !== 'notify') return;

    for (const message of upsert.messages) {
      this.enqueueMessage(message);
    }
  }

  /**
   * Enqueue a message for processing with bounded concurrency.
   * Up to MESSAGE_QUEUE_CONCURRENCY messages are processed in parallel;
   * the rest wait in the queue until a slot opens.
   */
  private enqueueMessage(message: proto.IWebMessageInfo): void {
    const task = async (): Promise<void> => {
      try {
        await this.handleSingleIncomingMessage(message);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '';
        if (errorMsg.includes('Bad MAC')) {
          logger.error('Bad MAC decryption error detected, triggering session recovery', error);
          void this.recoverFromInvalidSession();
          return;
        }
        logger.error('Failed processing inbound message', error);
      }
    };

    this.messageQueue.push(task);
    void this.drainMessageQueue();
  }

  private async drainMessageQueue(): Promise<void> {
    while (this.messageQueue.length > 0 && this.messageQueueActive < MESSAGE_QUEUE_CONCURRENCY) {
      const task = this.messageQueue.shift();
      if (!task) break;

      this.messageQueueActive += 1;
      task().finally(() => {
        this.messageQueueActive -= 1;
        void this.drainMessageQueue();
      });
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

    const isSelfChat = jidToPhone(remoteJid) === this.phone;

    if (key.fromMe) {
      if (!isSelfChat || this.sentByBotIds.has(messageId)) {
        logger.info('MSG_SKIP: fromMe message blocked', {
          messageId,
          reason: this.sentByBotIds.has(messageId) ? 'sent_by_bot' : 'not_self_chat',
          remoteJid
        });
        return;
      }
      logger.info('MSG_SELF: processing self-chat message for AI testing', {
        messageId,
        phone: this.phone
      });
    }

    const remotePhone = isSelfChat ? (this.phone ?? jidToPhone(remoteJid)) : jidToPhone(remoteJid);

    logger.info('MSG_RECV: new inbound message', {
      messageId,
      from: remotePhone,
      fromMe: Boolean(key.fromMe),
      isSelfChat,
      rawType: extractRawType(message),
      textPreview: extractMessageText(message).slice(0, 50)
    });

    const alreadyInFirestore = await inboundMessageExists(messageId);
    if (alreadyInFirestore) {
      this.rememberInbound(messageId);
      logger.info('MSG_SKIP: already in Firestore', { messageId });
      return;
    }

    const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
    const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
    const text = extractMessageText(message);
    const rawType = extractRawType(message);
    const imageDataUrl = await this.extractInboundImageDataUrl(message);
    const conversationText = text.trim() || (imageDataUrl ? IMAGE_ONLY_FALLBACK_TEXT : '');

    // Skip messages with no usable content (e.g. decryption failures)
    if (!conversationText && !imageDataUrl) {
      this.rememberInbound(messageId);
      logger.info('MSG_SKIP: empty message (likely decryption failure), ignoring', {
        messageId,
        rawType,
        from: remotePhone
      });
      return;
    }

    let binding = await getPhoneBinding(remotePhone);

    logger.info('MSG_BIND: phone binding lookup', {
      phone: remotePhone,
      found: Boolean(binding),
      uid: binding?.uid ?? null
    });

    // Se não há binding, tenta auto-vincular pelo número cadastrado na conta
    if (!binding) {
      logger.info('MSG_RESOLVE: attempting resolveUidFromPhone', { phone: remotePhone });
      const resolvedUid = await resolveUidFromPhone(remotePhone);
      if (resolvedUid) {
        // Verify the phone is actually in the user's allowed numbers before auto-binding
        const isAllowed = await isPhoneAllowedForUid(resolvedUid, remotePhone);
        if (isAllowed) {
          await savePhoneBinding(remotePhone, resolvedUid);
          binding = {
            phone: normalizePhoneNumber(remotePhone),
            uid: resolvedUid,
            linkedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          logger.info('MSG_RESOLVE: auto-linked phone to account', {
            phone: remotePhone,
            uid: resolvedUid
          });
        } else {
          logger.info('MSG_RESOLVE: phone not in allowed list for resolved user, skipping auto-bind', {
            phone: remotePhone,
            uid: resolvedUid
          });
        }
      } else {
        logger.info('MSG_RESOLVE: no account found for phone', { phone: remotePhone });
      }
    }

    if (!binding) {
      logger.info('MSG_UNLINKED: no binding found, ignoring message', { from: remotePhone });
      this.rememberInbound(messageId);
      return;
    }

    const stillAllowed = await isPhoneAllowedForUid(binding.uid, remotePhone);
    if (!stillAllowed) {
      logger.info('MSG_BLOCKED: phone not in whitelist anymore, ignoring message', {
        from: remotePhone,
        uid: binding.uid
      });
      this.rememberInbound(messageId);
      return;
    }

    const inboundRecord: WhatsAppMessageRecord = {
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
        hasImage: Boolean(imageDataUrl)
      }
    };

    await saveMessageSafe(inboundRecord);
    this.rememberInbound(messageId);

    logger.info('MSG_AI: sending to AI for reply', {
      uid: binding.uid,
      phone: remotePhone,
      textLength: conversationText.length,
      hasImage: Boolean(imageDataUrl)
    });

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
      // Rate limiting check
      if (this.isRateLimited(ownerUid)) {
        logger.warn('MSG_RATE_LIMITED: AI processing skipped due to rate limit', {
          uid: ownerUid,
          phone: remotePhone,
          limitPerMinute: env.whatsappAiRateLimitPerMinute
        });
        const rateLimitMsg = 'Voce enviou muitas mensagens seguidas. Aguarde um momento antes de enviar a proxima.';
        try {
          await this.sendWithRetry(remoteJid, rateLimitMsg, 'auto_reply', ownerUid);
        } catch (rateLimitSendError) {
          logger.error('Failed to send rate limit notice', rateLimitSendError);
        }
        return;
      }

      try {
        const conversation = await this.getConversationHistory(ownerUid, remotePhone);
        const isFirstMessage = conversation.length === 0;
        const isGreeting = isGreetingMessage(inboundText);
        const isCapabilitiesQuestion = isCapabilitiesIntentMessage(inboundText);
        const lastActivityAt = await getLastConversationActivityByPhone(ownerUid, remotePhone);
        const isConversationRestart = this.isConversationRestart(lastActivityAt, isFirstMessage);
        const shouldSendCapabilitiesSummary =
          isGreeting || isFirstMessage || isConversationRestart || isCapabilitiesQuestion;

        if (isFirstMessage) {
          logger.info('MSG_WELCOME: first message detected, AI will introduce itself', {
            uid: ownerUid,
            phone: remotePhone
          });
        }

        // Build AI messages from history (text only)
        const aiMessages: GroqChatMessage[] = conversation.map((entry) => ({
          role: entry.role,
          content: entry.content
        }));

        // Always add the current message at the end with the image if present
        aiMessages.push({
          role: 'user',
          content: inboundText.trim() || (imageDataUrl ? 'Analise a imagem enviada e registre o lançamento corretamente.' : ''),
          ...(imageDataUrl ? { imageDataUrl } : {})
        });

        logger.info('MSG_AI_CONTEXT: sending to Groq', {
          historyCount: conversation.length,
          totalMessages: aiMessages.length,
          hasImage: Boolean(imageDataUrl),
          isGreeting,
          isCapabilitiesQuestion,
          isConversationRestart,
          shouldSendCapabilitiesSummary
        });

        // Save user message to conversation cache for future context
        if (inboundText.trim() || imageDataUrl) {
          await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'user',
            content: inboundText.trim() || 'Imagem enviada no WhatsApp.'
          });
        }

        this.recordAiCall(ownerUid);

        const aiReply = await processWhatsAppAIMessage(ownerUid, aiMessages, {
          isFirstMessage,
          isGreeting,
          isCapabilitiesQuestion,
          isConversationRestart,
          shouldSendCapabilitiesSummary
        });
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
        // Send friendly error message instead of silent failure
        const errorMsg = 'Desculpe, estou com dificuldade para processar agora. Tente novamente em instantes.';
        try {
          await this.sendWithRetry(remoteJid, errorMsg, 'auto_reply', ownerUid);
        } catch (sendError) {
          logger.error('Failed to send AI error fallback message', sendError);
        }
        return;
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

        if (ownerUid) {
          await saveMessageSafe(sentRecord);
        }
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
    if (ownerUid) {
      await saveMessageSafe(failedRecord);
    }

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

  private async recoverFromInvalidSession(): Promise<void> {
    if (this.recoveringInvalidSession) {
      return;
    }

    this.recoveringInvalidSession = true;
    try {
      this.clearReconnectTimer();
      this.clearAuthSyncTimer();
      this.authSyncQueued = false;
      this.lastAuthSnapshotHash = null;
      this.clearQr();
      this.phone = null;

      if (this.socket) {
        (this.socket as { ws?: { close: () => void } }).ws?.close();
        this.socket = null;
      }

      await rm(env.whatsappAuthDir, { recursive: true, force: true });
      await mkdir(env.whatsappAuthDir, { recursive: true });

      try {
        await clearWhatsAppAuthSnapshot();
      } catch (error) {
        logger.error('Failed to clear invalid WhatsApp auth snapshot in Firestore', error);
      }

      if (this.allowReconnect) {
        this.state = 'connecting';
        await this.connect();
      }
    } catch (error) {
      logger.error('Failed to recover from invalid WhatsApp session', error);
      if (this.allowReconnect) {
        this.scheduleReconnect();
      }
    } finally {
      this.recoveringInvalidSession = false;
    }
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

  private isRateLimited(uid: string): boolean {
    const now = Date.now();
    const timestamps = this.aiCallTimestamps.get(uid);
    if (!timestamps) return false;

    // Keep only timestamps within the last 60 seconds
    const recent = timestamps.filter((t) => now - t < 60_000);
    this.aiCallTimestamps.set(uid, recent);

    return recent.length >= env.whatsappAiRateLimitPerMinute;
  }

  private recordAiCall(uid: string): void {
    const timestamps = this.aiCallTimestamps.get(uid) ?? [];
    timestamps.push(Date.now());
    this.aiCallTimestamps.set(uid, timestamps);
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
      logger.warn('Failed to load WhatsApp conversation history (will retry next message)', error);
      // Do NOT cache empty on error — allow retry on next message (e.g. index still building)
      return [];
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

  private isConversationRestart(lastActivityAt: string | null, isFirstMessage: boolean): boolean {
    if (isFirstMessage) return true;
    if (!lastActivityAt) return false;

    const parsed = Date.parse(lastActivityAt);
    if (!Number.isFinite(parsed)) return false;

    const elapsedMinutes = (Date.now() - parsed) / (60 * 1000);
    return elapsedMinutes >= env.whatsappAiNewConversationMinutes;
  }

  private conversationKey(uid: string, phone: string): string {
    return `${uid}:${phone}`;
  }
}

