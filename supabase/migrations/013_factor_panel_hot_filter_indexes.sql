-- Speed up backtester RPCs by indexing the factor labels used as hot filters.
-- These are partial indexes over valid return rows, matching run_backtest_legs.

create index if not exists factor_panel_mom_filter_idx
  on public.factor_panel (universe, mom_label, month)
  where monthly_ret is not null;

create index if not exists factor_panel_bm_filter_idx
  on public.factor_panel (universe, bm_label, month)
  where monthly_ret is not null;

create index if not exists factor_panel_rmw_portfolio_filter_idx
  on public.factor_panel (universe, rmw_portfolio, month)
  where monthly_ret is not null;

create index if not exists factor_panel_cma_portfolio_filter_idx
  on public.factor_panel (universe, cma_portfolio, month)
  where monthly_ret is not null;

create index if not exists factor_panel_op_filter_idx
  on public.factor_panel (universe, op_label, month)
  where monthly_ret is not null;

create index if not exists factor_panel_inv_filter_idx
  on public.factor_panel (universe, inv_label, month)
  where monthly_ret is not null;

create index if not exists factor_panel_size_yearly_filter_idx
  on public.factor_panel (universe, size_label_yearly, month)
  where monthly_ret is not null;
