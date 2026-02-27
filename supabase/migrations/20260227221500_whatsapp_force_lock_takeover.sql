-- Allow explicit administrative takeover of the WhatsApp connection lock.
-- Used when a stale/ghost instance keeps renewing the lease and blocks QR recovery.

create or replace function public.force_acquire_whatsapp_connection_lock(
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
        updated_at = excluded.updated_at;

  return true;
end;
$$;
