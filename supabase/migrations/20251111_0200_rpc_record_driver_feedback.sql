-- FILE: supabase/migrations/20251111_0200_rpc_record_driver_feedback.sql
-- Purpose: Single entrypoint to record driver feedback (up/down) from ANY page.
-- Includes optional lane/load/customer context. Minimal grants added.

-- 0) Ensure columns exist on driver_feedback (idempotent adds)
do $$
begin
  -- lane_key
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='lane_key'
  ) then
    alter table public.driver_feedback add column lane_key text null;
  end if;

  -- load_id
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='load_id'
  ) then
    alter table public.driver_feedback add column load_id uuid null;
  end if;

  -- customer_id
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='customer_id'
  ) then
    alter table public.driver_feedback add column customer_id uuid null;
  end if;

  -- note (optional free text)
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='driver_feedback' and column_name='note'
  ) then
    alter table public.driver_feedback add column note text null;
  end if;
end$$;

-- 1) RPC: write one feedback row; accepts 'up' or 'down'
create or replace function public.rpc_record_driver_feedback(
  p_driver_id   uuid,
  p_rating      text,           -- 'up' | 'down'
  p_lane_key    text default null,
  p_load_id     uuid default null,
  p_customer_id uuid default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  if p_rating not in ('up','down') then
    raise exception 'rating must be "up" or "down"';
  end if;

  insert into public.driver_feedback (driver_id, rating, lane_key, load_id, customer_id, note)
  values (p_driver_id, p_rating, p_lane_key, p_load_id, p_customer_id, p_note)
  returning id into v_id;

  -- if you have triggers that update driver_fit_scores, they will fire here automatically

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.rpc_record_driver_feedback(uuid, text, text, uuid, uuid, text)
is 'Insert a driver_feedback row with optional lane_key/load_id/customer_id context. rating must be "up" or "down".';

-- 2) Permissions
revoke all on function public.rpc_record_driver_feedback(uuid, text, text, uuid, uuid, text) from public;
grant execute on function public.rpc_record_driver_feedback(uuid, text, text, uuid, uuid, text) to anon, authenticated, service_role;

-- 3) Ask PostgREST to reload schema
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end$$;
