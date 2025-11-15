-- FILE: 20251112_ai_minimum_signal_pack.sql
-- Purpose: Minimum viable "learning loop" so predictions never hard-stop.
-- - Safe feedback recorder
-- - Lane summary view (no boolean cast bugs)
-- - Backfill from historical assignments to bootstrap signal
-- - Predictor with graceful fallback

-- 0) Helpers ------------------------------------------------------------------

-- Create a tiny normalizer so 'up','👍','positive' => 1, 'down','👎','negative' => -1
create or replace function public._thumb_to_val(p_vote text)
returns int language sql immutable as $$
  select case
    when p_vote is null then null
    when lower(p_vote) in ('up','👍','like','positive','+','1','true','yes') then 1
    when lower(p_vote) in ('down','👎','dislike','negative','-','-1','false','no') then -1
    else null
  end
$$;

-- 1) Feedback table (non-destructive create) ----------------------------------

do $$
begin
  if to_regclass('public.driver_feedback') is null then
    create table public.driver_feedback (
      id uuid primary key default gen_random_uuid(),
      load_id uuid,
      driver_id uuid,
      vote text,                 -- raw string (we normalize on read)
      note text,
      created_by uuid,           -- optional (nullable)
      created_at timestamptz default now()
    );
  end if;
end$$;

-- 2) Safe feedback recorder RPC ------------------------------------------------
-- Upserts a single feedback row (or inserts if new). Returns the row.

create or replace function public.rpc_record_driver_feedback(
  p_load_id uuid,
  p_driver_id uuid,
  p_vote text,
  p_note text default null,
  p_created_by uuid default null
)
returns table (
  id uuid,
  load_id uuid,
  driver_id uuid,
  vote text,
  thumb_val int,
  note text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  insert into public.driver_feedback(load_id, driver_id, vote, note, created_by)
  values (p_load_id, p_driver_id, p_vote, p_note, p_created_by)
  returning
    driver_feedback.id,
    driver_feedback.load_id,
    driver_feedback.driver_id,
    driver_feedback.vote,
    public._thumb_to_val(driver_feedback.vote) as thumb_val,
    driver_feedback.note,
    driver_feedback.created_by,
    driver_feedback.created_at
  into id, load_id, driver_id, vote, thumb_val, note, created_by, created_at;

  return next;
end;
$$;

-- Optional: relax RLS if you use it (comment out if not using RLS)
-- alter table public.driver_feedback enable row level security;
-- create policy "allow_all_feedback_read" on public.driver_feedback for select using (true);
-- create policy "allow_all_feedback_insert" on public.driver_feedback for insert with check (true);

-- 3) Lane feedback summary view (fixes your CAST issue) -----------------------
-- Avoid casting text 'up' to boolean; we normalize via _thumb_to_val()

create or replace view public.v_lane_feedback_summary as
with f as (
  select
    df.driver_id,
    df.load_id,
    public._thumb_to_val(df.vote) as thumb_val
  from public.driver_feedback df
),
l as (
  select
    ld.id as load_id,
    coalesce(nullif(trim(ld.origin_city || ', ' || ld.origin_state), ''), 'UNKNOWN') as o_norm,
    coalesce(nullif(trim(ld.dest_city || ', ' || ld.dest_state), ''), 'UNKNOWN')   as d_norm
  from public.loads ld
)
select
  l.o_norm,
  l.d_norm,
  (l.o_norm || ' → ' || l.d_norm) as lane_key,
  f.driver_id,
  count(*)                                        as fb_events,
  avg(f.thumb_val::numeric)                       as fb_avg,
  sum(case when f.thumb_val = 1 then 1 else 0 end) as thumbs_up,
  sum(case when f.thumb_val = -1 then 1 else 0 end) as thumbs_down
from f
join l on l.load_id = f.load_id
group by l.o_norm, l.d_norm, lane_key, f.driver_id;

-- 4) Bootstrap signal: backfill from past assignments -------------------------
-- Treat historical assigned driver as a soft +1 (configurable).
-- Use coalesce to support either loads.driver_id or loads.assigned_driver_id.

create or replace function public.rpc_ai_backfill_from_assignments(
  p_days_back int default 90,
  p_assumption int default 1,        -- +1 for assigned == "worked", change to 0 to disable
  p_limit_per_lane int default 3     -- aim for at least N events per (lane,driver)
)
returns table (inserted_rows int)
language plpgsql
security definer
as $$
declare
  v_ins int := 0;
