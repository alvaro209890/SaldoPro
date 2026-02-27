-- Support generic reminders (text-only) and financial reminders.

alter table public.app_reminders
  add column if not exists reminder_kind text;

update public.app_reminders
set reminder_kind = coalesce(type, 'general')
where reminder_kind is null;

alter table public.app_reminders
  alter column reminder_kind set default 'general',
  alter column reminder_kind set not null,
  alter column amount drop not null,
  alter column type drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_reminders_kind_check'
  ) then
    alter table public.app_reminders
      add constraint app_reminders_kind_check
      check (reminder_kind in ('general', 'payable', 'receivable'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_reminders_kind_consistency_check'
  ) then
    alter table public.app_reminders
      add constraint app_reminders_kind_consistency_check
      check (
        (reminder_kind = 'general' and type is null and amount is null)
        or
        (reminder_kind = 'payable' and type = 'payable' and amount is not null and amount > 0)
        or
        (reminder_kind = 'receivable' and type = 'receivable' and amount is not null and amount > 0)
      );
  end if;
end $$;
