-- 006_optimize_turnover.sql
-- Optimizes the turnover data extraction by evaluating JSONB filters once
-- and allows optionally omitting the huge rets and mcaps arrays when
-- transaction costs are disabled, avoiding Supabase statement timeouts.

drop function if exists public.run_backtest_legs(text, text, text, text, text[], jsonb);

create or replace function public.run_backtest_legs(
  p_universe    text,
  p_start       text,
  p_end         text,
  p_size_col    text,
  p_size_labels text[] default null,
  p_filters     jsonb  default '{}'::jsonb,
  p_include_turnover boolean default true
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
language plpgsql
stable
as $$
declare
  v_bm_labels text[];
  v_op_labels text[];
  v_inv_labels text[];
  v_mom_labels text[];
  v_at_labels text[];
  v_sg_labels text[];
  v_acc_labels text[];
  v_vol_labels text[];
  v_str_labels text[];
begin
  if p_filters ? 'BM_Label' then v_bm_labels := array(select jsonb_array_elements_text(p_filters -> 'BM_Label')); end if;
  if p_filters ? 'OP_Label' then v_op_labels := array(select jsonb_array_elements_text(p_filters -> 'OP_Label')); end if;
  if p_filters ? 'INV_Label' then v_inv_labels := array(select jsonb_array_elements_text(p_filters -> 'INV_Label')); end if;
  if p_filters ? 'MOM_Label' then v_mom_labels := array(select jsonb_array_elements_text(p_filters -> 'MOM_Label')); end if;
  if p_filters ? 'AT_Label' then v_at_labels := array(select jsonb_array_elements_text(p_filters -> 'AT_Label')); end if;
  if p_filters ? 'SG_Label' then v_sg_labels := array(select jsonb_array_elements_text(p_filters -> 'SG_Label')); end if;
  if p_filters ? 'ACC_Label' then v_acc_labels := array(select jsonb_array_elements_text(p_filters -> 'ACC_Label')); end if;
  if p_filters ? 'VOL_Label' then v_vol_labels := array(select jsonb_array_elements_text(p_filters -> 'VOL_Label')); end if;
  if p_filters ? 'STR_Label' then v_str_labels := array(select jsonb_array_elements_text(p_filters -> 'STR_Label')); end if;

  return query
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
      and (v_bm_labels is null or p.bm_label = any (v_bm_labels))
      and (v_op_labels is null or p.op_label = any (v_op_labels))
      and (v_inv_labels is null or p.inv_label = any (v_inv_labels))
      and (v_mom_labels is null or p.mom_label = any (v_mom_labels))
      and (v_at_labels is null or p.at_label = any (v_at_labels))
      and (v_sg_labels is null or p.sg_label = any (v_sg_labels))
      and (v_acc_labels is null or p.acc_label = any (v_acc_labels))
      and (v_vol_labels is null or p.vol_label = any (v_vol_labels))
      and (v_str_labels is null or p.str_label = any (v_str_labels))
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
    case when p_include_turnover then array_agg(base.monthly_ret) else '{}'::double precision[] end as rets,
    case when p_include_turnover then array_agg(case when base.prev_mktcap > 0 then base.prev_mktcap else 0 end) else '{}'::double precision[] end as mcaps
  from base
  where p_size_labels is null
     or array_length(p_size_labels, 1) is null
     or base.size_bucket = any (p_size_labels)
  group by base.month, base.size_bucket, base.bm_label;
end;
$$;

revoke all on function public.run_backtest_legs(text, text, text, text, text[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.run_backtest_legs(text, text, text, text, text[], jsonb, boolean) to service_role;
