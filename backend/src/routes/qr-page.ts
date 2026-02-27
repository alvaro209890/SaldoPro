import { Router } from 'express';
import { WHATSAPP_SLOT_IDS, type WhatsAppClientsManager } from '../whatsapp/manager';
import { renderWhatsAppPage, type WhatsAppSlotPageData } from './whatsapp-page';

function slotLabel(slotId: 'wa1' | 'wa2'): string {
  return slotId === 'wa1' ? 'WhatsApp' : 'WhatsApp 2';
}

export function createQrPageRouter(manager: WhatsAppClientsManager): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const slots: WhatsAppSlotPageData[] = await Promise.all(
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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderWhatsAppPage({ slots }));
  });

  return router;
}
