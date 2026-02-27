-- Firestore -> Supabase baseline schema
-- This migration creates relational tables equivalent to the current Firestore model.
-- No data migration is performed here.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core user/account domain (users/{uid} + subcollections)
-- ---------------------------------------------------------------------------

create table if not exists public.app_users (
  uid text primary key,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_user_settings (
  uid text primary key references public.app_users(uid) on delete cascade,
  budget numeric(14,2) not null default 0,
  start_day integer not null default 1 check (start_day between 1 and 31),
  currency text not null default 'BRL',
  whatsapp_allowed_numbers text[] not null default '{}',
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_categories (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  color text not null,
  icon text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_transactions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  month_key text not null,
  category text not null,
  description text not null,
  payment_method text not null check (payment_method in ('pix', 'credit', 'debit', 'cash', 'transfer', 'boleto')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  title text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_chat_messages (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  session_id uuid not null references public.app_chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  image_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_reminders (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  title text not null,
  amount numeric(14,2) not null check (amount > 0),
  due_date date not null,
  type text not null check (type in ('payable', 'receivable')),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  category text not null,
  description text not null,
  payment_method text not null check (payment_method in ('pix', 'credit', 'debit', 'cash', 'transfer', 'boleto')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  start_date date not null,
  end_date date,
  next_due_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- WhatsApp domain (whatsappMessages, whatsappBindings, whatsappRuntime)
-- ---------------------------------------------------------------------------

create table if not exists public.whatsapp_messages (
  id text primary key,
  client_id text not null check (client_id in ('wa1', 'wa2')),
  message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound', 'auto_reply')),
  owner_uid text references public.app_users(uid) on delete set null,
  from_phone text not null,
  to_phone text not null,
  text text not null default '',
  timestamp timestamptz not null,
  wa_timestamp bigint,
  status text not null check (status in ('received', 'sent', 'failed')),
  raw_type text,
  created_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.whatsapp_bindings (
  variant_phone text primary key,
  phone text not null,
  uid text not null references public.app_users(uid) on delete cascade,
  linked_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.whatsapp_runtime (
  doc_id text primary key,
  file_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.whatsapp_runtime_files (
  runtime_doc_id text not null references public.whatsapp_runtime(doc_id) on delete cascade,
  file_doc_id text not null,
  filename text not null,
  content_base64 text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (runtime_doc_id, file_doc_id)
);

-- ---------------------------------------------------------------------------
-- Indexes equivalent to Firestore query/index patterns
-- ---------------------------------------------------------------------------

create index if not exists idx_app_categories_uid_name
  on public.app_categories (uid, name asc);

create index if not exists idx_app_transactions_uid_month_date
  on public.app_transactions (uid, month_key, date desc);

create index if not exists idx_app_transactions_uid_date
  on public.app_transactions (uid, date desc);

create index if not exists idx_app_chat_sessions_uid_updated
  on public.app_chat_sessions (uid, updated_at desc);

create index if not exists idx_app_chat_messages_uid_session_created
  on public.app_chat_messages (uid, session_id, created_at asc);

create index if not exists idx_app_reminders_uid_due_date
  on public.app_reminders (uid, due_date asc);

create index if not exists idx_app_recurring_uid_next_due
  on public.app_recurring_transactions (uid, next_due_date asc);

create index if not exists idx_app_recurring_uid_active
  on public.app_recurring_transactions (uid, active);

create index if not exists idx_app_user_settings_whatsapp_allowed_numbers_gin
  on public.app_user_settings using gin (whatsapp_allowed_numbers);

create index if not exists idx_whatsapp_messages_owner_from_created
  on public.whatsapp_messages (owner_uid, from_phone, created_at desc);

create index if not exists idx_whatsapp_messages_owner_to_created
  on public.whatsapp_messages (owner_uid, to_phone, created_at desc);

create index if not exists idx_whatsapp_bindings_uid
  on public.whatsapp_bindings (uid);

create index if not exists idx_whatsapp_runtime_files_runtime_filename
  on public.whatsapp_runtime_files (runtime_doc_id, filename);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists trg_app_user_settings_updated_at on public.app_user_settings;
create trigger trg_app_user_settings_updated_at
before update on public.app_user_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_transactions_updated_at on public.app_transactions;
create trigger trg_app_transactions_updated_at
before update on public.app_transactions
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_chat_sessions_updated_at on public.app_chat_sessions;
create trigger trg_app_chat_sessions_updated_at
before update on public.app_chat_sessions
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_reminders_updated_at on public.app_reminders;
create trigger trg_app_reminders_updated_at
before update on public.app_reminders
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_recurring_transactions_updated_at on public.app_recurring_transactions;
create trigger trg_app_recurring_transactions_updated_at
before update on public.app_recurring_transactions
for each row execute function public.set_updated_at();

drop trigger if exists trg_whatsapp_bindings_updated_at on public.whatsapp_bindings;
create trigger trg_whatsapp_bindings_updated_at
before update on public.whatsapp_bindings
for each row execute function public.set_updated_at();

drop trigger if exists trg_whatsapp_runtime_updated_at on public.whatsapp_runtime;
create trigger trg_whatsapp_runtime_updated_at
before update on public.whatsapp_runtime
for each row execute function public.set_updated_at();

drop trigger if exists trg_whatsapp_runtime_files_updated_at on public.whatsapp_runtime_files;
create trigger trg_whatsapp_runtime_files_updated_at
before update on public.whatsapp_runtime_files
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Security baseline (Firebase Auth will remain external)
-- ---------------------------------------------------------------------------

alter table public.app_users enable row level security;
alter table public.app_user_settings enable row level security;
alter table public.app_categories enable row level security;
alter table public.app_transactions enable row level security;
alter table public.app_chat_sessions enable row level security;
alter table public.app_chat_messages enable row level security;
alter table public.app_reminders enable row level security;
alter table public.app_recurring_transactions enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_bindings enable row level security;
alter table public.whatsapp_runtime enable row level security;
alter table public.whatsapp_runtime_files enable row level security;

comment on table public.app_users is 'Firestore path: users/{uid}';
comment on table public.app_user_settings is 'Firestore path: users/{uid}/settings/profile';
comment on table public.app_categories is 'Firestore path: users/{uid}/categories/{categoryId}';
comment on table public.app_transactions is 'Firestore path: users/{uid}/transactions/{transactionId}';
comment on table public.app_chat_sessions is 'Firestore path: users/{uid}/chatSessions/{sessionId}';
comment on table public.app_chat_messages is 'Firestore path: users/{uid}/chatSessions/{sessionId}/messages/{messageId}';
comment on table public.app_reminders is 'Firestore path: users/{uid}/reminders/{reminderId}';
comment on table public.app_recurring_transactions is 'Firestore path: users/{uid}/recurringTransactions/{recurringId}';
comment on table public.whatsapp_messages is 'Firestore collection: whatsappMessages';
comment on table public.whatsapp_bindings is 'Firestore collection: whatsappBindings';
comment on table public.whatsapp_runtime is 'Firestore collection: whatsappRuntime (root docs)';
comment on table public.whatsapp_runtime_files is 'Firestore collection: whatsappRuntime/{doc}/files';
