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
function renderDynamicBlock(status, payload) {
    if (status.connected) {
        return '<section class="ok-block"><p class="hint">Conexao ativa.</p></section>';
    }
    if (payload?.available) {
        return `
      <section class="qr-block">
        <img src="${payload.qrPngBase64}" alt="WhatsApp QR Code" />
        <p class="expires">Expira em: <strong>${payload.expiresInSec}s</strong></p>
        <p class="hint">Abra o WhatsApp -> Dispositivos conectados -> Conectar dispositivo</p>
      </section>`;
    }
    const reason = payload?.available === false ? payload.reason : 'no_qr';
    const reasonText = reason === 'expired'
        ? 'QR expirado. Gerando um novo...'
        : reason === 'already_connected'
            ? 'WhatsApp ja conectado.'
            : 'Aguardando geracao do QR...';
    return `
    <section class="wait-block">
      <div class="spinner"></div>
      <p class="hint">${escapeHtml(reasonText)}</p>
    </section>`;
}
function renderSlotCard(slot) {
    const state = escapeHtml(formatState(slot.status));
    const phone = slot.status.phone ? escapeHtml(slot.status.phone) : '-';
    const reason = slot.status.lastDisconnectReason ? escapeHtml(slot.status.lastDisconnectReason) : '-';
    const title = escapeHtml(slot.label);
    const slotBadge = escapeHtml(slot.status.slotId.toUpperCase());
    return `
    <article class="slot-card">
      <header class="slot-header">
        <h2>${title}</h2>
        <span class="slot-badge">${slotBadge}</span>
      </header>
      <section class="status-panel">
        <p><strong>Status:</strong> ${state}</p>
        <p><strong>Numero:</strong> ${phone}</p>
        <p><strong>Ultimo motivo:</strong> ${reason}</p>
      </section>
      ${renderDynamicBlock(slot.status, slot.payload)}
    </article>`;
}
function computeRefreshSec(slots) {
    if (slots.every((slot) => slot.status.connected)) {
        return 10;
    }
    if (slots.some((slot) => !slot.status.connected && (!slot.payload || slot.payload.available === false))) {
        return 2;
    }
    return 3;
}
function renderWhatsAppPage({ slots, resetUrl }) {
    const refreshSec = computeRefreshSec(slots);
    const cards = slots.map((slot) => renderSlotCard(slot)).join('\n');
    const resetButton = resetUrl
        ? `
  <form method="POST" action="${escapeHtml(resetUrl)}" onsubmit="return confirm('Desconectar todos os WhatsApps e gerar novo QR?')">
    <button type="submit" class="reset-btn">Desconectar e gerar novo QR</button>
  </form>`
        : '';
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
      background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: grid;
      justify-items: center;
      gap: 20px;
      padding: 24px;
    }
    h1 { font-size: 1.35rem; color: #e2e8f0; }
    .cards {
      width: 100%;
      max-width: 900px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .slot-card {
      border: 1px solid #334155;
      border-radius: 14px;
      background: #0b1220;
      padding: 14px;
      display: grid;
      gap: 10px;
      align-content: start;
    }
    .slot-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .slot-header h2 {
      font-size: 1rem;
      color: #cbd5e1;
    }
    .slot-badge {
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 999px;
      background: #1e293b;
      color: #93c5fd;
    }
    .status-panel {
      border: 1px solid #1f2937;
      border-radius: 10px;
      background: #111827;
      padding: 10px 11px;
      display: grid;
      gap: 5px;
    }
    .status-panel p {
      font-size: 0.84rem;
      color: #94a3b8;
    }
    .qr-block {
      display: grid;
      gap: 8px;
      justify-items: center;
    }
    img {
      width: min(100%, 260px);
      aspect-ratio: 1 / 1;
      background: #ffffff;
      padding: 14px;
      border-radius: 12px;
      display: block;
    }
    .expires { font-size: 0.85rem; color: #94a3b8; }
    .hint {
      font-size: 0.8rem;
      color: #94a3b8;
      text-align: center;
      max-width: 260px;
    }
    .wait-block, .ok-block {
      display: grid;
      gap: 8px;
      justify-items: center;
      min-height: 64px;
      align-content: center;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 4px solid #1f2937;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    footer {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 4px;
    }
    .reset-btn {
      background: #7f1d1d;
      color: #fecaca;
      border: 1px solid #991b1b;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .reset-btn:hover { background: #991b1b; }
  </style>
</head>
<body>
  <h1>SaldoPro - WhatsApp</h1>
  <section class="cards">
    ${cards}
  </section>
  ${resetButton}
  <footer>Atualiza automaticamente</footer>
</body>
</html>`;
}
