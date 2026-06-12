create table if not exists public.backtest_cache (
  cache_key text primary key,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table public.backtest_cache enable row level security;

revoke all on table public.backtest_cache from anon, authenticated;
grant select, insert, update, delete on table public.backtest_cache to service_role;

create index if not exists backtest_cache_expires_at_idx
  on public.backtest_cache (expires_at);
