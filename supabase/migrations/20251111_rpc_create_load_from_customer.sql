-- Purpose: Canonicalize rpc_create_load_from_customer and make driver_id optional.
-- Usage: supabase db push  (or run in Supabase SQL editor)

-- 1) Drop ambiguous overloads if they exist
drop function if exists public.rpc_create_load_from_customer(
  uuid, text, uuid, text, text, text, text, timestamptz, timestamptz, numeric
);

drop function if exists public.rpc_create_load_from_customer(
  p_customer_id uuid,
  p_driver_id uuid,
  p_origin_city text,
  p_origin_state text,
  p_dest_city text,
  p_dest_state text,
  p_pickup_at timestamptz,
  p_rate numeric,
  p_ref_no text,
  p_delivery_at timestamptz,
  p_status text
);

-- 2) Create ONE clear function:
--    - driver is OPTIONAL (default null)
--    - ref_no is OPTIONAL (auto-filled if null)
--    - status defaults to 'AVAILABLE' (adjust if your loads_status_check requires a different initial status)
create or replace function public.rpc_create_load_from_customer(
  p_customer_id   uuid,
  p_origin_city   text,
  p_origin_state  text,
  p_dest_city     text,
  p_dest_state    text,
  p_pickup_at     timestamptz,
  p_delivery_at   timestamptz default null,
  p_rate          numeric     default 0,
  p_ref_no        text        default null,
  p_status        text        default 'AVAILABLE',
  p_driver_id     uuid        default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_no text;
  v_row    public.loads;
begin
  -- Fallback ref_no if not provided. If your schema DOES NOT have ref_no, remove it below.
  v_ref_no := coalesce(p_ref_no, 'LOAD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6));

  -- If you want to enforce allowed statuses at creation time, keep p_status constrained to your check.
  -- If your check constraint on loads.status disallows 'AVAILABLE', set a permitted default here.
  insert into public.loads (
    customer_id,
    ref_no,
    driver_id,
    status,
    origin_city,
    origin_state,
    dest_city,
    dest_state,
    pickup_at,
    delivery_at,
    rate
  )
  values (
    p_customer_id,
    v_ref_no,
    p_driver_id,     -- can be NULL now
    p_status,
    p_origin_city,
    p_origin_state,
    p_dest_city,
    p_dest_state,
    p_pickup_at,
    p_delivery_at,
    p_rate
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- 3) Permissions: allow authenticated users to call it (adjust to your roles)
revoke all on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid
) from public;

grant execute on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid
) to authenticated;
