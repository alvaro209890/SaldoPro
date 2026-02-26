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
        let bodyContent;
        try {
            const payload = await client.getQrPayload();
            if (!payload.available) {
                if (payload.reason === 'already_connected') {
                    bodyContent = '<p class="status ok">&#x2705; WhatsApp já está conectado!</p>';
                }
                else if (payload.reason === 'expired') {
                    bodyContent = '<p class="status warn">&#x23F3; QR expirado. Aguardando novo QR code...</p>';
                }
                else {
                    bodyContent = '<p class="status info">&#x1F4F1; Iniciando conexão, aguarde o QR code...</p>';
                }
            }
            else {
                bodyContent = `
          <img src="${payload.qrPngBase64}" alt="WhatsApp QR Code" />
          <p class="expires">Expira em: <strong>${payload.expiresInSec}s</strong></p>
          <p class="hint">Abra o WhatsApp &rarr; Dispositivos conectados &rarr; Conectar dispositivo</p>
        `;
            }
        }
        catch {
            bodyContent = '<p class="status warn">Erro ao carregar QR code. Recarregue a página.</p>';
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="3" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SaldoPro — WhatsApp QR Code</title>
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
      width: 280px;
      height: 280px;
      background: #ffffff;
      padding: 16px;
      border-radius: 12px;
      display: block;
    }
    .expires { font-size: 0.9rem; color: #9ca3af; }
    .hint { font-size: 0.8rem; color: #6b7280; text-align: center; max-width: 280px; }
    .status { font-size: 1.1rem; padding: 12px 24px; border-radius: 8px; }
    .ok   { background: #14532d; color: #bbf7d0; }
    .warn { background: #451a03; color: #fde68a; }
    .info { background: #1e3a5f; color: #bfdbfe; }
    footer { font-size: 0.7rem; color: #4b5563; }
  </style>
</head>
<body>
  <h1>SaldoPro &mdash; WhatsApp</h1>
  ${bodyContent}
  <footer>Página atualiza automaticamente a cada 5 segundos</footer>
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
