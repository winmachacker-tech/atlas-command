-- FILE: supabase/migrations/20251111_fix_driver_feedback.sql
-- Purpose: Fix driver feedback schema & RPC so it no longer references "accepted".
-- Safe on reruns: uses IF EXISTS/IF NOT EXISTS and COALESCE logic.

-- 1) Ensure table exists
create table if not exists public.driver_feedback (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  customer_id uuid,
  load_id uuid,
  lane_key text,
  -- we will normalize to a single boolean "vote": true = up, false = down
  vote boolean,
  note text,
  created_by uuid,
  feedback_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 2) Normalize legacy columns to "vote"
do $$
declare
  has_vote boolean;
  has_label boolean;
  has_accepted boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='vote'
  ) into has_vote;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='label'
  ) into has_label;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='accepted'
  ) into has_accepted;

  -- If no vote column yet, add it first
  if not has_vote then
    alter table public.driver_feedback add column vote boolean;
  end if;

  -- If legacy "label" exists, copy it into vote and drop "label"
  if has_label then
    execute 'update public.driver_feedback set vote = coalesce(vote, label)';
    execute 'alter table public.driver_feedback drop column label';
  end if;

  -- If legacy "accepted" exists, copy it into vote and drop "accepted"
  if has_accepted then
    execute 'update public.driver_feedback set vote = coalesce(vote, accepted)';
    execute 'alter table public.driver_feedback drop column accepted';
  end if;
end$$;

-- 3) Ensure created_by exists and defaults to auth.uid()
do $$
declare has_created_by boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='created_by'
  ) into has_created_by;

  if not has_created_by then
    alter table public.driver_feedback add column created_by uuid;
  end if;

  -- set any missing created_by to current user if available
  update public.driver_feedback
     set created_by = coalesce(created_by, auth.uid())
   where created_by is null;

  -- ensure default (can’t attach default to auth.uid() if called outside auth context,
  -- but it’s fine for Row Level Security usage in Supabase)
  alter table public.driver_feedback alter column created_by drop default;
  alter table public.driver_feedback alter column created_by set default auth.uid();
end$$;

-- 4) Helpful indexes
create index if not exists idx_driver_feedback_driver on public.driver_feedback (driver_id);
create index if not exists idx_driver_feedback_customer on public.driver_feedback (customer_id);
create index if not exists idx_driver_feedback_load on public.driver_feedback (load_id);
create index if not exists idx_driver_feedback_lane on public.driver_feedback (lane_key);
create index if not exists idx_driver_feedback_created_by on public.driver_feedback (created_by);

-- One feedback per (driver, customer, lane_key, created_by). If customer_id is null, the key reduces.
-- We use COALESCE(lane_key,'') so NULL vs '' doesn’t fragment uniqueness.
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and indexname='ux_driver_feedback_unique_vote_scope'
  ) then
    execute '
      create unique index ux_driver_feedback_unique_vote_scope
      on public.driver_feedback (driver_id, coalesce(customer_id, ''00000000-0000-0000-0000-000000000000''::uuid), coalesce(lane_key, ''''), coalesce(created_by, ''00000000-0000-0000-0000-000000000000''::uuid))
    ';
  end if;
end$$;

-- 5) Remove any old trigger functions that referenced NEW.accepted
do $$
declare r record;
begin
  for r in
    select tgname
    from pg_trigger
    where tgrelid = 'public.driver_feedback'::regclass
      and not tgisinternal
  loop
    -- We can’t peek into function body easily; safest is to drop suspicious ones by name if present.
    if r.tgname in ('driver_feedback_set_defaults', 'driver_feedback_accept_guard', 'tg_driver_feedback_before_ins') then
      execute format('drop trigger if exists %I on public.driver_feedback', r.tgname);
    end if;
  end loop;
end$$;

-- 6) Recreate the RPC that the UI calls
drop function if exists public.rpc_record_driver_feedback(uuid, uuid, text, text, text) cascade;
drop function if exists public.rpc_record_driver_feedback(uuid, uuid, text, text) cascade;
drop function if exists public.rpc_record_driver_feedback(uuid, uuid, text) cascade;

create or replace function public.rpc_record_driver_feedback(
  p_driver_id   uuid,
  p_customer_id uuid,
  p_lane_key    text,
  p_vote        text,   -- 'up' | 'down'
  p_note        text default null
)
returns public.driver_feedback
language plpgsql
security definer
as $$
declare
  v_vote boolean;
  v_user uuid := auth.uid();
  v_row public.driver_feedback;
begin
  if p_vote is null then
    raise exception 'vote text is required: use "up" or "down"';
  end if;

  if lower(p_vote) not in ('up','down') then
    raise exception 'invalid vote: % (allowed: up|down)', p_vote;
  end if;

  v_vote := case when lower(p_vote) = 'up' then true else false end;

  -- upsert one record per scope
  insert into public.driver_feedback as df
    (driver_id, customer_id, lane_key, vote, note, created_by, feedback_at)
  values
    (p_driver_id, p_customer_id, p_lane_key, v_vote, p_note, coalesce(v_user, created_by), now())
  on conflict (driver_id,
               coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(lane_key, ''),
               coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set vote = excluded.vote,
                note = excluded.note,
                feedback_at = now()
  returning * into v_row;

  return v_row;
end
$$;

-- Optional: grant execute to authenticated/anon as needed
grant execute on function public.rpc_record_driver_feedback(uuid, uuid, text, text, text) to anon, authenticated;

-- 7) (Optional but recommended) Row Level Security baseline
alter table public.driver_feedback enable row level security;

-- Allow users to insert their own feedback
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='driver_feedback'
      and policyname='driver_feedback_insert_own'
  ) then
    create policy driver_feedback_insert_own
      on public.driver_feedback
      for insert
      to authenticated, anon
      with check (created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='driver_feedback'
      and policyname='driver_feedback_select_own_org'
  ) then
    -- Basic readable-by-creator policy; adapt to your org_id model later
    create policy driver_feedback_select_own_org
      on public.driver_feedback
      for select
      to authenticated, anon
      using (created_by = auth.uid());
  end if;
end$$;
