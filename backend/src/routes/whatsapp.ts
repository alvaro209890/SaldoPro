import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { getPhoneBinding, isPhoneAllowedForUid } from '../lib/firestore';
import { logger } from '../lib/logger';
import { WhatsAppClient } from '../whatsapp/client';
import { normalizePhoneNumber } from '../whatsapp/events';
import { renderWhatsAppPage } from './whatsapp-page';

interface SendMessageBody {
  to?: string;
  text?: string;
}

export function createWhatsAppRouter(client: WhatsAppClient): Router {
  const router = Router();

  // QR display page - browser-accessible with token as query param (no Bearer header needed)
  router.get('/qr-page', async (req, res) => {
    const token = (req.query.token as string | undefined)?.trim() ?? '';
    if (!token || token !== env.whatsappApiToken) {
      res.status(401).send('Unauthorized');
      return;
    }

    const status = client.getStatus();
    let payload: Awaited<ReturnType<WhatsAppClient['getQrPayload']>> | null = null;

    if (!status.connected) {
      try {
        payload = await client.getQrPayload();
      } catch {
        payload = { available: false, reason: 'no_qr' };
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderWhatsAppPage({ status, payload }));
  });

  router.use(requireAuth);

  router.get('/status', (_req, res) => {
    res.json(client.getStatus());
  });

  router.get('/qr', async (_req, res, next) => {
    try {
      const payload = await client.getQrPayload();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post('/send', async (req, res, next) => {
    try {
      const body = req.body as SendMessageBody;
      const to = body.to?.trim() ?? '';
      const text = body.text?.trim() ?? '';

      if (!to || !text) {
        res.status(400).json({ error: '`to` and `text` are required' });
        return;
      }

      if (text.length > env.maxMessageLength) {
        res.status(400).json({ error: `Text exceeds max length (${env.maxMessageLength})` });
        return;
      }

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

      const result = await client.sendText(to, text, binding.uid);
      res.json({
        ok: true,
        messageId: result.messageId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/session/reset', async (_req, res, next) => {
    try {
      await client.resetSession();
      res.json({ ok: true });
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
