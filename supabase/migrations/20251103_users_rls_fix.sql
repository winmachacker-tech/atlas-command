-- 2025-11-03: Fix users RLS (self-upsert + admin allowlist) — no recursion

-- 1) Safety: ensure the users table exists with a proper PK (adjust columns if yours differ)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  is_admin boolean default false, -- informational only; not used in policies
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep email unique (id is the real identity key, email can still help)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'users_email_key'
  ) then
    alter table public.users
      add constraint users_email_key unique (email);
  end if;
end$$;

-- Updated_at trigger (optional but nice)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_users_updated_at'
  ) then
    create trigger set_users_updated_at
    before update on public.users
    for each row execute function public.set_updated_at();
  end if;
end$$;

-- 2) Admin allowlist table (no RLS to avoid recursion in policies)
create table if not exists public.admins (
  email text primary key
);

-- Make absolutely sure RLS is disabled here (we are only storing emails)
alter table public.admins disable row level security;

-- Seed known admins (edit these to your real admin emails)
insert into public.admins(email)
values
  ('mark@tishkun.com'),
  ('danielle@tishkun.com')
on conflict (email) do nothing;

-- 3) Clean slate RLS on users
alter table public.users enable row level security;

-- Drop existing policies if they exist (avoids duplicates / name collisions)
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='users') then
    -- drop all policies on public.users
    execute (
      select string_agg(format('drop policy if exists %I on public.users;', polname), ' ')
      from pg_policies
      where schemaname='public' and tablename='users'
    );
  end if;
end$$;

-- 4) Self-access policies (fixes onboarding upsert 403)
create policy "users_select_own"
on public.users
for select
to authenticated
using ( id = auth.uid() );

create policy "users_insert_self"
on public.users
for insert
to authenticated
with check ( id = auth.uid() );

create policy "users_update_own"
on public.users
for update
to authenticated
using ( id = auth.uid() )
with check ( id = auth.uid() );

-- (Optional) allow self-delete; keep commented if you don't want this
-- create policy "users_delete_own"
-- on public.users
-- for delete
-- to authenticated
-- using ( id = auth.uid() );

-- 5) Admin-all policies via non-recursive allowlist (public.admins)
--    Checks the caller's JWT email against public.admins (RLS disabled there → NO recursion)
create policy "admins_select_all"
on public.users
for select
to authenticated
using (
  exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

create policy "admins_insert_all"
on public.users
for insert
to authenticated
with check (
  exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

create policy "admins_update_all"
on public.users
for update
to authenticated
using (
  exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
)
with check (
  exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

create policy "admins_delete_all"
on public.users
for delete
to authenticated
using (
  exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

-- 6) Grants (Supabase usually manages these, but keep explicit)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.users to anon, authenticated;
grant select on public.admins to anon, authenticated;
