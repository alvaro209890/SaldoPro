import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type proto,
  type WASocket
} from '@whiskeysockets/baileys';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { handleReminderShortcut, processWhatsAppAIMessage, undoLastAction } from '../ai/assistant';
import {
  createSignedDocumentUrl,
  DocumentUploadUserError,
  deleteStoredDocument,
  finalizePendingDocumentMove,
  MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION,
  MAX_STORED_DOCUMENT_BYTES,
  uploadPendingDocument
} from '../lib/document-storage';
import { consumeFreeWhatsAppQuota, getFreeWhatsAppQuotaState } from '../lib/daily-ai-quota';
import { isFirebaseUserActive } from '../lib/firebase-user-access';
import { getUserPlanAccess } from '../lib/subscription-access';
import type { GroqChatMessage } from '../ai/groq';
import { env } from '../config/env';
import {
  bootstrapUserData,
  clearWhatsAppAuthSnapshot,
  createPendingWhatsAppDocumentDraft,
  createUserDocument,
  deletePendingWhatsAppDocumentDraft,
  getLastConversationActivityByPhone,
  getActivePendingWhatsAppDocumentDraft,
  getPhoneBinding,
  isPhoneAllowedForUid,
  getRecentConversationByPhone,
  listRecentUserDocuments,
  inboundMessageExists,
  loadWhatsAppAuthSnapshot,
  resolveUidFromPhone,
  saveWhatsAppAuthSnapshot,
  savePhoneBinding,
  saveMessageSafe,
  touchUserDocumentAccess,
  type PendingWhatsAppDocumentDraft,
  type UserDocument
} from '../lib/firestore';
import { logger } from '../lib/logger';
import type { MessageDirection, RuntimeStatus, WhatsAppMessageRecord, WhatsAppSlotId } from '../types/whatsapp';
import {
  extractMessageText,
  extractRawType,
  getImageMimeType,
  isAudioMessage,
  getAudioMimeType,
  isDocumentMessage,
  getDocumentMimeType,
  getDocumentFileName,
  isGroupJid,
  isImageMessage,
  isStatusJid,
  jidToPhone,
  normalizePhoneNumber,
  normalizePhoneToJid
} from './events';

import {
  detectDocumentFetchIntent,
  detectDocumentSaveIntent,
  isMeaningfulDocumentLabel,
  normalizeDocumentText,
  parseDocumentLabelInput,
  tokenizeDocumentSearch,
  scoreRecentDocuments,
  type RankedDocumentMatch
} from './document-intents';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpectedMediaDecryptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return (
    message.includes('bad decrypt') ||
    message.includes('bad mac') ||
    message.includes('no matching sessions found') ||
    message.includes('no session') ||
    message.includes('sessionerror') ||
    message.includes('prekey')
  );
}

function asDisconnectCode(error: unknown): number | null {
  const code = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
  return typeof code === 'number' ? code : null;
}

function resolveSupportedDocumentMimeType(
  mimeType: string | null | undefined,
  fileName: string | null | undefined
): string | null {
  const normalizedMimeType = (mimeType ?? '').trim().toLowerCase();
  if (DOCUMENT_ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const normalizedFileName = (fileName ?? '').trim().toLowerCase();
  const extensionIndex = normalizedFileName.lastIndexOf('.');
  if (extensionIndex === -1) {
    return null;
  }

  const extension = normalizedFileName.slice(extensionIndex + 1);
  return DOCUMENT_EXTENSION_TO_MIME[extension] ?? null;
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

function isPanelLinkIntentMessage(text: string): boolean {
  const normalized = normalizeForGreeting(text);
  if (!normalized) return false;

  return (
    /\b(link|url|acesso)\b/.test(normalized) &&
    /\b(site|painel|dashboard|app|sistema|plataforma|saldopro|saldo pro)\b/.test(normalized)
  ) || /\bme\s+(mande|manda|passa|passe)\s+o\s+link\s+d[oa]\s+(site|painel|dashboard|app|sistema|plataforma)\b/.test(normalized);
}

function buildPanelLinkReply(): string {
  return [
    'Aqui estao os links do SaldoPro:',
    `Site: ${env.webAppUrl}`,
    `Painel: ${env.appPanelUrl}`
  ].join('\n');
}

function buildRegistrationRequiredReply(): string {
  return [
    'Oi! Eu sou a IA do SaldoPro.',
    '',
    'Eu posso te ajudar a registrar gastos e receitas, criar lembretes e acompanhar seu controle financeiro pelo WhatsApp.',
    '',
    'Para eu te atender por aqui, primeiro voce precisa fazer seu cadastro no site.',
    `Faca seu cadastro aqui: ${env.appRegisterUrl}`,
    '',
    'Assim que terminar, pode me mandar mensagem novamente que eu continuo com voce.'
  ].join('\n');
}

const UNDO_KEYWORDS = ['desfaz', 'desfazer', 'desfaca', 'cancela', 'cancelar', 'errou', 'errei', 'anula', 'anular', 'desfizer'];

function isUndoMessage(text: string): boolean {
  const normalized = normalizeForGreeting(text);
  if (!normalized || normalized.length > 120) return false;
  return UNDO_KEYWORDS.some((kw) => normalized.includes(kw));
}

function buildDocumentSavedReply(title: string): string {
  return [
    `Arquivo salvo com sucesso como "${title}".`,
    '',
    `Quando quiser receber de volta, voce pode enviar: "me manda o arquivo ${title}".`,
    `Tambem funciona: "procura ${title}" ou "manda de volta ${title}".`
  ].join('\n');
}

function buildDocumentFetchReply(title: string): string {
  return [
    `Encontrei o arquivo "${title}" e estou te enviando agora.`,
    'Se quiser outra, me diga uma parte do nome ou da descricao.'
  ].join('\n');
}

function getDocumentExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized === 'multipart/x-zip'
  ) {
    return 'zip';
  }
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  return 'jpg';
}

function buildDocumentFileName(document: UserDocument): string {
  const baseName = document.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return `${baseName || `arquivo-${document.id.slice(0, 8)}`}.${getDocumentExtension(document.mimeType)}`;
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageKeyWithLid extends proto.IMessageKey {
  senderLid?: string | null;
  participantLid?: string | null;
  participantPn?: string | null;
  remoteJidAlt?: string | null;
}

const IMAGE_ONLY_FALLBACK_TEXT = 'Analise a imagem enviada. Se for um comprovante, recibo, nota fiscal ou boleto (com valores, datas, nomes de bancos, chave PIX, etc.), extraia os dados financeiros e registre automaticamente a transacao usando add_transaction. Se NAO for um documento financeiro (foto, print, screenshot, meme, etc.), responda pedindo ao usuario um titulo/nome para salvar a imagem como arquivo. NAO registre transacao se nao houver dados financeiros claros na imagem.';
const DOCUMENT_PENDING_TTL_MS = 10 * 60 * 1000;
const DOCUMENT_RECENT_LIMIT = 30;
const DOCUMENT_STRONG_MATCH_MIN_SCORE = 60;
const DOCUMENT_AMBIGUOUS_MIN_SCORE = 25;
const DOCUMENT_RESULT_GAP_MIN = 15;
const DOCUMENT_RECENCY_BONUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Mime types accepted for document upload (PDF and ZIP). */
const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip'
]);
const DOCUMENT_EXTENSION_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip'
};
const DOCUMENT_UNSUPPORTED_MEDIA_REPLY =
  'Por enquanto so consigo guardar imagens, PDFs e arquivos ZIP. Esse tipo de arquivo ainda nao e suportado.';
const DOCUMENT_PENDING_PROMPT_REPLY =
  'Recebi o arquivo. Me diga o titulo que voce quer usar para salvar. Exemplo: "comprovante de luz". Se quiser, voce tambem pode mandar: "comprovante de luz descricao conta de marco".';
const DOCUMENT_PENDING_PROMPT_FILE_REPLY =
  'Recebi o arquivo. Me diga o titulo que voce quer usar para salvar. Exemplo: "contrato de aluguel" ou "nota fiscal marco".';
const DOCUMENT_PENDING_CONFIRM_FILE_REPLY =
  'Recebi o arquivo e a legenda, mas ela nao deixou claro se voce quer salvar. Se quiser guardar, me diga o titulo que devo usar. Exemplo: "contrato de aluguel".';
const DOCUMENT_PENDING_CANCELLED_REPLY = 'Salvamento cancelado.';
const DOCUMENT_SAVE_ERROR_REPLY =
  'Nao consegui concluir essa operacao com arquivos agora. Tente novamente em instantes.';
const DOCUMENT_IMAGE_READ_ERROR_REPLY =
  'Recebi seu pedido para guardar o arquivo, mas nao consegui ler o conteudo enviado. Tente reenviar em alguns instantes.';
const DOCUMENT_PLAN_REQUIRED_REPLY =
  'Salvar e acessar imagens, PDFs e arquivos exige um plano ativo. Ative um plano no painel para liberar essa funcao.';
const FREE_WHATSAPP_LIMIT_REACHED_REPLY = [
  'Voce atingiu o limite gratis de mensagens no WhatsApp hoje.',
  'Assine um plano para continuar usando a IA sem travas e liberar o uso ilimitado.',
  `Entre no seu painel para assinar: ${env.appPanelUrl}`
].join('\n');
const WHATSAPP_GUEST_UID_PREFIX = 'wa_guest_';

const SIGNAL_CONSOLE_WARN_FILTERS = new Set([
  'Closing open session in favor of incoming prekey bundle'
]);
const SIGNAL_CONSOLE_INFO_FILTERS = new Set([
  'Closing session:'
]);

function shouldSuppressConsoleNoise(
  args: unknown[],
  filters: ReadonlySet<string>
): boolean {
  const [firstArg] = args;
  return typeof firstArg === 'string' && filters.has(firstArg);
}

function buildWhatsAppGuestUid(phone: string): string {
  const normalizedPhone = normalizePhoneNumber(phone).replace(/\D/g, '');
  return `${WHATSAPP_GUEST_UID_PREFIX}${normalizedPhone}`;
}

function isWhatsAppGuestUid(uid: string): boolean {
  return uid.startsWith(WHATSAPP_GUEST_UID_PREFIX);
}

function installSignalConsoleNoiseFilter(): void {
  const globalState = globalThis as typeof globalThis & {
    __saldoproSignalConsoleFilterInstalled?: boolean;
  };

  if (globalState.__saldoproSignalConsoleFilterInstalled) {
    return;
  }

  const originalWarn = console.warn.bind(console);
  const originalInfo = console.info.bind(console);

  console.warn = ((...args: unknown[]) => {
    if (shouldSuppressConsoleNoise(args, SIGNAL_CONSOLE_WARN_FILTERS)) {
      return;
    }
    originalWarn(...(args as Parameters<typeof console.warn>));
  }) as typeof console.warn;

  console.info = ((...args: unknown[]) => {
    if (shouldSuppressConsoleNoise(args, SIGNAL_CONSOLE_INFO_FILTERS)) {
      return;
    }
    originalInfo(...(args as Parameters<typeof console.info>));
  }) as typeof console.info;

  globalState.__saldoproSignalConsoleFilterInstalled = true;
}

