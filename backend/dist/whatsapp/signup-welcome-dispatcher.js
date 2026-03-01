"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSignupWelcomeDispatcher = startSignupWelcomeDispatcher;
const logger_1 = require("../lib/logger");
const SIGNUP_WELCOME_RETRY_MS = 30_000;
const SIGNUP_WELCOME_MAX_ATTEMPTS = 5;
function isConnectionRetryableError(message) {
    return message === 'WhatsApp is not connected' || message.includes('Connection Closed');
}
function buildSignupWelcomeMessage(displayName) {
    const firstName = displayName.split(/\s+/).find(Boolean) ?? '';
    const greetingName = firstName ? `, ${firstName}` : '';
    return [
        `Oi${greetingName}! Eu sou a IA do SaldoPro.`,
        'Vou te ajudar aqui no WhatsApp com organizacao financeira, registros e lembretes.',
        'Quando quiser, e so me chamar por aqui.'
    ].join('\n');
}
function startSignupWelcomeDispatcher(manager) {
    const queue = new Map();
    let stopped = false;
    let inFlight = false;
    const deliver = async (entry) => {
        try {
            const result = await manager.sendTextWithRouting({
                to: entry.phone,
                text: buildSignupWelcomeMessage(entry.displayName),
                ownerUid: entry.uid
            });
            logger_1.logger.info('Signup WhatsApp welcome message delivered', {
                uid: entry.uid,
                phone: entry.phone,
                clientId: result.clientId,
                messageId: result.messageId,
                attempts: entry.attempts + 1
            });
            return true;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'unknown';
            entry.lastError = message;
            if (isConnectionRetryableError(message)) {
                logger_1.logger.warn('WhatsApp unavailable for signup welcome message; keeping it queued', {
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
                logger_1.logger.warn('Dropping signup WhatsApp welcome message after retry limit', {
                    uid: entry.uid,
                    phone: entry.phone,
                    attempts: entry.attempts,
                    queuedAt: entry.queuedAt,
                    error: message
                });
                return true;
            }
            logger_1.logger.warn('Failed to deliver signup WhatsApp welcome message; will retry', {
                uid: entry.uid,
                phone: entry.phone,
                attempts: entry.attempts,
                queuedAt: entry.queuedAt,
                error: message
            });
            return false;
        }
    };
    const flushQueue = async () => {
        if (stopped || inFlight || queue.size === 0)
            return;
        const status = manager.getStatuses()[0];
        if (!status?.connected)
            return;
        inFlight = true;
        try {
            for (const [key, entry] of queue) {
                const deliveredOrDropped = await deliver(entry);
                if (deliveredOrDropped) {
                    queue.delete(key);
                }
            }
        }
        finally {
            inFlight = false;
        }
    };
    const timer = setInterval(() => {
        void flushQueue();
    }, SIGNUP_WELCOME_RETRY_MS);
    logger_1.logger.info('Signup WhatsApp welcome dispatcher started', {
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
