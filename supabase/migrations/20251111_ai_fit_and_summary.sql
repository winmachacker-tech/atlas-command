-- FILE: supabase/migrations/20251111_ai_fit_and_summary.sql
-- Purpose:
-- 1) Maintain per-driver fit scores from thumbs (driver_feedback)
-- 2) Log nightly AI retraining runs
-- 3) Provide a simple summary RPC for your "AI Learning Proof" page

-- ────────────────────────────────────────────────────────────────────────────────
-- SAFETY: extensions
-- ────────────────────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────────────────────────
-- 0) Assume these tables already exist (do NOT fail if they don’t)
--    - drivers(id uuid pk, full_name text, ...)
--    - driver_feedback(id uuid pk, driver_id uuid, label boolean, feedback_at timestamptz, note text, load_id uuid, lane_key text)
-- If names differ in your project, adjust the trigger queries below.
-- ────────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────────
-- 1) driver_fit_scores: aggregate thumbs per driver
-- ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.driver_fit_scores (
  driver_id         uuid primary key references public.drivers(id) on delete cascade,
  up_events         integer not null default 0,
  down_events       integer not null default 0,
  fit_score         numeric(6,5) not null default 0, -- 0..1 with smoothing
  last_feedback_at  timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table  public.driver_fit_scores is 'Per-driver AI fit score with Laplace smoothing from driver_feedback';
comment on column public.driver_fit_scores.fit_score is 'Smoothed fit score: (up+1)/(up+down+2)';

-- Helpful index
create index if not exists idx_driver_fit_scores_score_desc
  on public.driver_fit_scores (fit_score desc);

-- ────────────────────────────────────────────────────────────────────────────────
-- 1a) Recompute function (incremental)
--     Calculates counts + smoothed fit for one driver.
-- ────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_recompute_driver_fit(p_driver_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_up   int;
  v_down int;
  v_last timestamptz;
begin
  -- Aggregate from driver_feedback
  select
    count(*) filter (where label is true)  as up_cnt,
    count(*) filter (where label is false) as down_cnt,
    max(feedback_at)                       as last_ts
  into v_up, v_down, v_last
  from public.driver_feedback
  where driver_id = p_driver_id;

  -- Upsert into driver_fit_scores with Laplace smoothing
  insert into public.driver_fit_scores (driver_id, up_events, down_events, fit_score, last_feedback_at, updated_at)
  values (
    p_driver_id,
    coalesce(v_up, 0),
    coalesce(v_down, 0),
    case
      when coalesce(v_up,0)+coalesce(v_down,0) = 0 then 0
      else round( ((coalesce(v_up,0)::numeric + 1) / (coalesce(v_up,0)+coalesce(v_down,0) + 2)), 5)
    end,
    v_last,
    now()
  )
  on conflict (driver_id) do update
  set
    up_events        = excluded.up_events,
    down_events      = excluded.down_events,
    fit_score        = excluded.fit_score,
    last_feedback_at = excluded.last_feedback_at,
    updated_at       = now();
end;
$$;

revoke all on function public.fn_recompute_driver_fit(uuid) from public;

-- ────────────────────────────────────────────────────────────────────────────────
-- 1b) Trigger: recompute on feedback insert/update/delete
-- ────────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_recompute_driver_fit()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'INSERT') then
    perform public.fn_recompute_driver_fit(new.driver_id);
    return new;
  elsif (tg_op = 'UPDATE') then
    if new.driver_id is distinct from old.driver_id then
      perform public.fn_recompute_driver_fit(old.driver_id);
      perform public.fn_recompute_driver_fit(new.driver_id);
    else
      perform public.fn_recompute_driver_fit(new.driver_id);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    perform public.fn_recompute_driver_fit(old.driver_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_driver_feedback_fit on public.driver_feedback;
create trigger trg_driver_feedback_fit
after insert or update or delete on public.driver_feedback
for each row execute function public.trg_recompute_driver_fit();

-- ────────────────────────────────────────────────────────────────────────────────
-- 2) ai_training_runs: log each nightly retrain (Edge Function can insert or call rpc)
-- ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_training_runs (
  id             uuid primary key default gen_random_uuid(),
  ran_at         timestamptz not null default now(),
  lane_key       text,                    -- optional, if training a specific lane
  ok             boolean not null,        -- overall outcome of the retrain
  backfill_ok    boolean,
  backfill_name  text,
  retrain_ok     boolean,
  retrain_name   text,
  notes          text
);

