-- 20251111_ai_predictions.sql
-- Purpose: Minimal, safe prediction layer for Atlas Command.
-- - Creates ai_predictions (auditable store of results)
-- - Adds RPCs:
--     rpc_ai_predict_best_drivers_for_load(load_id uuid, limit_n int default 5)
--     rpc_ai_predict_all_open_loads(limit_per_load int default 3)
-- - Defensive against schema differences (optional columns, etc.)
-- - No changes to existing tables required.

-- ---------- Extensions (safe if already present) ----------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------- Table: ai_predictions ----------
create table if not exists public.ai_predictions (
  id              uuid primary key default gen_random_uuid(),
  load_id         uuid not null,
  driver_id       uuid not null,
  predicted_fit   numeric not null,     -- raw score (0..1)
  confidence      numeric not null,     -- 0..1 (data support / recency)
  reason          text,                 -- short explanation / signals used
  generated_at    timestamptz not null default now(),
  generated_by    uuid default auth.uid()
);

alter table public.ai_predictions enable row level security;

-- Read for signed-in users
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'ai_predictions'
      and policyname = 'ai_predictions_select_auth'
  ) then
    create policy "ai_predictions_select_auth"
      on public.ai_predictions
      for select
      to authenticated
      using (true);
  end if;
end$$;

-- Insert allowed via our RPC (SECURITY DEFINER). We also allow direct insert for admins if you have that role later.

-- ---------- Helper: does_table_exist / does_column_exist ----------
-- Returns true if a table exists
create or replace function public._tbl_exists(p_schema text, p_table text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.tables
    where table_schema = p_schema
      and table_name   = p_table
  );
$$;

-- Returns true if a column exists
create or replace function public._col_exists(p_schema text, p_table text, p_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = p_schema
      and table_name   = p_table
      and column_name  = p_column
  );
$$;

