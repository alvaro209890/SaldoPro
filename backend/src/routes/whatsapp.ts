import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { WhatsAppClient } from '../whatsapp/client';

interface SendMessageBody {
  to?: string;
  text?: string;
}

export function createWhatsAppRouter(client: WhatsAppClient): Router {
  const router = Router();

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

      const result = await client.sendText(to, text);
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

  router.use((error: unknown, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
    logger.error('WhatsApp route error', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  });

  return router;
}

