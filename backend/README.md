# SaldoPro WhatsApp Backend

Backend Node.js + TypeScript para integrar WhatsApp (Baileys) com Firestore e rodar na Render.

## Features

- Conexao de um numero global de WhatsApp com QR.
- Sessao persistida em disco (`WHATSAPP_AUTH_DIR`).
- Listener de mensagens recebidas.
- Auto-resposta simples por variavel de ambiente.
- Modo IA no WhatsApp usando Groq para criar/editar/excluir lancamentos no Firestore.
- Processamento de imagens recebidas no WhatsApp (sem Cloudinary), usando modelo vision da Groq.
- Whitelist de numeros autorizados lida de `users/{uid}/settings/profile.whatsappAllowedNumbers`.
- Vinculacao por codigo unico da conta (`whatsappAccessCode`), exigido no primeiro contato do numero.
- Persistencia de mensagens na colecao `whatsappMessages` no Firestore.
- API protegida por Bearer token.

## Requisitos

- Node.js 20+
- Projeto Firebase com credenciais de Service Account

## Setup local

1. Copie `backend/.env.example` para `backend/.env`.
2. Preencha as variaveis (principalmente Firebase e token da API).
3. Para IA no WhatsApp, configure tambem:
- `GROQ_API_KEY`: chave da API Groq.
- `WHATSAPP_AI_ENABLED=true`.
- Ajuste opcional de contexto e imagens:
  - `WHATSAPP_AI_HISTORY_LIMIT` (padrao: `10`)
  - `WHATSAPP_AI_IMAGE_MAX_BYTES` (padrao: `5242880`)
  - `GROQ_VISION_MODEL` (padrao: `llama-3.2-90b-vision-preview`)
4. Instale dependencias:

```bash
cd backend
npm install
```

5. Execute em modo desenvolvimento:

```bash
npm run dev
```

## Endpoints

`GET /healthz`

`GET /api/whatsapp/status` (auth)

`GET /api/whatsapp/qr` (auth)

`POST /api/whatsapp/send` (auth)

Body:

```json
{
  "to": "5511999999999",
  "text": "Mensagem de teste"
}
```

`POST /api/whatsapp/session/reset` (auth)

## Header de autenticacao

Use:

```http
Authorization: Bearer <WHATSAPP_API_TOKEN>
```

## Render

- O `render.yaml` na raiz cria um web service para `backend/`.
- O build instala devDependencies com `npm ci --include=dev` para compilar TypeScript.
- O disco persistente precisa ser mantido em `/opt/render/project/src/backend/.baileys_auth`.
- Configure as env vars secretas no painel da Render, incluindo:
  - `WHATSAPP_API_TOKEN`
  - `GROQ_API_KEY`
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`

## Controle de numeros autorizados

- Cadastre os numeros no frontend em `Configuracoes > WhatsApp Autorizado`.
- O backend so responde mensagens vindas de numeros listados em `whatsappAllowedNumbers`.
- No primeiro contato, o numero recebe pedido de codigo e deve enviar o codigo da conta exibido em `Configuracoes`.
- Depois do vinculo, aquele numero fica associado a conta e nao precisa enviar codigo novamente.
- Numeros nao cadastrados sao ignorados (sem resposta e sem acao da IA).

## Observacao importante

Esta integracao usa metodo nao oficial (protocolo WhatsApp Web via Baileys). Pode haver mudancas de comportamento e risco de bloqueio pela plataforma.
