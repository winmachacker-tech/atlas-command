-- Purpose: Ensure loads.shipper is always populated (NOT NULL) when creating a load.
-- Strategy: Add optional p_shipper arg; if null, derive from customers table.

-- 1) Drop any previous variants to avoid ambiguity
drop function if exists public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid
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

-- 2) Create the canonical function
-- Notes:
-- - p_shipper is optional; if omitted, we pull company/name from customers.
-- - p_status defaults to an allowed initial status (adjust if your check/trigger requires different).
-- - p_driver_id is optional (NULL allowed).
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
  p_driver_id     uuid        default null,
  p_shipper       text        default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref_no   text;
  v_shipper  text;
  v_row      public.loads;
begin
  -- Generate ref_no if not provided (remove if your table doesn't have ref_no)
  v_ref_no := coalesce(
    p_ref_no,
    'LOAD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6)
  );

  -- Resolve shipper from input or customers table
  select
    coalesce(
      p_shipper,
      -- adjust the columns below to match your customers schema
      coalesce(c.company_name, c.name, c.customer_name)::text
    )
  into v_shipper
  from public.customers c
  where c.id = p_customer_id
  limit 1;

  -- Safety net: if still null, set a placeholder (keeps NOT NULL happy)
  if v_shipper is null then
    v_shipper := 'Unknown';
  end if;

  insert into public.loads (
    customer_id,
    shipper,          -- <-- NOT NULL in your schema
    ref_no,           -- remove if you don't have this column
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
    v_shipper,
    v_ref_no,         -- remove if you don't have this column
    p_driver_id,
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

-- 3) Permissions
revoke all on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid, text
) from public;

grant execute on function public.rpc_create_load_from_customer(
  uuid, text, text, text, text, timestamptz, timestamptz, numeric, text, text, uuid, text
) to authenticated;
