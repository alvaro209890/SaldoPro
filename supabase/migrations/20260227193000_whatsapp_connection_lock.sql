-- Ensure only one backend instance owns the WhatsApp session at a time.
-- This avoids session replacement during rolling deploys.

create table if not exists public.whatsapp_connection_locks (
  slot_id text primary key check (slot_id in ('wa1')),
  instance_id text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_whatsapp_connection_locks_lease_expires_at
  on public.whatsapp_connection_locks (lease_expires_at);

create or replace function public.acquire_whatsapp_connection_lock(
  p_slot_id text,
  p_instance_id text,
  p_ttl_seconds integer default 90
)
returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_exp timestamptz;
  v_rows integer := 0;
begin
  if p_slot_id is null or p_slot_id <> 'wa1' then
    return false;
  end if;

  if p_instance_id is null or length(trim(p_instance_id)) = 0 then
    return false;
  end if;

  v_exp := v_now + make_interval(secs => greatest(coalesce(p_ttl_seconds, 90), 15));

  insert into public.whatsapp_connection_locks (slot_id, instance_id, lease_expires_at, updated_at)
  values (p_slot_id, p_instance_id, v_exp, v_now)
  on conflict (slot_id) do update
    set instance_id = excluded.instance_id,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = excluded.updated_at
  where public.whatsapp_connection_locks.instance_id = excluded.instance_id
     or public.whatsapp_connection_locks.lease_expires_at <= v_now;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_whatsapp_connection_lock(
  p_slot_id text,
  p_instance_id text
)
returns boolean
language plpgsql
as $$
declare
  v_rows integer := 0;
begin
  delete from public.whatsapp_connection_locks
   where slot_id = p_slot_id
     and instance_id = p_instance_id;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

alter table public.whatsapp_connection_locks enable row level security;

comment on table public.whatsapp_connection_locks is 'Distributed lease lock for single active WhatsApp backend instance.';
