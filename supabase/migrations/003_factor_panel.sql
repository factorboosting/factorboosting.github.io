-- Factor panel + benchmark + risk-free + company-name tables.
--
-- One row per (universe, co_code, month). The factor/size *_label values are
-- universe-relative (Fama-French breakpoints are computed inside each universe),
-- so a stock can be labelled differently in `all` vs `top500` vs `top300`. We
-- therefore keep a single table discriminated by `universe` rather than sharing
-- rows across universes. Total ≈ 789k rows (all 554k + top500 147k + top300 89k),
-- comfortably under the Supabase free 500 MB cap.
--
-- Numerics are double precision so server-side aggregation matches the JS engine
-- (which uses 64-bit floats) bit-for-bit within rounding.

create table if not exists public.factor_panel (
  universe          text             not null,   -- 'all' | 'top500' | 'top300'
  co_code           integer          not null,
  month             text             not null,   -- 'YYYY-MM'
  monthly_ret       double precision,            -- sanitized monthly return (fraction)
  mktcap            double precision,            -- current end-of-month market cap
  prev_mktcap       double precision,            -- prior-month size, the VW weight (no look-ahead)
  size_label        text,                        -- generic fallback size bucket (S/B)
  size_label_yearly text,
  size_label_monthly text,
  size_label_op     text,
  size_label_inv    text,
  size_label_at     text,
  size_label_sg     text,
  size_label_acc    text,
  mom_label         text,
  bm_label          text,
  op_label          text,
  inv_label         text,
  rmw_portfolio     text,
  cma_portfolio     text,
  at_label          text,
  sg_label          text,
  acc_label         text,
  vol_label         text,
  str_label         text,
  constraint factor_panel_pkey primary key (universe, month, co_code)
);

-- The PK (universe, month, co_code) already serves the hot query
-- `where universe = $1 and month between $2 and $3` as an index-range scan, so
-- no extra indexes are needed for the aggregation RPC.

alter table public.factor_panel enable row level security;
revoke all on table public.factor_panel from anon, authenticated;
grant select on table public.factor_panel to service_role;

-- Monthly benchmark index returns (fractions), one row per month.
create table if not exists public.benchmark_monthly (
  month    text primary key,            -- 'YYYY-MM'
  nifty50  double precision,
  nifty500 double precision
);

alter table public.benchmark_monthly enable row level security;
revoke all on table public.benchmark_monthly from anon, authenticated;
grant select on table public.benchmark_monthly to service_role;

-- Monthly risk-free rate (fraction), one row per month.
create table if not exists public.rf_monthly (
  month text primary key,               -- 'YYYY-MM'
  rf    double precision
);

alter table public.rf_monthly enable row level security;
revoke all on table public.rf_monthly from anon, authenticated;
grant select on table public.rf_monthly to service_role;

-- Co_Code -> Co_Name lookup for the holdings inspector.
create table if not exists public.company_names (
  co_code integer primary key,
  co_name text
);

alter table public.company_names enable row level security;
revoke all on table public.company_names from anon, authenticated;
grant select on table public.company_names to service_role;
