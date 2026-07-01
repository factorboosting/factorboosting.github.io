-- Keep only the hot-filter indexes the planner used during verification.
-- The batch RPC experiment was slower than parallel JSON leg RPCs, so remove it.

drop index if exists public.factor_panel_rmw_portfolio_filter_idx;
drop index if exists public.factor_panel_cma_portfolio_filter_idx;
drop index if exists public.factor_panel_op_filter_idx;
drop index if exists public.factor_panel_inv_filter_idx;
drop index if exists public.factor_panel_size_yearly_filter_idx;

drop function if exists public.run_backtest_legs_batch(text, text, text, jsonb);
