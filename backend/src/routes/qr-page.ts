import { Router } from 'express';
import type { WhatsAppClient } from '../whatsapp/client';

export function createQrPageRouter(client: WhatsAppClient): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const status = client.getStatus();
    const statusText = status.connected
      ? '<p class="status ok">WhatsApp conectado</p>'
      : '<p class="status info">WhatsApp desconectado</p>';

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SaldoPro Backend</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      background: #111827;
      color: #f9fafb;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 1.4rem; color: #e5e7eb; margin-bottom: 1rem; }
    .status { font-size: 1rem; padding: 8px 20px; border-radius: 8px; display: inline-block; }
    .ok { background: #14532d; color: #bbf7d0; }
    .info { background: #1e3a5f; color: #bfdbfe; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SaldoPro &mdash; Backend</h1>
    ${statusText}
  </div>
</body>
</html>`);
  });

  return router;
}
