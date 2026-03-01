"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClientsManager = exports.WHATSAPP_SLOT_IDS = void 0;
exports.isWhatsAppSlotId = isWhatsAppSlotId;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
const firebase_user_access_1 = require("../lib/firebase-user-access");
const logger_1 = require("../lib/logger");
const whatsapp_lock_1 = require("../lib/whatsapp-lock");
const client_1 = require("./client");
const events_1 = require("./events");
/** Only wa1 is active - single WhatsApp connection. */
exports.WHATSAPP_SLOT_IDS = ['wa1'];
const ACTIVE_SLOT = 'wa1';
const LOCK_TTL_SECONDS = 90;
const LOCK_RENEW_INTERVAL_MS = 30_000;
const LOCK_RETRY_MS = 10_000;
function isWhatsAppSlotId(value) {
    return value === 'wa1';
}
class WhatsAppClientsManager {
    client;
    instanceId;
    running = false;
    hasLock = false;
    clientStarted = false;
    lockAttemptInFlight = false;
    lockRenewInFlight = false;
    lockRetryTimer = null;
    lockRenewTimer = null;
    constructor() {
        this.instanceId = (0, node_crypto_1.randomUUID)();
        this.client = new client_1.WhatsAppClient({
            slotId: 'wa1',
            authDir: env_1.env.whatsappAuthDirWa1,
            displayName: 'WhatsApp 1'
        });
    }
    async startAll() {
        if (this.running)
            return;
        this.running = true;
        await this.tryAcquireAndStart();
    }
    async shutdownAll() {
        this.running = false;
        this.clearLockRetryTimer();
        this.stopLockRenewLoop();
        try {
            if (this.clientStarted) {
                await this.client.shutdown();
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to shutdown WhatsApp', { error });
        }
        finally {
            this.clientStarted = false;
        }
        if (this.hasLock) {
            try {
                await (0, whatsapp_lock_1.releaseWhatsAppConnectionLock)(ACTIVE_SLOT, this.instanceId);
            }
            catch (error) {
                logger_1.logger.error('Failed to release WhatsApp connection lock on shutdown', { error });
            }
            finally {
                this.hasLock = false;
            }
        }
    }
    getClient(_slotId) {
        return this.client;
    }
    getStatuses() {
        return [this.client.getStatus()];
    }
    getStatusBySlot(_slotId) {
        return this.client.getStatus();
    }
    async getQrPayloadBySlot(_slotId) {
        return this.client.getQrPayload();
    }
    async getQrPayloads() {
        try {
            return { wa1: await this.client.getQrPayload() };
        }
        catch {
            return { wa1: { available: false, reason: 'no_qr' } };
        }
    }
    async resetSession(_slotId) {
        if (!this.hasLock || !this.clientStarted) {
            await this.forceTakeoverAndStart();
        }
        await this.client.resetSession();
    }
    async sendTextWithRouting(input) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(input.to);
        if (normalizedPhone.length < 10) {
            throw new Error('Invalid destination phone');
        }
        const ownerActive = await (0, firebase_user_access_1.isFirebaseUserActive)(input.ownerUid);
        if (!ownerActive) {
            throw new Error('Target account is blocked or unavailable');
        }
        if (!this.hasLock || !this.clientStarted || !this.client.getStatus().connected) {
            throw new Error('WhatsApp is not connected');
        }
        const result = await this.client.sendText(input.to, input.text, input.ownerUid);
        return { ...result, clientId: 'wa1' };
    }
    clearLockRetryTimer() {
        if (!this.lockRetryTimer)
            return;
        clearTimeout(this.lockRetryTimer);
        this.lockRetryTimer = null;
    }
    scheduleLockRetry() {
        if (!this.running || this.lockRetryTimer)
            return;
        this.lockRetryTimer = setTimeout(() => {
            this.lockRetryTimer = null;
            void this.tryAcquireAndStart();
        }, LOCK_RETRY_MS);
    }
    startLockRenewLoop() {
        this.stopLockRenewLoop();
        this.lockRenewTimer = setInterval(() => {
            void this.renewLock();
        }, LOCK_RENEW_INTERVAL_MS);
    }
    stopLockRenewLoop() {
        if (!this.lockRenewTimer)
            return;
        clearInterval(this.lockRenewTimer);
        this.lockRenewTimer = null;
    }
    async renewLock() {
        if (!this.running || !this.hasLock || this.lockRenewInFlight)
            return;
        this.lockRenewInFlight = true;
        try {
            const renewed = await (0, whatsapp_lock_1.acquireWhatsAppConnectionLock)(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
            if (renewed)
                return;
            logger_1.logger.warn('Lost WhatsApp connection lock. Stopping client to avoid dual sessions.', {
                slotId: ACTIVE_SLOT,
                instanceId: this.instanceId
            });
            this.hasLock = false;
            this.stopLockRenewLoop();
            if (this.clientStarted) {
                await this.client.shutdown();
                this.clientStarted = false;
            }
            this.scheduleLockRetry();
        }
        catch (error) {
            logger_1.logger.warn('Failed to renew WhatsApp connection lock', {
                slotId: ACTIVE_SLOT,
                instanceId: this.instanceId,
                error
            });
        }
        finally {
            this.lockRenewInFlight = false;
        }
    }
    async tryAcquireAndStart() {
        if (!this.running || this.lockAttemptInFlight)
            return;
        this.lockAttemptInFlight = true;
        try {
            const acquired = await (0, whatsapp_lock_1.acquireWhatsAppConnectionLock)(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
            if (!this.running)
                return;
            if (!acquired) {
                logger_1.logger.debug('WhatsApp lock is held by another instance. Waiting before retry.', {
                    slotId: ACTIVE_SLOT,
                    instanceId: this.instanceId
                });
                this.scheduleLockRetry();
                return;
            }
            const wasLocked = this.hasLock;
            this.hasLock = true;
            this.startLockRenewLoop();
            if (!wasLocked) {
                logger_1.logger.info('WhatsApp connection lock acquired', {
                    slotId: ACTIVE_SLOT,
                    instanceId: this.instanceId
                });
            }
            if (this.clientStarted)
                return;
            await this.client.start();
            this.clientStarted = true;
            logger_1.logger.info('WhatsApp client started with active lock', {
                slotId: ACTIVE_SLOT,
                instanceId: this.instanceId
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to acquire/start WhatsApp with distributed lock', {
                slotId: ACTIVE_SLOT,
                instanceId: this.instanceId,
                error
            });
            if (this.hasLock) {
                try {
                    await (0, whatsapp_lock_1.releaseWhatsAppConnectionLock)(ACTIVE_SLOT, this.instanceId);
                }
                catch (releaseError) {
                    logger_1.logger.error('Failed to release WhatsApp lock after start error', { releaseError });
                }
                finally {
                    this.hasLock = false;
                }
            }
            this.stopLockRenewLoop();
            this.scheduleLockRetry();
        }
        finally {
            this.lockAttemptInFlight = false;
        }
    }
    async forceTakeoverAndStart() {
        if (!this.running) {
            this.running = true;
        }
        const forced = await (0, whatsapp_lock_1.forceAcquireWhatsAppConnectionLock)(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
        if (!forced) {
            throw new Error('Failed to force WhatsApp lock takeover.');
        }
        this.hasLock = true;
        this.startLockRenewLoop();
        logger_1.logger.warn('Forced WhatsApp lock takeover for administrative recovery', {
            slotId: ACTIVE_SLOT,
            instanceId: this.instanceId
        });
        if (this.clientStarted)
            return;
        await this.client.start();
        this.clientStarted = true;
        logger_1.logger.info('WhatsApp client started after forced lock takeover', {
            slotId: ACTIVE_SLOT,
            instanceId: this.instanceId
        });
    }
}
exports.WhatsAppClientsManager = WhatsAppClientsManager;
