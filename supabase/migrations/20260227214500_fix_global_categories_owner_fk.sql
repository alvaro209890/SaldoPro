-- Ensure the synthetic global owner exists for shared categories.
-- app_categories.uid has FK to app_users.uid, so __global__ must exist.

insert into public.app_users (uid, email, display_name, created_at)
values ('__global__', null, 'Global Categories', timezone('utc', now()))
on conflict (uid) do update
set display_name = excluded.display_name;
