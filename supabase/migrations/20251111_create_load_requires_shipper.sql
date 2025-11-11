-- Purpose: Canonical rpc_create_load_from_customer aligned to your actual loads schema.
-- Notes from schema:
--   - loads.shipper           NOT NULL (must be provided)
--   - loads.ref_no            NULLABLE (exists)
--   - loads.driver_id         NULLABLE (optional)
--   - loads.customer_id       NULLABLE (exists)
--   - origin_city/state, dest_city/state, pickup_at/delivery_at, rate exist
--   - status NOT NULL (default value must be allowed by your checks/triggers)

-- 1) Remove older variants to avoid overload ambiguity
drop function if exists public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid, text
);
drop function if exists public.rpc_create_load_from_customer(
  p_customer_id uuid,
  p_origin_city text,
  p_origin_state text,
  p_dest_city text,
  p_dest_state text,
  p_pickup_at timestamptz,
  p_delivery_at timestamptz,
  p_rate numeric,
  p_ref_no text,
  p_status text,
  p_driver_id uuid,
  p_shipper text
);
drop function if exists public.rpc_create_load_from_customer(
  p_customer_id uuid,
  p_origin_city text,
  p_origin_state text,
  p_dest_city text,
  p_dest_state text,
  p_pickup_at timestamptz,
  p_delivery_at timestamptz,
  p_rate numeric,
  p_ref_no text,
  p_status text,
  p_driver_id uuid
);

-- 2) Create the single canonical RPC
create or replace function public.rpc_create_load_from_customer(
  p_customer_id   uuid        default null,   -- loads.customer_id exists and is nullable
  p_shipper       text,                        -- REQUIRED (loads.shipper is NOT NULL)
  p_origin_city   text,
  p_origin_state  text,
  p_dest_city     text,
  p_dest_state    text,
  p_pickup_at     timestamptz,
  p_delivery_at   timestamptz default null,
  p_rate          numeric     default 0,
  p_ref_no        text        default null,
  p_status        text        default 'AVAILABLE',  -- adjust if your trigger/check requires a different start
  p_driver_id     uuid        default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.loads%rowtype;
  v_ref_no text;
begin
  -- Generate a ref number if none supplied (since loads.ref_no exists)
  v_ref_no := coalesce(
    p_ref_no,
    'LOAD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6)
  );

  insert into public.loads (
    customer_id,
    shipper,
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
    p_shipper,          -- required
    v_ref_no,
    p_driver_id,        -- optional
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

-- 3) Tighten permissions
revoke all on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid
) from public;

grant execute on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid
) to authenticated;
