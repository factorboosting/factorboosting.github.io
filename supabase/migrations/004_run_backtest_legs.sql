-- Backtest RPCs. These push the only heavy work (the per-month GROUP BY over the
-- panel) into Postgres and return tiny aggregates; the Cloudflare Worker then does
-- the cheap composition (EW/VW blend, long-short, turnover, txn cost, metrics).
--
-- Filters are applied as static, parameterized predicates over a fixed set of
-- known label columns -- no dynamic SQL, so this is injection-safe and index-able.
-- `p_filters` is a jsonb object keyed by the engine's label column names
-- (e.g. {"MOM_Label": ["W"], "BM_Label": ["V"]}); the Size factor is passed
-- separately via `p_size_col` (which Size_Label_* column drives bucketing) and
-- `p_size_labels` (the allowed buckets, or NULL for "no size filter").
--
-- The Worker must OMIT any factor whose label list is empty (the JS engine skips
-- empty filters); an empty array here would otherwise exclude every row.

-- ── Heavy aggregation: one leg (long or short) of one portfolio ──────────────
-- Returns, per (month, size_bucket, bm_bucket):
--   n         firm count (EW denominator)
--   sum_ret   Σ monthly_ret              (EW numerator)
--   sum_ret_w Σ monthly_ret * prev_mktcap (VW numerator, weight > 0 only)
--   sum_w     Σ prev_mktcap              (VW denominator, weight > 0 only)
--   co_codes  firm ids in the group      (for turnover)
create or replace function public.run_backtest_legs(
  p_universe    text,
  p_start       text,
  p_end         text,
  p_size_col    text,
  p_size_labels text[] default null,
  p_filters     jsonb  default '{}'::jsonb
)
returns table (
  month       text,
  size_bucket text,
  bm_bucket   text,
  n           integer,
  sum_ret     double precision,
  sum_ret_w   double precision,
  sum_w       double precision,
  co_codes    integer[]
)
language sql
stable
as $$
  with base as (
    select
      p.month,
      p.co_code,
      p.monthly_ret,
      p.prev_mktcap,
      p.bm_label,
      coalesce(
        nullif(
          case p_size_col
            when 'Size_Label_Monthly' then p.size_label_monthly
            else p.size_label_yearly
          end, ''),
        nullif(p.size_label_yearly, ''),
        nullif(p.size_label_monthly, ''),
        nullif(p.size_label, ''),
        ''
      ) as size_bucket
    from public.factor_panel p
    where p.universe = p_universe
      and p.month >= p_start
      and p.month <= p_end
      and p.monthly_ret is not null
      and (not (p_filters ? 'BM_Label')  or p.bm_label  = any (array(select jsonb_array_elements_text(p_filters -> 'BM_Label'))))
      and (not (p_filters ? 'OP_Label')  or p.op_label  = any (array(select jsonb_array_elements_text(p_filters -> 'OP_Label'))))
      and (not (p_filters ? 'INV_Label') or p.inv_label = any (array(select jsonb_array_elements_text(p_filters -> 'INV_Label'))))
      and (not (p_filters ? 'MOM_Label') or p.mom_label = any (array(select jsonb_array_elements_text(p_filters -> 'MOM_Label'))))
      and (not (p_filters ? 'AT_Label')  or p.at_label  = any (array(select jsonb_array_elements_text(p_filters -> 'AT_Label'))))
      and (not (p_filters ? 'SG_Label')  or p.sg_label  = any (array(select jsonb_array_elements_text(p_filters -> 'SG_Label'))))
      and (not (p_filters ? 'ACC_Label') or p.acc_label = any (array(select jsonb_array_elements_text(p_filters -> 'ACC_Label'))))
      and (not (p_filters ? 'VOL_Label') or p.vol_label = any (array(select jsonb_array_elements_text(p_filters -> 'VOL_Label'))))
      and (not (p_filters ? 'STR_Label') or p.str_label = any (array(select jsonb_array_elements_text(p_filters -> 'STR_Label'))))
  )
  select
    base.month,
    base.size_bucket,
    base.bm_label as bm_bucket,
    count(*)::integer as n,
    sum(base.monthly_ret) as sum_ret,
    sum(case when base.prev_mktcap > 0 then base.monthly_ret * base.prev_mktcap else 0 end) as sum_ret_w,
    sum(case when base.prev_mktcap > 0 then base.prev_mktcap else 0 end) as sum_w,
    array_agg(base.co_code) as co_codes
  from base
  where p_size_labels is null
     or array_length(p_size_labels, 1) is null
     or base.size_bucket = any (p_size_labels)
  group by base.month, base.size_bucket, base.bm_label;
