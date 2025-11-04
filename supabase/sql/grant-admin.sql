-- supabase/sql/grant-admin.sql
-- Purpose: ensure the 'is_admin' flag exists and mark the given user as admin.

begin;

-- 1) Make sure required columns exist on public.users
alter table public.users
  add column if not exists is_admin boolean not null default false;

alter table public.users
  add column if not exists email text;

-- 2) Upsert the caller's row and set admin = true
--    (auth.users is authoritative for id/email)
insert into public.users (id, email, is_admin)
select au.id, au.email, true
from auth.users au
where au.id = 'f13da68e-a81d-42ea-85d9-aa7437d82c09'
on conflict (id)
do update
  set is_admin = true,
      email    = excluded.email;

-- 3) (Optional) Verify
-- select id, email, is_admin from public.users
-- where id = 'f13da68e-a81d-42ea-85d9-aa7437d82c09';

commit;
