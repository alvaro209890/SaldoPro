import { Router } from 'express';
import type { WhatsAppClient } from '../whatsapp/client';
import { renderWhatsAppPage } from './whatsapp-page';

export function createQrPageRouter(client: WhatsAppClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
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

  return router;
}