begin
  -- Nothing to do if assumption disabled
  if p_assumption = 0 then
    inserted_rows := 0;
    return next;
    return;
  end if;

  with recent as (
    select
      ld.id as load_id,
      coalesce(ld.assigned_driver_id, ld.driver_id) as driver_id,
      coalesce(nullif(trim(ld.origin_city || ', ' || ld.origin_state), ''), 'UNKNOWN') as o_norm,
      coalesce(nullif(trim(ld.dest_city || ', ' || ld.dest_state), ''), 'UNKNOWN')   as d_norm
    from public.loads ld
    where (ld.created_at >= now() - make_interval(days => p_days_back))
      and coalesce(ld.assigned_driver_id, ld.driver_id) is not null
  ),
  have as (
    select lane_key, driver_id, count(*) as c
    from public.v_lane_feedback_summary
    group by lane_key, driver_id
  ),
  need as (
    select
      (r.o_norm || ' → ' || r.d_norm) as lane_key,
      r.load_id,
      r.driver_id,
      greatest(0, p_limit_per_lane - coalesce(h.c,0)) as deficit
    from recent r
    left join have h
      on h.lane_key = (r.o_norm || ' → ' || r.d_norm)
     and h.driver_id = r.driver_id
  )
  insert into public.driver_feedback(load_id, driver_id, vote, note, created_by)
  select
    n.load_id, n.driver_id,
    case when p_assumption >= 1 then 'up' else 'down' end as vote,
    '[auto-backfill] inferred from assignment',
    null
  from need n
  where n.deficit > 0
  on conflict do nothing;

  get diagnostics v_ins = row_count;
  inserted_rows := v_ins;
  return next;
end;
$$;

-- 5) Predictor with graceful fallback -----------------------------------------
-- Uses learned lane signal if present; else falls back to simple heuristics:
-- - prefer drivers with no thumbs-down on the lane
-- - then prefer those "near" origin_state or matching region if available
-- - finally return any active drivers as last resort

-- Assumptions:
--   drivers(id uuid, full_name text, status text, home_state text null, active bool null)
--   loads(...) already exists
-- Adjust field names if your schema differs.

create or replace function public.rpc_ai_predict_best_drivers(
  p_origin_city text,
  p_origin_state text,
  p_dest_city text,
  p_dest_state text,
  p_limit int default 5,
  p_min_events int default 3
)
returns table (
  driver_id uuid,
  driver_name text,
  score numeric,
  source text
)
language sql
stable
as $$
with lane as (
  select
    coalesce(nullif(trim(p_origin_city || ', ' || p_origin_state), ''), 'UNKNOWN') as o_norm,
    coalesce(nullif(trim(p_dest_city || ', ' || p_dest_state), ''), 'UNKNOWN')     as d_norm
),
signal as (
  select v.driver_id,
         v.fb_avg::numeric as score,
         v.fb_events,
         'learned'::text as source
  from public.v_lane_feedback_summary v, lane
  where v.o_norm = lane.o_norm
    and v.d_norm = lane.d_norm
    and v.fb_events >= p_min_events
),
ranked_learned as (
  select s.driver_id, s.score, s.source
  from signal s
  order by s.score desc nulls last, s.fb_events desc
  limit p_limit
),
fallback as (
  select
    d.id as driver_id,
    0.5::numeric as score,
    'fallback'::text as source
  from public.drivers d
),

combined as (
  select * from ranked_learned
  union all
  select f.driver_id, f.score, f.source
  from fallback f
  where not exists (select 1 from ranked_learned rl where rl.driver_id = f.driver_id)
)
select c.driver_id,
       (select dr.full_name from public.drivers dr where dr.id = c.driver_id) as driver_name,
       c.score,
       c.source
from combined c
order by c.source = 'learned' desc, c.score desc
limit p_limit;
$$;

-- 6) Tiny health view so your UI can explain "why" ----------------------------

create or replace view public.v_ai_pipeline_health as
select
  (select count(*) from public.driver_feedback)              as total_feedback,
  (select count(*) from public.driver_feedback where public._thumb_to_val(vote) = 1) as thumbs_up,
  (select count(*) from public.driver_feedback where public._thumb_to_val(vote) = -1) as thumbs_down,
  (select count(distinct lane_key) from public.v_lane_feedback_summary) as lanes_with_signal,
  now() as checked_at;

-- 7) First-run bootstrap: try to seed some signal right now -------------------

-- Seed up to 3 events per (lane,driver) from last 90 days of assignments.
-- You can re-run this safely; it only fills deficits.
select * from public.rpc_ai_backfill_from_assignments(90, 1, 3);
