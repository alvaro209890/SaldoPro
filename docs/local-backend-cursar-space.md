# Backend local em `cursar.space`

Objetivo: subir o backend do SaldoPro neste PC, manter o frontend no Firebase Hosting e expor somente a API por um hostname proprio em `cursar.space`, sem tocar nos endpoints ja usados por WMS, AuraCore e GeoForest.

## Topologia recomendada

- Frontend: Firebase Hosting
- Backend: Node local neste host, escutando em `127.0.0.1:10000`
- Exposicao publica: Cloudflare Tunnel em `https://saldopro-api.cursar.space`
- Hostnames ja ocupados e que nao devem ser alterados:
  - `wms.cursar.space`
  - `geoforest-api.cursar.space`
  - `api.cursar.space`

## Credenciais obrigatorias

O clone atual **nao** trouxe as credenciais de servidor necessarias para subir o backend funcionalmente. Antes de ativar o servico, preencha:

- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`
- `WHATSAPP_API_TOKEN`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `GROQ_API_KEY` se `WHATSAPP_AI_ENABLED=true`

Firebase Admin pode ser configurado de dois jeitos:

- `FIREBASE_SERVICE_ACCOUNT_PATH=/media/server/HD Backup/Servidores_NAO_MEXA/SaldoPro/saldopro-98049-firebase-adminsdk-fbsvc-c18e2ef2fa.json`
- ou `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`

## Backend local

1. Copie [`ops/local/saldopro-backend.env.example`](../ops/local/saldopro-backend.env.example) para `~/.config/saldopro/backend.env`.
2. Ajuste os segredos e confirme estes valores base:
   - `HOST=127.0.0.1`
   - `PORT=10000`
   - `BACKEND_URL=https://saldopro-api.cursar.space`
   - `WEB_APP_URL=https://saldopro-98049.web.app`
   - `WHATSAPP_AUTH_DIR=/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro/whatsapp-auth`
3. Copie [`ops/local/run-backend.sh`](../ops/local/run-backend.sh) para `~/.config/saldopro/run-backend.sh` e deixe executavel.
4. Copie [`ops/local/systemd/saldopro-backend.service`](../ops/local/systemd/saldopro-backend.service) para `~/.config/systemd/user/saldopro-backend.service`.
5. Ative:

```bash
systemctl --user daemon-reload
systemctl --user enable --now saldopro-backend.service
systemctl --user status saldopro-backend.service
```

## Cloudflare Tunnel

O host ja usa um tunnel com `config.yml` para `wms.cursar.space` e `geoforest-api.cursar.space`. A forma menos intrusiva de publicar o SaldoPro e **adicionar somente mais um ingress** acima do `http_status:404`.

Trecho a adicionar no arquivo atual `~/.cloudflared/config.yml`:

```yml
- hostname: saldopro-api.cursar.space
  service: http://127.0.0.1:10000
```

Depois:

```bash
systemctl --user restart geoserver-wms-tunnel.service
systemctl --user status geoserver-wms-tunnel.service
```

Observacao: se o DNS do hostname ainda nao existir na zona Cloudflare, sera necessario criar a rota DNS do tunnel antes do endpoint ficar publico.

## Frontend Firebase Hosting

O frontend hoje esta configurado para Render em [`.env`](/media/server/HD Backup/Servidores_NAO_MEXA/SaldoPro/.env:1). Quando o backend local ja estiver respondendo em `saldopro-api.cursar.space`, troque:

```bash
VITE_BACKEND_URL=https://saldopro-api.cursar.space
```

Depois gere e publique o hosting:

```bash
npm run build:all
firebase deploy --only hosting:app,hosting:admin
```

## Verificacao minima

- Backend local: `curl http://127.0.0.1:10000/healthz`
- Backend publico: `curl https://saldopro-api.cursar.space/healthz`
- Frontend publicado: conferir login, reset de senha e telas que chamam `/api/auth`, `/api/data`, `/api/billing` e `/api/ai`

## O que esta isolado nesta abordagem

- O WMS continua no proxy local `127.0.0.1:8082` e no hostname `wms.cursar.space`
- O GeoForest continua em `127.0.0.1:3001` e `geoforest-api.cursar.space`
- O AuraCore continua em `127.0.0.1:8000` e `api.cursar.space`
- O SaldoPro usa so `127.0.0.1:10000` e um hostname novo

## Estrutura local de dados

Crie e mantenha a persistencia operacional do SaldoPro em:

- `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro`
- `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro/whatsapp-auth`
- `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro/whatsapp-auth-wa1`
- `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro/logs`
- `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/SaldoPro/backups`

Observacao importante: o banco de negocio do projeto continua sendo o Supabase. Nesta maquina ficam os arquivos operacionais persistentes do backend local, principalmente sessao do WhatsApp, logs e artefatos de operacao.
