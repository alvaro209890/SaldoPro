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

insert into public.app_subscription_plans (
  code,
  name,
  description,
  interval_unit,
  interval_count,
  price_cents,
  currency,
  active
)
values
  ('monthly', 'Plano Mensal', 'Acesso premium com renovacao mensal.', 'months', 1, 2000, 'BRL', true),
  ('quarterly', 'Plano Trimestral', 'Acesso premium com renovacao a cada 3 meses.', 'months', 3, 5400, 'BRL', true),
  ('yearly', 'Plano Anual', 'Acesso premium com renovacao anual.', 'months', 12, 20000, 'BRL', true)
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

create table if not exists public.app_user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  plan_code text not null,
  status text not null,
  status_reason text,
  mercado_pago_preapproval_id text unique,
  mercado_pago_plan_id text,
  external_reference text not null unique,
  payer_email text not null,
  next_billing_date timestamptz,
  last_payment_at timestamptz,
  last_payment_status text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_subscriptions_status_check check (
    status in ('pending', 'authorized', 'paused', 'cancelled', 'rejected')
  )
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
  provider_event_id text,
  raw_payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_daily_ai_quotas (
  uid text not null,
  quota_date date not null,
  channel text not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (uid, quota_date, channel)
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

  update public.app_daily_ai_quotas
  set
    used_count = app_daily_ai_quotas.used_count + 1,
    updated_at = now()
  where
    uid = p_uid
    and quota_date = p_quota_date
    and channel = p_channel
    and used_count < p_limit
  returning app_daily_ai_quotas.used_count into v_used_count;

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
