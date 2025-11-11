-- 20251112_rpc_create_load_from_customer.sql
-- Purpose: Create a REAL load row from the Customers page (or anywhere),
--          so the AI trainer can learn from it.
-- Notes:
-- - We DO NOT set status here. Your table's default will apply (avoids check-constraint errors).
-- - Pass a valid customer_id (required). driver_id is optional.
-- - Returns the inserted loads row.

create or replace function public.rpc_create_load_from_customer(
  p_ref_no        text default null,
  p_customer_id   uuid,                -- REQUIRED
  p_driver_id     uuid default null,   -- optional
  p_origin_city   text,
  p_origin_state  text,
  p_dest_city     text,
  p_dest_state    text,
  p_pickup_at     timestamptz default null,
  p_delivery_at   timestamptz default null,
  p_rate          numeric default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ref text := coalesce(p_ref_no, 'AC-' || substr(v_id::text, 1, 8));
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;

  insert into public.loads (
    id,
    ref_no,
    customer_id,
    driver_id,
    origin_city, origin_state,
    dest_city,   dest_state,
    pickup_at,   delivery_at,
    rate,
    created_at,  updated_at
    -- status intentionally omitted: table default applies
    -- completed_at omitted: will be set by your normal flow
  ) values (
    v_id,
    v_ref,
    p_customer_id,
    p_driver_id,
    p_origin_city, p_origin_state,
    p_dest_city,   p_dest_state,
    p_pickup_at,   p_delivery_at,
    p_rate,
    now(),         now()
  );

  return (select l from public.loads l where l.id = v_id);
end
$$;

-- Allow your app roles to call it (adjust roles to your setup)
grant execute on function public.rpc_create_load_from_customer(
  text, uuid, uuid, text, text, text, text, timestamptz, timestamptz, numeric
) to authenticated, service_role;

-- (Optional) If RLS blocks inserts on loads for your users,
-- you can either rely on existing policies, or add a policy like:
-- create policy "app_can_insert_loads"
-- on public.loads
-- for insert
-- to authenticated
-- with check (true);
