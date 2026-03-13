-- SaldoPro - full fresh-start reset
-- What this does:
-- 1. Drops legacy public tables that do not belong to the current app.
-- 2. Recreates any required app tables/functions if they are missing.
-- 3. Deletes ALL data from the current app tables.
-- 4. Deletes ALL Supabase Auth users/sessions/tokens.
-- 5. Deletes ALL Storage objects/buckets and recreates only user-documents.
-- 6. Reseeds the billing plans required by the current app.
--
-- Important:
-- - This clears the WhatsApp state stored INSIDE Supabase.
-- - It does NOT remove the Baileys session stored on the backend disk/Render volume.
--   To fully reset the live WhatsApp connection, also reset/delete the backend auth dir.

begin;

create extension if not exists pgcrypto;

drop table if exists public.courier_devices cascade;
drop table if exists public.courier_location_updates cascade;
drop table if exists public.courier_profiles cascade;
drop table if exists public.courier_restaurant_memberships cascade;
drop table if exists public.courier_work_sessions cascade;
drop table if exists public.customer_addresses cascade;
drop table if exists public.customers cascade;
drop table if exists public.delivery_fee_rules cascade;
drop table if exists public.delivery_jobs cascade;
drop table if exists public.financial_order_snapshots cascade;
drop table if exists public.financial_settings cascade;
drop table if exists public.financial_transactions cascade;
drop table if exists public.inventory_items cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.inventory_order_deductions cascade;
drop table if exists public.inventory_product_recipes cascade;
drop table if exists public.inventory_products cascade;
drop table if exists public.menu_categories cascade;
drop table if exists public.menu_product_settings cascade;
drop table if exists public.menu_service_windows cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.restaurant_pairing_codes cascade;
drop table if exists public.suppliers cascade;
drop table if exists public.user_profiles cascade;

