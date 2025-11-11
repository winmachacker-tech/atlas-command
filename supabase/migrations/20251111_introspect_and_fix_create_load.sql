-- ===========================================
-- A) QUICK SCHEMA INSPECTION (run these first)
-- ===========================================
-- Customers table columns (name + type)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'customers'
order by ordinal_position;

-- Loads table columns (name + type)
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'loads'
order by ordinal_position;

-- ===========================================
-- B) CANONICAL, SCHEMA-AWARE RPC
-- - driver_id optional (NULL ok)
-- - status defaults to an allowed value
-- - shipper auto-resolves from customers using to_jsonb-safe keys
-- - ref_no is inserted ONLY if loads.ref_no exists
-- ===========================================

-- 1) Drop any prior variants to avoid ambiguity
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

-- 2) Create a single resilient version
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
  v_row        public.loads%rowtype;
  v_ref_no     text;
  v_shipper    text;

  has_ref_no   boolean;
  sql_cols     text;
  sql_vals     text;
  sql_stmt     text;
begin
  -- Resolve shipper using safe JSON lookup of whatever columns actually exist
  -- Try common names in order: company_name, company, name, legal_name, display_name, title
  select coalesce(
           p_shipper,
           to_jsonb(c)->>'company_name',
           to_jsonb(c)->>'company',
           to_jsonb(c)->>'name',
           to_jsonb(c)->>'legal_name',
           to_jsonb(c)->>'display_name',
           to_jsonb(c)->>'title'
         )
    into v_shipper
    from public.customers c
   where c.id = p_customer_id
   limit 1;

  if v_shipper is null then
    v_shipper := 'Unknown';
  end if;

  -- Generate ref_no if the loads table has that column AND caller did not supply one
  select exists(
           select 1 from information_schema.columns
            where table_schema='public' and table_name='loads' and column_name='ref_no'
         )
    into has_ref_no;

  v_ref_no := case
                when has_ref_no then
                  coalesce(
                    p_ref_no,
                    'LOAD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
                    substr(gen_random_uuid()::text, 1, 6)
                  )
                else null
              end;

  -- Build column/values lists conditionally (only include ref_no if it exists)
  sql_cols := 'customer_id, shipper, driver_id, status, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, rate';
  sql_vals := ' $1,         $2,      $3,       $4,    $5,         $6,          $7,       $8,        $9,        $10,        $11';

  if has_ref_no then
    sql_cols := 'customer_id, shipper, ref_no, driver_id, status, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, rate';
    sql_vals := ' $1,         $2,      $3,     $4,       $5,     $6,         $7,          $8,       $9,        $10,       $11,         $12';
  end if;

  if has_ref_no then
    sql_stmt := format('
      insert into public.loads (%s)
      values (%s)
      returning *;
    ', sql_cols, sql_vals);

    execute sql_stmt
      into v_row
      using
        p_customer_id,
        v_shipper,
        v_ref_no,               -- ref_no present
        p_driver_id,
        p_status,
        p_origin_city,
        p_origin_state,
        p_dest_city,
        p_dest_state,
        p_pickup_at,
        p_delivery_at,
        p_rate;
  else
    sql_stmt := format('
      insert into public.loads (%s)
      values (%s)
      returning *;
    ', sql_cols, sql_vals);

    execute sql_stmt
      into v_row
      using
        p_customer_id,
        v_shipper,
        p_driver_id,
        p_status,
        p_origin_city,
        p_origin_state,
        p_dest_city,
        p_dest_state,
        p_pickup_at,
        p_delivery_at,
        p_rate;
  end if;

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
