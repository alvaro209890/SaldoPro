-- Hardening indexes after initial Firestore->Supabase migration.

create unique index if not exists uq_app_categories_uid_type_name_ci
  on public.app_categories (uid, type, lower(name));

create index if not exists idx_app_transactions_uid_created_at
  on public.app_transactions (uid, created_at desc);

create index if not exists idx_app_chat_messages_session_created
  on public.app_chat_messages (session_id, created_at asc);