create table if not exists public.app_users (
  uid text primary key,
  email text null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_user_settings (
  uid text primary key references public.app_users(uid) on delete cascade,
  budget numeric not null default 0,
  start_day integer not null default 1,
  currency text not null default 'BRL',
  whatsapp_allowed_numbers text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  user_id text null,
  default_sale_type text not null default 'Balcao',
  default_channel text not null default 'Loja',
  default_payment_method text not null default 'Pix'
);

create table if not exists public.app_categories (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  name text not null,
  type text not null,
  color text not null,
  icon text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_categories_uid on public.app_categories(uid);
create index if not exists idx_app_categories_uid_name on public.app_categories(uid, name);

create table if not exists public.app_transactions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  type text not null,
  amount numeric not null,
  date date not null,
  month_key text not null,
  category text not null,
  description text not null,
  payment_method text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_transactions_uid on public.app_transactions(uid);
create index if not exists idx_app_transactions_uid_created_at on public.app_transactions(uid, created_at desc);
create index if not exists idx_app_transactions_uid_month_key on public.app_transactions(uid, month_key);

create table if not exists public.app_recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  type text not null,
  amount numeric not null,
  category text not null,
  description text not null,
  payment_method text not null,
  frequency text not null,
  start_date date not null,
  end_date date null,
  next_due_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_recurring_transactions_uid on public.app_recurring_transactions(uid);

create table if not exists public.app_reminders (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  title text not null,
  amount numeric null,
  due_date date not null,
  type text null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  due_time text null,
  due_at timestamptz null,
  notified_at timestamptz null,
  notify_phone text null,
  reminder_kind text not null default 'general'
);

create index if not exists idx_app_reminders_uid on public.app_reminders(uid);
create index if not exists idx_app_reminders_due_at on public.app_reminders(due_at);

create table if not exists public.app_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_chat_sessions_uid on public.app_chat_sessions(uid);

create table if not exists public.app_chat_messages (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  session_id uuid not null references public.app_chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  image_url text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_chat_messages_uid on public.app_chat_messages(uid);
create index if not exists idx_app_chat_messages_session_id on public.app_chat_messages(session_id, created_at asc);

create table if not exists public.whatsapp_bindings (
  variant_phone text primary key,
  phone text not null,
  uid text not null references public.app_users(uid) on delete cascade,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_bindings_uid on public.whatsapp_bindings(uid);

create table if not exists public.whatsapp_messages (
  id text primary key,
  client_id text not null,
  message_id text not null,
  direction text not null,
  owner_uid text null references public.app_users(uid) on delete set null,
  from_phone text not null,
  to_phone text not null,
  text text not null default '',
  timestamp timestamptz not null,
  wa_timestamp bigint null,
  status text not null,
  raw_type text null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_whatsapp_messages_owner_uid on public.whatsapp_messages(owner_uid, created_at desc);
create index if not exists idx_whatsapp_messages_message_id on public.whatsapp_messages(message_id);

create table if not exists public.whatsapp_runtime (
  doc_id text primary key,
  file_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_runtime_files (
  runtime_doc_id text not null references public.whatsapp_runtime(doc_id) on delete cascade,
  file_doc_id text not null,
  filename text not null,
  content_base64 text not null,
  updated_at timestamptz not null default now(),
  primary key (runtime_doc_id, file_doc_id)
);

create table if not exists public.app_user_documents (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  source text not null default 'whatsapp',
  title text not null,
  description text null,
  normalized_title text not null,
  normalized_description text null,
  search_tokens text[] not null default '{}'::text[],
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz null
);

create index if not exists app_user_documents_uid_created_at_idx
  on public.app_user_documents (uid, created_at desc);
create index if not exists app_user_documents_uid_normalized_title_idx
  on public.app_user_documents (uid, normalized_title);

create table if not exists public.app_whatsapp_pending_documents (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  source_phone text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  pending_reason text not null default 'missing_title',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists app_whatsapp_pending_documents_uid_phone_uidx
  on public.app_whatsapp_pending_documents (uid, source_phone);

create table if not exists public.app_financial_profiles (
  uid text primary key references public.app_users(uid) on delete cascade,
  monthly_income numeric not null default 0,
  fixed_expenses numeric not null default 0,
  variable_expenses numeric not null default 0,
  savings_target_pct numeric not null default 10,
  financial_goals_text text null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_goals (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  title text not null,
  description text null,
  target_amount numeric null,
  current_amount numeric not null default 0,
  deadline date null,
  source text not null default 'manual',
  status text not null default 'active',
  priority text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_goals_uid on public.app_goals(uid);

create table if not exists public.app_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  interval_unit text not null,
  interval_count integer not null,
  price_cents integer not null,
  currency text not null default 'BRL',
  mercado_pago_plan_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  uid text not null references public.app_users(uid) on delete cascade,
  plan_code text not null,
  status text not null,
  status_reason text null,
  mercado_pago_preapproval_id text unique null,
  mercado_pago_plan_id text null,
  external_reference text not null unique,
  payer_email text not null,
  next_billing_date timestamptz null,
  last_payment_at timestamptz null,
  last_payment_status text null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_user_subscriptions_uid
  on public.app_user_subscriptions(uid);
create index if not exists idx_app_user_subscriptions_uid_created_at
  on public.app_user_subscriptions(uid, created_at desc);
create index if not exists idx_app_user_subscriptions_status
  on public.app_user_subscriptions(status);

create table if not exists public.app_billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  provider_event_id text null,
  raw_payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_daily_ai_quotas (
  uid text not null references public.app_users(uid) on delete cascade,
  quota_date date not null,
  channel text not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (uid, quota_date, channel)
);

create table if not exists public.app_user_plan_overrides (
  uid text primary key references public.app_users(uid) on delete cascade,
  mode text not null,
  reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_connection_locks (
  slot_id text primary key,
  instance_id text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_daily_ai_quota(
  p_uid text,
  p_quota_date date,
  p_channel text,
  p_limit integer
)
returns table (
  allowed boolean,
  used_count integer,
  remaining_count integer
)
language plpgsql
as $$
declare
  v_used_count integer;
begin
  if p_limit <= 0 then
    raise exception 'p_limit must be greater than zero';
  end if;

  insert into public.app_daily_ai_quotas (
    uid,
    quota_date,
    channel,
    used_count,
    created_at,
    updated_at
  )
  values (
    p_uid,
    p_quota_date,
    p_channel,
    0,
    now(),
    now()
  )
  on conflict (uid, quota_date, channel) do nothing;

  update public.app_daily_ai_quotas as quota
  set
    used_count = quota.used_count + 1,
    updated_at = now()
  where
    quota.uid = p_uid
    and quota.quota_date = p_quota_date
    and quota.channel = p_channel
    and quota.used_count < p_limit
  returning quota.used_count into v_used_count;

  if v_used_count is null then
    select q.used_count
      into v_used_count
      from public.app_daily_ai_quotas q
      where q.uid = p_uid
        and q.quota_date = p_quota_date
        and q.channel = p_channel;

    return query
    select
      false,
      coalesce(v_used_count, 0),
      greatest(p_limit - coalesce(v_used_count, 0), 0);
    return;
  end if;

  return query
  select
    true,
    v_used_count,
    greatest(p_limit - v_used_count, 0);
end;
$$;

drop function if exists public.acquire_whatsapp_connection_lock(text, text, integer);
create function public.acquire_whatsapp_connection_lock(
  p_slot_id text,
  p_instance_id text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 90), 1));
begin
  insert into public.whatsapp_connection_locks (
    slot_id,
    instance_id,
    lease_expires_at,
    updated_at
  )
  values (
    p_slot_id,
    p_instance_id,
    v_expires,
    v_now
  )
  on conflict (slot_id) do update
  set
    instance_id = excluded.instance_id,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = excluded.updated_at
  where public.whatsapp_connection_locks.lease_expires_at <= v_now
     or public.whatsapp_connection_locks.instance_id = p_instance_id;

  return exists (
    select 1
    from public.whatsapp_connection_locks
    where slot_id = p_slot_id
      and instance_id = p_instance_id
      and lease_expires_at = v_expires
  );
end;
$$;

drop function if exists public.release_whatsapp_connection_lock(text, text);
create function public.release_whatsapp_connection_lock(
  p_slot_id text,
  p_instance_id text
)
returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from public.whatsapp_connection_locks
  where slot_id = p_slot_id
    and instance_id = p_instance_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

drop function if exists public.force_acquire_whatsapp_connection_lock(text, text, integer);
create function public.force_acquire_whatsapp_connection_lock(
  p_slot_id text,
  p_instance_id text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 90), 1));
begin
  insert into public.whatsapp_connection_locks (
    slot_id,
    instance_id,
    lease_expires_at,
    updated_at
  )
  values (
    p_slot_id,
    p_instance_id,
    v_expires,
    v_now
  )
  on conflict (slot_id) do update
  set
    instance_id = excluded.instance_id,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = excluded.updated_at;

  return true;
end;
$$;

do $$
declare
  stmt text;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) then
    execute 'truncate table storage.objects restart identity cascade';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    execute 'truncate table storage.buckets restart identity cascade';
  end if;

  for stmt in
    select format('truncate table %I.%I restart identity cascade', schemaname, tablename)
    from pg_tables
    where schemaname = 'public'
  loop
    execute stmt;
  end loop;

  for stmt in
    select format('truncate table %I.%I cascade', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relkind = 'r'
      and c.relname in (
        'audit_log_entries',
        'flow_state',
        'identities',
        'instances',
        'mfa_amr_claims',
        'mfa_challenges',
        'mfa_factors',
        'one_time_tokens',
        'refresh_tokens',
        'sessions',
        'sso_domains',
        'sso_providers',
        'users'
      )
  loop
    execute stmt;
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

insert into public.app_subscription_plans (
  code,
  name,
  description,
  interval_unit,
  interval_count,
  price_cents,
  currency,
  active,
  updated_at
)
values
  ('monthly', 'Plano Mensal', 'Acesso premium com renovacao mensal.', 'months', 1, 2000, 'BRL', true, now()),
  ('quarterly', 'Plano Trimestral', 'Acesso premium com renovacao a cada 3 meses.', 'months', 3, 5400, 'BRL', true, now()),
  ('yearly', 'Plano Anual', 'Acesso premium com renovacao anual.', 'months', 12, 20000, 'BRL', true, now())
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  interval_unit = excluded.interval_unit,
  interval_count = excluded.interval_count,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  active = excluded.active,
  updated_at = now();

commit;
