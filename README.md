# SaldoPro

Controle financeiro pessoal com React + backend Node, mantendo Firebase para autenticacao/hospedagem e Supabase como banco de dados.

## Stack

- Frontend: React 19, TypeScript, Vite 6, TailwindCSS v4
- Auth/Hospedagem: Firebase Auth + Firebase Hosting
- Banco de dados: Supabase (PostgreSQL)
- Backend: Node.js/Express + TypeScript

## Configuracao

1. Firebase
- Crie um projeto no Firebase.
- Ative Email/Senha em Authentication.
- Crie um app web e copie as variaveis `VITE_FIREBASE_*`.

2. Supabase
- Crie um projeto no Supabase.
- Aplique as migrations em `supabase/migrations`.
- Configure `VITE_SUPABASE_*` no frontend e `SUPABASE_*` no backend.

## Execucao local

1. Copie `.env.example` para `.env` na raiz e preencha variaveis.
2. Copie `backend/.env.example` para `backend/.env` e preencha variaveis.
3. Instale dependencias:
```bash
npm install
cd backend && npm install
```
4. Rode frontend e backend:
```bash
npm run dev
cd backend && npm run dev
```
