import { logger } from '../lib/logger';
import type { WhatsAppClientsManager } from './manager';

const SIGNUP_WELCOME_RETRY_MS = 30_000;
const SIGNUP_WELCOME_MAX_ATTEMPTS = 5;

interface PendingSignupWelcomeMessage {
  uid: string;
  phone: string;
  displayName: string;
  attempts: number;
  queuedAt: string;
  lastError: string | null;
}

export interface SignupWelcomeDispatcher {
  enqueue(input: { uid: string; phone: string; displayName: string }): void;
}

function isConnectionRetryableError(message: string): boolean {
  return message === 'WhatsApp is not connected' || message.includes('Connection Closed');
}

function buildSignupWelcomeMessage(displayName: string): string {
  const firstName = displayName.split(/\s+/).find(Boolean) ?? '';
  const greetingName = firstName ? `, ${firstName}` : '';

  return [
    `Oi${greetingName}! Eu sou a IA do SaldoPro. 🚀`,
    '',
    '*Como posso te ajudar aqui no WhatsApp:*',
    '✅ Registrar seus ganhos e gastos diários (basta me mandar texto ou áudio)',
    '✅ Tirar dúvidas rápidas sobre o seu saldo',
    '✅ Te lembrar de contas a pagar e receber',
    '',
    '*Acesse seu painel completo no site para ver gráficos e relatórios detallhados:*',
    '🌐 https://saldopro-98049.web.app',
    '',
    'Quando quiser registrar algo, é só me mandar uma mensagem!'
  ].join('\n');
}

export function startSignupWelcomeDispatcher(
  manager: WhatsAppClientsManager
): SignupWelcomeDispatcher & { stop: () => void } {
  const queue = new Map<string, PendingSignupWelcomeMessage>();
  let stopped = false;
  let inFlight = false;

  const deliver = async (entry: PendingSignupWelcomeMessage): Promise<boolean> => {
    try {
      const result = await manager.sendTextWithRouting({
        to: entry.phone,
        text: buildSignupWelcomeMessage(entry.displayName),
        ownerUid: entry.uid
      });

      logger.info('Signup WhatsApp welcome message delivered', {
        uid: entry.uid,
        phone: entry.phone,
        clientId: result.clientId,
        messageId: result.messageId,
        attempts: entry.attempts + 1
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      entry.lastError = message;

      if (isConnectionRetryableError(message)) {
        logger.warn('WhatsApp unavailable for signup welcome message; keeping it queued', {
          uid: entry.uid,
          phone: entry.phone,
          attempts: entry.attempts,
          queuedAt: entry.queuedAt,
          error: message
        });
        return false;
      }

      entry.attempts += 1;

      if (entry.attempts >= SIGNUP_WELCOME_MAX_ATTEMPTS) {
        logger.warn('Dropping signup WhatsApp welcome message after retry limit', {
          uid: entry.uid,
          phone: entry.phone,
          attempts: entry.attempts,
          queuedAt: entry.queuedAt,
          error: message
        });
        return true;
      }

      logger.warn('Failed to deliver signup WhatsApp welcome message; will retry', {
        uid: entry.uid,
        phone: entry.phone,
        attempts: entry.attempts,
        queuedAt: entry.queuedAt,
        error: message
      });
      return false;
    }
  };

  const flushQueue = async (): Promise<void> => {
    if (stopped || inFlight || queue.size === 0) return;

    const status = manager.getStatuses()[0];
    if (!status?.connected) return;

    inFlight = true;
    try {
      for (const [key, entry] of queue) {
        const deliveredOrDropped = await deliver(entry);
        if (deliveredOrDropped) {
          queue.delete(key);
        }
      }
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void flushQueue();
  }, SIGNUP_WELCOME_RETRY_MS);

  logger.info('Signup WhatsApp welcome dispatcher started', {
    intervalMs: SIGNUP_WELCOME_RETRY_MS,
    maxAttempts: SIGNUP_WELCOME_MAX_ATTEMPTS
  });

  return {
    enqueue(input) {
      const key = `${input.uid}:${input.phone}`;

      if (!queue.has(key)) {
        queue.set(key, {
          uid: input.uid,
          phone: input.phone,
          displayName: input.displayName,
          attempts: 0,
          queuedAt: new Date().toISOString(),
          lastError: null
        });
      }

      void flushQueue();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
