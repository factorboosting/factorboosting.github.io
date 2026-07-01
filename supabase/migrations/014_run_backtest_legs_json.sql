-- Return complete leg aggregates as one JSON value so PostgREST's row cap does
-- not truncate large full-history responses or force repeated RPC execution.

drop function if exists public.run_backtest_legs_json(text, text, text, text, text[], jsonb, boolean);

create or replace function public.run_backtest_legs_json(
  p_universe text,
  p_start text,
  p_end text,
  p_size_col text,
  p_size_labels text[] default null,
  p_filters jsonb default '{}'::jsonb,
  p_include_turnover boolean default true
)
returns jsonb
language sql
stable
set search_path = public
set statement_timeout = '60s'
as $$
  select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)
  from public.run_backtest_legs(
    p_universe,
    p_start,
    p_end,
    p_size_col,
    p_size_labels,
    p_filters,
    p_include_turnover
  ) as rows;
$$;

revoke all on function public.run_backtest_legs_json(text, text, text, text, text[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.run_backtest_legs_json(text, text, text, text, text[], jsonb, boolean) to service_role;
