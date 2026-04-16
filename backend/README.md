# SaldoPro WhatsApp Backend

Backend Node.js + TypeScript para WhatsApp/IA do SaldoPro.

## Arquitetura de dados

- Supabase Auth: login, refresh de sessao e validacao do token do frontend.
- Supabase: persistencia de dados de negocio e dados do WhatsApp.
- Firebase Admin: usado apenas nas rotinas que ainda dependem do painel/admin.

## Requisitos

- Node.js 20+
- Projeto Firebase (para Auth Admin)
- Projeto Supabase

## Setup

1. Copie `backend/.env.example` para `backend/.env`.
2. Preencha variaveis obrigatorias (`SUPABASE_*`, `WHATSAPP_API_TOKEN`, `MERCADO_PAGO_*`, `GROQ_API_KEY` quando IA ativa).
   - Para Firebase Admin, use `FIREBASE_SERVICE_ACCOUNT_PATH` apontando para o JSON da service account, ou informe `FIREBASE_*` inline.
   - Para operacao local segura atras do Cloudflare Tunnel, mantenha `HOST=127.0.0.1`.
3. Instale dependencias:
```bash
npm install
```
4. Rode em desenvolvimento:
```bash
npm run dev
```

## Endpoints principais

- `GET /healthz`
- `GET /api/whatsapp/status` (Bearer `WHATSAPP_API_TOKEN`)
- `GET /api/whatsapp/qr` (Bearer `WHATSAPP_API_TOKEN`)
- `POST /api/whatsapp/send` (Bearer `WHATSAPP_API_TOKEN`)
- `POST /api/whatsapp/session/reset` (Bearer `WHATSAPP_API_TOKEN`)
- `POST /api/ai/chat` (Bearer Firebase ID token)
- `GET/POST/PATCH/DELETE /api/data/*` (Bearer Firebase ID token)

## Deploy (Render)

Use o `render.yaml` e configure as variaveis de ambiente no service.

## Operacao local no host

Consulte [`docs/local-backend-cursar-space.md`](../docs/local-backend-cursar-space.md) para subir este backend localmente com `systemd --user` e publicar via `cursar.space` sem interferir no WMS nem nos outros servicos do host.