type BaileysLogMeta = Record<string, unknown> | undefined;

function normalizeBaileysLogArgs(args: unknown[]): { message: string; meta: BaileysLogMeta } {
  if (typeof args[0] === 'string') {
    return {
      message: args[0],
      meta: typeof args[1] === 'object' && args[1] !== null
        ? args[1] as Record<string, unknown>
        : undefined
    };
  }

  return {
    message: typeof args[1] === 'string' ? args[1] : '',
    meta: typeof args[0] === 'object' && args[0] !== null
      ? args[0] as Record<string, unknown>
      : undefined
  };
}

function isTransientBaileysDecryptLog(message: string, meta: BaileysLogMeta): boolean {
  if (message === 'sent retry receipt') {
    return true;
  }

  if (message !== 'failed to decrypt message' || !meta) {
    return false;
  }

  const err = meta['err'];
  if (!err || typeof err !== 'object') {
    return false;
  }

  const errorName = typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : '';
  const errorMessage = typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : '';

  return (
    errorName === 'SessionError' &&
    errorMessage.includes('No matching sessions found for message')
  );
}

function createBaileysLogger(): WASocket['logger'] {
  const instance = {
    level: 'info',
    child: () => instance,
    trace: () => undefined,
    debug: () => undefined,
    info: (...args: unknown[]) => {
      const { message } = normalizeBaileysLogArgs(args);
      if (isTransientBaileysDecryptLog(message, undefined)) {
        return;
      }
    },
    warn: (...args: unknown[]) => {
      const { message, meta } = normalizeBaileysLogArgs(args);
      if (isTransientBaileysDecryptLog(message, meta)) {
        return;
      }

      if (message) {
        logger.warn(`Baileys: ${message}`, meta);
      }
    },
    error: (...args: unknown[]) => {
      const { message, meta } = normalizeBaileysLogArgs(args);
      if (isTransientBaileysDecryptLog(message, meta)) {
        return;
      }

      if (message) {
        logger.error(`Baileys: ${message}`, meta);
      }
    },
    fatal: (...args: unknown[]) => {
      const { message, meta } = normalizeBaileysLogArgs(args);
      if (message) {
        logger.error(`Baileys fatal: ${message}`, meta);
      }
    }
  };

  return instance as unknown as WASocket['logger'];
}

installSignalConsoleNoiseFilter();
const BAILEYS_LOGGER = createBaileysLogger();

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
const BAD_MAC_RECONNECT_THRESHOLD = 5;
/** After this many soft reconnects, restart the cycle but preserve auth state. */
const BAD_MAC_RECONNECT_CYCLE_AFTER = 3;
/** How long to keep unresolvable-LID messages buffered before discarding. */
const LID_BUFFER_TTL_MS = 120_000;
const LID_BUFFER_MAX_PER_JID = 15;
/** Debounce for bursts of creds.update events. */
const AUTH_SYNC_DEBOUNCE_MS = 1200;
/** Minimum interval between persisted auth snapshots to reduce write volume. */
const AUTH_SYNC_MIN_INTERVAL_MS = 3 * 60 * 1000;

interface WhatsAppClientOptions {
  slotId: WhatsAppSlotId;
  authDir: string;
  displayName?: string;
}

export class WhatsAppClient {
  private readonly slotId: WhatsAppSlotId;
  private readonly authDir: string;
  private readonly displayName: string;
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
  private readonly conversationByPhone = new Map<string, ConversationEntry[]>();
  private readonly badMacByJid = new Map<string, { count: number; lastAt: number; cleared: number }>();
  private readonly lidToPhoneJid = new Map<string, string>();
  private readonly sentMessagesCache = new Map<string, proto.IMessage>();

  private authSyncTimer: NodeJS.Timeout | null = null;
  private authSyncInFlight = false;
  private authSyncQueued = false;
  private authSyncQueuedForce = false;
  private lastAuthSnapshotHash: string | null = null;
  private lastAuthSyncAt = 0;
  private recoveringInvalidSession = false;
  private readonly aiCallTimestamps = new Map<string, number[]>();
  private softReconnectCount = 0;
  private connectionEpoch = 0;
  private lastOpenedAt = 0;

  // --- LID message buffer: store messages with unresolved LID for later replay ---
  private readonly pendingLidMessages = new Map<string, { message: proto.IWebMessageInfo; bufferedAt: number }[]>();

  // --- Message processing queue ---
  private readonly messageQueue: Array<() => Promise<void>> = [];
  private messageQueueActive = 0;
  private drainInProgress = false;

  // --- Per-user debounce for rapid messages ---
  private readonly userDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly userDebouncedMessages = new Map<string, proto.IWebMessageInfo[]>();

  constructor(options: WhatsAppClientOptions) {
    this.slotId = options.slotId;
    this.authDir = options.authDir;
    this.displayName = options.displayName?.trim() || options.slotId.toUpperCase();
  }

  async start(): Promise<void> {
    await mkdir(this.authDir, { recursive: true });
    await this.restoreAuthStateFromFirestoreIfNeeded();
    const files = await readdir(this.authDir);
    const hasSavedSession = files.some((f) => f.includes('creds'));
    logger.info('WhatsApp auth state', {
      slotId: this.slotId,
      authDir: this.authDir,
      filesFound: files.length,
      hasSavedSession
    });
    await this.connect();
  }

