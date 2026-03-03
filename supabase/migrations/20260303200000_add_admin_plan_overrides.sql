create table if not exists public.app_user_plan_overrides (
  uid text primary key,
  mode text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_plan_overrides_mode_check check (
    mode in ('allow', 'deny')
  )
);
