import { env } from '../config/env';
import { getLastConversationClientIdByPhone } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { RuntimeStatus, WhatsAppSlotId } from '../types/whatsapp';
import { WhatsAppClient } from './client';
import { normalizePhoneNumber } from './events';

export const WHATSAPP_SLOT_IDS: WhatsAppSlotId[] = ['wa1', 'wa2'];

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
  private readonly clients: Record<WhatsAppSlotId, WhatsAppClient>;

  constructor() {
    this.clients = {
      wa1: new WhatsAppClient({
        slotId: 'wa1',
        authDir: env.whatsappAuthDirWa1,
        displayName: 'WhatsApp 1'
      }),
      wa2: new WhatsAppClient({
        slotId: 'wa2',
        authDir: env.whatsappAuthDirWa2,
        displayName: 'WhatsApp 2'
      })
    };
  }

  async startAll(): Promise<void> {
    await Promise.all(
      WHATSAPP_SLOT_IDS.map(async (slotId) => {
        try {
          await this.clients[slotId].start();
        } catch (error) {
          logger.error('Failed to start WhatsApp slot', { slotId, error });
        }
      })
    );
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(
      WHATSAPP_SLOT_IDS.map(async (slotId) => {
        try {
          await this.clients[slotId].shutdown();
        } catch (error) {
          logger.error('Failed to shutdown WhatsApp slot', { slotId, error });
        }
      })
    );
  }

  getClient(slotId: WhatsAppSlotId): WhatsAppClient {
    return this.clients[slotId];
  }

  getStatuses(): RuntimeStatus[] {
    return WHATSAPP_SLOT_IDS.map((slotId) => this.clients[slotId].getStatus());
  }

  getStatusBySlot(slotId: WhatsAppSlotId): RuntimeStatus {
    return this.clients[slotId].getStatus();
  }

  async getQrPayloadBySlot(slotId: WhatsAppSlotId): Promise<WhatsAppQrPayload> {
    return this.clients[slotId].getQrPayload();
  }

  async getQrPayloads(): Promise<Record<WhatsAppSlotId, WhatsAppQrPayload>> {
    const payloads = await Promise.all(
      WHATSAPP_SLOT_IDS.map(async (slotId) => {
        try {
          return [slotId, await this.clients[slotId].getQrPayload()] as const;
        } catch {
          return [slotId, { available: false, reason: 'no_qr' } as WhatsAppQrPayload] as const;
        }
      })
    );

    return Object.fromEntries(payloads) as Record<WhatsAppSlotId, WhatsAppQrPayload>;
  }

  async resetSession(slotId?: WhatsAppSlotId): Promise<void> {
    if (slotId) {
      await this.clients[slotId].resetSession();
      return;
    }

    await Promise.all(WHATSAPP_SLOT_IDS.map((id) => this.clients[id].resetSession()));
  }

  private firstConnectedClient():
    | {
      slotId: WhatsAppSlotId;
      client: WhatsAppClient;
    }
    | null {
    for (const slotId of WHATSAPP_SLOT_IDS) {
      const client = this.clients[slotId];
      if (client.getStatus().connected) {
        return { slotId, client };
      }
    }
    return null;
  }

  async sendTextWithRouting(input: SendWithRoutingInput): Promise<{ messageId: string; clientId: WhatsAppSlotId }> {
    const normalizedPhone = normalizePhoneNumber(input.to);
    if (normalizedPhone.length < 10) {
      throw new Error('Invalid destination phone');
    }

    if (input.clientId) {
      const forcedClient = this.clients[input.clientId];
      if (!forcedClient.getStatus().connected) {
        throw new Error(`WhatsApp ${input.clientId} is not connected`);
      }
      const result = await forcedClient.sendText(input.to, input.text, input.ownerUid);
      return { ...result, clientId: input.clientId };
    }

    const lastClientId = await getLastConversationClientIdByPhone(input.ownerUid, normalizedPhone);
    if (lastClientId) {
      const routedClient = this.clients[lastClientId];
      if (routedClient.getStatus().connected) {
        const result = await routedClient.sendText(input.to, input.text, input.ownerUid);
        return { ...result, clientId: lastClientId };
      }
    }

    const fallback = this.firstConnectedClient();
    if (!fallback) {
      throw new Error('No connected WhatsApp client is available');
    }

    const result = await fallback.client.sendText(input.to, input.text, input.ownerUid);
    return { ...result, clientId: fallback.slotId };
  }
}
