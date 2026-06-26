-- 008_increase_timeout.sql
-- Increases the statement timeout for the heavy backtest query.
-- The query groups hundreds of thousands of rows into arrays which takes ~8 seconds on the free tier.
-- The default API timeout is 8 seconds, which causes "canceling statement due to statement timeout".
-- This migration bumps it to 60 seconds specifically for this function, ensuring it never times out.

ALTER FUNCTION public.run_backtest_legs(text, text, text, text, text[], jsonb, boolean) SET statement_timeout = '60s';
