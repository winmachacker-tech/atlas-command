-- Fix: Parameter order so required args come first (no defaults),
-- then optional args (with defaults). Also keeps origin/destination autofill.

-- 1) Drop prior variants to avoid overload ambiguity
drop function if exists public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid, text, text
);
drop function if exists public.rpc_create_load_from_customer(
  p_customer_id uuid,
  p_shipper text,
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
  p_origin text,
  p_destination text
);

-- 2) Create canonical function with correct ordering:
--    REQUIRED (no defaults): p_shipper, p_origin_city, p_origin_state, p_dest_city, p_dest_state, p_pickup_at
--    OPTIONAL (with defaults): p_customer_id, p_delivery_at, p_rate, p_ref_no, p_status, p_driver_id, p_origin, p_destination
create or replace function public.rpc_create_load_from_customer(
  -- REQUIRED
  p_shipper        text,
  p_origin_city    text,
  p_origin_state   text,
  p_dest_city      text,
  p_dest_state     text,
  p_pickup_at      timestamptz,

  -- OPTIONAL (all have defaults)
  p_customer_id    uuid        default null,   -- loads.customer_id is nullable
  p_delivery_at    timestamptz default null,
  p_rate           numeric     default 0,
  p_ref_no         text        default null,
  p_status         text        default 'AVAILABLE',
  p_driver_id      uuid        default null,
  p_origin         text        default null,   -- override "City, ST" if you want
  p_destination    text        default null    -- override "City, ST" if you want
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
    nullif(trim(coalesce(p_origin_city, '') ||
          case when p_origin_state is not null and p_origin_state <> '' then ', ' || p_origin_state else '' end), '')
  );

  v_destination := coalesce(
    p_destination,
    nullif(trim(coalesce(p_dest_city, '') ||
          case when p_dest_state is not null and p_dest_state <> '' then ', ' || p_dest_state else '' end), '')
  );

  -- Safety fallbacks to satisfy NOT NULL
  if v_origin is null then v_origin := 'Unknown'; end if;
  if v_destination is null then v_destination := 'Unknown'; end if;

  -- Auto-generate ref number if none supplied (loads.ref_no exists)
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
    p_shipper,          -- NOT NULL in schema
    v_ref_no,
    p_driver_id,        -- optional
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

-- 3) Permissions
revoke all on function public.rpc_create_load_from_customer(
  text, text, text, text, text, timestamptz, uuid, timestamptz, numeric, text, text, uuid, text, text
) from public;

grant execute on function public.rpc_create_load_from_customer(
  text, text, text, text, text, timestamptz, uuid, timestamptz, numeric, text, text, uuid, text, text
) to authenticated;
