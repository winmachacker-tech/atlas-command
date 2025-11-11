-- 20251111072304_ai_auto_feedback_on_delivered.sql
-- Purpose: Auto-insert driver_feedback ðŸ‘ when a load is delivered/completed.
-- Safe to re-run: uses CREATE OR REPLACE; dedupes with a unique index.

-- === EXTENSIONS (safe) ===
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- === HELPERS ===

-- Build lane key like "Tulsa, OK â†’ Columbus, OH"
create or replace function public.fn_build_lane_key(
  o_city text, o_state text, d_city text, d_state text
) returns text
language sql
immutable
as \$\$
  select trim(
    coalesce(o_city,'') || case when o_state is not null and o_state <> '' then ', '||o_state else '' end
    || ' â†’ ' ||
    coalesce(d_city,'') || case when d_state is not null and d_state <> '' then ', '||d_state else '' end
  );
\$\$;

-- Generate compact click key
create or replace function public.fn_make_click_key(_rating text default 'up')
returns text
language plpgsql
as \$\$
declare
  ts text := extract(epoch from now())::bigint::text;  -- seconds
  rnd text := encode(gen_random_bytes(4), 'hex');
begin
  if _rating is null then _rating := 'up'; end if;
  return ts || '-' || rnd || '-' || _rating;
end;
\$\$;

-- Ensure click_key always has a value (column exists & is NOT NULL)
alter table public.driver_feedback
  alter column click_key set default encode(gen_random_bytes(8), 'hex');

-- One feedback per driver/customer/lane per second (unique index)
create unique index if not exists uniq_driver_feedback_lane_sec
  on public.driver_feedback (driver_id, customer_id, lane_key, created_at_sec);

-- === TRIGGER: on loads status change, auto-write ðŸ‘ feedback ===
create or replace function public.trg_loads_auto_feedback()
returns trigger
language plpgsql
as \$\$
declare
  v_lane_key text;
  v_sec bigint := extract(epoch from now())::bigint;
begin
  -- Only act when status changes
  if (TG_OP = 'UPDATE') then
    if coalesce(NEW.status,'') = coalesce(OLD.status,'') then
      return NEW;
    end if;
  end if;

  -- Normalize terminal good states (adjust if your enum differs)
  if upper(coalesce(NEW.status,'')) not in ('DELIVERED','COMPLETED') then
    return NEW;
  end if;

  -- Require minimal fields for a valid example
  if NEW.driver_id is null or NEW.customer_id is null then
    return NEW;
  end if;

  if NEW.completed_at is null then
    return NEW;
  end if;

  -- Build lane key
  v_lane_key := public.fn_build_lane_key(NEW.origin_city, NEW.origin_state, NEW.dest_city, NEW.dest_state);

  -- Insert feedback; ignore duplicates per unique index
  insert into public.driver_feedback (
    id, driver_id, rating, lane_key, customer_id, note,
    click_key, is_interactive, created_at, created_at_sec, created_epoch_sec, created_epoch_2s
  )
  values (
    gen_random_uuid(),
    NEW.driver_id,
    'up',
    v_lane_key,
    NEW.customer_id,
    'auto: load delivered',
    public.fn_make_click_key('up'),
    false,
    now(),
    v_sec,
    v_sec,
    floor(v_sec/2)
  )
  on conflict (driver_id, customer_id, lane_key, created_at_sec)
  do nothing;

  return NEW;
end;
\$\$;

-- Attach trigger (after insert or status update)
drop trigger if exists trg_loads_auto_feedback on public.loads;
create trigger trg_loads_auto_feedback
after insert or update of status on public.loads
for each row
execute function public.trg_loads_auto_feedback();

-- === OPTIONAL BACKFILL (run once): create feedback for already-delivered loads ===
with cand as (
  select
    l.id,
    l.driver_id,
    l.customer_id,
    public.fn_build_lane_key(l.origin_city, l.origin_state, l.dest_city, l.dest_state) as lane_key,
    extract(epoch from coalesce(l.completed_at, l.updated_at, now()))::bigint as sec
  from public.loads l
  left join lateral (
    select 1
    from public.driver_feedback f
    where f.driver_id = l.driver_id
      and f.customer_id = l.customer_id
      and f.lane_key = public.fn_build_lane_key(l.origin_city, l.origin_state, l.dest_city, l.dest_state)
      and f.created_at_sec = extract(epoch from coalesce(l.completed_at, l.updated_at, now()))::bigint
    limit 1
  ) fx on true
  where l.driver_id is not null
    and l.customer_id is not null
    and upper(coalesce(l.status,'')) in ('DELIVERED','COMPLETED')
    and l.completed_at is not null
    and fx is null
)
insert into public.driver_feedback (
  id, driver_id, rating, lane_key, customer_id, note,
  click_key, is_interactive, created_at, created_at_sec, created_epoch_sec, created_epoch_2s
)
select
  gen_random_uuid(),
  c.driver_id,
  'up',
  c.lane_key,
  c.customer_id,
  'auto: backfill delivered',
  public.fn_make_click_key('up'),
  false,
  now(),
  c.sec,
  c.sec,
  floor(c.sec/2)
from cand c
on conflict (driver_id, customer_id, lane_key, created_at_sec)
do nothing;
