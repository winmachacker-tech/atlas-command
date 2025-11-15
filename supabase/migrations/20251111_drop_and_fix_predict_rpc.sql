-- FILE: supabase/migrations/20251111_drop_and_fix_predict_rpc.sql
-- Purpose: Drop the existing rpc_ai_predict_best_drivers_for_load(uuid,int) (if any)
--          and recreate it with a schema-safe active check (no hard dependency on d.active).

-- 1) Drop the old function with the exact signature the app calls:
drop function if exists public.rpc_ai_predict_best_drivers_for_load(uuid, integer);

-- 2) Recreate with robust logic that doesn't assume drivers.active exists
create or replace function public.rpc_ai_predict_best_drivers_for_load(
  p_load_id uuid,
  p_limit int default 5
)
returns table (
  driver_id uuid,
  full_name text,
  score numeric,
  reason text
)
language sql
security definer
set search_path = public, extensions
as $$
with L as (
  select *
  from public.loads
  where id = p_load_id
),
D as (
  select
    d.id,
    d.full_name,
    /* Schema-safe "is_active": works whether 'active' or 'status' exists or not */
    coalesce(
      -- If there's a boolean-ish 'active' key, use it
      case when (to_jsonb(d)->>'active') in ('true','false')
           then (to_jsonb(d)->>'active')::boolean
      end,
      -- Else, infer from 'status' if present
      case when lower(coalesce(to_jsonb(d)->>'status','')) in ('active','available','ready')
           then true
      end,
      -- Fallback: true so we don't exclude everyone or crash
      true
    ) as is_active
  from public.drivers d
)
select
  d.id as driver_id,
  d.full_name,
  0.5::numeric as score,  -- neutral baseline; plug in your scoring later
  'Baseline ranking (schema-safe). Adjust scoring later.'::text as reason
from D d
join L on true
where d.is_active is true
order by score desc, d.full_name asc
limit greatest(1, p_limit);
$$;

-- 3) Permissions (adjust if you lock these down differently)
revoke all on function public.rpc_ai_predict_best_drivers_for_load(uuid, integer) from public;
grant execute on function public.rpc_ai_predict_best_drivers_for_load(uuid, integer) to anon, authenticated, service_role;