$$;

revoke all on function public.run_backtest_legs(text, text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.run_backtest_legs(text, text, text, text, text[], jsonb) to service_role;

-- ── Holdings inspector: filtered firm list for one leg in a single month ─────
-- Mirrors the engine's toFirms(): every row passing the filters (incl. Size),
-- sorted by return descending. The Worker formats ret%/size for display.
create or replace function public.get_holdings(
  p_universe    text,
  p_month       text,
  p_size_col    text,
  p_size_labels text[] default null,
  p_filters     jsonb  default '{}'::jsonb
)
returns table (
  co_code integer,
  co_name text,
  ret     double precision,
  size    double precision
)
language sql
stable
as $$
  with base as (
    select
      p.co_code,
      p.monthly_ret,
      p.mktcap,
      coalesce(
        nullif(
          case p_size_col
            when 'Size_Label_Monthly' then p.size_label_monthly
            else p.size_label_yearly
          end, ''),
        nullif(p.size_label_yearly, ''),
        nullif(p.size_label_monthly, ''),
        nullif(p.size_label, ''),
        ''
      ) as size_bucket
    from public.factor_panel p
    where p.universe = p_universe
      and p.month = p_month
      and p.monthly_ret is not null
      and (not (p_filters ? 'BM_Label')  or p.bm_label  = any (array(select jsonb_array_elements_text(p_filters -> 'BM_Label'))))
      and (not (p_filters ? 'OP_Label')  or p.op_label  = any (array(select jsonb_array_elements_text(p_filters -> 'OP_Label'))))
      and (not (p_filters ? 'INV_Label') or p.inv_label = any (array(select jsonb_array_elements_text(p_filters -> 'INV_Label'))))
      and (not (p_filters ? 'MOM_Label') or p.mom_label = any (array(select jsonb_array_elements_text(p_filters -> 'MOM_Label'))))
      and (not (p_filters ? 'AT_Label')  or p.at_label  = any (array(select jsonb_array_elements_text(p_filters -> 'AT_Label'))))
      and (not (p_filters ? 'SG_Label')  or p.sg_label  = any (array(select jsonb_array_elements_text(p_filters -> 'SG_Label'))))
      and (not (p_filters ? 'ACC_Label') or p.acc_label = any (array(select jsonb_array_elements_text(p_filters -> 'ACC_Label'))))
      and (not (p_filters ? 'VOL_Label') or p.vol_label = any (array(select jsonb_array_elements_text(p_filters -> 'VOL_Label'))))
      and (not (p_filters ? 'STR_Label') or p.str_label = any (array(select jsonb_array_elements_text(p_filters -> 'STR_Label'))))
  )
  select
    base.co_code,
    coalesce(c.co_name, 'Stock ' || base.co_code::text) as co_name,
    base.monthly_ret as ret,
    base.mktcap as size
  from base
  left join public.company_names c on c.co_code = base.co_code
  where p_size_labels is null
     or array_length(p_size_labels, 1) is null
     or base.size_bucket = any (p_size_labels)
  order by base.monthly_ret desc;
$$;

revoke all on function public.get_holdings(text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.get_holdings(text, text, text, text[], jsonb) to service_role;

-- ── Universe metadata for the GET handler (slider range, row count) ──────────
create or replace function public.get_universe_meta(p_universe text)
returns jsonb
language sql
stable
as $$
  with months as (
    select array_agg(distinct month order by month) as list
    from public.factor_panel
    where universe = p_universe
  ),
  cnt as (
    select count(*)::bigint as row_count
    from public.factor_panel
    where universe = p_universe
  )
  select jsonb_build_object(
    'universe', p_universe,
    'rowCount', cnt.row_count,
    'months', coalesce(to_jsonb(months.list), '[]'::jsonb),
    'firstMonth', months.list[1],
    'lastMonth', months.list[array_length(months.list, 1)],
    'dataQualityStats', jsonb_build_object('dropped', 0, 'capped', 0, 'total', cnt.row_count)
  )
  from months, cnt;
$$;

revoke all on function public.get_universe_meta(text) from public, anon, authenticated;
grant execute on function public.get_universe_meta(text) to service_role;
