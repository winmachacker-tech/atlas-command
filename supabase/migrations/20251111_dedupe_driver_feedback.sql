-- FILE: supabase/migrations/20251111_dedupe_driver_feedback.sql
-- Purpose: Remove duplicate driver_feedback rows before creating the unique index.

-- 0) Safety: ensure the table exists
create table if not exists public.driver_feedback (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  customer_id uuid,
  load_id uuid,
  lane_key text,
  vote boolean,
  note text,
  created_by uuid,
  feedback_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 1) Normalize null created_by to a sentinel, so our uniqueness key is stable.
--    (Earlier we tried auth.uid(); during migrations it’s null.)
update public.driver_feedback
   set created_by = coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid)
 where created_by is null;

-- 2) Dedupe: keep the most recent row per (driver_id, customer_id?, lane_key?, created_by?)
--    We use COALESCE(customer_id, sentinel) and COALESCE(lane_key, '') to match the intended index key.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        driver_id,
        coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(lane_key, ''),
        coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid)
      order by
        feedback_at desc nulls last,
        created_at desc nulls last,
        id desc
    ) as rn
  from public.driver_feedback
)
delete from public.driver_feedback df
using ranked r
where df.id = r.id
  and r.rn > 1;

-- 3) Drop any prior attempt of the unique index, then recreate it.
do $$
begin
  if exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and indexname  = 'ux_driver_feedback_unique_vote_scope'
  ) then
    execute 'drop index public.ux_driver_feedback_unique_vote_scope';
  end if;
end$$;

create unique index ux_driver_feedback_unique_vote_scope
  on public.driver_feedback (
    driver_id,
    coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(lane_key, ''),
    coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid)
  );
