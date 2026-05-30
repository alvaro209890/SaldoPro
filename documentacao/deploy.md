# Deploy — Render (backend) + Vercel (frontend)

Guia para colocar o SaldoPro em produção:

- **Backend** (Express + WhatsApp/Baileys): **Render**.
- **Frontend** (app do usuário + painel admin): **Vercel**, dois projetos apontando para o mesmo repositório.
- **Firestore / Storage / Authentication**: continuam no **Firebase**.

---

## 1. Render — corrigir o backend

O deploy estava falhando no startup com:

```
Error: Missing required environment variable: FIREBASE_WEB_API_KEY
```

O build/compilação funcionam; o crash é em runtime por **variável de ambiente faltando**.

### Passos

1. Acesse **Render → serviço `saldopro-whatsapp-backend` → Environment**.
2. Adicione a variável que faltava:
   - `FIREBASE_WEB_API_KEY` = o **mesmo valor** de `VITE_FIREBASE_API_KEY` do frontend (começa com `AIzaSy...`).
     É a "Web API Key" do projeto Firebase, usada para autenticação via REST (login, lookup e refresh de token).
3. Confirme que estas variáveis (marcadas como `sync: false` no `render.yaml`, ou seja, **não** ficam no repositório) estão preenchidas:
   - `WHATSAPP_API_TOKEN` — token aleatório longo que protege os endpoints.
   - `GROQ_API_KEY` — obrigatória enquanto `WHATSAPP_AI_ENABLED=true`.
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — credenciais do Firebase Admin (service account).
     - Atenção ao colar `FIREBASE_PRIVATE_KEY`: preserve as quebras de linha (`\n`).
   - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` — **legado**, o Supabase foi removido do runtime do backend; podem ficar vazias.
4. Depois de preencher, clique em **Manual Deploy → Deploy latest commit**.
5. Valide acessando o health check: `https://saldopro-whatsapp-backend.onrender.com/healthz`.

### Variáveis já definidas no `render.yaml` (não precisa mexer)

`NODE_ENV`, `PORT`, `WHATSAPP_AUTH_DIR`, `WHATSAPP_AUTO_REPLY_*`, `WHATSAPP_AI_*`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GROQ_TIMEOUT_MS`, `GROQ_MAX_RETRIES`, `SUPABASE_URL`.

### Após migrar o frontend para o Vercel

- Atualize `WEB_APP_URL` na Render para a URL do app no Vercel (usada em links de reset de senha e mensagens do WhatsApp) e faça redeploy.

> **Por que o backend não vai para o Vercel:** o WhatsApp via Baileys precisa de conexão WebSocket persistente e disco para a sessão de autenticação (`.baileys_auth`), incompatível com o ambiente serverless do Vercel. O backend permanece na Render.

---

## 2. Vercel — hospedar o frontend (2 projetos)

O repositório tem dois frontends que compartilham o `vercel.json` da raiz (rewrite de SPA + cache de assets). Cada projeto define o próprio build/output:

| Projeto | Build Command | Output Directory |
|---|---|---|
| App do usuário | `npm run build` | `dist` |
| Painel admin | `npm run build:admin` | `admin-dist` |

### Projeto 1 — App do usuário

1. Acesse [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → `alvaro209890/SaldoPro`.
2. **Project Name:** `saldopro-app`.
3. **Framework Preset:** Vite (detectado automaticamente).
4. **Build & Output Settings:**
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. **Environment Variables** (preencher para Production, Preview e Development):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_BACKEND_URL` = `https://saldopro-whatsapp-backend.onrender.com`
   - `VITE_APP_URL` = (deixar em branco no primeiro deploy; preencher depois com a URL gerada)
   - `VITE_MERCADO_PAGO_PUBLIC_KEY` = (se usar pagamentos)
6. Clique em **Deploy**. Anote a URL (ex.: `https://saldopro-app.vercel.app`).
7. Volte em **Settings → Environment Variables**, defina `VITE_APP_URL` com essa URL e faça **Redeploy**.

### Projeto 2 — Painel admin

1. Em [vercel.com/new](https://vercel.com/new), importe o **mesmo repositório** novamente.
2. **Project Name:** `saldopro-admin`.
3. **Build & Output Settings (override):**
   - Build Command: `npm run build:admin`
   - Output Directory: `admin-dist`
4. **Environment Variables:** as mesmas `VITE_*` do projeto 1 (o admin também usa Firebase).
5. Clique em **Deploy**. Anote a URL (ex.: `https://saldopro-admin.vercel.app`).

---

## 3. Ajustes obrigatórios após os deploys

1. **Firebase Console → Authentication → Settings → Authorized domains:**
   adicione os dois domínios do Vercel (`saldopro-app.vercel.app`, `saldopro-admin.vercel.app`) e quaisquer domínios customizados.
   Sem isso, o login via Firebase **falha** no Vercel.
2. **Render → Environment:** atualize `WEB_APP_URL` para a URL do app no Vercel e faça redeploy.
3. (Opcional) Após validar tudo no Vercel, desative os sites `*.web.app` do Firebase Hosting.

---

## 4. Checklist final

- [ ] `FIREBASE_WEB_API_KEY` adicionada na Render e deploy refeito.
- [ ] `/healthz` do backend respondendo 200.
- [ ] App buildou e abriu no Vercel.
- [ ] Admin buildou e abriu no Vercel.
- [ ] Domínios do Vercel autorizados no Firebase Auth.
- [ ] Login, cadastro e reset de senha funcionando.
- [ ] `VITE_APP_URL` (Vercel) e `WEB_APP_URL` (Render) apontando para a nova URL.
