-- FILE: 20251112_ai_signal_health.sql
-- Purpose: Simple, schema-safe AI signal health check so we know why
--          Predict Best Drivers may return "not enough signal".

-- Notes:
-- - This intentionally avoids depending on exact lane column names.
-- - It only uses generic, common fields:
--     loads.id, loads.driver_id, loads.status, loads.created_at, loads.updated_at
--     driver_feedback.id, driver_feedback.created_at
-- - If your status values differ, we detect "delivered-ish" with a loose match.
-- - Tune thresholds at the top (MIN_* constants) to your taste.

create or replace function public.rpc_ai_signal_health()
returns table (
  total_loads bigint,
  loads_with_driver bigint,
  delivered_like_loads bigint,
  feedback_count bigint,
  active_drivers bigint,
  loads_30d bigint,
  feedback_30d bigint,
  ready boolean,
  reasons text
)
language plpgsql
as $$
declare
  -- Thresholds (tune these if you like)
  MIN_LOADS_WITH_DRIVER int := 50;  -- enough historical assignments
  MIN_DELIVERED_LIKE    int := 25;  -- completed-ish examples
  MIN_FEEDBACK          int := 10;  -- thumbs up/down minimum
  MIN_ACTIVE_DRIVERS    int := 5;   -- drivers with any history
  MIN_RECENT_LOADS_30D  int := 10;  -- ensure recent signal exists
  MIN_RECENT_FB_30D     int := 5;   -- recent feedback

  v_total_loads bigint;
  v_with_driver bigint;
  v_delivered_like bigint;
  v_feedback bigint;
  v_active_drivers bigint;
  v_loads_30d bigint;
  v_feedback_30d bigint;
  v_reasons text := '';
  v_ready boolean := true;
begin
  -- 1) Totals
  select count(*) into v_total_loads from public.loads;

  -- 2) Loads that actually have drivers assigned
  select count(*) into v_with_driver
  from public.loads
  where driver_id is not null;

  -- 3) "Delivered-like" loads (very forgiving match)
  --    Adjust this if your statuses differ; we match common delivered/billing states.
  select count(*) into v_delivered_like
  from public.loads
  where (status ilike '%deliver%' or status ilike '%bill%');

  -- 4) Feedback count (thumbs up/down)
  --    If your table is named differently, adjust here.
  select count(*) into v_feedback
  from public.driver_feedback;

  -- 5) Active drivers (seen at least once on a load)
  select count(distinct driver_id) into v_active_drivers
  from public.loads
  where driver_id is not null;

  -- 6) Recent activity (last 30 days)
  select count(*) into v_loads_30d
  from public.loads
  where (created_at >= now() - interval '30 days'
      or updated_at >= now() - interval '30 days');

  select count(*) into v_feedback_30d
  from public.driver_feedback
  where created_at >= now() - interval '30 days';

  -- 7) Build reasons + ready flag
  if v_with_driver < MIN_LOADS_WITH_DRIVER then
    v_ready := false;
    v_reasons := v_reasons || format('Need ≥ %s loads with driver assigned (have %s). ', MIN_LOADS_WITH_DRIVER, coalesce(v_with_driver,0));
  end if;

  if v_delivered_like < MIN_DELIVERED_LIKE then
    v_ready := false;
    v_reasons := v_reasons || format('Need ≥ %s delivered/billing loads (have %s). ', MIN_DELIVERED_LIKE, coalesce(v_delivered_like,0));
  end if;

  if v_feedback < MIN_FEEDBACK then
    v_ready := false;
    v_reasons := v_reasons || format('Need ≥ %s feedback items (have %s). ', MIN_FEEDBACK, coalesce(v_feedback,0));
  end if;

  if v_active_drivers < MIN_ACTIVE_DRIVERS then
    v_ready := false;
    v_reasons := v_reasons || format('Need ≥ %s active drivers with history (have %s). ', MIN_ACTIVE_DRIVERS, coalesce(v_active_drivers,0));
  end if;

  if v_loads_30d < MIN_RECENT_LOADS_30D then
    v_ready := false;
    v_reasons := v_reasons || format('Need some recent activity: ≥ %s loads in last 30d (have %s). ', MIN_RECENT_LOADS_30D, coalesce(v_loads_30d,0));
  end if;

  if v_feedback_30d < MIN_RECENT_FB_30D then
    v_ready := false;
    v_reasons := v_reasons || format('Need recent feedback: ≥ %s in last 30d (have %s). ', MIN_RECENT_FB_30D, coalesce(v_feedback_30d,0));
  end if;

  return query
  select
    v_total_loads,
    v_with_driver,
    v_delivered_like,
    v_feedback,
    v_active_drivers,
    v_loads_30d,
    v_feedback_30d,
    v_ready,
    nullif(v_reasons, '');
end;
$$;
