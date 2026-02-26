"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWhatsAppRouter = createWhatsAppRouter;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const events_1 = require("../whatsapp/events");
function createWhatsAppRouter(client) {
    const router = (0, express_1.Router)();
    // QR display page — browser-accessible with token as query param (no Bearer header needed)
    router.get('/qr-page', async (req, res) => {
        const token = req.query.token?.trim() ?? '';
        if (!token || token !== env_1.env.whatsappApiToken) {
            res.status(401).send('Unauthorized');
            return;
        }
        const status = client.getStatus();
        let bodyContent;
        let refreshSec = 3;
        try {
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
                    // no_qr or expired — show spinner and wait for next QR
                    bodyContent = `
            <div class="spinner"></div>
            <p class="hint">Conectando ao WhatsApp, aguarde...</p>`;
                    refreshSec = 2;
                }
            }
        }
        catch {
            bodyContent = `
        <div class="spinner"></div>
        <p class="hint">Conectando ao WhatsApp, aguarde...</p>`;
            refreshSec = 2;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
    router.use(auth_1.requireAuth);
    router.get('/status', (_req, res) => {
        res.json(client.getStatus());
    });
    router.get('/qr', async (_req, res, next) => {
        try {
            const payload = await client.getQrPayload();
            res.json(payload);
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/send', async (req, res, next) => {
        try {
            const body = req.body;
            const to = body.to?.trim() ?? '';
            const text = body.text?.trim() ?? '';
            if (!to || !text) {
                res.status(400).json({ error: '`to` and `text` are required' });
                return;
            }
            if (text.length > env_1.env.maxMessageLength) {
                res.status(400).json({ error: `Text exceeds max length (${env_1.env.maxMessageLength})` });
                return;
            }
            const normalizedTarget = (0, events_1.normalizePhoneNumber)(to);
            const binding = await (0, firestore_1.getPhoneBinding)(normalizedTarget);
            if (!binding) {
                res.status(403).json({ error: 'Target phone is not linked to any account' });
                return;
            }
            const stillAllowed = await (0, firestore_1.isPhoneAllowedForUid)(binding.uid, normalizedTarget);
            if (!stillAllowed) {
                res.status(403).json({ error: 'Target phone is not whitelisted' });
                return;
            }
            const result = await client.sendText(to, text, binding.uid);
            res.json({
                ok: true,
                messageId: result.messageId
            });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/session/reset', async (_req, res, next) => {
        try {
            await client.resetSession();
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    router.use((error, _req, res, _next) => {
        logger_1.logger.error('WhatsApp route error', error);
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: message });
    });
    return router;
}