-- ---------- Core RPC: predict for a single load ----------
/*
  Strategy (simple but useful):
    - Candidate drivers = all rows in public.drivers (filters to active=true if that column exists).
    - Score per driver is a weighted blend of:
        * Customer-specific feedback (if both feedback.customer_id and loads.customer_id exist)
        * Global feedback (all thumbs for that driver)
      Weighting favors recency: weight = 1 / (1 + age_days)
    - predicted_fit is min-max normalized to 0..1 across candidates.
    - confidence based on volume & recency of feedback.
    - Writes the top N into ai_predictions (with reason) and returns them, most likely first.
*/
create or replace function public.rpc_ai_predict_best_drivers_for_load(p_load_id uuid, p_limit_n int default 5)
returns table (
  load_id uuid,
  driver_id uuid,
  predicted_fit numeric,
  confidence numeric,
  reason text,
  generated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  has_loads bool;
  has_drivers bool;
  has_feedback bool;

  loads_has_customer_id bool;
  loads_has_driver_id   bool;
  drivers_has_active    bool;
  feedback_has_customer bool;
  feedback_has_thumb    bool;
  feedback_has_created  bool;

  v_customer_id uuid;
  v_now timestamptz := now();

  -- temp candidate set
  rec record;
begin
  -- Basic existence checks
  has_loads    := public._tbl_exists('public','loads');
  has_drivers  := public._tbl_exists('public','drivers');
  has_feedback := public._tbl_exists('public','driver_feedback');

  if not has_loads or not has_drivers or not has_feedback then
    -- Return nothing but make it clear why
    return query
    select p_load_id, null::uuid, 0::numeric, 0::numeric,
           'Missing required tables: loads/drivers/driver_feedback'::text,
           v_now;
    return;
  end if;

  -- Check optional columns
  loads_has_customer_id := public._col_exists('public','loads','customer_id');
  loads_has_driver_id   := public._col_exists('public','loads','driver_id'); -- may or may not be used downstream
  drivers_has_active    := public._col_exists('public','drivers','active');

  feedback_has_customer := public._col_exists('public','driver_feedback','customer_id');
  feedback_has_thumb    := public._col_exists('public','driver_feedback','thumb');       -- expects +1 / -1 or 1/0
  feedback_has_created  := public._col_exists('public','driver_feedback','created_at');

  -- Grab the load's customer_id if available
  if loads_has_customer_id then
    select customer_id into v_customer_id
    from public.loads
    where id = p_load_id
    limit 1;
  else
    v_customer_id := null;
  end if;

  -- Build candidate drivers (respect active=true if present)
  create temporary table tmp_candidates on commit drop as
  select d.id as driver_id
  from public.drivers d
  where case when drivers_has_active then coalesce((d->>'active')::boolean, d.active) is not false else true end
       or case when drivers_has_active then d.active is true else true end;

  -- Build feedback base with safe fallbacks
  -- We require at least thumb and created_at to compute meaningful weights; otherwise we treat as zero signal.
  create temporary table tmp_feedback on commit drop as
  select
    df.driver_id,
    case
      when feedback_has_thumb then
        -- normalize: treat 1 as +1, 0 as -1 if someone used 0/1; else coalesce to 0
        case
          when df.thumb in (1, -1) then df.thumb
          when df.thumb = 1 then 1
          when df.thumb = 0 then -1
          else 0
        end
      else 0
    end::int as thumb_norm,
    case
      when feedback_has_created and df.created_at is not null then df.created_at
      else v_now - interval '365 days' -- very old if unknown
    end as ts,
    case when feedback_has_customer then df.customer_id else null end as customer_id
  from public.driver_feedback df;

  -- Compute recency weight: w = 1 / (1 + age_days)
  create temporary table tmp_feedback_w on commit drop as
  select
    driver_id,
    customer_id,
    thumb_norm,
    greatest(0.0001, 1.0 / (1.0 + extract(epoch from (v_now - ts)) / 86400.0))::numeric as w
  from tmp_feedback;

  -- Aggregate GLOBAL score per driver
  create temporary table tmp_score_global on commit drop as
  select
    driver_id,
    case when sum(w) > 0 then sum(thumb_norm * w) / sum(w) else 0 end::numeric as score_global,
    count(*)::int as n_global,
    max(w)::numeric as max_w_global
  from tmp_feedback_w
  group by driver_id;

  -- Aggregate CUSTOMER-SPECIFIC score per driver (only if we have both sides)
  create temporary table tmp_score_customer on commit drop as
  select
    f.driver_id,
    case when sum(f.w) > 0 then sum(f.thumb_norm * f.w) / sum(f.w) else null end::numeric as score_customer,
    count(*)::int as n_cust,
    max(f.w)::numeric as max_w_cust
  from tmp_feedback_w f
  where v_customer_id is not null and f.customer_id = v_customer_id
  group by f.driver_id;

  -- Join candidates with scores
  create temporary table tmp_joined on commit drop as
  select
    c.driver_id,
    coalesce(gc.score_global, 0)       as score_global,
    coalesce(gc.n_global, 0)           as n_global,
    coalesce(gc.max_w_global, 0)       as max_w_global,
    cs.score_customer,
    coalesce(cs.n_cust, 0)             as n_cust,
    coalesce(cs.max_w_cust, 0)         as max_w_cust
  from tmp_candidates c
  left join tmp_score_global gc on gc.driver_id = c.driver_id
  left join tmp_score_customer cs on cs.driver_id = c.driver_id;

  -- Blend: customer signal (if present) gets 3x weight; otherwise just global.
  -- raw_fit ≈ normalized to [-1, 1], then we map to [0,1]
  create temporary table tmp_scored on commit drop as
  select
    j.driver_id,
    case
      when j.score_customer is not null then (3 * j.score_customer + 1 * j.score_global) / 4.0
      else j.score_global
    end as raw_fit,
    j.n_global,
    j.n_cust,
    greatest(j.max_w_global, j.max_w_cust) as recency_hint
  from tmp_joined j;

  -- Normalize raw_fit to 0..1 within candidates (avoid div by zero)
  -- confidence: combines volume (log-shaped) and recency_hint.
  -- volume_component = ln(1 + n_total) / ln(1 + 50) clamped to 1; recency_component = recency_hint (0..1-ish)
  do $inner$
  begin
    -- Just scope container
  end
  $inner$;

  create temporary table tmp_norm on commit drop as
  with bounds as (
    select min(raw_fit) as fmin, max(raw_fit) as fmax from tmp_scored
  ),
  base as (
    select
      s.driver_id,
      s.raw_fit,
      (s.n_global + s.n_cust) as n_total,
      s.recency_hint,
      b.fmin, b.fmax
    from tmp_scored s cross join bounds b
  )
  select
    driver_id,
    case
      when fmax > fmin then (raw_fit - fmin) / nullif(fmax - fmin, 0)
      else 0.5
    end::numeric as predicted_fit,
    least(1.0,
          coalesce( ln(1 + greatest(0, n_total)) / nullif(ln(1 + 50),0), 0)
         * greatest(0.2, coalesce(recency_hint, 0.2))
    )::numeric as confidence
  from base;

  -- Compose reason text
  create temporary table tmp_final on commit drop as
  select
    p_load_id as load_id,
    n.driver_id,
    n.predicted_fit,
    n.confidence,
    case
      when (select n_cust from tmp_scored s where s.driver_id = n.driver_id) > 0
        then 'Customer-specific + global feedback (recency-weighted)'
      when (select n_global from tmp_scored s where s.driver_id = n.driver_id) > 0
        then 'Global feedback only (recency-weighted)'
      else 'No feedback found; default baseline'
    end as reason,
    v_now as generated_at
  from tmp_norm n
  order by n.predicted_fit desc, n.confidence desc
  limit greatest(1, coalesce(p_limit_n, 5));

  -- Persist to ai_predictions for auditing/analytics
  insert into public.ai_predictions (load_id, driver_id, predicted_fit, confidence, reason, generated_at)
  select load_id, driver_id, predicted_fit, confidence, reason, generated_at
  from tmp_final;

  -- Return the same rows
  return query
  select load_id, driver_id, predicted_fit, confidence, reason, generated_at
  from tmp_final
  order by predicted_fit desc, confidence desc;
end;
$$;

grant execute on function public.rpc_ai_predict_best_drivers_for_load(uuid, int) to authenticated;

-- ---------- Helper RPC: predict for all open loads ----------
/*
  "Open loads" definition (robust):
    - loads table exists
    - Prefer loads where driver is not yet assigned IF loads.driver_id column exists
    - Else, loads that are not delivered (if a delivered_at column exists)
    - If neither column exists, process nothing (safety)
*/
create or replace function public.rpc_ai_predict_all_open_loads(p_limit_per_load int default 3)
returns table (
  load_id uuid,
  driver_id uuid,
  predicted_fit numeric,
  confidence numeric,
  reason text,
  generated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  loads_has_driver_id bool := public._col_exists('public','loads','driver_id');
  loads_has_delivered bool := public._col_exists('public','loads','delivered_at');
  r record;
begin
  if not public._tbl_exists('public','loads') then
    return;
  end if;

  -- Build target set
  create temporary table tmp_open_loads on commit drop as
  select l.id
  from public.loads l
  where
    (
      loads_has_driver_id and (l.driver_id is null)
    )
    or (
      (not loads_has_driver_id) and loads_has_delivered and (l.delivered_at is null)
    );

  for r in (select id from tmp_open_loads) loop
    return query
    select * from public.rpc_ai_predict_best_drivers_for_load(r.id, p_limit_per_load);
  end loop;

end;
$$;

grant execute on function public.rpc_ai_predict_all_open_loads(int) to authenticated;

-- ------------- Indexes (simple) -------------
create index if not exists idx_ai_predictions_load on public.ai_predictions(load_id);
create index if not exists idx_ai_predictions_driver on public.ai_predictions(driver_id);
create index if not exists idx_ai_predictions_generated_at on public.ai_predictions(generated_at);
