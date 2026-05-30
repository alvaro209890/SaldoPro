# SaldoPro

SaldoPro e uma plataforma de controle financeiro pessoal com:
- painel web para gestao diaria;
- automacao por WhatsApp com IA;
- painel administrativo separado.

## Modulos principais

- **App do usuario (`src/`)**: dashboard, transacoes, categorias, relatorios, lembretes, recorrencias, metas, documentos e assistente de IA.
- **Painel admin (`admin/`)**: monitoramento operacional, usuarios, assinaturas e suporte.
- **Backend WhatsApp/IA (`backend/`)**: integracao com WhatsApp (Baileys), IA, cobranca e APIs de dados.

## Stack

- Frontend: React 19 + Vite + TypeScript + Tailwind.
- Admin: React + Vite + TypeScript.
- Auth: Firebase Authentication.
- Banco e storage: Supabase.
- Pagamentos: Mercado Pago.
- Backend: Node.js + Express + TypeScript.

## Estrutura do repositorio

- `src/`: app principal.
- `admin/`: app do painel administrativo.
- `backend/`: API/backend.
- `supabase/`: migracoes e configuracao local.
- `documentacao/`: visao funcional e produto.
- `public/`: assets publicos (logo e favicon).

## Requisitos

- Node.js 20+
- npm 10+

## Setup rapido (raiz)

1. Instale dependencias:
```bash
npm install
```
2. Configure variaveis do frontend:
```bash
cp .env.example .env
```
3. Preencha as variaveis `VITE_*` no arquivo `.env`.
4. Rode o app principal:
```bash
npm run dev
```

## Setup do backend

1. Entre na pasta:
```bash
cd backend
```
2. Instale dependencias:
```bash
npm install
```
3. Configure as variaveis de ambiente do backend.
4. Rode em desenvolvimento:
```bash
npm run dev
```

> Detalhes do backend: `backend/README.md`

## Scripts uteis (raiz)

- `npm run dev`: app principal em dev.
- `npm run build`: build do app principal.
- `npm run build:admin`: build do painel admin.
- `npm run build:all`: build app + admin.
- `npm run deploy`: build app + admin e deploy Firebase Hosting (`app` e `admin`).

## Deploy

- Frontend e admin: Vercel (config compartilhada em `vercel.json`), dois projetos apontando para o mesmo repo:
  - App do usuario: build `npm run build`, output `dist`.
  - Painel admin: build `npm run build:admin`, output `admin-dist`.
- Backend: Render (config base em `render.yaml`).

> Config legada de Firebase Hosting permanece em `firebase.json` (Firestore/Storage continuam no Firebase).

## Branding

- Logo principal escuro: `public/logo-dark.png`
- Favicons: `public/favicon.png` e `public/icon-*.png`

## Documentacao complementar

- `documentacao/visao-geral-do-produto.md`
- `documentacao/funcionalidades-resumidas.md`
- `documentacao/painel-admin.md`
