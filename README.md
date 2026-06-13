# SCDLDS Factor Library

Official website and portfolio analysis studio for the SCDLDS Factor Data
Library, Ashoka University.

## Architecture

Static frontend on **Cloudflare Pages** → a thin **Pages Function** at
`/api/backtest` → the heavy aggregation runs in **Supabase Postgres** (one indexed
`factor_panel` table + a `GROUP BY` RPC) → a small JSON response → Chart.js renders
instantly. Results are cached at the edge in **Cloudflare KV**.

```
Browser (static HTML/CSS/JS, Chart.js)
   │  fetch('/api/backtest')
   ▼
Cloudflare Pages Function (functions/api/backtest.js)
   • validates the request, checks the KV cache
   • calls the Supabase RPC (the only heavy work, runs in Postgres)
   • composes metrics/equity/drawdown/IR in JS (src/worker/backtest-core.js)
   ▼
Supabase Postgres (Mumbai / ap-south-1)
   • factor_panel (per universe × month × co_code) + benchmark/rf/name tables
   • run_backtest_legs() returns per-month, per-bucket EW/VW aggregates (tiny)
```

Why this split: a Cloudflare Worker has a small CPU budget, but *waiting* on
Postgres is I/O and doesn't count against it. The row-crunching happens in Postgres
(returning a few hundred numbers); the Worker only does cheap composition.

The legacy browser-only engine (`loadDataLocal` / client `computePortfolio` in
`backtester.js`) is still present as a fallback. Delete it once the API path is
verified — the Worker is the single source of truth.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html`, `backtester.html`, `team.html`, `styles.css`, `script.js`, `backtester.js` | The static site (canonical source, at repo root). |
| `scripts/build-site.mjs` | Assembles the deployable site into `dist/` (allowlist of web assets only). |
| `functions/api/backtest.js` | Pages Function: backtest endpoint (RPC + composition + KV cache). |
| `functions/api/download.js` | Pages Function: redirects allowlisted big-file downloads to Supabase Storage. |
| `src/worker/backtest-core.js` | The backtest math/composition (port of `src/server/backtest-engine.js`). |
| `src/server/*` | Legacy Node engine — kept as the correctness oracle (`npm run backtest:smoke`). |
| `supabase/migrations/003_factor_panel.sql` | Tables: `factor_panel`, `benchmark_monthly`, `rf_monthly`, `company_names`. |
| `supabase/migrations/004_run_backtest_legs.sql` | RPCs: `run_backtest_legs`, `get_holdings`, `get_universe_meta`. |
| `scripts/load-panel-to-postgres.mjs` | Bulk-loads the derived snapshots into Postgres. |
| `wrangler.toml` | Cloudflare Pages config (output dir `dist`, KV binding `BACKTEST_KV`). |
| `.github/workflows/keep-warm.yml` | Daily ping so the free Supabase project doesn't pause. |

## Local development

```bash
npm install          # provides wrangler (dev tool only; not deployed)
npm run dev          # builds dist/ then serves it + functions via wrangler
```

`wrangler pages dev` reads Function secrets from a local `.dev.vars` file (never
commit it):

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
SUPABASE_STORAGE_BUCKET=factor-data
```

Bind a local KV namespace with `--kv BACKTEST_KV` if you want to exercise caching.
Without Supabase configured, the page still loads and the browser fallback runs.

## Going live (one-time, user-driven)

> **Standing up the whole stack on fresh accounts?** See **[`DEPLOYMENT.md`](DEPLOYMENT.md)** —
> a step-by-step runbook written so an AI agent or engineer can deploy from scratch
> (Supabase + Cloudflare + GitHub) with their own accounts, including the data-load path
> and the gotchas we hit. The section below is the condensed version.

These steps touch shared/external systems (your Supabase + Cloudflare accounts),
so they are done by a human, not automatically. Everything below is
account-portable — moving to a researcher's account later means repeating §3 with
new keys, nothing in the code changes.

### 1. Supabase (Mumbai)

1. Create a new Supabase project in **`ap-south-1` (Mumbai)**.
2. Apply the schema (SQL editor or `supabase db push`), in order:
   - `supabase/migrations/003_factor_panel.sql`
   - `supabase/migrations/004_run_backtest_legs.sql`
   - (existing) `supabase/migrations/001_backtest_cache.sql` if you want the cache table.
3. Note the project **URL** and **service-role key** (Settings → API).

### 2. Load data

1. Generate the derived snapshots locally (needs the source CSVs on disk):
   ```bash
   npm run data:derive
   ```
   Or set `PANEL_SOURCE_SUPABASE_URL` / `PANEL_SOURCE_SERVICE_ROLE_KEY` to pull the
   gzipped chunks from the old project's Storage.
2. Load the panel + benchmark + rf + names into Postgres:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run data:load
   ```
3. Confirm `factor_panel` (≈ 789k rows) plus indexes is comfortably under the 500 MB
   free cap.
4. Upload the big **download** files to a Storage bucket named `factor-data`
   (`npm run data:upload` handles this) so `/api/download` works:
   `finalMonthlyLabels_aman.csv` and the three `21_*stock_level_monthly.csv` panels.

### 3. Cloudflare Pages

1. Create a Pages project and **connect this GitHub repo** (Git integration → every
   push to `main` deploys; every PR gets a free preview URL).
2. Build settings: **Framework = None**, **Build command = `node scripts/build-site.mjs`**,
   **Build output directory = `dist`**.
3. Create the KV namespace and paste the ids into `wrangler.toml`:
   ```bash
   npx wrangler kv namespace create BACKTEST_KV
   npx wrangler kv namespace create BACKTEST_KV --preview
   ```
4. Set environment variables/secrets for **both** Production and Preview:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
   `SUPABASE_STORAGE_BUCKET=factor-data`. The service-role key is server-only —
   never a public/`NEXT_PUBLIC_*` variable.
5. Deploy a branch first, validate on its preview URL, then merge to `main`.

### 4. Keep-warm

Set a repo **variable** `PAGES_URL` (e.g. `https://factorboosting.pages.dev`)
under Settings → Secrets and variables → Actions → Variables. The
`keep-warm` workflow then pings `/api/backtest?warm=1` daily. (Cloudflare Pages
Functions can't run cron themselves; a scheduled standalone Worker is the
alternative if you prefer to keep it inside Cloudflare.)

### 5. Cutover & rollback

- Leave **GitHub Pages** running until the Cloudflare site is verified, then turn it
  off (it can't run the Function and would keep serving the old broken site).
- Push the safety tag so the pre-migration state is recoverable from anywhere:
  ```bash
  git push origin legacy-ghpages-v0
  ```
- Rollback options: Cloudflare Pages keeps every deployment (one-click
  "Rollback to this deployment"); or check out `legacy-ghpages-v0` to return to the
  original code.

## Verification

```bash
npm run backtest:smoke   # legacy engine oracle — compare equity curves/metrics
npm run build            # assemble dist/
```

The correctness oracle (`scripts/smoke-backtest.mjs`) runs the original Node engine.
After the data is loaded, compare its output for a few preset portfolios
(all/top500/top300, long-only and long-short) against the new RPC+Worker path; they
should match within rounding. Cold `/api/backtest` should return well under ~1 s;
cached repeats are single-digit ms from KV.
