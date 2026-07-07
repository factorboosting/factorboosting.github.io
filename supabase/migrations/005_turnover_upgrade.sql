-- 005_turnover_upgrade.sql
-- Upgrades run_backtest_legs to return individual firm returns and market caps
-- alongside their co_codes, so that the backtest engine can compute precise
-- weight-based turnover (EW and VW) instead of using stock counts.

drop function if exists public.run_backtest_legs(text, text, text, text, text[], jsonb);

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
  co_codes    integer[],
  rets        double precision[],
  mcaps       double precision[]
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
    array_agg(base.co_code) as co_codes,
    array_agg(base.monthly_ret) as rets,
    array_agg(case when base.prev_mktcap > 0 then base.prev_mktcap else 0 end) as mcaps
  from base
  where p_size_labels is null
     or array_length(p_size_labels, 1) is null
     or base.size_bucket = any (p_size_labels)
  group by base.month, base.size_bucket, base.bm_label;
$$;

revoke all on function public.run_backtest_legs(text, text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.run_backtest_legs(text, text, text, text, text[], jsonb) to service_role;