  async shutdown(): Promise<void> {
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
        (this.socket as { ws?: { close: () => void } }).ws?.close();
      } catch {
        // ignore cleanup errors
      }
    }
    this.socket = null;
  }

  getStatus(): RuntimeStatus {
    return {
      slotId: this.slotId,
      connected: this.connected,
      state: this.state,
      phone: this.phone,
      lastDisconnectReason: this.lastDisconnectReason
    };
  }

  getSlotId(): WhatsAppSlotId {
    return this.slotId;
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

  async sendText(to: string, text: string, ownerUid?: string, mediaUrl?: string): Promise<{ messageId: string }> {
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

    let jid = normalizePhoneToJid(to);

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
        logger.info('MSG_OUTBOUND_RESOLVE: resolved phone to registered JID', {
          slotId: this.slotId,
          requestedPhone: to,
          resolvedJid: jid
        });
      }
    } catch (err) {
      logger.warn('MSG_OUTBOUND_RESOLVE_FAIL: failed to verify number on WhatsApp, falling back to raw JID', {
        slotId: this.slotId,
        requestedPhone: to,
        error: err instanceof Error ? err.message : 'unknown'
      });
    }
    const customOptions = mediaUrl ? { image: { url: mediaUrl } } : undefined;
    const result = await this.sendWithRetry(jid, normalizedText, 'outbound', ownerUid, customOptions);
    if (ownerUid) {
      await this.appendConversationMessage(ownerUid, jidToPhone(jid), {
        role: 'assistant',
        content: mediaUrl ? `[Imagem Enviada] ${normalizedText}` : normalizedText
      });
    }
    return result;
  }

  async resetSession(): Promise<void> {
    logger.warn('Resetting WhatsApp session by API request', { slotId: this.slotId });
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
        } catch (error) {
          logger.warn('Socket logout failed during reset', {
            slotId: this.slotId,
            error
          });
        }
      } else {
        logger.debug('Skipping WhatsApp logout during reset because socket is not connected yet', {
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
        (this.socket as { ws?: { close: () => void } }).ws?.close();
      } catch {
        // ignore cleanup errors
      }
      this.socket = null;
    }

    this.clearAuthSyncTimer();
    this.authSyncQueued = false;
    this.lastAuthSnapshotHash = null;

    await rm(this.authDir, { recursive: true, force: true });
    await mkdir(this.authDir, { recursive: true });
    try {
      await clearWhatsAppAuthSnapshot(this.slotId);
    } catch (error) {
      logger.error('Failed to clear WhatsApp auth snapshot in Firestore', { slotId: this.slotId, error });
    }

    this.allowReconnect = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
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
        (this.socket as { ws?: { close: () => void } }).ws?.close();
      } catch {
        // ignore cleanup errors
      }
      this.socket = null;
    }

    const epoch = ++this.connectionEpoch;
    this.state = 'connecting';
    this.connected = false;

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    let version: [number, number, number];
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (error) {
      logger.warn('fetchLatestBaileysVersion failed, using fallback', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      version = [2, 3000, 1017531287];
    }

    const socket = makeWASocket({
      auth: state,
      version,
      logger: BAILEYS_LOGGER,
      printQRInTerminal: false,
      // Ignore status & groups at socket level: this bot only handles 1:1 chats.
      shouldIgnoreJid: (jid) => isStatusJid(jid) || isGroupJid(jid),
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
      if (this.connectionEpoch !== epoch) return;
      void saveCreds();
      if (this.lastAuthSyncAt === 0 || this.lastAuthSnapshotHash === null) {
        this.scheduleAuthStateSync(true);
        return;
      }
      this.scheduleAuthStateSync();
    });
    socket.ev.on('connection.update', (update) => {
      if (this.connectionEpoch !== epoch) return;
      void this.handleConnectionUpdate(update);
    });
    socket.ev.on('messages.upsert', (upsert) => {
      if (this.connectionEpoch !== epoch) return;
      void this.handleMessagesUpsert(upsert as { type: string; messages: proto.IWebMessageInfo[] });
    });
    socket.ev.on('chats.phoneNumberShare', (event) => {
      if (this.connectionEpoch !== epoch) return;
      this.rememberLidMapping(event.lid, event.jid, 'phone_number_share');
    });
    socket.ev.on('contacts.upsert', (contacts) => {
      if (this.connectionEpoch !== epoch) return;
      this.absorbContactLidMappings(contacts, 'contacts_upsert');
    });
    socket.ev.on('contacts.update', (contacts) => {
      if (this.connectionEpoch !== epoch) return;
      this.absorbContactLidMappings(contacts, 'contacts_update');
    });
    // messaging-history.set carries contacts from history sync — main source of LID→phone mappings
    socket.ev.on('messaging-history.set', (history) => {
      if (this.connectionEpoch !== epoch) return;
      if (history.contacts && history.contacts.length > 0) {
        logger.info('HISTORY_SYNC: received contacts with potential LID mappings', {
          slotId: this.slotId,
          contactCount: history.contacts.length
        });
        this.absorbContactLidMappings(history.contacts, 'contacts_upsert');
      }
    });

    // CRITICAL: Hook into raw WebSocket stanzas to capture sender_pn from node attributes.
    // Baileys has sender_pn in retry receipt nodes but may also include it in some
    // initial message nodes. We intercept it BEFORE Baileys processes the message.
    const ws = socket.ws as { on?: (event: string, listener: (...args: unknown[]) => void) => void };
    if (ws && typeof ws.on === 'function') {
      ws.on('CB:message', (node: unknown) => {
        if (this.connectionEpoch !== epoch) return;
        const attrs = (node as { attrs?: Record<string, string> })?.attrs;
        if (!attrs) return;
        const from = attrs.from;
        const senderPn = attrs.sender_pn;
        if (from && from.endsWith('@lid') && senderPn && senderPn.includes('@s.whatsapp.net')) {
          this.rememberLidMapping(from, senderPn, 'message_candidate');
          logger.info('CB_MESSAGE_SENDER_PN: extracted phone from raw node', {
            slotId: this.slotId,
            lidJid: from,
            senderPn
          });
        } else if (from && from.endsWith('@lid') && !senderPn) {
          logger.info('CB_MESSAGE_NO_SENDER_PN: LID message without sender_pn', {
            slotId: this.slotId,
            lidJid: from,
            availableAttrs: Object.keys(attrs).join(',')
          });
        }
      });
      // Also listen for CB:receipt which carries sender_pn in retry receipts
      ws.on('CB:receipt', (node: unknown) => {
        if (this.connectionEpoch !== epoch) return;
        const attrs = (node as { attrs?: Record<string, string> })?.attrs;
        if (!attrs) return;
        const from = attrs.from;
        const senderPn = attrs.sender_pn;
        if (from && from.endsWith('@lid') && senderPn && senderPn.includes('@s.whatsapp.net')) {
          this.rememberLidMapping(from, senderPn, 'message_candidate');
          logger.info('CB_RECEIPT_SENDER_PN: extracted phone from receipt node', {
            slotId: this.slotId,
            lidJid: from,
            senderPn
          });
        }
      });
      logger.info('Raw CB:message/CB:receipt listeners registered for sender_pn extraction', { slotId: this.slotId });
    }

    logger.info('WhatsApp socket initialized', { slotId: this.slotId, displayName: this.displayName, epoch });
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
      this.lastOpenedAt = Date.now();
      this.phone = jidToPhone(this.socket?.user?.id) || null;
      this.badMacByJid.clear();
      this.softReconnectCount = 0;
      this.clearQr();
      void this.syncAuthStateNow(true);
      this.scheduleAuthStateSync();

      // Log the bot's own LID for debugging self-chat detection
      const socketUser = this.socket?.user as { id?: string; lid?: string } | undefined;
      logger.info('WhatsApp connection opened', {
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
      logger.warn('WhatsApp connection closed', { slotId: this.slotId, code, reason });

      const shouldForceRelogin =
        this.allowReconnect &&
        (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession);

      if (shouldForceRelogin) {
        logger.warn('Invalid WhatsApp session detected, forcing fresh login to generate new QR', {
          slotId: this.slotId,
          code,
          reason
        });
        void this.recoverFromInvalidSession();
        return;
      }

      // In Render deploys, two instances can overlap briefly and trigger
      // "connection_replaced". Do NOT wipe auth state in this case.
      if (this.allowReconnect && code === DisconnectReason.connectionReplaced) {
        logger.warn('WhatsApp connection replaced; preserving auth state and retrying later', {
          slotId: this.slotId,
          code,
          reason
        });
        this.scheduleReconnect(20000);
        return;
      }

      const shouldReconnect =
        this.allowReconnect &&
        code !== DisconnectReason.loggedOut &&
        code !== DisconnectReason.forbidden;

      if (shouldReconnect) {
        // If connection was open less than 5s, it's likely unstable — back off longer
        const uptime = this.lastOpenedAt ? Date.now() - this.lastOpenedAt : Infinity;
        const delay = uptime < 5000 ? 5000 : 2000;
        this.scheduleReconnect(delay);
      }
    }
  }

  private async handleMessagesUpsert(upsert: {
    type: string;
    messages: proto.IWebMessageInfo[];
  }): Promise<void> {
    if (upsert.type !== 'notify' && upsert.type !== 'append') {
      logger.info('MSG_UPSERT_SKIP: unsupported upsert type', {
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
  private enqueueMessage(message: proto.IWebMessageInfo): void {
    const key = message.key;
    const remoteJid = key?.remoteJid ?? '';
    // Use the raw remoteJid as debounce key — same sender = same key
    const debounceKey = remoteJid || `unknown_${Date.now()}`;

    // If this is a LID, status, group, fromMe, or has no remoteJid, skip debounce
    const shouldDebounce =
      remoteJid &&
      !isStatusJid(remoteJid) &&
      !isGroupJid(remoteJid) &&
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

    logger.info('MSG_DEBOUNCE: buffering rapid message', {
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

      if (messages.length === 0) return;

      logger.info('MSG_DEBOUNCE_FLUSH: processing batched messages', {
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
  private enqueueTask(message: proto.IWebMessageInfo): void {
    const task = async (): Promise<void> => {
      try {
        await this.handleSingleIncomingMessage(message);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '';
        if (isExpectedMediaDecryptError(error)) {
          const remoteJid = message.key?.remoteJid ?? 'unknown';
          const messageId = message.key?.id ?? 'unknown';
          await this.registerBadMac(message, errorMsg);
          logger.warn('Signal decryption error detected; ignoring message while recovery stays in place', {
            slotId: this.slotId,
            remoteJid,
            messageId,
            error: error instanceof Error ? error.message : 'unknown'
          });
          return;
        }
        logger.error('Failed processing inbound message', error);
      }
    };

    this.messageQueue.push(task);
    void this.drainMessageQueue();
  }

  private async drainMessageQueue(): Promise<void> {
    // Prevent concurrent drain loops from competing for the same slots
    if (this.drainInProgress) return;
    this.drainInProgress = true;

    try {
      while (this.messageQueue.length > 0 && this.messageQueueActive < MESSAGE_QUEUE_CONCURRENCY) {
        const task = this.messageQueue.shift();
        if (!task) break;

        this.messageQueueActive += 1;
        task().finally(() => {
          this.messageQueueActive -= 1;
          void this.drainMessageQueue();
        });
      }
    } finally {
      this.drainInProgress = false;
    }
  }

  private async handleSingleIncomingMessage(message: proto.IWebMessageInfo): Promise<void> {
    const key = message.key;
    if (!key) return;

    const messageId = key.id ?? '';
    if (!messageId) return;

    if (this.alreadyProcessedInbound(messageId)) return;

    const rawRemoteJid = key.remoteJid ?? '';
    const remoteJid = this.resolveIncomingRemoteJid(key);
    if (!remoteJid || isStatusJid(remoteJid) || isGroupJid(remoteJid)) return;
    const remotePhone = jidToPhone(remoteJid);
    // CRITICAL: Always reply to the resolved phone JID (@s.whatsapp.net).
    // Sending directly to @lid causes encryption session errors ("Aguardando mensagem")
    // on iOS because the mobile app expects replies to arrive on the standard phone jid.
    const replyJid = remoteJid;

    if (this.phone && remotePhone === this.phone) {
      this.rememberInbound(messageId);
      logger.info('MSG_SKIP: own-number chat ignored', {
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
      logger.info('MSG_SKIP: fromMe message ignored', {
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
      logger.warn('MSG_BUFFER: unresolved LID remoteJid, buffered for retry', {
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
      logger.warn('MSG_DECRYPT_FAIL: missing payload with LID identity (Bad MAC), awaiting retry', {
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
      logger.warn('MSG_DECRYPT_FAIL: empty payload (decrypt failure), awaiting Baileys retry', {
        slotId: this.slotId,
        messageId,
        remoteJid,
        rawRemoteJid,
        fromMe: Boolean(key.fromMe),
        isFromLid: rawRemoteJid?.endsWith('@lid') ?? false
      });
      return;
    }

    logger.info('MSG_RECV: new inbound message', {
      messageId,
      from: remotePhone,
      fromMe: Boolean(key.fromMe),
      rawRemoteJid,
      replyJid,
      rawType: extractRawType(message),
      textPreview: extractMessageText(message).slice(0, 50)
    });

    const alreadyInFirestore = await inboundMessageExists(messageId, this.slotId, this.processedInboundIds);
    if (alreadyInFirestore) {
      this.rememberInbound(messageId);
      logger.info('MSG_SKIP: already processed', { messageId });
      return;
    }

    const waTimestamp = message.messageTimestamp ? Number(message.messageTimestamp) : null;
    const timestamp = waTimestamp ? new Date(waTimestamp * 1000).toISOString() : new Date().toISOString();
    const text = extractMessageText(message);
    const rawType = extractRawType(message);
    const isDocumentUpload = isDocumentMessage(message);
    const documentMimeType = isDocumentUpload ? (getDocumentMimeType(message) ?? '').toLowerCase() : '';
    const documentFileName = isDocumentUpload ? getDocumentFileName(message) : null;
    const isAllowedDocument =
      isDocumentUpload && Boolean(resolveSupportedDocumentMimeType(documentMimeType, documentFileName));
    const hasImageAttachment = isImageMessage(message);
    const imageDataUrl = await this.extractInboundImageDataUrl(message);
    const audioDataUrl = await this.extractInboundAudioDataUrl(message);
    const inboundText = text.trim();

    // Extract document data URL for allowed document types (PDF/ZIP)
    const documentDataUrl = isAllowedDocument ? await this.extractInboundDocumentDataUrl(message) : null;

    // Skip messages with no usable content (e.g. decryption failures)
    if (!inboundText && !imageDataUrl && !audioDataUrl && !isDocumentUpload) {
      this.rememberInbound(messageId);
      logger.info('MSG_SKIP: empty message (likely decryption failure or unsupported media), ignoring', {
        messageId,
        rawType,
        hasAudioDataUrl: Boolean(audioDataUrl),
        from: remotePhone
      });
      return;
    }

    let binding = await getPhoneBinding(remotePhone);
    let bindingJustVerified = false;

    logger.info('MSG_BIND: phone binding lookup', {
      phone: remotePhone,
      found: Boolean(binding),
      uid: binding?.uid ?? null
    });

    if (binding) {
      let stillAllowed: boolean;
      try {
        stillAllowed = await isPhoneAllowedForUid(binding.uid, remotePhone);
      } catch (allowedError) {
        logger.error('MSG_ALLOWED_CHECK_ERROR: isPhoneAllowedForUid threw, treating as allowed to avoid silent drop', {
          phone: remotePhone,
          uid: binding.uid,
          error: allowedError instanceof Error ? allowedError.message : 'unknown'
        });
        stillAllowed = true;
      }
      logger.info('MSG_ALLOWED: phone permission check result', {
        phone: remotePhone,
        uid: binding.uid,
        stillAllowed
      });
      if (!stillAllowed) {
        logger.info('MSG_STALE_BINDING: old binding no longer allowed, dropping to re-resolve', {
          phone: remotePhone,
          oldUid: binding.uid
        });
        binding = null; // force re-resolve below
      } else {
        bindingJustVerified = true;
      }
    }

    // Se não há binding (ou era stale), tenta auto-vincular pelo número cadastrado na conta
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
          bindingJustVerified = true;
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
      const guestUid = buildWhatsAppGuestUid(remotePhone);
      try {
        await bootstrapUserData(guestUid, {
          email: `${guestUid}@whatsapp.local`,
          displayName: `WhatsApp ${normalizePhoneNumber(remotePhone).slice(-4)}`,
          phone: remotePhone
        });

        binding = await getPhoneBinding(remotePhone);
        if (binding?.uid !== guestUid) {
          await savePhoneBinding(remotePhone, guestUid);
          binding = {
            phone: normalizePhoneNumber(remotePhone),
            uid: guestUid,
            linkedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        }

        bindingJustVerified = true;
        logger.info('MSG_GUEST_PROVISION: provisioned temporary WhatsApp account', {
          phone: remotePhone,
          uid: guestUid
        });
      } catch (guestProvisionError) {
        logger.error('MSG_GUEST_PROVISION_FAIL: unable to provision temporary WhatsApp account', {
          phone: remotePhone,
          uid: guestUid,
          error: guestProvisionError instanceof Error ? guestProvisionError.message : 'unknown'
        });
      }
    }

    if (!binding) {
      logger.info('MSG_UNLINKED: no binding found or allowed, asking user to register', { from: remotePhone });
      await this.handleUnlinkedMessage(replyJid, remotePhone);
      this.rememberInbound(messageId);
      return;
    }

    const ownerActive = isWhatsAppGuestUid(binding.uid) ? true : await isFirebaseUserActive(binding.uid);
    if (!ownerActive) {
      logger.warn('MSG_BLOCKED_USER: ignoring inbound WhatsApp message for blocked/unavailable account', {
        uid: binding.uid,
        phone: remotePhone
      });
      this.rememberInbound(messageId);
      return;
    }

    const inboundRecord: WhatsAppMessageRecord = {
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

    await saveMessageSafe(inboundRecord);
    this.rememberInbound(messageId);

    if (isDocumentUpload && !isAllowedDocument) {
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

    if (isAllowedDocument && !documentDataUrl) {
      const readErrorReply = 'Nao consegui ler o arquivo enviado. Tente reenviar em alguns instantes.';
      await this.sendWithRetry(replyJid, readErrorReply, 'auto_reply', binding.uid);
      await this.appendConversationMessage(binding.uid, remotePhone, {
        role: 'user',
        content: inboundText || 'Documento enviado no WhatsApp.'
      });
      await this.appendConversationMessage(binding.uid, remotePhone, {
        role: 'assistant',
        content: readErrorReply
      });
      return;
    }

    logger.info('MSG_AI: sending to AI for reply', {
      uid: binding.uid,
      phone: remotePhone,
      textLength: inboundText.length,
      hasImage: Boolean(imageDataUrl),
      hadImageAttachment: hasImageAttachment,
      hasAudio: Boolean(audioDataUrl)
    });

    await this.sendSmartReply(
      binding.uid,
      replyJid,
      remotePhone,
      inboundText,
      imageDataUrl,
      audioDataUrl,
      hasImageAttachment,
      documentDataUrl
    );
  }

  private isPlanBlockedDocumentAttempt(
    inboundText: string,
    imageDataUrl: string | null,
    hasImageAttachment: boolean,
    documentDataUrl: string | null,
    hasPendingDraft: boolean
  ): boolean {
    if (documentDataUrl || imageDataUrl || hasImageAttachment) {
      return true;
    }

    if (hasPendingDraft && inboundText.trim().length > 0) {
      return true;
    }

    if (detectDocumentSaveIntent(inboundText).matched) {
      return true;
    }

    return detectDocumentFetchIntent(inboundText).matched;
  }

  private async tryConsumeFreeWhatsAppQuotaOrReply(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    hasUnlimitedAi: boolean
  ): Promise<boolean> {
    if (hasUnlimitedAi) {
      return true;
    }

    try {
      const quotaResult = await consumeFreeWhatsAppQuota(ownerUid);
      if (quotaResult.allowed) {
        return true;
      }
    } catch (error) {
      logger.error('WHATSAPP_FREE_QUOTA_CONSUME_FAILED', {
        uid: ownerUid,
        phone: remotePhone,
        error: error instanceof Error ? error.message : 'unknown'
      });

      try {
        const quotaState = await getFreeWhatsAppQuotaState(ownerUid, true);
        if (quotaState.remaining > 0) {
          logger.warn('WHATSAPP_FREE_QUOTA_FALLBACK_ALLOW', {
            uid: ownerUid,
            phone: remotePhone,
            remaining: quotaState.remaining
          });
          return true;
        }
      } catch (fallbackError) {
        logger.error('WHATSAPP_FREE_QUOTA_FALLBACK_FAILED', {
          uid: ownerUid,
          phone: remotePhone,
          error: fallbackError instanceof Error ? fallbackError.message : 'unknown'
        });
        return true;
      }
    }

    await this.sendDocumentTextReply(
      ownerUid,
      remoteJid,
      remotePhone,
      FREE_WHATSAPP_LIMIT_REACHED_REPLY,
      '[Plano requerido] limite gratis diario'
    );
    return false;
  }

  private async sendSmartReply(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    inboundText: string,
    imageDataUrl: string | null,
    audioDataUrl: string | null = null,
    hasImageAttachment = false,
    documentDataUrl: string | null = null
  ): Promise<void> {
    const hasInboundInput = inboundText.trim().length > 0 || Boolean(imageDataUrl) || Boolean(audioDataUrl) || Boolean(documentDataUrl);

    if (hasInboundInput && isPanelLinkIntentMessage(inboundText)) {
      const panelLinkReply = buildPanelLinkReply();
      await this.sendWithRetry(remoteJid, panelLinkReply, 'auto_reply', ownerUid);
      await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
      await this.appendConversationMessage(ownerUid, remotePhone, {
        role: 'assistant',
        content: panelLinkReply
      });
      return;
    }

    const planAccess = await getUserPlanAccess(ownerUid);

    if (!planAccess.features.whatsappDocumentStorage && hasInboundInput) {
      const activeDraft = await this.getUsablePendingDocumentDraft(ownerUid, remotePhone);
      if (
        this.isPlanBlockedDocumentAttempt(
          inboundText,
          imageDataUrl,
          hasImageAttachment,
          documentDataUrl,
          Boolean(activeDraft)
        )
      ) {
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          DOCUMENT_PLAN_REQUIRED_REPLY,
          '[Plano requerido] documentos bloqueados'
        );
        return;
      }
    }

    if (planAccess.features.whatsappDocumentStorage && hasInboundInput) {
      try {
        const handledByDocumentFlow = await this.handleDocumentRouting(
          ownerUid,
          remoteJid,
          remotePhone,
          inboundText,
          imageDataUrl,
          audioDataUrl,
          hasImageAttachment,
          documentDataUrl
        );
        if (handledByDocumentFlow) {
          logger.info('MSG_DOCUMENT_FLOW_HANDLED', {
            uid: ownerUid,
            phone: remotePhone,
            hasImage: Boolean(imageDataUrl),
            hadImageAttachment: hasImageAttachment,
            hasAudio: Boolean(audioDataUrl),
            textLength: inboundText.trim().length
          });
          return;
        }
      } catch (documentFlowError) {
        logger.error('MSG_DOCUMENT_FLOW_ERROR: Failed to process document flow', {
          uid: ownerUid,
          phone: remotePhone,
          error: documentFlowError instanceof Error ? documentFlowError.message : 'unknown'
        });
        const replyText = documentFlowError instanceof DocumentUploadUserError
          ? documentFlowError.userMessage
          : DOCUMENT_SAVE_ERROR_REPLY;
        await this.sendWithRetry(remoteJid, replyText, 'auto_reply', ownerUid);
        return;
      }
    }

    if (env.whatsappAiEnabled && hasInboundInput) {
      if (!planAccess.features.whatsappUnlimitedAi && planAccess.freeWhatsappQuota.remaining <= 0) {
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          FREE_WHATSAPP_LIMIT_REACHED_REPLY,
          '[Plano requerido] limite gratis diario'
        );
        return;
      }

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

      // Quick undo: detect "desfaz", "cancela", "errou" etc. and revert last action
      if (isUndoMessage(inboundText)) {
        try {
          const undoReply = await undoLastAction(ownerUid);
          if (!(await this.tryConsumeFreeWhatsAppQuotaOrReply(
            ownerUid,
            remoteJid,
            remotePhone,
            planAccess.features.whatsappUnlimitedAi
          ))) {
            return;
          }

          await this.sendWithRetry(remoteJid, undoReply, 'auto_reply', ownerUid);
          await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
          await this.appendConversationMessage(ownerUid, remotePhone, { role: 'assistant', content: undoReply });
          return;
        } catch (undoError) {
          logger.error('Failed to process undo action', undoError);
        }
      }

      try {
        const reminderShortcutReply = await handleReminderShortcut(ownerUid, inboundText);
        if (reminderShortcutReply) {
          if (!(await this.tryConsumeFreeWhatsAppQuotaOrReply(
            ownerUid,
            remoteJid,
            remotePhone,
            planAccess.features.whatsappUnlimitedAi
          ))) {
            return;
          }

          await this.sendWithRetry(remoteJid, reminderShortcutReply, 'auto_reply', ownerUid);
          await this.appendConversationMessage(ownerUid, remotePhone, { role: 'user', content: inboundText.trim() });
          await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: reminderShortcutReply
          });
          return;
        }
      } catch (shortcutError) {
        logger.error('Failed to process reminder shortcut', shortcutError);
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
          if (!(await this.tryConsumeFreeWhatsAppQuotaOrReply(
            ownerUid,
            remoteJid,
            remotePhone,
            planAccess.features.whatsappUnlimitedAi
          ))) {
            return;
          }

          const payload = aiPipelineResult.aiReply.trim() || 'Aqui está a imagem solicitada:';
          await this.sendWithRetry(remoteJid, payload, 'auto_reply', ownerUid, { image: { url: aiPipelineResult.mediaUrl } });
          await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: `[Imagem Enviada] ${payload}`
          });
          return;
        }

        if (aiPipelineResult.aiReply.trim()) {
          if (!(await this.tryConsumeFreeWhatsAppQuotaOrReply(
            ownerUid,
            remoteJid,
            remotePhone,
            planAccess.features.whatsappUnlimitedAi
          ))) {
            return;
          }

          await this.sendWithRetry(remoteJid, aiPipelineResult.aiReply.trim(), 'auto_reply', ownerUid);
          await this.appendConversationMessage(ownerUid, remotePhone, {
            role: 'assistant',
            content: aiPipelineResult.aiReply.trim()
          });
          return;
        }
      } catch (error) {
        logger.error('MSG_AI_ERROR: Failed to process AI WhatsApp message', {
          uid: ownerUid,
          phone: remotePhone,
          error: error instanceof Error ? error.message : 'unknown',
          stack: error instanceof Error ? error.stack : undefined
        });
        // Send friendly error message instead of silent failure
        const errorMsg = 'Desculpe, estou com dificuldade para processar agora. Tente novamente em instantes.';
        try {
          await this.sendWithRetry(remoteJid, errorMsg, 'auto_reply', ownerUid);
        } catch (sendError) {
          logger.error('Failed to send AI error fallback message', sendError);
        }
        return;
      } finally {
        stopTypingPresence();
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

  private async handleDocumentRouting(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    inboundText: string,
    imageDataUrl: string | null,
    audioDataUrl: string | null,
    hasImageAttachment: boolean,
    documentDataUrl: string | null = null
  ): Promise<boolean> {
    const activeDraft = await this.getUsablePendingDocumentDraft(ownerUid, remotePhone);
    const saveIntent = detectDocumentSaveIntent(inboundText);

    // --- PDF/ZIP document upload: only save immediately when the caption clearly asks to save and includes a usable title ---
    if (documentDataUrl) {
      if (activeDraft) {
        await this.clearPendingDocumentDraft(activeDraft);
      }

      const labelCandidate = saveIntent.matched ? saveIntent.labelCandidate : '';
      const captionText = inboundText.trim();

      if (!captionText) {
        await this.createPendingDocumentDraftFromDataUrl(ownerUid, remotePhone, documentDataUrl);
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          DOCUMENT_PENDING_PROMPT_FILE_REPLY,
          '[Arquivo pendente] aguardando nome'
        );
      } else if (saveIntent.matched && isMeaningfulDocumentLabel(labelCandidate)) {
        const title = await this.saveReadyDocumentFromDataUrl(ownerUid, documentDataUrl, labelCandidate);
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          buildDocumentSavedReply(title),
          `[Arquivo salvo] ${title}`
        );
      } else {
        await this.createPendingDocumentDraftFromDataUrl(ownerUid, remotePhone, documentDataUrl);
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          saveIntent.matched ? DOCUMENT_PENDING_PROMPT_FILE_REPLY : DOCUMENT_PENDING_CONFIRM_FILE_REPLY,
          '[Arquivo pendente] aguardando nome'
        );
      }
      return true;
    }

    if (hasImageAttachment && !imageDataUrl && saveIntent.matched) {
      logger.warn('DOC_SAVE_SKIPPED_NO_IMAGE_DATA: explicit save requested but image payload was unavailable', {
        uid: ownerUid,
        phone: remotePhone,
        textLength: inboundText.trim().length
      });
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        DOCUMENT_IMAGE_READ_ERROR_REPLY,
        '[Arquivo nao salvo] falha ao ler imagem'
      );
      return true;
    }

    if (imageDataUrl) {
      if (saveIntent.matched) {
        await this.handleExplicitDocumentSave(
          ownerUid,
          remoteJid,
          remotePhone,
          imageDataUrl,
          saveIntent.labelCandidate,
          activeDraft
        );
        return true;
      }
    }

    if (activeDraft && inboundText.trim() && !imageDataUrl && !audioDataUrl && !documentDataUrl) {
      await this.handlePendingDocumentFollowUp(ownerUid, remoteJid, remotePhone, inboundText, activeDraft);
      return true;
    }

    if (!imageDataUrl && !audioDataUrl && !documentDataUrl && inboundText.trim()) {
      const fetchIntent = detectDocumentFetchIntent(inboundText);
      if (fetchIntent.matched) {
        await this.handleDocumentFetchRequest(ownerUid, remoteJid, remotePhone, fetchIntent.query);
        return true;
      }
    }

    return false;
  }

  private async getUsablePendingDocumentDraft(
    ownerUid: string,
    remotePhone: string
  ): Promise<PendingWhatsAppDocumentDraft | null> {
    const draft = await getActivePendingWhatsAppDocumentDraft(ownerUid, remotePhone);
    if (!draft) return null;

    const expiresAt = Date.parse(draft.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return draft;
    }

    logger.info('DOC_PENDING_EXPIRED: cleaning expired document draft', {
      uid: ownerUid,
      phone: remotePhone,
      draftId: draft.id
    });

    await this.clearPendingDocumentDraft(draft);
    return null;
  }

  private async clearPendingDocumentDraft(draft: PendingWhatsAppDocumentDraft): Promise<void> {
    try {
      await deleteStoredDocument(draft.storagePath);
    } catch (error) {
      logger.warn('DOC_PENDING_DELETE_FILE_FAIL: failed to delete pending document file', {
        draftId: draft.id,
        storagePath: draft.storagePath,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }

    try {
      await deletePendingWhatsAppDocumentDraft(draft.id);
    } catch (error) {
      logger.warn('DOC_PENDING_DELETE_ROW_FAIL: failed to delete pending document row', {
        draftId: draft.id,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  private buildDocumentMetadata(labelSource: string): {
    title: string;
    description: string | null;
    normalizedTitle: string;
    normalizedDescription: string | null;
    searchTokens: string[];
  } {
    const cleaned = labelSource.trim().replace(/\s+/g, ' ');
    const parsed = parseDocumentLabelInput(cleaned);
    const title = (parsed.title || cleaned).slice(0, 80);
    const description = (parsed.description || '').slice(0, 300) || null;
    const normalizedTitle = normalizeDocumentText(title);
    const normalizedDescription = description ? normalizeDocumentText(description) : null;
    const searchTokens = [...new Set([
      ...tokenizeDocumentSearch(title),
      ...tokenizeDocumentSearch(description ?? '')
    ])];

    return {
      title,
      description,
      normalizedTitle,
      normalizedDescription,
      searchTokens
    };
  }

  private async saveReadyDocumentFromDataUrl(
    ownerUid: string,
    fileDataUrl: string,
    labelSource: string
  ): Promise<string> {
    const metadata = this.buildDocumentMetadata(labelSource);
    logger.info('DOC_SAVE_START', {
      uid: ownerUid,
      title: metadata.title
    });
    const upload = await uploadPendingDocument(ownerUid, fileDataUrl);
    const documentId = randomUUID();
    let currentStoragePath = upload.storagePath;

    try {
      currentStoragePath = await finalizePendingDocumentMove(ownerUid, upload.storagePath, documentId, upload.mimeType);
      await createUserDocument(ownerUid, {
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
      logger.info('DOC_SAVE_SUCCESS', {
        uid: ownerUid,
        documentId,
        storagePath: currentStoragePath,
        title: metadata.title,
        sizeBytes: upload.sizeBytes
      });
      return metadata.title;
    } catch (error) {
      try {
        await deleteStoredDocument(currentStoragePath);
      } catch (cleanupError) {
        logger.warn('DOC_SAVE_CLEANUP_FAIL: failed to cleanup storage after save error', {
          storagePath: currentStoragePath,
          error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
        });
      }
      throw error;
    }
  }

  private async createPendingDocumentDraftFromDataUrl(
    ownerUid: string,
    remotePhone: string,
    fileDataUrl: string
  ): Promise<void> {
    const upload = await uploadPendingDocument(ownerUid, fileDataUrl);

    try {
      await createPendingWhatsAppDocumentDraft(ownerUid, remotePhone, {
        id: upload.draftId,
        storagePath: upload.storagePath,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        expiresAt: new Date(Date.now() + DOCUMENT_PENDING_TTL_MS).toISOString(),
        pendingReason: 'missing_title'
      });
    } catch (error) {
      try {
        await deleteStoredDocument(upload.storagePath);
      } catch (cleanupError) {
        logger.warn('DOC_PENDING_CREATE_CLEANUP_FAIL: failed to cleanup pending upload after DB error', {
          storagePath: upload.storagePath,
          error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
        });
      }
      throw error;
    }
  }

  private async finalizePendingDocumentDraft(
    ownerUid: string,
    draft: PendingWhatsAppDocumentDraft,
    labelSource: string
  ): Promise<string> {
    const metadata = this.buildDocumentMetadata(labelSource);
    logger.info('DOC_PENDING_FINALIZE_START', {
      uid: ownerUid,
      draftId: draft.id,
      title: metadata.title
    });
    const documentId = randomUUID();
    let movedToFinal = false;
    let finalStoragePath = draft.storagePath;

    try {
      finalStoragePath = await finalizePendingDocumentMove(ownerUid, draft.storagePath, documentId, draft.mimeType);
      movedToFinal = true;

      await createUserDocument(ownerUid, {
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
      await deletePendingWhatsAppDocumentDraft(draft.id);
      logger.info('DOC_PENDING_FINALIZE_SUCCESS', {
        uid: ownerUid,
        draftId: draft.id,
        documentId,
        storagePath: finalStoragePath,
        title: metadata.title,
        sizeBytes: draft.sizeBytes
      });
      return metadata.title;
    } catch (error) {
      if (movedToFinal) {
        try {
          await deleteStoredDocument(finalStoragePath);
        } catch (cleanupError) {
          logger.warn('DOC_PENDING_FINALIZE_CLEANUP_FAIL: failed to cleanup moved file after error', {
            storagePath: finalStoragePath,
            error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
          });
        }

        try {
          await deletePendingWhatsAppDocumentDraft(draft.id);
        } catch (cleanupError) {
          logger.warn('DOC_PENDING_FINALIZE_ROW_FAIL: failed to cleanup pending draft after finalize error', {
            draftId: draft.id,
            error: cleanupError instanceof Error ? cleanupError.message : 'unknown'
          });
        }
      }
      throw error;
    }
  }

  private async sendDocumentTextReply(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    reply: string,
    syntheticUserContent?: string
  ): Promise<void> {
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

  private async handleExplicitDocumentSave(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    imageDataUrl: string,
    labelCandidate: string,
    existingDraft: PendingWhatsAppDocumentDraft | null
  ): Promise<void> {
    if (existingDraft) {
      await this.clearPendingDocumentDraft(existingDraft);
    }

    if (!isMeaningfulDocumentLabel(labelCandidate)) {
      await this.createPendingDocumentDraftFromDataUrl(ownerUid, remotePhone, imageDataUrl);

      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        DOCUMENT_PENDING_PROMPT_REPLY,
        '[Arquivo pendente] aguardando nome'
      );
      return;
    }

    const title = await this.saveReadyDocumentFromDataUrl(ownerUid, imageDataUrl, labelCandidate);
    await this.sendDocumentTextReply(
      ownerUid,
      remoteJid,
      remotePhone,
      buildDocumentSavedReply(title),
      `[Arquivo salvo] ${title}`
    );
  }

  private async handlePendingDocumentFollowUp(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    inboundText: string,
    draft: PendingWhatsAppDocumentDraft
  ): Promise<void> {
    const normalized = normalizeDocumentText(inboundText);
    if (normalized === 'cancelar' || normalized === 'cancela') {
      await this.clearPendingDocumentDraft(draft);
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        DOCUMENT_PENDING_CANCELLED_REPLY,
        '[Arquivo pendente] cancelado'
      );
      return;
    }

    if (!isMeaningfulDocumentLabel(inboundText)) {
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        DOCUMENT_PENDING_PROMPT_REPLY,
        '[Arquivo pendente] aguardando nome'
      );
      return;
    }

    const title = await this.finalizePendingDocumentDraft(ownerUid, draft, inboundText);
    await this.sendDocumentTextReply(
      ownerUid,
      remoteJid,
      remotePhone,
      buildDocumentSavedReply(title),
      `[Arquivo salvo] ${title}`
    );
  }

  private async handleDocumentFetchRequest(
    ownerUid: string,
    remoteJid: string,
    remotePhone: string,
    query: string
  ): Promise<void> {
    logger.info('DOC_FETCH_START', {
      uid: ownerUid,
      phone: remotePhone,
      query
    });
    const documents = await listRecentUserDocuments(ownerUid, DOCUMENT_RECENT_LIMIT);
    if (documents.length === 0) {
      logger.info('DOC_FETCH_NONE: user has no saved documents', {
        uid: ownerUid,
        phone: remotePhone
      });
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        'Nao encontrei nenhum arquivo com esse nome ou descricao.',
        `[Arquivo solicitado] ${query || '(sem filtro)'}`
      );
      return;
    }

    const normalizedQuery = normalizeDocumentText(query);
    let shouldSendDirect = false;
    let candidates: RankedDocumentMatch[] = [];

    if (!normalizedQuery) {
      candidates = documents.map((document) => ({ document, score: 0 }));
      shouldSendDirect = documents.length === 1;
    } else {
      const ranked = scoreRecentDocuments(documents, query);
      const top = ranked[0];
      const second = ranked[1];
      const diffToSecond = top ? top.score - (second?.score ?? 0) : 0;

      if (!top || top.score < DOCUMENT_AMBIGUOUS_MIN_SCORE) {
        logger.info('DOC_FETCH_NONE: no document reached minimum score', {
          uid: ownerUid,
          phone: remotePhone,
          query,
          topScore: top?.score ?? null
        });
        await this.sendDocumentTextReply(
          ownerUid,
          remoteJid,
          remotePhone,
          'Nao encontrei nenhum arquivo com esse nome ou descricao.',
          `[Arquivo solicitado] ${query}`
        );
        return;
      }

      if (top.score >= DOCUMENT_STRONG_MATCH_MIN_SCORE && diffToSecond >= DOCUMENT_RESULT_GAP_MIN) {
        shouldSendDirect = true;
        candidates = [top];
      } else {
        candidates = ranked.filter((entry) => entry.score >= DOCUMENT_AMBIGUOUS_MIN_SCORE).slice(0, 3);
      }
    }

    if (!shouldSendDirect && candidates.length === 0) {
      logger.info('DOC_FETCH_NONE: no candidates after ranking', {
        uid: ownerUid,
        phone: remotePhone,
        query
      });
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        'Nao encontrei nenhum arquivo com esse nome ou descricao.',
        `[Arquivo solicitado] ${query || '(sem filtro)'}`
      );
      return;
    }

    if (!shouldSendDirect) {
      const summary = candidates
        .slice(0, 3)
        .map((entry, index) => `${index + 1}) "${entry.document.title}"`)
        .join(' ');
      logger.info('DOC_FETCH_AMBIGUOUS', {
        uid: ownerUid,
        phone: remotePhone,
        query,
        candidates: candidates.map((entry) => ({ title: entry.document.title, score: entry.score }))
      });
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        `Encontrei mais de um arquivo parecido: ${summary}. Me diga qual nome voce quer.`,
        `[Arquivo solicitado] ${query || '(sem filtro)'}`
      );
      return;
    }

    const selected = candidates[0]?.document;
    if (!selected) {
      logger.info('DOC_FETCH_NONE: selected document missing after candidate selection', {
        uid: ownerUid,
        phone: remotePhone,
        query
      });
      await this.sendDocumentTextReply(
        ownerUid,
        remoteJid,
        remotePhone,
        'Nao encontrei nenhum arquivo com esse nome ou descricao.',
        `[Arquivo solicitado] ${query || '(sem filtro)'}`
      );
      return;
    }

    const signedUrl = await createSignedDocumentUrl(selected.storagePath);
    logger.info('DOC_FETCH_MATCH', {
      uid: ownerUid,
      phone: remotePhone,
      query,
      documentId: selected.id,
      title: selected.title,
      storagePath: selected.storagePath
    });
    try {
      await touchUserDocumentAccess(ownerUid, selected.id);
    } catch (error) {
      logger.warn('DOC_FETCH_TOUCH_FAIL: failed to update last accessed timestamp', {
        uid: ownerUid,
        documentId: selected.id,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }

    const reply = buildDocumentFetchReply(selected.title);
    const selectedMimeType = selected.mimeType.trim().toLowerCase();
    const isImageDocument = selectedMimeType.startsWith('image/');
    if (isImageDocument) {
      await this.sendWithRetry(remoteJid, reply, 'auto_reply', ownerUid, { image: { url: signedUrl } });
    } else {
      await this.sendWithRetry(remoteJid, reply, 'auto_reply', ownerUid, {
        document: {
          url: signedUrl,
          mimeType: selectedMimeType || 'application/octet-stream',
          fileName: buildDocumentFileName(selected)
        }
      });
    }
    logger.info('DOC_FETCH_SEND_SUCCESS', {
      uid: ownerUid,
      phone: remotePhone,
      documentId: selected.id,
      title: selected.title,
      mimeType: selectedMimeType || null
    });
    await this.appendConversationMessage(ownerUid, remotePhone, {
      role: 'user',
      content: `[Arquivo solicitado] ${query || selected.title}`
    });
    await this.appendConversationMessage(ownerUid, remotePhone, {
      role: 'assistant',
      content: isImageDocument ? `[Imagem Enviada] ${reply}` : `[Arquivo Enviado] ${reply}`
    });
  }

  /**
   * Runs the full AI processing pipeline with logging at each step.
   * Extracted so the caller can wrap it in a global timeout.
   */
  private async runAiPipeline(
    ownerUid: string,
    remotePhone: string,
    inboundText: string,
    imageDataUrl: string | null,
    audioDataUrl: string | null
  ): Promise<{ aiReply: string, mediaUrl?: string }> {
    logger.info('MSG_PIPELINE_START: loading conversation history', { uid: ownerUid, phone: remotePhone });
    // Invalidate cached conversation so we get fresh state from DB.
    // This is critical when multiple messages from the same user are
    // processed sequentially (after debounce) — each must see the
    // previous AI reply in the history.
    const cacheKey = this.conversationKey(ownerUid, normalizePhoneNumber(remotePhone));
    this.conversationByPhone.delete(cacheKey);
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

    // Always add the current message at the end with the image/audio if present
    let finalContent = inboundText.trim();
    if (!finalContent) {
      if (imageDataUrl) finalContent = IMAGE_ONLY_FALLBACK_TEXT;
      else if (audioDataUrl) finalContent = 'Transcreva e interprete o audio enviado, e execute a acao de registrar ou responder.';
    }

    aiMessages.push({
      role: 'user',
      content: finalContent,
      ...(imageDataUrl ? { imageDataUrl } : {}),
      ...(audioDataUrl ? { audioDataUrl } : {})
    });

    logger.info('MSG_AI_CONTEXT: sending to AI', {
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

    logger.info('MSG_PIPELINE_AI_CALL: calling processWhatsAppAIMessage', { uid: ownerUid });
    const aiReply = await processWhatsAppAIMessage(ownerUid, aiMessages, {
      isFirstMessage,
      isGreeting,
      isCapabilitiesQuestion,
      isConversationRestart,
      shouldSendCapabilitiesSummary,
      sourcePhone: remotePhone,
      latestUserMessageText: inboundText,
      imageOnlyWithoutDocumentIntent: Boolean(imageDataUrl) && !inboundText.trim()
    });
    logger.info('MSG_PIPELINE_AI_DONE: AI response received', {
      uid: ownerUid,
      replyLength: aiReply.text.length,
      replyPreview: aiReply.text.slice(0, 80)
    });

    // Save user message AFTER AI processes — enrich media messages with AI-extracted context
    if (inboundText.trim() || imageDataUrl || audioDataUrl) {
      let textForHistory = inboundText.trim();
      if (!textForHistory && aiReply.text.trim()) {
        const mediaType = imageDataUrl ? 'Imagem' : 'Audio';
        const firstLine = aiReply.text.trim().split('\n').find((l: string) => l.replace(/[*_~`]/g, '').trim().length > 0) || '';
        const cleaned = firstLine.replace(/[*_~`]/g, '').trim().slice(0, 120);
        textForHistory = cleaned ? `[${mediaType}] ${cleaned}` : `${mediaType} enviado no WhatsApp.`;
      } else if (!textForHistory) {
        textForHistory = imageDataUrl ? 'Imagem enviada no WhatsApp.' : 'Audio enviado no WhatsApp.';
      }
      await this.appendConversationMessage(ownerUid, remotePhone, {
        role: 'user',
        content: textForHistory
      });
    }

    return { aiReply: aiReply.text, mediaUrl: aiReply.mediaUrl };
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

  private startTypingPresence(remoteJid: string): () => void {
    let stopped = false;

    const sendPresence = async (presence: 'composing' | 'paused'): Promise<void> => {
      if (!this.socket || !this.connected) return;
      try {
        await this.socket.sendPresenceUpdate(presence, remoteJid);
      } catch (error) {
        logger.warn('Failed to update WhatsApp presence', {
          presence,
          remoteJid,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    };

    void sendPresence('composing');
    const interval = setInterval(() => {
      if (stopped) return;
      void sendPresence('composing');
    }, COMPOSING_REFRESH_MS);

    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      void sendPresence('paused');
    };
  }

  private async sendWithRetry(
    jid: string,
    text: string,
    direction: MessageDirection,
    ownerUid?: string,
    customOptions?: {
      image?: { url: string };
      document?: { url: string; mimeType: string; fileName: string };
    }
  ): Promise<{ messageId: string }> {
    if (!this.socket) {
      throw new Error('WhatsApp socket is not available');
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        logger.info('MSG_SEND: attempting WhatsApp send', {
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
          } catch (sessionError) {
            logger.warn('MSG_SEND: assertSessions failed (continuing anyway)', {
              slotId: this.slotId,
              jid,
              error: sessionError instanceof Error ? sessionError.message : 'unknown'
            });
          }
        }
        const payload = customOptions?.document
          ? {
            document: { url: customOptions.document.url },
            mimetype: customOptions.document.mimeType,
            fileName: customOptions.document.fileName,
            caption: text
          }
          : customOptions?.image
            ? { image: { url: customOptions.image.url }, caption: text }
            : { text };
        const response = await this.socket.sendMessage(jid, payload);
        if (response?.key?.id && response.message) {
          this.sentMessagesCache.set(response.key.id, response.message);
          // Prevent memory leaks: cap cache at ~100 messages per instance
          if (this.sentMessagesCache.size > 100) {
            const firstKey = this.sentMessagesCache.keys().next().value;
            if (firstKey) this.sentMessagesCache.delete(firstKey);
          }
        }
        const messageId = response?.key?.id ?? `generated_${Date.now()}`;
        const now = new Date().toISOString();

        const sentRecord: WhatsAppMessageRecord = {
          clientId: this.slotId,
          messageId,
          direction,
          ...(ownerUid ? { ownerUid } : {}),
          from: this.phone ?? '',
          to: jidToPhone(jid),
          text,
          timestamp: now,
          waTimestamp: null,
          status: 'sent',
          rawType: customOptions?.document ? 'documentMessage' : customOptions?.image ? 'imageMessage' : 'conversation',
          createdAt: now,
          metadata: {
            fromMe: true,
            isGroup: isGroupJid(jid),
            hasImage: Boolean(customOptions?.image)
          }
        };

        if (ownerUid) {
          await saveMessageSafe(sentRecord);
        }
        logger.info('MSG_SEND_OK: WhatsApp send succeeded', {
          slotId: this.slotId,
          jid,
          ownerUid,
          messageId
        });
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
      clientId: this.slotId,
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
        isGroup: isGroupJid(jid),
        hasImage: Boolean(customOptions?.image)
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
    logger.info(`  NOVO QR CODE DISPONIVEL [${this.displayName}] - abra no navegador:`);
    logger.info(`  ${qrPageUrl}`);
    logger.info('==================================================');

    // ASCII art apenas para referÃªncia em ambientes de terminal local
    qrcodeTerminal.generate(qr, { small: true });

    try {
      this.qrDataUrl = await QRCode.toDataURL(qr);
      logger.info('WhatsApp QR code updated', { slotId: this.slotId });
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

  private scheduleReconnect(delayMs = 2000): void {
    if (this.reconnectTimer) return;
    logger.info('Scheduling WhatsApp reconnect', { delayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        logger.error('Reconnect attempt failed', error);
        this.scheduleReconnect();
      });
    }, delayMs);
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
          (this.socket as { ws?: { close: () => void } }).ws?.close();
        } catch {
          // ignore cleanup errors
        }
        this.socket = null;
      }

      await rm(this.authDir, { recursive: true, force: true });
      await mkdir(this.authDir, { recursive: true });

      try {
        await clearWhatsAppAuthSnapshot(this.slotId);
      } catch (error) {
        logger.error('Failed to clear invalid WhatsApp auth snapshot in Firestore', {
          slotId: this.slotId,
          error
        });
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

  private scheduleAuthStateSync(force = false): void {
    this.clearAuthSyncTimer();
    const cooldownRemaining = Math.max(0, this.lastAuthSyncAt + AUTH_SYNC_MIN_INTERVAL_MS - Date.now());
    const waitMs = force ? 0 : Math.max(AUTH_SYNC_DEBOUNCE_MS, cooldownRemaining);
    this.authSyncTimer = setTimeout(() => {
      this.authSyncTimer = null;
      void this.syncAuthStateNow(force);
    }, waitMs);
  }

  private async syncAuthStateNow(force = false): Promise<void> {
    if (this.authSyncInFlight) {
      this.authSyncQueued = true;
      if (force) this.authSyncQueuedForce = true;
      return;
    }

    if (!force && Date.now() - this.lastAuthSyncAt < AUTH_SYNC_MIN_INTERVAL_MS) {
      this.scheduleAuthStateSync(false);
      return;
    }

    this.authSyncInFlight = true;
    try {
      const files = await readdir(this.authDir);
      const authFiles = files
        .filter((filename) => filename.endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));

      if (authFiles.length === 0) {
        return;
      }

      const snapshotFiles = await Promise.all(
        authFiles.map(async (filename) => {
          const content = await readFile(join(this.authDir, filename));
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

      await saveWhatsAppAuthSnapshot(this.slotId, snapshotFiles);
      this.lastAuthSnapshotHash = hash;
      this.lastAuthSyncAt = Date.now();
      logger.info('WhatsApp auth snapshot synced to Firestore', {
        slotId: this.slotId,
        fileCount: snapshotFiles.length
      });
    } catch (error) {
      logger.error('Failed to sync WhatsApp auth snapshot', error);
    } finally {
      this.authSyncInFlight = false;
      if (this.authSyncQueued) {
        const queuedForce = this.authSyncQueuedForce;
        this.authSyncQueued = false;
        this.authSyncQueuedForce = false;
        this.scheduleAuthStateSync(queuedForce);
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
    const currentFiles = await readdir(this.authDir);
    const hasLocalCreds = currentFiles.some((filename) => filename.includes('creds'));
    if (hasLocalCreds) {
      return;
    }

    const snapshotFiles = await loadWhatsAppAuthSnapshot(this.slotId);
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
        await writeFile(join(this.authDir, safeName), payload);
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
        slotId: this.slotId,
        fileCount: restoredCount
      });
    }
  }

  private async registerBadMac(message: proto.IWebMessageInfo, errorMessage: string): Promise<void> {
    const key = message.key as MessageKeyWithLid | undefined;
    const remoteJid = key?.remoteJid ?? 'unknown';
    const messageId = key?.id ?? 'unknown';

    const now = Date.now();
    const previous = this.badMacByJid.get(remoteJid);
    const isWithinWindow = previous && now - previous.lastAt <= BAD_MAC_WINDOW_MS;
    const count = isWithinWindow ? previous.count + 1 : 1;
    const previousCleared = isWithinWindow ? (previous.cleared ?? 0) : 0;

    this.badMacByJid.set(remoteJid, { count, lastAt: now, cleared: previousCleared });

    logger.warn('Bad MAC counter updated', {
      slotId: this.slotId,
      remoteJid,
      messageId,
      count,
      threshold: BAD_MAC_RECONNECT_THRESHOLD,
      cleared: previousCleared,
      softReconnectCount: this.softReconnectCount,
      reconnectCycleAfter: BAD_MAC_RECONNECT_CYCLE_AFTER,
      errorMessage
    });

    if (count < BAD_MAC_RECONNECT_THRESHOLD) {
      return;
    }

    const newCleared = previousCleared + 1;
    this.badMacByJid.set(remoteJid, { count: 0, lastAt: now, cleared: newCleared });
    await this.clearSignalSessionsAfterBadMac(message);

    // First round: just clear sessions and let Baileys built-in retry mechanism
    // recover the decrypt (retry receipt → sender re-sends with prekey bundle).
    // Do NOT reconnect — that kills the socket and prevents the retry from completing.
    if (newCleared <= 1) {
      logger.info('Bad MAC sessions cleared, awaiting Baileys retry (no reconnect)', {
        slotId: this.slotId,
        remoteJid,
        clearedRound: newCleared
      });
      return;
    }

    // Second+ round: Baileys retry didn't fix it. Now escalate to soft reconnect.
    if (this.softReconnectCount >= BAD_MAC_RECONNECT_CYCLE_AFTER) {
      logger.error('BAD_MAC_ESCALATION: repeated decrypt failures detected, preserving auth and recycling socket', {
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

  private hasLidIdentity(key: proto.IMessageKey): boolean {
    const enriched = key as MessageKeyWithLid;
    return Boolean(enriched.senderLid || enriched.participantLid);
  }

  private extractBadMacPeerJids(message: proto.IWebMessageInfo): string[] {
    const key = message.key as MessageKeyWithLid | undefined;
    if (!key) return [];

    const candidates = [key.remoteJid, key.participant, key.senderLid, key.participantLid];

    return [
      ...new Set(
        candidates.filter(
          (jid): jid is string =>
            typeof jid === 'string' &&
            jid.includes('@') &&
            !isStatusJid(jid) &&
            !isGroupJid(jid)
        )
      )
    ];
  }

  private async clearSignalSessionsAfterBadMac(message: proto.IWebMessageInfo): Promise<void> {
    const socket = this.socket;
    if (!socket) return;

    const peerJids = this.extractBadMacPeerJids(message);
    if (peerJids.length === 0) return;

    const sessionsToClear: Record<string, null> = {};
    for (const jid of peerJids) {
      try {
        const signalAddress = socket.signalRepository.jidToSignalProtocolAddress(jid);
        sessionsToClear[signalAddress] = null;
      } catch (error) {
        logger.warn('Failed deriving Signal address for Bad MAC session cleanup', {
          slotId: this.slotId,
          jid,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    const sessionIds = Object.keys(sessionsToClear);
    if (sessionIds.length === 0) return;

    try {
      await socket.authState.keys.set({ session: sessionsToClear });
      this.scheduleAuthStateSync();
      logger.warn('Cleared Signal sessions after repeated Bad MAC', {
        slotId: this.slotId,
        sessionIds,
        peerJids
      });
    } catch (error) {
      logger.warn('Failed clearing Signal sessions after Bad MAC', {
        slotId: this.slotId,
        peerJids,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  private resolveIncomingRemoteJid(key: proto.IMessageKey): string {
    const enriched = key as MessageKeyWithLid;
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
      if (exact) return exact;
      const baseLid = remoteJid.replace(/:\d+@lid$/, '@lid');
      if (baseLid !== remoteJid) {
        const baseMatch = this.lidToPhoneJid.get(baseLid);
        if (baseMatch) return baseMatch;
      }
      // Search for any key that shares the same base LID number
      const lidNumber = remoteJid.split('@')[0].split(':')[0];
      for (const [key, value] of this.lidToPhoneJid.entries()) {
        if (key.startsWith(lidNumber)) return value;
      }
      return remoteJid;
    }

    return remoteJid;
  }

  private normalizePhoneJidCandidate(jid: string | null | undefined): string | null {
    if (!jid) return null;
    if (isStatusJid(jid) || isGroupJid(jid) || jid.endsWith('@lid')) return null;

    const phone = jidToPhone(jid);
    // Accept only Brazilian-like personal numbers (10-13 digits with/without country code).
    if (phone.length < 10 || phone.length > 13) return null;

    try {
      return normalizePhoneToJid(phone);
    } catch {
      return null;
    }
  }

  private rememberLidMapping(
    lidJid: string | null | undefined,
    phoneJid: string | null | undefined,
    source: 'phone_number_share' | 'contacts_upsert' | 'contacts_update' | 'message_candidate'
  ): void {
    if (!lidJid || !lidJid.endsWith('@lid')) return;

    const normalizedPhoneJid = this.normalizePhoneJidCandidate(phoneJid);
    if (!normalizedPhoneJid) return;

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
      logger.info('LID mapping updated', {
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

  private absorbContactLidMappings(
    contacts: Array<{ id?: string | null; lid?: string | null }>,
    source: 'contacts_upsert' | 'contacts_update'
  ): void {
    let mappedCount = 0;
    for (const contact of contacts) {
      const contactId = contact.id ?? null;
      const lidRaw = contact.lid ?? null;

      // Determine which field is the LID and which is the phone JID.
      // Baileys may provide:
      //   Case A: id = "55...@s.whatsapp.net", lid = "123...@lid"  (most common)
      //   Case B: id = "123...@lid",           lid = null          (LID-only contact)
      //   Case C: id = "55...@s.whatsapp.net", lid = "123..."      (raw LID without @)
      let lidJid: string | null = null;
      let phoneJid: string | null = null;

      // Parse the explicit lid field
      if (lidRaw) {
        lidJid = lidRaw.includes('@') ? lidRaw : `${lidRaw}@lid`;
      }

      // Parse the id field
      if (contactId) {
        if (contactId.endsWith('@lid')) {
          // id is a LID — use it as lidJid if we don't have one from the lid field
          if (!lidJid) lidJid = contactId;
        } else if (contactId.endsWith('@s.whatsapp.net')) {
          phoneJid = contactId;
        }
      }

      if (lidJid && phoneJid) {
        this.rememberLidMapping(lidJid, phoneJid, source);
        mappedCount++;
      }
    }
    if (mappedCount > 0) {
      logger.info('LID_ABSORB: absorbed contact LID mappings', {
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
  private bufferLidMessage(lidJid: string, message: proto.IWebMessageInfo): void {
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
      logger.warn('LID buffer full for JID, dropping oldest', {
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
  private replayBufferedLidMessages(lidJid: string): void {
    const entries = this.pendingLidMessages.get(lidJid);
    if (!entries || entries.length === 0) return;

    this.pendingLidMessages.delete(lidJid);

    const validEntries = entries.filter((e) => Date.now() - e.bufferedAt < LID_BUFFER_TTL_MS);
    if (validEntries.length === 0) return;

    logger.info('LID_REPLAY: replaying buffered messages after LID mapping resolved', {
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
  private requestPhoneForLidJid(lidJid: string, message?: proto.IWebMessageInfo): void {
    if (!this.socket || this.lidToPhoneJid.has(lidJid)) return;

    const socket = this.socket;
    const slotId = this.slotId;
    void (async () => {
      // Strategy 1: Subscribe to presence — may trigger contacts.upsert with LID→phone
      try {
        await socket.presenceSubscribe(lidJid);
        logger.info('LID_RESOLVE_SUBSCRIBE: subscribed to LID presence', { slotId, lidJid });
      } catch (error) {
        logger.warn('LID_RESOLVE_SUBSCRIBE: failed (best-effort)', {
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
          logger.info('LID_RESOLVE_READ: sent read receipt to trigger retry with sender_pn', { slotId, lidJid });
        } catch (error) {
          logger.warn('LID_RESOLVE_READ: failed (best-effort)', {
            slotId,
            lidJid,
            error: error instanceof Error ? error.message : 'unknown'
          });
        }
      }

      // Strategy 3: Fetch status — may trigger contact events
      try {
        await socket.fetchStatus(lidJid);
        logger.info('LID_RESOLVE_STATUS: fetched status for LID', { slotId, lidJid });
      } catch (error) {
        logger.warn('LID_RESOLVE_STATUS: failed (best-effort)', {
          slotId,
          lidJid,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }

      // Strategy 4: Delayed retry — check if the mapping arrived after 5 seconds
      await sleep(5000);
      if (this.lidToPhoneJid.has(lidJid)) {
        logger.info('LID_RESOLVE_DELAYED: mapping resolved, triggering replay', { slotId, lidJid });
        this.replayBufferedLidMessages(lidJid);
      } else {
        // Try again after 15 seconds total
        await sleep(10_000);
        if (this.lidToPhoneJid.has(lidJid)) {
          logger.info('LID_RESOLVE_DELAYED_2: mapping resolved on second check', { slotId, lidJid });
          this.replayBufferedLidMessages(lidJid);
        } else {
          // FALLBACK: Search for any existing mapping that shares the same base LID number.
          // CB_MESSAGE_SENDER_PN stores with device suffix (e.g. "123:47@lid")
          // but handleSingleIncomingMessage looks up base form ("123@lid").
          const lidNumber = lidJid.split('@')[0].split(':')[0];
          let fallbackPhone: string | undefined;
          for (const [key, value] of this.lidToPhoneJid.entries()) {
            if (key.startsWith(lidNumber)) {
              fallbackPhone = value;
              break;
            }
          }
          if (fallbackPhone) {
            logger.info('LID_RESOLVE_FALLBACK: found phone via prefix scan of stored mappings', {
              slotId,
              lidJid,
              lidNumber,
              resolvedPhone: fallbackPhone
            });
            // Store the mapping under the base LID so future lookups succeed
            this.lidToPhoneJid.set(lidJid, fallbackPhone);
            this.replayBufferedLidMessages(lidJid);
          } else {
            logger.warn('LID_RESOLVE_FAILED: could not resolve LID after all strategies', {
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
  private tryExtractPhoneFromMessageMeta(message: proto.IWebMessageInfo): void {
    const key = message.key as MessageKeyWithLid | undefined;
    if (!key) return;

    const lidJid = key.remoteJid;
    if (!lidJid || !lidJid.endsWith('@lid')) return;

    // Check all known fields that may contain phone numbers
    const phoneCandidates: Array<string | null | undefined> = [
      (key as MessageKeyWithLid).participantPn,
      (key as MessageKeyWithLid).remoteJidAlt,
      key.participant
    ];

    // Baileys may include userReceipt with phone JIDs
    const msgAny = message as unknown as Record<string, unknown>;
    if (Array.isArray(msgAny.userReceipt)) {
      for (const receipt of msgAny.userReceipt as Array<{ userJid?: string }>) {
        if (receipt?.userJid) phoneCandidates.push(receipt.userJid);
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
    logger.info('MSG_META_EXTRACT: scanning message for phone info', {
      slotId: this.slotId,
      lidJid,
      candidatesFound: phoneCandidates.filter(Boolean).length,
      participantPn: (key as MessageKeyWithLid).participantPn ?? null,
      remoteJidAlt: (key as MessageKeyWithLid).remoteJidAlt ?? null,
      participant: key.participant ?? null,
      messageId: key.id ?? 'unknown'
    });

    for (const candidate of phoneCandidates) {
      if (!candidate) continue;
      const normalized = this.normalizePhoneJidCandidate(candidate);
      if (normalized) {
        this.rememberLidMapping(lidJid, normalized, 'message_candidate');
        return;
      }
    }
  }

  private triggerSoftReconnectAfterBadMac(remoteJid: string): void {
    if (!this.allowReconnect) return;
    if (this.reconnectTimer) return;

    this.softReconnectCount += 1;

    logger.warn('Triggering soft reconnect after repeated Bad MAC', {
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
        (this.socket as { ws?: { close: () => void } }).ws?.close();
      }
    } catch (error) {
      logger.warn('Failed closing websocket during soft reconnect', {
        slotId: this.slotId,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }

    this.socket = null;
    // Exponential backoff: 3s → 6s → 12s → capped at 15s
    const delay = Math.min(3000 * Math.pow(2, this.softReconnectCount - 1), 15000);
    this.scheduleReconnect(delay);
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

  private async handleUnlinkedMessage(remoteJid: string, remotePhone: string): Promise<void> {
    const normalizedPhone = normalizePhoneNumber(remotePhone);
    const reply = buildRegistrationRequiredReply();

    try {
      await this.sendWithRetry(remoteJid, reply, 'auto_reply');
      logger.info('Sent registration guidance to unlinked WhatsApp number', {
        from: normalizedPhone
      });
    } catch (error) {
      logger.error('Failed to send registration guidance to unlinked WhatsApp number', {
        from: normalizedPhone,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  private getMediaDownloadContext():
    | { reuploadRequest: (msg: proto.IWebMessageInfo) => Promise<proto.IWebMessageInfo>; logger: WASocket['logger'] }
    | undefined {
    const socket = this.socket;
    if (!socket) return undefined;
    return {
      reuploadRequest: socket.updateMediaMessage,
      logger: socket.logger
    };
  }

  private async extractInboundImageDataUrl(message: proto.IWebMessageInfo): Promise<string | null> {
    if (!isImageMessage(message)) return null;

    const mimeType = getImageMimeType(message) || 'image/jpeg';
    try {
      const mediaBuffer = await downloadMediaMessage(message, 'buffer', {}, this.getMediaDownloadContext());
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
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('Bad MAC')) {
        await this.registerBadMac(message, errorMsg);
      }
      if (isExpectedMediaDecryptError(error)) {
        logger.warn('Skipping inbound image due to decrypt failure', {
          slotId: this.slotId,
          messageId: message.key?.id ?? 'unknown',
          error: errorMsg || 'unknown'
        });
      } else {
        logger.error('Failed to download inbound WhatsApp image', error);
      }
      return null;
    }
  }

  private async extractInboundAudioDataUrl(message: proto.IWebMessageInfo): Promise<string | null> {
    const rawType = extractRawType(message);
    const isAudio = isAudioMessage(message);
    logger.info('AUDIO_EXTRACT_START', { messageId: message.key.id, rawType, isAudio });

    if (!isAudio) return null;

    const mimeType = getAudioMimeType(message) || 'audio/ogg';
    try {
      const mediaBuffer = await downloadMediaMessage(message, 'buffer', {}, this.getMediaDownloadContext());
      if (!mediaBuffer || mediaBuffer.length === 0) {
        logger.warn('AUDIO_EXTRACT_FAIL: buffer is empty');
        return null;
      }

      // Max 10MB for audio
      const maxAudioBytes = 10 * 1024 * 1024;
      if (mediaBuffer.length > maxAudioBytes) {
        logger.warn('AUDIO_EXTRACT_FAIL: exceeds max size', {
          size: mediaBuffer.length,
          maxAllowed: maxAudioBytes
        });
        return null;
      }

      const base64 = mediaBuffer.toString('base64');
      logger.info('AUDIO_EXTRACT_SUCCESS', { size: mediaBuffer.length, mimeType });
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('Bad MAC')) {
        await this.registerBadMac(message, errorMsg);
      }
      if (isExpectedMediaDecryptError(error)) {
        logger.warn('AUDIO_EXTRACT_SKIP: decrypt failure on inbound audio', {
          slotId: this.slotId,
          messageId: message.key?.id ?? 'unknown',
          error: errorMsg || 'unknown'
        });
      } else {
        logger.error('AUDIO_EXTRACT_ERROR: Failed to download inbound WhatsApp audio', error);
      }
      return null;
    }
  }

  private async extractInboundDocumentDataUrl(message: proto.IWebMessageInfo): Promise<string | null> {
    if (!isDocumentMessage(message)) return null;

    const fileName = getDocumentFileName(message);
    const rawMimeType = (getDocumentMimeType(message) ?? '').toLowerCase();
    const mimeType = resolveSupportedDocumentMimeType(rawMimeType, fileName);
    if (!mimeType) {
      logger.info('DOC_EXTRACT_SKIP: unsupported document type', {
        messageId: message.key?.id ?? 'unknown',
        mimeType: rawMimeType,
        fileName
      });
      return null;
    }

    try {
      const mediaBuffer = await downloadMediaMessage(message, 'buffer', {}, this.getMediaDownloadContext());
      if (!mediaBuffer || mediaBuffer.length === 0) {
        logger.warn('DOC_EXTRACT_FAIL: buffer is empty');
        return null;
      }

      // PDFs can arrive larger and be recompressed during storage; ZIP and other files stay capped at 10 MB.
      const maxDocBytes = mimeType === 'application/pdf'
        ? MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION
        : MAX_STORED_DOCUMENT_BYTES;
      if (mediaBuffer.length > maxDocBytes) {
        logger.warn('DOC_EXTRACT_FAIL: exceeds max size', {
          size: mediaBuffer.length,
          maxAllowed: maxDocBytes,
          mimeType,
          fileName: fileName ?? 'document'
        });
        return null;
      }

      const base64 = mediaBuffer.toString('base64');
      logger.info('DOC_EXTRACT_SUCCESS', { size: mediaBuffer.length, mimeType, fileName: fileName ?? 'document' });
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('Bad MAC')) {
        await this.registerBadMac(message, errorMsg);
      }
      if (isExpectedMediaDecryptError(error)) {
        logger.warn('DOC_EXTRACT_SKIP: decrypt failure on inbound document', {
          slotId: this.slotId,
          messageId: message.key?.id ?? 'unknown',
          error: errorMsg || 'unknown'
        });
      } else {
        logger.error('DOC_EXTRACT_ERROR: Failed to download inbound WhatsApp document', error);
      }
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
      const loaded = await getRecentConversationByPhone(
        uid,
        normalized,
        env.whatsappAiHistoryLimit
      );
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
    // Shared across slots so conversation context is not lost when messages arrive on a different number
    return `${uid}:${phone}`;
  }
}
