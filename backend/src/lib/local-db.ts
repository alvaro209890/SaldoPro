import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env';

mkdirSync(dirname(env.localDatabasePath), { recursive: true });
mkdirSync(env.localDataRoot, { recursive: true });
mkdirSync(env.localDocumentsDir, { recursive: true });

export const db = new Database(env.localDatabasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');

db.exec(`
create table if not exists app_users (
  uid text primary key,
  email text null,
  display_name text not null,
  created_at text not null
);
create unique index if not exists idx_app_users_email_unique
on app_users(lower(email))
where email is not null and trim(email) <> '';

create table if not exists app_user_settings (
  uid text primary key references app_users(uid) on delete cascade,
  budget real not null default 0,
  start_day integer not null default 1,
  currency text not null default 'BRL',
  whatsapp_allowed_numbers text not null default '[]',
  updated_at text not null
);

create table if not exists app_categories (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  name text not null,
  normalized_name text not null,
  type text not null,
  color text not null,
  icon text not null,
  created_at text not null
);
create index if not exists idx_app_categories_uid on app_categories(uid);
create unique index if not exists idx_app_categories_uid_type_name on app_categories(uid, type, normalized_name);

create table if not exists app_transactions (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  type text not null,
  amount real not null,
  date text not null,
  month_key text not null,
  category text not null,
  description text not null,
  payment_method text not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_transactions_uid_month_key on app_transactions(uid, month_key);
create index if not exists idx_app_transactions_uid_created_at on app_transactions(uid, created_at desc);

create table if not exists app_recurring_transactions (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  type text not null,
  amount real not null,
  category text not null,
  description text not null,
  payment_method text not null,
  frequency text not null,
  start_date text not null,
  end_date text null,
  next_due_date text not null,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_recurring_transactions_uid on app_recurring_transactions(uid);

create table if not exists app_reminders (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  title text not null,
  amount real null,
  due_date text not null,
  due_time text null,
  due_at text null,
  notified_at text null,
  notify_phone text null,
  reminder_kind text not null default 'general',
  type text null,
  status text not null default 'pending',
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_reminders_uid on app_reminders(uid);
create index if not exists idx_app_reminders_due_at on app_reminders(due_at);

create table if not exists app_chat_sessions (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  title text not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_chat_sessions_uid on app_chat_sessions(uid);

create table if not exists app_chat_messages (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  session_id text not null references app_chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  image_url text null,
  created_at text not null
);
create index if not exists idx_app_chat_messages_session_id on app_chat_messages(session_id, created_at asc);

create table if not exists whatsapp_bindings (
  variant_phone text primary key,
  phone text not null,
  uid text not null references app_users(uid) on delete cascade,
  linked_at text not null,
  updated_at text not null
);
create index if not exists idx_whatsapp_bindings_uid on whatsapp_bindings(uid);

create table if not exists whatsapp_messages (
  id text primary key,
  client_id text not null,
  message_id text not null,
  direction text not null,
  owner_uid text null references app_users(uid) on delete set null,
  from_phone text not null,
  to_phone text not null,
  text text not null default '',
  timestamp text not null,
  wa_timestamp integer null,
  status text not null,
  raw_type text null,
  created_at text not null,
  metadata text not null default '{}'
);
create index if not exists idx_whatsapp_messages_owner_uid on whatsapp_messages(owner_uid, created_at desc);
create index if not exists idx_whatsapp_messages_message_id on whatsapp_messages(message_id);
create index if not exists idx_whatsapp_messages_from_to on whatsapp_messages(from_phone, to_phone, created_at desc);

create table if not exists whatsapp_runtime (
  doc_id text primary key,
  file_count integer not null default 0,
  updated_at text not null
);

create table if not exists whatsapp_runtime_files (
  runtime_doc_id text not null references whatsapp_runtime(doc_id) on delete cascade,
  file_doc_id text not null,
  filename text not null,
  content_base64 text not null,
  updated_at text not null,
  primary key (runtime_doc_id, file_doc_id)
);

create table if not exists app_user_documents (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  source text not null default 'whatsapp',
  title text not null,
  description text null,
  normalized_title text not null,
  normalized_description text null,
  search_tokens text not null default '[]',
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  status text not null default 'ready',
  created_at text not null,
  updated_at text not null,
  last_accessed_at text null
);
create index if not exists idx_app_user_documents_uid_created_at on app_user_documents(uid, created_at desc);
create index if not exists idx_app_user_documents_uid_normalized_title on app_user_documents(uid, normalized_title);

create table if not exists app_whatsapp_pending_documents (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  source_phone text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  pending_reason text not null default 'missing_title',
  expires_at text not null,
  created_at text not null
);
create unique index if not exists idx_app_whatsapp_pending_documents_uid_phone on app_whatsapp_pending_documents(uid, source_phone);

create table if not exists app_financial_profiles (
  uid text primary key references app_users(uid) on delete cascade,
  monthly_income real not null default 0,
  fixed_expenses real not null default 0,
  variable_expenses real not null default 0,
  savings_target_pct real not null default 10,
  financial_goals_text text null,
  completed_at text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists app_goals (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  title text not null,
  description text null,
  target_amount real null,
  current_amount real not null default 0,
  deadline text null,
  source text not null default 'manual',
  status text not null default 'active',
  priority text not null default 'medium',
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_goals_uid on app_goals(uid);

create table if not exists app_daily_ai_quotas (
  uid text not null references app_users(uid) on delete cascade,
  quota_date text not null,
  channel text not null,
  used_count integer not null default 0,
  created_at text not null,
  updated_at text not null,
  primary key (uid, quota_date, channel)
);

create table if not exists app_subscription_plans (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null,
  interval_unit text not null,
  interval_count integer not null,
  price_cents integer not null,
  currency text not null,
  mercado_pago_plan_id text null,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create table if not exists app_user_subscriptions (
  id text primary key,
  uid text not null references app_users(uid) on delete cascade,
  plan_code text not null,
  status text not null,
  status_reason text null,
  mercado_pago_preapproval_id text null,
  mercado_pago_plan_id text null,
  external_reference text not null,
  payer_email text not null,
  next_billing_date text null,
  last_payment_at text null,
  last_payment_status text null,
  cancelled_at text null,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_app_user_subscriptions_uid_created_at on app_user_subscriptions(uid, created_at desc);
create index if not exists idx_app_user_subscriptions_mp_id on app_user_subscriptions(mercado_pago_preapproval_id);

create table if not exists app_billing_events (
  id text primary key,
  provider text not null,
  event_type text not null,
  provider_event_id text not null,
  processed integer not null default 0,
  failed integer not null default 0,
  error_message text null,
  raw_payload text null,
  created_at text not null,
  updated_at text not null
);
create unique index if not exists idx_app_billing_events_provider_event on app_billing_events(provider, provider_event_id);

create table if not exists app_user_plan_overrides (
  uid text primary key references app_users(uid) on delete cascade,
  mode text not null,
  reason text null,
  created_at text not null,
  updated_at text not null
);

create table if not exists whatsapp_connection_locks (
  slot_id text primary key,
  instance_id text not null,
  expires_at text not null,
  updated_at text not null
);
`);

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T extends object>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as T;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
