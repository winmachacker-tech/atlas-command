-- Purpose: Remove ambiguous overloads and define ONE canonical create-load RPC.
-- Notes (per your loads schema):
--   - loads.shipper is NOT NULL  -> require p_shipper
--   - loads.origin / destination are NOT NULL -> derive from city/state
--   - loads.ref_no exists -> auto-generate if omitted
--   - driver_id is optional
--   - status default should be allowed by your checks/triggers

-- 1) DROP BOTH EXISTING OVERLOADS (exact type signatures)

-- Overload #1 (customer_id first)
drop function if exists public.rpc_create_load_from_customer(
  uuid,         -- p_customer_id
  text,         -- p_origin_city
  text,         -- p_origin_state
  text,         -- p_dest_city
  text,         -- p_dest_state
  timestamptz,  -- p_pickup_at
  timestamptz,  -- p_delivery_at
  numeric,      -- p_rate
  text,         -- p_ref_no
  text,         -- p_status
  uuid,         -- p_driver_id
  text          -- p_shipper
);

-- Overload #2 (shipper first + origin/destination overrides)
drop function if exists public.rpc_create_load_from_customer(
  text,         -- p_shipper
  text,         -- p_origin_city
  text,         -- p_origin_state
  text,         -- p_dest_city
  text,         -- p_dest_state
  timestamptz,  -- p_pickup_at
  uuid,         -- p_customer_id
  timestamptz,  -- p_delivery_at
  numeric,      -- p_rate
  text,         -- p_ref_no
  text,         -- p_status
  uuid,         -- p_driver_id
  text,         -- p_origin
  text          -- p_destination
);

-- 2) CREATE ONE CANONICAL FUNCTION
--    Required args come first (no defaults), then all optional with defaults (Postgres rule).
create or replace function public.rpc_create_load_from_customer(
  -- REQUIRED (no defaults)
  p_shipper        text,
  p_origin_city    text,
  p_origin_state   text,
  p_dest_city      text,
  p_dest_state     text,
  p_pickup_at      timestamptz,

  -- OPTIONAL (all with defaults)
  p_customer_id    uuid        default null,        -- loads.customer_id is nullable
  p_delivery_at    timestamptz default null,
  p_rate           numeric     default 0,
  p_ref_no         text        default null,
  p_status         text        default 'AVAILABLE', -- adjust if your trigger requires e.g. 'TENDERED'
  p_driver_id      uuid        default null,
  p_origin         text        default null,        -- explicit override for "City, ST"
  p_destination    text        default null         -- explicit override for "City, ST"
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row          public.loads%rowtype;
  v_ref_no       text;
  v_origin       text;
  v_destination  text;
begin
  -- Build "City, ST" when not explicitly provided
  v_origin := coalesce(
    p_origin,
    nullif(
      trim(coalesce(p_origin_city, '') ||
          case when coalesce(p_origin_state, '') <> '' then ', ' || p_origin_state else '' end),
      ''
    )
  );

  v_destination := coalesce(
    p_destination,
    nullif(
      trim(coalesce(p_dest_city, '') ||
          case when coalesce(p_dest_state, '') <> '' then ', ' || p_dest_state else '' end),
      ''
    )
  );

  -- Safety fallbacks to satisfy NOT NULL
  if v_origin is null then v_origin := 'Unknown'; end if;
  if v_destination is null then v_destination := 'Unknown'; end if;

  -- Auto-generate ref number if none supplied
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
    origin,
    destination,
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
    p_shipper,
    v_ref_no,
    p_driver_id,
    p_status,
    v_origin,
    v_destination,
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

-- 3) EXECUTE PERMISSION FOR AUTHENTICATED USERS
revoke all on function public.rpc_create_load_from_customer(
  text, text, text, text, text, timestamptz, uuid, timestamptz, numeric, text, text, uuid, text, text
) from public;

grant execute on function public.rpc_create_load_from_customer(
  text, text, text, text, text, timestamptz, uuid, timestamptz, numeric, text, text, uuid, text, text
) to authenticated;
