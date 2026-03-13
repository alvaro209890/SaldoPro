-- SaldoPro - full data reset for a fresh first-use state
-- This script removes all user/app data, WhatsApp state, legacy public data,
-- auth users, and stored files, while keeping the schema/functions intact.
-- It also recreates the required storage bucket and reseeds billing plans.

begin;

do $$
declare
  stmt text;
begin
  -- Remove stored files first.
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) then
    execute 'delete from storage.objects';
  end if;

  -- Remove all public-table data, including WhatsApp runtime and any legacy tables.
  for stmt in
    select format('truncate table %I.%I restart identity cascade', schemaname, tablename)
    from pg_tables
    where schemaname = 'public'
  loop
    execute stmt;
  end loop;

  -- Clear Supabase Auth data so the project returns to zero users.
  for stmt in
    select format('truncate table %I.%I restart identity cascade', n.nspname, c.relname)
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

  -- Remove all buckets, then recreate only the bucket used by this app.
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    execute 'delete from storage.buckets';
  end if;
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

-- Optional verification queries:
-- select schemaname, relname, n_live_tup
-- from pg_stat_user_tables
-- where schemaname in ('public')
-- order by relname;
--
-- select count(*) as auth_users from auth.users;
-- select id, name, public from storage.buckets order by id;
