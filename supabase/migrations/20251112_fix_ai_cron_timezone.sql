-- 20251112_fix_ai_cron_timezone.sql
-- Purpose: Ensure AI learning job runs at 2:00 AM Los Angeles (10:00 UTC now)
-- Behavior:
--   - Creates pg_cron extension if missing
--   - Upserts a cron job to call your retrain function daily at 10:00 UTC
--   - If a previous job exists (any older fn_ai_retrain* command), it updates that job instead of duplicating it
--   - Shows a quick verification at the end

-----------------------------
-- 0) Ensure pg_cron exists --
-----------------------------
create extension if not exists pg_cron;

-- Optional (usually not needed on Supabase, kept for completeness)
-- grant usage on schema cron to postgres;

-----------------------------------------------------
-- 1) Define the exact retrain function to execute --
-----------------------------------------------------
-- If your function name differs, edit ONLY the line below.
-- Common choices we've used together: fn_ai_retrain_all(), rpc_ai_retrain()
-- Use SELECT form (no semicolon inside the $$...$$ literal)
do $$
declare
  v_target_cmd text := $$select public.fn_ai_retrain_all()$$;  -- <-- CHANGE HERE if your function name differs
  v_jobid      int;
begin
  ------------------------------------------------------------
  -- 2) Try to find an existing job to UPDATE (idempotency) --
  ------------------------------------------------------------
  -- Match by exact command first
  select j.jobid
    into v_jobid
  from cron.job j
  where j.database = current_database()
    and j.command  = v_target_cmd
  limit 1;

  -- If not found, match any older retrain commands we’ve used before
  if v_jobid is null then
    select j.jobid
      into v_jobid
    from cron.job j
    where j.database = current_database()
      and (
        j.command ilike '%fn_ai_retrain_all%' or
        j.command ilike '%rpc_ai_retrain%'     or
        j.command ilike '%fn_ai_retrain%'
      )
    order by j.jobid desc
    limit 1;
  end if;

  ----------------------------------------------------------------
  -- 3) Upsert the job to run at 10:00 UTC (≈ 2:00 AM LA in PST) --
  ----------------------------------------------------------------
  if v_jobid is null then
    -- No prior job: create a new one
    perform cron.schedule('0 10 * * *', v_target_cmd);
  else
    -- Update existing job
    update cron.job
       set schedule = '0 10 * * *',           -- daily at 10:00 UTC
           command  = v_target_cmd,
           active   = true
     where jobid    = v_jobid;
  end if;
end$$;

--------------------------------------
-- 4) Quick verification (read-only) --
--------------------------------------
-- Shows the retrain job that will run daily at 10:00 UTC
select
  j.jobid,
  j.schedule,
  j.command,
  j.database,
  j.active,
  now()                                 as server_now_utc,
  (now() at time zone 'America/Los_Angeles') as server_now_la
from cron.job j
where j.database = current_database()
  and j.command = $$select public.fn_ai_retrain_all()$$  -- keep in sync with v_target_cmd above
order by j.jobid desc
limit 3;
