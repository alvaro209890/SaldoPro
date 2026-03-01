import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { isFirebaseUserActive } from '../lib/firebase-user-access';
import { logger } from '../lib/logger';
import {
  acquireWhatsAppConnectionLock,
  forceAcquireWhatsAppConnectionLock,
  releaseWhatsAppConnectionLock
} from '../lib/whatsapp-lock';
import type { RuntimeStatus, WhatsAppSlotId } from '../types/whatsapp';
import { WhatsAppClient } from './client';
import { normalizePhoneNumber } from './events';

/** Only wa1 is active - single WhatsApp connection. */
export const WHATSAPP_SLOT_IDS: WhatsAppSlotId[] = ['wa1'];
const ACTIVE_SLOT: WhatsAppSlotId = 'wa1';
const LOCK_TTL_SECONDS = 90;
const LOCK_RENEW_INTERVAL_MS = 30_000;
const LOCK_RETRY_MS = 10_000;

export function isWhatsAppSlotId(value: unknown): value is WhatsAppSlotId {
  return value === 'wa1';
}

export type WhatsAppQrPayload = Awaited<ReturnType<WhatsAppClient['getQrPayload']>>;

interface SendWithRoutingInput {
  to: string;
  text: string;
  ownerUid: string;
  clientId?: WhatsAppSlotId;
  mediaUrl?: string;
}

