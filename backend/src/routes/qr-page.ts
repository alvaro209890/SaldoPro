import { Router } from 'express';
import type { WhatsAppClient } from '../whatsapp/client';

export function createQrPageRouter(client: WhatsAppClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const status = client.getStatus();
    const qrPayload = await client.getQrPayload();

    let content: string;

    if (status.connected) {
      content = `
        <div class="status connected">
          <div class="icon">&#10004;</div>
          <h2>WhatsApp Conectado</h2>
          <p>Telefone: ${status.phone ?? 'N/A'}</p>
        </div>`;
    } else if (qrPayload.available) {
      content = `
        <div class="qr-container">
          <h2>Escaneie o QR Code</h2>
          <p>Abra o WhatsApp no celular &gt; Menu &gt; Dispositivos conectados &gt; Conectar dispositivo</p>
          <img src="${qrPayload.qrPngBase64}" alt="QR Code" />
          <p class="timer">Expira em <span id="countdown">${qrPayload.expiresInSec}</span>s</p>
        </div>
        <script>
          let sec = ${qrPayload.expiresInSec};
          const el = document.getElementById('countdown');
          const iv = setInterval(() => {
            sec--;
            if (el) el.textContent = sec;
            if (sec <= 0) { clearInterval(iv); location.reload(); }
          }, 1000);
          setTimeout(() => location.reload(), ${qrPayload.expiresInSec * 1000});
        </script>`;
    } else {
      const reason = qrPayload.reason === 'expired'
        ? 'QR Code expirado. Aguarde um novo...'
        : 'Aguardando QR Code... O servidor est\u00E1 iniciando a conex\u00E3o.';
      content = `
        <div class="status waiting">
          <div class="spinner"></div>
          <h2>${reason}</h2>
        </div>
        <script>setTimeout(() => location.reload(), 3000);</script>`;
    }

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SaldoPro - WhatsApp</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #111b21;
      color: #e9edef;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 460px;
    }
    h1 { color: #00a884; margin-bottom: 1.5rem; font-size: 1.6rem; }
    h2 { margin-bottom: 0.8rem; font-size: 1.2rem; }
    p { color: #8696a0; margin-bottom: 1rem; font-size: 0.95rem; line-height: 1.4; }
    .qr-container img {
      background: #fff;
      padding: 12px;
      border-radius: 12px;
      max-width: 280px;
      width: 100%;
    }
    .timer { color: #00a884; font-weight: 600; margin-top: 1rem; }
    .status { padding: 2rem; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    .connected .icon { color: #00a884; }
    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #2a3942;
      border-top-color: #00a884;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>SaldoPro WhatsApp</h1>
    ${content}
  </div>
</body>
</html>`);
  });

  return router;
}
