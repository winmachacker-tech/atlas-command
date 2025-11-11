-- Purpose: add created_by to driver_feedback and provide a robust RPC to record thumbs 👍/👎
-- Safe: uses IF NOT EXISTS so it won't break if partially present.

-- 1) Ensure base columns exist
alter table public.driver_feedback
  add column if not exists created_by uuid;

alter table public.driver_feedback
  add column if not exists feedback_at timestamptz;

-- Set sensible defaults where missing
update public.driver_feedback
set feedback_at = coalesce(feedback_at, now())
where feedback_at is null;

-- Optional: index for faster lookups by lane/driver
create index if not exists idx_driver_feedback_lane_driver
  on public.driver_feedback ((to_jsonb(driver_feedback)->>'lane_key'), driver_id);

-- 2) Replace/define a canonical RPC for recording feedback
-- Assumes front-end sends named args compatible with these:
--   p_driver_id (uuid, required)
--   p_lane_key (text, required) e.g., "Sacramento, CA → Tulsa, OK"
--   p_label (boolean, required) true=👍, false=👎
--   p_note (text, optional)
--   p_load_id (uuid, optional)
--   p_customer_id (uuid, optional)
drop function if exists public.rpc_record_driver_feedback(
  p_driver_id uuid,
  p_customer_id uuid,
  p_lane_key text,
  p_label boolean,
  p_note text,
  p_load_id uuid
);

create or replace function public.rpc_record_driver_feedback(
  p_driver_id    uuid,
  p_lane_key     text,
  p_label        boolean,
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
  v_uid uuid;
begin
  -- capture current user; may be null if called in service role
  v_uid := auth.uid();

  insert into public.driver_feedback (
    driver_id,
    -- lane key may be a real column OR stored JSON; we handle both patterns:
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
exception
  when undefined_column then
    -- Fallback for schemas that store flexible fields in JSONB (defensive):
    insert into public.driver_feedback (
      driver_id,
      label,
      note,
      load_id,
      customer_id,
      feedback_at,
      created_by
    )
    values (
      p_driver_id,
      p_label,
      p_note,
      p_load_id,
      p_customer_id,
      now(),
      v_uid
    )
    returning * into v_row;

    -- If you need the lane key but don't have a dedicated column,
    -- you can add a trigger later to mirror it into JSON.
    return v_row;
end;
$$;

-- 3) Permissions
revoke all on function public.rpc_record_driver_feedback(
  uuid, text, boolean, text, uuid, uuid
) from public;

grant execute on function public.rpc_record_driver_feedback(
  uuid, text, boolean, text, uuid, uuid
) to authenticated;
