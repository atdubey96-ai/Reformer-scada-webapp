-- Hourly averaged history for the Reformer Tube Remaining Life panel (webapp/index.html, #tube-life-card).
-- Read-only, SECURITY INVOKER (row level security on plant_data_history still applies).
-- Applied to the "Uniformance" project on 2026-11-20.
create or replace function public.tube_life_hourly(p_tags text[], p_from timestamptz default now() - interval '400 days')
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', h.tag_id, 'h', h.hr, 'v', h.v, 'lo', h.lo) order by h.hr), '[]'::jsonb)
  from (
    select tag_id, date_trunc('hour', recorded_at) as hr,
           round(avg(value)::numeric, 1)::float8 as v,
           round(min(value)::numeric, 1)::float8 as lo
    from public.plant_data_history
    where tag_id = any(p_tags) and recorded_at >= p_from and value is not null
    group by tag_id, date_trunc('hour', recorded_at)
  ) h;
$$;
grant execute on function public.tube_life_hourly(text[], timestamptz) to anon, authenticated;
