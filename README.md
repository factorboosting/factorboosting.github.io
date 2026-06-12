# SCDLDS Factor Library

Official website and portfolio analysis studio for the SCDLDS Factor Data
Library, Ashoka University.

## What changed

The public design remains the existing HTML/CSS experience. The project now also
runs as a Next.js app so the expensive backtester work can happen server-side
instead of forcing every visitor to download and parse the large CSV files in
their browser.

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The root route redirects to the existing
`index.html`; `backtester.html` keeps the same UI and falls back to browser-side
CSV processing if the API is unavailable.

## Verification

```bash
npm run backtest:smoke
npm run build
npm audit --omit=dev
```

## Supabase cache

The app works without Supabase by using server memory caching. To persist cached
backtest responses across deployments, set server-only Supabase environment
variables and apply `supabase/migrations/001_backtest_cache.sql`.

Never expose the service role key in browser code or a `NEXT_PUBLIC_*` variable.

## Supabase Storage data source

Large CSVs do not need to live in Git. Upload the backtester input files to a
private Supabase Storage bucket and set production to read from Storage. The
upload command first regenerates a compact runtime manifest, then uploads large
CSV files compressed as `.gz` so cold starts download far less data:

```bash
npm run data:upload
```

Required server env:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=factor-data
DATA_SOURCE=supabase-storage
BACKTEST_REMOTE_CACHE=0
```

`BACKTEST_REMOTE_CACHE` stays off by default because warm in-memory computation
is faster than a network cache lookup for most custom comparisons. Set it to
`1` only if you want persistent cross-instance result caching.

The upload script creates the `factor-data` bucket if needed and uploads:

- `Data/Derived/backtest-runtime.json`
- `Data/Factor_Data/ff5.csv`
- `Data/Factor_Data/finalMonthlyLabels_aman.csv.gz`
- `Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv.gz`
- `Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv.gz`
- `Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv.gz`

Run only the manifest generation locally with:

```bash
npm run data:derive
```

Those large CSVs are ignored by Git. Keep small images, PDFs, and lightweight
CSV downloads in the repo unless you decide to move all static assets to Storage
later.
