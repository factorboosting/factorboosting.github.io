-- Pin public RPC functions to the public schema search path.

alter function public.run_backtest_legs(text, text, text, text, text[], jsonb, boolean)
  set search_path = public;

alter function public.get_holdings(text, text, text, text[], jsonb)
  set search_path = public;

alter function public.get_universe_meta(text)
  set search_path = public;
