-- Batch the common no-transaction-cost backtest path into one RPC call.
-- The existing run_backtest_legs RPC remains the detailed turnover path.

drop function if exists public.run_backtest_legs_batch(text, text, text, jsonb);

create or replace function public.run_backtest_legs_batch(
  p_universe text,
  p_start    text,
  p_end      text,
  p_legs     jsonb
)
returns table (
  leg_index   integer,
  month       text,
  size_bucket text,
  bm_bucket   text,
  n           integer,
  sum_ret     double precision,
  sum_ret_w   double precision,
  sum_w       double precision,
  co_codes    integer[],
  rets        double precision[],
  mcaps       double precision[]
)
language sql
stable
set search_path = public
set statement_timeout = '60s'
as $$
  with raw_legs as (
    select
      coalesce((leg ->> 'leg_index')::integer, (ord - 1)::integer) as leg_index,
      coalesce(leg ->> 'size_col', 'Size_Label_Yearly') as size_col,
      case
        when jsonb_typeof(leg -> 'size_labels') = 'array'
          then array(select jsonb_array_elements_text(leg -> 'size_labels'))
        else null::text[]
      end as size_labels,
      coalesce(leg -> 'filters', '{}'::jsonb) as filters
    from jsonb_array_elements(p_legs) with ordinality as x(leg, ord)
  ),
  legs as (
    select
      leg_index,
      size_col,
      size_labels,
      case when filters ? 'BM_Label' then array(select jsonb_array_elements_text(filters -> 'BM_Label')) end as bm_labels,
      case when filters ? 'OP_Label' then array(select jsonb_array_elements_text(filters -> 'OP_Label')) end as op_labels,
      case when filters ? 'INV_Label' then array(select jsonb_array_elements_text(filters -> 'INV_Label')) end as inv_labels,
      case when filters ? 'RMW_Portfolio' then array(select jsonb_array_elements_text(filters -> 'RMW_Portfolio')) end as rmw_portfolios,
      case when filters ? 'CMA_Portfolio' then array(select jsonb_array_elements_text(filters -> 'CMA_Portfolio')) end as cma_portfolios,
      case when filters ? 'MOM_Label' then array(select jsonb_array_elements_text(filters -> 'MOM_Label')) end as mom_labels,
      case when filters ? 'AT_Label' then array(select jsonb_array_elements_text(filters -> 'AT_Label')) end as at_labels,
      case when filters ? 'SG_Label' then array(select jsonb_array_elements_text(filters -> 'SG_Label')) end as sg_labels,
      case when filters ? 'ACC_Label' then array(select jsonb_array_elements_text(filters -> 'ACC_Label')) end as acc_labels,
      case when filters ? 'VOL_Label' then array(select jsonb_array_elements_text(filters -> 'VOL_Label')) end as vol_labels,
      case when filters ? 'STR_Label' then array(select jsonb_array_elements_text(filters -> 'STR_Label')) end as str_labels
    from raw_legs
  ),
  base as (
    select
      l.leg_index,
      l.size_labels,
      p.month,
      p.monthly_ret,
      p.prev_mktcap,
      p.bm_label,
      coalesce(
        nullif(
          case l.size_col
            when 'RMW_Portfolio'      then left(coalesce(p.rmw_portfolio, ''), 1)
            when 'CMA_Portfolio'      then left(coalesce(p.cma_portfolio, ''), 1)
            when 'Size_Label_Monthly' then p.size_label_monthly
            when 'Size_Label_OP'      then p.size_label_op
            when 'Size_Label_INV'     then p.size_label_inv
            when 'Size_Label_AT'      then p.size_label_at
            when 'Size_Label_SG'      then p.size_label_sg
            when 'Size_Label_ACC'     then p.size_label_acc
            else p.size_label_yearly
          end, ''),
        nullif(p.size_label_yearly, ''),
        nullif(p.size_label_monthly, ''),
        nullif(p.size_label, ''),
        ''
      ) as size_bucket
    from public.factor_panel p
    join legs l on true
    where p.universe = p_universe
      and p.month >= p_start
      and p.month <= p_end
      and p.monthly_ret is not null
      and (l.bm_labels is null or p.bm_label = any (l.bm_labels))
      and (l.op_labels is null or p.op_label = any (l.op_labels))
      and (l.inv_labels is null or p.inv_label = any (l.inv_labels))
      and (l.rmw_portfolios is null or p.rmw_portfolio = any (l.rmw_portfolios))
      and (l.cma_portfolios is null or p.cma_portfolio = any (l.cma_portfolios))
      and (l.mom_labels is null or p.mom_label = any (l.mom_labels))
      and (l.at_labels is null or p.at_label = any (l.at_labels))
      and (l.sg_labels is null or p.sg_label = any (l.sg_labels))
      and (l.acc_labels is null or p.acc_label = any (l.acc_labels))
      and (l.vol_labels is null or p.vol_label = any (l.vol_labels))
      and (l.str_labels is null or p.str_label = any (l.str_labels))
  ),
  filtered as (
    select *
    from base
    where size_labels is null
       or array_length(size_labels, 1) is null
       or size_bucket = any (size_labels)
  )
  select
    filtered.leg_index,
    filtered.month,
    filtered.size_bucket,
    filtered.bm_label as bm_bucket,
    count(*)::integer as n,
    sum(filtered.monthly_ret) as sum_ret,
    sum(case when filtered.prev_mktcap > 0 then filtered.monthly_ret * filtered.prev_mktcap else 0 end) as sum_ret_w,
    sum(case when filtered.prev_mktcap > 0 then filtered.prev_mktcap else 0 end) as sum_w,
    '{}'::integer[] as co_codes,
    '{}'::double precision[] as rets,
    '{}'::double precision[] as mcaps
  from filtered
  group by filtered.leg_index, filtered.month, filtered.size_bucket, filtered.bm_label;
$$;

revoke all on function public.run_backtest_legs_batch(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.run_backtest_legs_batch(text, text, text, jsonb) to service_role;
