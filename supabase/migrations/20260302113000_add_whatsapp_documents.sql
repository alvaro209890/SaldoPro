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
  last_accessed_at timestamptz null,
  constraint app_user_documents_status_check check (status in ('ready', 'deleted'))
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

insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do update
set public = excluded.public;
