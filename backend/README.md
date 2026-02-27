# SaldoPro WhatsApp Backend

Backend Node.js + TypeScript para WhatsApp/IA do SaldoPro.

## Arquitetura de dados

- Firebase Auth: validacao do token JWT do frontend.
- Supabase: persistencia de dados de negocio e dados do WhatsApp.

## Requisitos

- Node.js 20+
- Projeto Firebase (para Auth Admin)
- Projeto Supabase

## Setup

1. Copie `backend/.env.example` para `backend/.env`.
2. Preencha variaveis obrigatorias (`SUPABASE_*`, `FIREBASE_*`, `WHATSAPP_API_TOKEN`, `GROQ_API_KEY` quando IA ativa).
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
