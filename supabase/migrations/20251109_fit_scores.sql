-- 20251103_users_rls_fix.sql
-- Safe, idempotent RLS reset for public.users and public.admins
-- Fixes "polname" → correct catalog column is policyname.

-----------------------------
-- Drop all policies on a table if it exists
-----------------------------
create or replace function public._drop_all_policies_on(tbl regclass)
returns void
language plpgsql
as $$
declare
  sql text;
  nsp name;
  rel name;
begin
  select n.nspname, c.relname
  into nsp, rel
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid = tbl;

  if nsp is null then
    -- Table doesn't exist; nothing to do.
    return;
  end if;

  select string_agg(format('drop policy if exists %I on %I.%I;', policyname, nsp, rel), ' ')
  into sql
  from pg_policies
  where schemaname = nsp and tablename = rel;

  if coalesce(sql, '') <> '' then
    execute sql;
  end if;
end;
$$;

-----------------------------
-- USERS TABLE
-----------------------------
-- Ensure table exists (no-op if already there)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  full_name text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.users enable row level security;

-- Drop any existing policies (fixes duplicates/name collisions)
do $$
begin
  perform public._drop_all_policies_on('public.users'::regclass);
end;
$$;

-- Recreate permissive development policies (adjust for prod)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='users' and policyname='users_select_auth'
  ) then
    create policy users_select_auth
      on public.users for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='users' and policyname='users_insert_auth'
  ) then
    create policy users_insert_auth
      on public.users for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='users' and policyname='users_update_auth'
  ) then
    create policy users_update_auth
      on public.users for update
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='users' and policyname='users_delete_auth'
  ) then
    create policy users_delete_auth
      on public.users for delete
      to authenticated
      using (true);
  end if;
end;
$$;

-----------------------------
-- ADMINS TABLE (optional)
-----------------------------
-- Ensure table exists (no-op if already there)
create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.admins enable row level security;

-- Drop existing policies
do $$
begin
  perform public._drop_all_policies_on('public.admins'::regclass);
end;
$$;

-- Dev-friendly policies (tighten later)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='admins' and policyname='admins_select_auth'
  ) then
    create policy admins_select_auth
      on public.admins for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='admins' and policyname='admins_insert_auth'
  ) then
    create policy admins_insert_auth
      on public.admins for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='admins' and policyname='admins_update_auth'
  ) then
    create policy admins_update_auth
      on public.admins for update
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='admins' and policyname='admins_delete_auth'
  ) then
    create policy admins_delete_auth
      on public.admins for delete
      to authenticated
      using (true);
  end if;
end;
$$;

-- (Optional) keep the helper around for future migrations.
-- To remove it after this migration, uncomment:
-- drop function if exists public._drop_all_policies_on(regclass);
