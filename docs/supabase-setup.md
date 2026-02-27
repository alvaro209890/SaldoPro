# Supabase Setup (Firestore Replacement)

Este projeto foi preparado para manter o **Firebase Auth** e migrar somente o banco de dados para **Supabase/Postgres**.

## 1. Variaveis de ambiente

Frontend (`.env` na raiz):

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Backend (`backend/.env`):

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Firebase continua necessario no backend para validar token:

```bash
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
```

## 2. Aplicar schema no projeto Supabase

Arquivo de migracao criado:

`supabase/migrations/20260227130000_init_schema_from_firestore.sql`
`supabase/migrations/20260227142000_hardening_indexes.sql`

Opcoes para aplicar:

1. SQL Editor (mais rapido):
   - Abra o SQL Editor no painel Supabase.
   - Cole o SQL completo do arquivo acima.
   - Execute.

2. Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <SEU_PROJECT_REF>
npx supabase db push
```

## 3. Mapeamento Firestore -> Supabase

- `users/{uid}` -> `public.app_users`
- `users/{uid}/settings/profile` -> `public.app_user_settings`
- `users/{uid}/categories/{categoryId}` -> `public.app_categories`
- `users/{uid}/transactions/{transactionId}` -> `public.app_transactions`
- `users/{uid}/chatSessions/{sessionId}` -> `public.app_chat_sessions`
- `users/{uid}/chatSessions/{sessionId}/messages/{messageId}` -> `public.app_chat_messages`
- `users/{uid}/reminders/{reminderId}` -> `public.app_reminders`
- `users/{uid}/recurringTransactions/{recurringId}` -> `public.app_recurring_transactions`
- `whatsappMessages` -> `public.whatsapp_messages`
- `whatsappBindings` -> `public.whatsapp_bindings`
- `whatsappRuntime` -> `public.whatsapp_runtime`
- `whatsappRuntime/{doc}/files` -> `public.whatsapp_runtime_files`

## 4. Observacoes

- Esta etapa **nao migra dados antigos** do Firestore.
- O schema ja inclui indices equivalentes aos queries atuais do Firestore.
- RLS foi habilitado em todas as tabelas como baseline de seguranca (sem politicas abertas para anon/authenticated).
