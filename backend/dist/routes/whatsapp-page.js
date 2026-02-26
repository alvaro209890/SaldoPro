"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWhatsAppPage = renderWhatsAppPage;
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function formatState(status) {
    if (status.connected)
        return 'conectado';
    if (status.state === 'connecting')
        return 'conectando';
    if (status.state === 'close')
        return 'desconectado';
    return status.state;
}
function buildStatusPanel(status) {
    const state = escapeHtml(formatState(status));
    const phone = status.phone ? escapeHtml(status.phone) : '-';
    const reason = status.lastDisconnectReason ? escapeHtml(status.lastDisconnectReason) : '-';
    return `
    <section class="status-panel">
      <h2>Estado da Conexao</h2>
      <p><strong>Status:</strong> ${state}</p>
      <p><strong>Numero:</strong> ${phone}</p>
      <p><strong>Ultimo motivo:</strong> ${reason}</p>
    </section>`;
}
function renderWhatsAppPage({ status, payload }) {
    let refreshSec = status.connected ? 10 : 3;
    let dynamicBlock = '';
    if (status.connected) {
        dynamicBlock = '';
    }
    else if (payload?.available) {
        dynamicBlock = `
      <section class="qr-block">
        <img src="${payload.qrPngBase64}" alt="WhatsApp QR Code" />
        <p class="expires">Expira em: <strong>${payload.expiresInSec}s</strong></p>
        <p class="hint">Abra o WhatsApp -> Dispositivos conectados -> Conectar dispositivo</p>
      </section>`;
    }
    else {
        refreshSec = 2;
        const reason = payload?.available === false ? payload.reason : 'no_qr';
        const reasonText = reason === 'expired'
            ? 'QR expirado. Gerando um novo...'
            : reason === 'already_connected'
                ? 'WhatsApp ja conectado.'
                : 'Aguardando geracao do QR...';
        dynamicBlock = `
      <section class="wait-block">
        <div class="spinner"></div>
        <p class="hint">${escapeHtml(reasonText)}</p>
      </section>`;
    }
    const statusPanel = buildStatusPanel(status);
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="${refreshSec}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SaldoPro - WhatsApp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 24px;
    }
    h1 { font-size: 1.35rem; color: #e2e8f0; }
    .status-panel {
      width: 100%;
      max-width: 360px;
      border: 1px solid #334155;
      border-radius: 12px;
      background: #111827;
      padding: 14px 16px;
      display: grid;
      gap: 6px;
    }
    .status-panel h2 {
      font-size: 0.95rem;
      margin-bottom: 4px;
      color: #cbd5e1;
    }
    .status-panel p {
      font-size: 0.88rem;
      color: #94a3b8;
    }
    .qr-block {
      display: grid;
      gap: 8px;
      justify-items: center;
    }
    img {
      width: 280px;
      height: 280px;
      background: #ffffff;
      padding: 16px;
      border-radius: 12px;
      display: block;
    }
    .expires { font-size: 0.9rem; color: #94a3b8; }
    .hint {
      font-size: 0.85rem;
      color: #94a3b8;
      text-align: center;
      max-width: 320px;
    }
    .wait-block {
      display: grid;
      gap: 8px;
      justify-items: center;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #1f2937;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    footer {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <h1>SaldoPro - WhatsApp</h1>
  ${statusPanel}
  ${dynamicBlock}
  <footer>Atualiza automaticamente</footer>
</body>
</html>`;
}