create index if not exists idx_ai_training_runs_ran_at_desc
  on public.ai_training_runs (ran_at desc);

comment on table public.ai_training_runs is 'Audit log for nightly/adhoc AI training runs. Populated by Edge Function or RPC.';

-- Optional: RPC to log from Edge Function (simple and RLS-friendly)
create or replace function public.rpc_ai_log_training_run(
  p_ok            boolean,
  p_lane_key      text default null,
  p_backfill_ok   boolean default null,
  p_backfill_name text   default null,
  p_retrain_ok    boolean default null,
  p_retrain_name  text   default null,
  p_notes         text   default null
)
returns uuid
language sql
security definer
as $$
  insert into public.ai_training_runs(
    ok, lane_key, backfill_ok, backfill_name, retrain_ok, retrain_name, notes
  )
  values (p_ok, p_lane_key, p_backfill_ok, p_backfill_name, p_retrain_ok, p_retrain_name, p_notes)
  returning id;
$$;

revoke all on function public.rpc_ai_log_training_run(boolean, text, boolean, text, boolean, text, text) from public;

-- ────────────────────────────────────────────────────────────────────────────────
-- 3) Summary view + RPC for the “AI Learning Proof” page
-- ────────────────────────────────────────────────────────────────────────────────

-- View with rolled-up metrics
create or replace view public.v_ai_learning_summary as
with fb as (
  select
    count(*)                             as total_feedback,
    max(feedback_at)                     as last_feedback_at
  from public.driver_feedback
),
ds as (
  select
    count(*)                             as drivers_with_signals,
    avg(fit_score)                       as avg_fit_score
  from public.driver_fit_scores
),
lr as (
  select
    max(ran_at)                          as last_training_at,
    (array_agg(ok order by ran_at desc))[1]            as last_training_ok,
    (array_agg(retrain_name order by ran_at desc))[1]  as last_training_method
  from public.ai_training_runs
)
select
  ds.drivers_with_signals,
  fb.total_feedback,
  round(coalesce(ds.avg_fit_score, 0)::numeric, 4)     as avg_fit_score,
  fb.last_feedback_at,
  lr.last_training_at,
  coalesce(lr.last_training_ok, false)                 as last_training_ok,
  lr.last_training_method
from ds, fb, lr;

-- RPC wrapper (table-returning, single signature to avoid overload confusion)
create or replace function public.rpc_ai_learning_summary()
returns table (
  drivers_with_signals bigint,
  total_feedback       bigint,
  avg_fit_score        numeric,
  last_feedback_at     timestamptz,
  last_training_at     timestamptz,
  last_training_ok     boolean,
  last_training_method text
)
language sql
security definer
as $$
  select * from public.v_ai_learning_summary;
$$;

revoke all on function public.rpc_ai_learning_summary() from public;

-- ────────────────────────────────────────────────────────────────────────────────
-- 4) Optional RLS (enable if your project uses RLS on these tables)
--    Adjust policies to your tenant model as needed.
-- ────────────────────────────────────────────────────────────────────────────────
-- alter table public.driver_fit_scores enable row level security;
-- alter table public.ai_training_runs  enable row level security;
-- create policy "read fit scores" on public.driver_fit_scores
--   for select using (true);
-- create policy "read training runs" on public.ai_training_runs
--   for select using (true);

-- ────────────────────────────────────────────────────────────────────────────────
-- END