export class WhatsAppClientsManager {
  private readonly client: WhatsAppClient;
  private readonly instanceId: string;
  private running = false;
  private hasLock = false;
  private clientStarted = false;
  private lockAttemptInFlight = false;
  private lockRenewInFlight = false;
  private lockRetryTimer: NodeJS.Timeout | null = null;
  private lockRenewTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.instanceId = randomUUID();
    this.client = new WhatsAppClient({
      slotId: 'wa1',
      authDir: env.whatsappAuthDirWa1,
      displayName: 'WhatsApp 1'
    });
  }

  async startAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.tryAcquireAndStart();
  }

  async shutdownAll(): Promise<void> {
    this.running = false;
    this.clearLockRetryTimer();
    this.stopLockRenewLoop();

    try {
      if (this.clientStarted) {
        await this.client.shutdown();
      }
    } catch (error) {
      logger.error('Failed to shutdown WhatsApp', { error });
    } finally {
      this.clientStarted = false;
    }

    if (this.hasLock) {
      try {
        await releaseWhatsAppConnectionLock(ACTIVE_SLOT, this.instanceId);
      } catch (error) {
        logger.error('Failed to release WhatsApp connection lock on shutdown', { error });
      } finally {
        this.hasLock = false;
      }
    }
  }

  getClient(_slotId?: WhatsAppSlotId): WhatsAppClient {
    return this.client;
  }

  getStatuses(): RuntimeStatus[] {
    return [this.client.getStatus()];
  }

  getStatusBySlot(_slotId: WhatsAppSlotId): RuntimeStatus {
    return this.client.getStatus();
  }

  async getQrPayloadBySlot(_slotId: WhatsAppSlotId): Promise<WhatsAppQrPayload> {
    return this.client.getQrPayload();
  }

  async getQrPayloads(): Promise<Record<string, WhatsAppQrPayload>> {
    try {
      return { wa1: await this.client.getQrPayload() };
    } catch {
      return { wa1: { available: false, reason: 'no_qr' } as WhatsAppQrPayload };
    }
  }

  async resetSession(_slotId?: WhatsAppSlotId): Promise<void> {
    if (!this.hasLock || !this.clientStarted) {
      await this.forceTakeoverAndStart();
    }
    await this.client.resetSession();
  }

  async sendTextWithRouting(input: SendWithRoutingInput): Promise<{ messageId: string; clientId: WhatsAppSlotId }> {
    const normalizedPhone = normalizePhoneNumber(input.to);
    if (normalizedPhone.length < 10) {
      throw new Error('Invalid destination phone');
    }

    const ownerActive = await isFirebaseUserActive(input.ownerUid);
    if (!ownerActive) {
      throw new Error('Target account is blocked or unavailable');
    }

    if (!this.hasLock || !this.clientStarted || !this.client.getStatus().connected) {
      throw new Error('WhatsApp is not connected');
    }

    const result = await this.client.sendText(input.to, input.text, input.ownerUid, input.mediaUrl);
    return { ...result, clientId: 'wa1' };
  }

  private clearLockRetryTimer(): void {
    if (!this.lockRetryTimer) return;
    clearTimeout(this.lockRetryTimer);
    this.lockRetryTimer = null;
  }

  private scheduleLockRetry(): void {
    if (!this.running || this.lockRetryTimer) return;
    this.lockRetryTimer = setTimeout(() => {
      this.lockRetryTimer = null;
      void this.tryAcquireAndStart();
    }, LOCK_RETRY_MS);
  }

  private startLockRenewLoop(): void {
    this.stopLockRenewLoop();
    this.lockRenewTimer = setInterval(() => {
      void this.renewLock();
    }, LOCK_RENEW_INTERVAL_MS);
  }

  private stopLockRenewLoop(): void {
    if (!this.lockRenewTimer) return;
    clearInterval(this.lockRenewTimer);
    this.lockRenewTimer = null;
  }

  private async renewLock(): Promise<void> {
    if (!this.running || !this.hasLock || this.lockRenewInFlight) return;
    this.lockRenewInFlight = true;
    try {
      const renewed = await acquireWhatsAppConnectionLock(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
      if (renewed) return;

      logger.warn('Lost WhatsApp connection lock. Stopping client to avoid dual sessions.', {
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
    } catch (error) {
      logger.warn('Failed to renew WhatsApp connection lock', {
        slotId: ACTIVE_SLOT,
        instanceId: this.instanceId,
        error
      });
    } finally {
      this.lockRenewInFlight = false;
    }
  }

  private async tryAcquireAndStart(): Promise<void> {
    if (!this.running || this.lockAttemptInFlight) return;
    this.lockAttemptInFlight = true;

    try {
      const acquired = await acquireWhatsAppConnectionLock(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
      if (!this.running) return;

      if (!acquired) {
        logger.debug('WhatsApp lock is held by another instance. Waiting before retry.', {
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
        logger.info('WhatsApp connection lock acquired', {
          slotId: ACTIVE_SLOT,
          instanceId: this.instanceId
        });
      }

      if (this.clientStarted) return;
      await this.client.start();
      this.clientStarted = true;
      logger.info('WhatsApp client started with active lock', {
        slotId: ACTIVE_SLOT,
        instanceId: this.instanceId
      });
    } catch (error) {
      logger.error('Failed to acquire/start WhatsApp with distributed lock', {
        slotId: ACTIVE_SLOT,
        instanceId: this.instanceId,
        error
      });

      if (this.hasLock) {
        try {
          await releaseWhatsAppConnectionLock(ACTIVE_SLOT, this.instanceId);
        } catch (releaseError) {
          logger.error('Failed to release WhatsApp lock after start error', { releaseError });
        } finally {
          this.hasLock = false;
        }
      }

      this.stopLockRenewLoop();
      this.scheduleLockRetry();
    } finally {
      this.lockAttemptInFlight = false;
    }
  }

  private async forceTakeoverAndStart(): Promise<void> {
    if (!this.running) {
      this.running = true;
    }

    const forced = await forceAcquireWhatsAppConnectionLock(ACTIVE_SLOT, this.instanceId, LOCK_TTL_SECONDS);
    if (!forced) {
      throw new Error('Failed to force WhatsApp lock takeover.');
    }

    this.hasLock = true;
    this.startLockRenewLoop();
    logger.warn('Forced WhatsApp lock takeover for administrative recovery', {
      slotId: ACTIVE_SLOT,
      instanceId: this.instanceId
    });

    if (this.clientStarted) return;
    await this.client.start();
    this.clientStarted = true;
    logger.info('WhatsApp client started after forced lock takeover', {
      slotId: ACTIVE_SLOT,
      instanceId: this.instanceId
    });
  }
}
