-- Purpose: Make lane-key lookups fast without IMMUTABLE expression indexes.
-- Strategy: Ensure a real text column driver_feedback.lane_key exists and index (lane_key, driver_id).

-- 0) Safety: drop any previous problematic expression index if it exists
drop index if exists public.idx_driver_feedback_lane_driver;

-- 1) Ensure required columns exist
alter table public.driver_feedback
  add column if not exists lane_key   text,
  add column if not exists created_by uuid,
  add column if not exists feedback_at timestamptz;

-- Backfill feedback_at if missing
update public.driver_feedback
set feedback_at = coalesce(feedback_at, now())
where feedback_at is null;

-- 2) Create a simple, valid btree index (IMMUTABLE-safe)
create index if not exists idx_driver_feedback_lane_driver
  on public.driver_feedback (lane_key, driver_id);

-- 3) Replace RPC so it always writes lane_key and created_by
drop function if exists public.rpc_record_driver_feedback(
  p_driver_id    uuid,
  p_lane_key     text,
  p_label        boolean,
  p_note         text,
  p_load_id      uuid,
  p_customer_id  uuid
);

create or replace function public.rpc_record_driver_feedback(
  p_driver_id    uuid,
  p_lane_key     text,      -- e.g. 'Sacramento, CA → Tulsa, OK'
  p_label        boolean,   -- true=👍, false=👎
  p_note         text default null,
  p_load_id      uuid default null,
  p_customer_id  uuid default null
)
returns public.driver_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.driver_feedback%rowtype;
  v_uid uuid := auth.uid();
begin
  insert into public.driver_feedback (
    driver_id,
    lane_key,
    label,
    note,
    load_id,
    customer_id,
    feedback_at,
    created_by
  )
  values (
    p_driver_id,
    p_lane_key,
    p_label,
    p_note,
    p_load_id,
    p_customer_id,
    now(),
    v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- 4) Tighten permissions
revoke all on function public.rpc_record_driver_feedback(
  uuid, text, boolean, text, uuid, uuid
) from public;

grant execute on function public.rpc_record_driver_feedback(
  uuid, text, boolean, text, uuid, uuid
) to authenticated;
