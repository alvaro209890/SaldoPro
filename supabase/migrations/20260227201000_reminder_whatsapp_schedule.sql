-- Reminder scheduling for WhatsApp notifications.
-- Adds optional time support and notification tracking fields.

alter table public.app_reminders
  add column if not exists due_time text,
  add column if not exists due_at timestamptz,
  add column if not exists notified_at timestamptz,
  add column if not exists notify_phone text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_reminders_due_time_format_check'
  ) then
    alter table public.app_reminders
      add constraint app_reminders_due_time_format_check
      check (due_time is null or due_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

create index if not exists idx_app_reminders_due_at_pending_notified
  on public.app_reminders (due_at asc)
  where status = 'pending'
    and notified_at is null
    and due_at is not null
    and notify_phone is not null;

create index if not exists idx_app_reminders_uid_due_at
  on public.app_reminders (uid, due_at asc);
