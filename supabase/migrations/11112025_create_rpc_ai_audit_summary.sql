-- 20251111_create_rpc_ai_audit_summary.sql
-- Creates a robust audit RPC that summarizes recent AI runs.
-- It works whether you store predictions inline on ai_prediction_runs.predictions (jsonb)
-- or in a separate table like ai_predictions / ai_prediction_items.
-- Also summarizes thumbs feedback from driver_feedback by run_id.

-- Optional: create helper tables if they don't exist (NO-OP if they do).
-- You can remove these IF you already have these tables.
-- Do not error if they exist.
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================================
-- RPC: rpc_ai_audit_summary()
-- =====================================================================
create or replace function public.rpc_ai_audit_summary()
returns table (
  run_id uuid,
  created_at timestamptz,
  model_name text,
  total_predictions int,
  total_feedback int,
  thumbs_up int,
  thumbs_down int,
  accuracy numeric,
  notes text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  has_inline_predictions boolean;
  has_ai_predictions_tbl boolean;
  has_ai_prediction_items_tbl boolean;
begin
  -- Detect schema shape once per call
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ai_prediction_runs' and column_name='predictions'
  ) into has_inline_predictions;

  select to_regclass('public.ai_predictions') is not null
  into has_ai_predictions_tbl;

  select to_regclass('public.ai_prediction_items') is not null
  into has_ai_prediction_items_tbl;

  return query
  with runs as (
    select
      r.id,
      r.created_at,
      coalesce(r.model_name, 'unknown') as model_name,
      r.notes
    from public.ai_prediction_runs r
    order by r.created_at desc
    limit 50
  ),
  feedback as (
    select
      df.run_id,
      count(*)::int as total_feedback,
      sum((df.feedback = 'up')::int)::int as thumbs_up,
      sum((df.feedback = 'down')::int)::int as thumbs_down
    from public.driver_feedback df
    group by df.run_id
  ),
  pred_counts as (
    -- Prefer inline JSONB length if present; otherwise fall back to ai_predictions or ai_prediction_items
    select
      ru.id as run_id,
      (
        case
          when has_inline_predictions then (
            select coalesce(jsonb_array_length(r.predictions), 0)
            from public.ai_prediction_runs r
            where r.id = ru.id
          )
          when has_ai_predictions_tbl then (
            select count(*)::int from public.ai_predictions p where p.run_id = ru.id
          )
          when has_ai_prediction_items_tbl then (
            select count(*)::int from public.ai_prediction_items pi where pi.run_id = ru.id
          )
          else 0
        end
      )::int as total_predictions
    from runs ru
  )
  select
    ru.id as run_id,
    ru.created_at,
    ru.model_name,
    coalesce(pc.total_predictions, 0) as total_predictions,
    coalesce(f.total_feedback, 0) as total_feedback,
    coalesce(f.thumbs_up, 0) as thumbs_up,
    coalesce(f.thumbs_down, 0) as thumbs_down,
    case
      when coalesce(f.total_feedback, 0) = 0 then null
      else round((f.thumbs_up::numeric / nullif(f.total_feedback, 0)) * 100, 1)
    end as accuracy,
    ru.notes
  from runs ru
  left join pred_counts pc on pc.run_id = ru.id
  left join feedback f on f.run_id = ru.id
  order by ru.created_at desc;
end;
$$;

-- Convenience view (lets you SELECT without rpc()).
drop view if exists public.v_ai_audit_summary;
create view public.v_ai_audit_summary as
select * from public.rpc_ai_audit_summary();

-- Permissions: let your app call it.
grant execute on function public.rpc_ai_audit_summary() to authenticated, anon;
grant select on public.v_ai_audit_summary to authenticated, anon;
