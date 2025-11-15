// FILE: scripts/trainLaneModel.mjs
// Purpose: Train a simple, robust lane→driver model from your real data.
// - No PowerShell. Just Node.
// - Works even if your loads use different column names for cities/states.
// - Uses Laplace-smoothing on (up/down) to avoid divide-by-zero.
// - Writes results to public.ai_lane_driver_model
// - Installs a tiny predictor RPC that reads the trained table (with fallback).

import pg from "pg";

// ----------- CONFIG -----------
const DB_URL =
  process.argv[2] || process.env.DATABASE_URL ||
  ""; // e.g., postgresql://postgres:PASS@db.tnpesnohwbwpmakvyzpn.supabase.co:5432/postgres

if (!DB_URL) {
  console.error(
    "Usage:\n  node scripts/trainLaneModel.mjs \"postgresql://postgres:PASS@db.HOST:5432/postgres\""
  );
  process.exit(1);
}

const ssl = { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: DB_URL, ssl });

(async () => {
  await client.connect();

  // 0) Helpers & lane-field view (column-agnostic)
  await client.query(`
    create or replace function public.json_pick_first(obj jsonb, keys text[])
    returns text language sql immutable as $$
      select v from (
        select obj->>k as v from unnest(keys) as k
      ) s where v is not null and btrim(v) <> '' limit 1
    $$;

    create or replace function public._thumb_to_val(anyelement)
    returns int language sql immutable as $$
      select case
        when $1 is null then null
        when $1::text ilike 'true'  or $1::text in ('up','👍','like','positive','+','1','yes') then 1
        when $1::text ilike 'false' or $1::text in ('down','👎','dislike','negative','-','-1','no') then -1
        else null
      end
    $$;

    create or replace view public.v_loads_lane_fields as
    select
      ld.id as load_id,
      public.json_pick_first(to_jsonb(ld), array['origin_city','o_city','shipper_city','pickup_city','pickup_city_name']) as o_city,
      public.json_pick_first(to_jsonb(ld), array['origin_state','o_state','shipper_state','origin_state_code','pickup_state']) as o_state,
      public.json_pick_first(to_jsonb(ld), array['dest_city','d_city','consignee_city','delivery_city']) as d_city,
      public.json_pick_first(to_jsonb(ld), array['dest_state','d_state','consignee_state','dest_state_code','delivery_state']) as d_state,
      coalesce(ld.assigned_driver_id, ld.driver_id) as driver_id
    from public.loads ld;
  `);

  // 1) Ensure model table exists
  await client.query(`
    create table if not exists public.ai_lane_driver_model (
      lane_key text not null,
      o_norm   text not null,
      d_norm   text not null,
      driver_id uuid not null,
      up_count bigint not null,
      down_count bigint not null,
      score numeric not null,
      trained_at timestamptz not null default now(),
      primary key (lane_key, driver_id)
    );
  `);

  // 2) Build training dataset: combine thumbs (if present) + delivered assignments
  //    - Thumbs: uses driver_feedback (boolean or text) -> +1/-1
  //    - Assignments: treat (load with driver assigned) as +1 evidence
  // IMPORTANT: We only use loads with clear lane fields (no UNKNOWN).
  const trainSQL = `
    with lanes as (
      select
        v.load_id,
        v.driver_id,
        coalesce(nullif(trim(v.o_city || ', ' || v.o_state), ''), 'UNKNOWN') as o_norm,
        coalesce(nullif(trim(v.d_city || ', ' || v.d_state), ''), 'UNKNOWN') as d_norm
      from public.v_loads_lane_fields v
      where v.driver_id is not null
    ),
    -- explicit feedback, if table exists: driver_feedback(vote bool/text)
    thumbs as (
      select
        df.load_id,
        df.driver_id,
        public._thumb_to_val(df.vote) as tv
      from public.driver_feedback df
      join lanes l on l.load_id = df.load_id and l.driver_id = df.driver_id
      where public._thumb_to_val(df.vote) is not null
    ),
    -- implicit positives from assignments (each counts as +1)
    assigns as (
      select
        l.load_id,
        l.driver_id,
        1 as tv
      from lanes l
    ),
    -- union both sources
    events as (
      select load_id, driver_id, tv from thumbs
      union all
      select load_id, driver_id, tv from assigns
    ),
    joined as (
      select
        e.driver_id,
        l.o_norm,
        l.d_norm,
        (l.o_norm || ' → ' || l.d_norm) as lane_key,
        e.tv
      from events e
      join lanes l on l.load_id = e.load_id and l.driver_id = e.driver_id
      where l.o_norm <> 'UNKNOWN' and l.d_norm <> 'UNKNOWN'
    ),
    agg as (
      select
        lane_key, o_norm, d_norm, driver_id,
        sum(case when tv =  1 then 1 else 0 end)::bigint as up_count,
        sum(case when tv = -1 then 1 else 0 end)::bigint as down_count
      from joined
      group by lane_key, o_norm, d_norm, driver_id
    ),
    scored as (
      select
        lane_key, o_norm, d_norm, driver_id,
        up_count, down_count,
        -- Laplace smoothing: (up+1)/(up+down+2)
        ((up_count + 1.0) / greatest(up_count + down_count + 2.0, 1.0))::numeric as score
      from agg
    )
    -- refresh model table (truncate+insert)
    delete from public.ai_lane_driver_model;
    insert into public.ai_lane_driver_model (lane_key, o_norm, d_norm, driver_id, up_count, down_count, score, trained_at)
    select lane_key, o_norm, d_norm, driver_id, up_count, down_count, score, now()
    from scored;
  `;

  await client.query('begin');
  try {
    await client.query(trainSQL);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }

  // 3) Install a tiny predictor RPC that reads from the trained table with fallback.
  await client.query(`
    create or replace function public.rpc_ai_predict_best_drivers(
      p_origin_city  text,
      p_origin_state text,
      p_dest_city    text,
      p_dest_state   text,
      p_limit        int default 5
    )
    returns table (
      driver_id   uuid,
      driver_name text,
      score       numeric,
      source      text
    )
    language sql
    stable
    as $$
      with lane as (
        select
          coalesce(nullif(trim(p_origin_city || ', ' || p_origin_state), ''), 'UNKNOWN') as o_norm,
          coalesce(nullif(trim(p_dest_city   || ', ' || p_dest_state  ), ''), 'UNKNOWN') as d_norm
      ),
      learned as (
        select m.driver_id, m.score, 'learned'::text as source
        from public.ai_lane_driver_model m, lane
        where m.o_norm = lane.o_norm and m.d_norm = lane.d_norm
        order by m.score desc
        limit p_limit
      ),
      fallback as (
        -- neutral fallback: all drivers with baseline score 0.5
        select d.id as driver_id, 0.5::numeric as score, 'fallback'::text as source
        from public.drivers d
      )
      select
        l.driver_id,
        (select dr.full_name from public.drivers dr where dr.id = l.driver_id) as driver_name,
        l.score,
        l.source
      from learned l
      union all
      select
        f.driver_id,
        (select dr.full_name from public.drivers dr where dr.id = f.driver_id) as driver_name,
        f.score,
        f.source
      from fallback f
      where not exists (select 1 from learned l2 where l2.driver_id = f.driver_id)
      order by source = 'learned' desc, score desc
      limit p_limit;
    $$;
  `);

  console.log("✅ Training complete. Model table refreshed. Predictor installed.");
  console.log("Try in SQL Editor:");
  console.log("  select * from public.rpc_ai_predict_best_drivers('Birmingham','AL','Charlotte','NC', 5);");

  await client.end();
})().catch((err) => {
  console.error("TRAINING ERROR:", err.message || err);
  process.exit(1);
});
