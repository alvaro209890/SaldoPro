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
