"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQrPageRouter = createQrPageRouter;
const express_1 = require("express");
function createQrPageRouter(client) {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res) => {
        const status = client.getStatus();
        let bodyContent;
        let refreshSec = 3;
        if (status.connected) {
            bodyContent = `
        <div class="connected-box">
          <div class="check">&#x2713;</div>
          <p>WhatsApp conectado</p>
          <p class="phone">${status.phone ?? ''}</p>
        </div>`;
            refreshSec = 10;
        }
        else {
            const payload = await client.getQrPayload();
            if (payload.available) {
                bodyContent = `
          <img src="${payload.qrPngBase64}" alt="WhatsApp QR Code" />
          <p class="expires">Expira em: <strong>${payload.expiresInSec}s</strong></p>
          <p class="hint">Abra o WhatsApp &rarr; Dispositivos conectados &rarr; Conectar dispositivo</p>`;
            }
            else {
                bodyContent = `
          <div class="spinner"></div>
          <p class="hint">Conectando ao WhatsApp, aguarde...</p>`;
                refreshSec = 2;
            }
        }
        res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="${refreshSec}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SaldoPro — WhatsApp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      background: #111827;
      color: #f9fafb;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 24px;
    }
    h1 { font-size: 1.4rem; letter-spacing: 0.02em; color: #e5e7eb; }
    img {
      width: 280px; height: 280px;
      background: #fff; padding: 16px;
      border-radius: 12px; display: block;
    }
    .expires { font-size: 0.9rem; color: #9ca3af; }
    .hint { font-size: 0.85rem; color: #9ca3af; text-align: center; max-width: 300px; }
    .connected-box { text-align: center; }
    .connected-box .check {
      font-size: 3rem; color: #22c55e;
      width: 72px; height: 72px; line-height: 72px;
      border-radius: 50%; background: #14532d;
      margin: 0 auto 12px;
    }
    .connected-box p { font-size: 1.1rem; }
    .connected-box .phone { font-size: 0.9rem; color: #9ca3af; margin-top: 4px; }
    .spinner {
      width: 48px; height: 48px;
      border: 4px solid #1f2937;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    footer { font-size: 0.7rem; color: #4b5563; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>SaldoPro &mdash; WhatsApp</h1>
  ${bodyContent}
  <footer>Atualiza automaticamente</footer>
</body>
</html>`);
    });
    return router;
}
