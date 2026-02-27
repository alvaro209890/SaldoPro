import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { RuntimeStatus, WhatsAppSlotId } from '../types/whatsapp';
import { WhatsAppClient } from './client';
import { normalizePhoneNumber } from './events';

/** Only wa1 is active — single WhatsApp connection. */
export const WHATSAPP_SLOT_IDS: WhatsAppSlotId[] = ['wa1'];

export function isWhatsAppSlotId(value: unknown): value is WhatsAppSlotId {
  return value === 'wa1' || value === 'wa2';
}

export type WhatsAppQrPayload = Awaited<ReturnType<WhatsAppClient['getQrPayload']>>;

interface SendWithRoutingInput {
  to: string;
  text: string;
  ownerUid: string;
  clientId?: WhatsAppSlotId;
}

export class WhatsAppClientsManager {
  private readonly client: WhatsAppClient;

  constructor() {
    this.client = new WhatsAppClient({
      slotId: 'wa1',
      authDir: env.whatsappAuthDirWa1,
      displayName: 'WhatsApp 1'
    });
  }

  async startAll(): Promise<void> {
    try {
      await this.client.start();
    } catch (error) {
      logger.error('Failed to start WhatsApp', { error });
    }
  }

  async shutdownAll(): Promise<void> {
    try {
      await this.client.shutdown();
    } catch (error) {
      logger.error('Failed to shutdown WhatsApp', { error });
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
    await this.client.resetSession();
  }

  async sendTextWithRouting(input: SendWithRoutingInput): Promise<{ messageId: string; clientId: WhatsAppSlotId }> {
    const normalizedPhone = normalizePhoneNumber(input.to);
    if (normalizedPhone.length < 10) {
      throw new Error('Invalid destination phone');
    }

    if (!this.client.getStatus().connected) {
      throw new Error('WhatsApp is not connected');
    }

    const result = await this.client.sendText(input.to, input.text, input.ownerUid);
    return { ...result, clientId: 'wa1' };
  }
}
