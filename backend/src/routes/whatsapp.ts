import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { getPhoneBinding, isPhoneAllowedForUid } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { WhatsAppSlotId } from '../types/whatsapp';
import { normalizePhoneNumber } from '../whatsapp/events';
import { WHATSAPP_SLOT_IDS, isWhatsAppSlotId, type WhatsAppClientsManager } from '../whatsapp/manager';
import { renderWhatsAppPage, type WhatsAppSlotPageData } from './whatsapp-page';

interface SendMessageBody {
  to?: string;
  text?: string;
  clientId?: WhatsAppSlotId | string;
}

interface ResetSessionBody {
  slotId?: WhatsAppSlotId | string;
}

function slotLabel(slotId: WhatsAppSlotId): string {
  return slotId === 'wa1' ? 'WhatsApp' : 'WhatsApp';
}

async function buildSlotsPageData(manager: WhatsAppClientsManager): Promise<WhatsAppSlotPageData[]> {
  return Promise.all(
    WHATSAPP_SLOT_IDS.map(async (slotId) => {
      const status = manager.getStatusBySlot(slotId);
      let payload: WhatsAppSlotPageData['payload'] = null;

      if (!status.connected) {
        try {
          payload = await manager.getQrPayloadBySlot(slotId);
        } catch {
          payload = { available: false, reason: 'no_qr' };
        }
      }

      return {
        label: slotLabel(slotId),
        status,
        payload
      };
    })
  );
}

export function createWhatsAppRouter(manager: WhatsAppClientsManager): Router {
  const router = Router();

  // QR display page - browser-accessible with token as query param (no Bearer header needed)
  router.get('/qr-page', async (req, res) => {
    const token = (req.query.token as string | undefined)?.trim() ?? '';
    if (!token || token !== env.whatsappApiToken) {
      res.status(401).send('Unauthorized');
      return;
    }

    const slots = await buildSlotsPageData(manager);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderWhatsAppPage({ slots }));
  });

  router.use(requireAuth);

  router.get('/status', (_req, res) => {
    res.json({ slots: manager.getStatuses() });
  });

  router.get('/qr', async (_req, res, next) => {
    try {
      const payloads = await manager.getQrPayloads();
      res.json({ slots: payloads });
    } catch (error) {
      next(error);
    }
  });

  router.post('/send', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as SendMessageBody;
      const to = body.to?.trim() ?? '';
      const text = body.text?.trim() ?? '';
      const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;

      if (!to || !text) {
        res.status(400).json({ error: '`to` and `text` are required' });
        return;
      }

      if (text.length > env.maxMessageLength) {
        res.status(400).json({ error: `Text exceeds max length (${env.maxMessageLength})` });
        return;
      }

      if (clientId && !isWhatsAppSlotId(clientId)) {
        res.status(400).json({ error: '`clientId` must be `wa1` when provided' });
        return;
      }
      const resolvedClientId: WhatsAppSlotId | undefined =
        clientId && isWhatsAppSlotId(clientId) ? clientId : undefined;

      const normalizedTarget = normalizePhoneNumber(to);
      const binding = await getPhoneBinding(normalizedTarget);
      if (!binding) {
        res.status(403).json({ error: 'Target phone is not linked to any account' });
        return;
      }

      const stillAllowed = await isPhoneAllowedForUid(binding.uid, normalizedTarget);
      if (!stillAllowed) {
        res.status(403).json({ error: 'Target phone is not whitelisted' });
        return;
      }

      const result = await manager.sendTextWithRouting({
        to,
        text,
        ownerUid: binding.uid,
        ...(resolvedClientId ? { clientId: resolvedClientId } : {})
      });

      res.json({
        ok: true,
        messageId: result.messageId,
        clientId: result.clientId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/session/reset', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as ResetSessionBody;
      const slotValue = typeof body.slotId === 'string' ? body.slotId.trim() : '';

      if (slotValue && !isWhatsAppSlotId(slotValue)) {
        res.status(400).json({ error: '`slotId` must be `wa1` when provided' });
        return;
      }
      const resolvedSlotId: WhatsAppSlotId | undefined =
        slotValue && isWhatsAppSlotId(slotValue) ? slotValue : undefined;

      await manager.resetSession(resolvedSlotId);
      res.json({ ok: true, slotId: resolvedSlotId ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.use(
    (
      error: unknown,
      _req: unknown,
      res: { status: (code: number) => { json: (body: unknown) => void } },
      _next: unknown
    ) => {
      logger.error('WhatsApp route error', error);
      const message = error instanceof Error ? error.message : 'Unexpected error';
      res.status(500).json({ error: message });
    }
  );

  return router;
}
