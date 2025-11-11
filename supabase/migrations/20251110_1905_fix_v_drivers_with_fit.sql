-- Fix: recreate v_drivers_with_fit cleanly (drop first, then create)

-- If other views depend on it, cascade the drop so we can recreate cleanly.
drop view if exists public.v_drivers_with_fit cascade;

create view public.v_drivers_with_fit as
select
  d.*,
  coalesce(s.up_events, 0)                         as fit_thumbs_up,
  coalesce(s.down_events, 0)                       as fit_thumbs_down,
  coalesce(s.up_events + s.down_events, 0)         as fit_total_events,
  coalesce(s.fit_score, 0)                         as fit_score,
  case
    when coalesce(s.fit_score,0) >= 3 then 'great'
    when coalesce(s.fit_score,0) >  0 then 'good'
    when coalesce(s.fit_score,0) =  0 then 'neutral'
    else 'poor'
  end                                              as fit_label,
  s.updated_at                                     as fit_updated_at
from public.drivers d
left join public.driver_fit_scores s on s.driver_id = d.id;
