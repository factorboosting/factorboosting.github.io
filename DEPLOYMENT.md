# Deploying this site from scratch (agent / engineer runbook)

This file is written so that **an AI coding agent or an engineer can stand up the
entire stack on brand-new accounts**, with no prior context about this project. If
you are a researcher taking this code to your own Supabase + Cloudflare + GitHub
accounts, follow this top to bottom. Nothing here is tied to the original owner's
accounts — every account-specific value is a placeholder you fill in.

For *what the architecture is and why*, read `README.md` first. This file is the
**operational** companion: the exact ordered steps, the inputs only a human can
provide, and the gotchas we actually hit.

---

## 0. The shape of the system (30-second version)

```
Static site (dist/)  ──>  Cloudflare Pages Function /api/backtest  ──>  Supabase Postgres RPC
   Chart.js renders        (validates, caches in KV, composes math)        (heavy GROUP BY over factor_panel)
```

- **Frontend**: plain static HTML/CSS/JS at the repo root, assembled into `dist/` by
  `scripts/build-site.mjs`.
- **Compute**: `functions/api/backtest.js` (a Cloudflare Pages Function) + the math in
  `src/worker/backtest-core.js`. The heavy aggregation runs in Postgres; the Function
  only does cheap composition and caches results in Cloudflare KV.
- **Data**: one `factor_panel` table (~789k rows) + `benchmark_monthly`, `rf_monthly`,
  `company_names`. Big downloadable CSVs live in Supabase **Storage**, served via
  `functions/api/download.js`.

There is **no Next.js / no Node server in production**. Do not reintroduce one.

---

## 1. Prerequisites

**Accounts** (all have free tiers sufficient for this):
- **Supabase** — Postgres + Storage.
- **Cloudflare** — Pages (static hosting) + Pages Functions + KV.
- **GitHub** — hosts the repo; Cloudflare Pages deploys from it via Git integration.

**Local tools**:
- Node.js 18+ and npm. (`wrangler` is installed as a dev dependency via `npm install` —
  you do not need it globally; use `npx wrangler ...`.)

**The data** — see §2. This is the one input you cannot generate from nothing.

---

## 2. Get the data (do this before touching Supabase)

The pipeline loads from **derived snapshots** in `Data/Derived/`:
- `Data/Derived/backtest-runtime.json` — manifest + benchmarks + risk-free + names.
- `Data/Derived/universe-<all|top500|top300>-<year>.json` — the per-year panel chunks
  (these are **gitignored** and are NOT in the repo).

You have three ways to obtain them, in order of preference:

1. **You have the source CSVs.** Place the raw monthly stock-level CSVs where
   `src/server/factor-config.js` → `UNIVERSE_FILES` expects them
   (`Data/Updated_Factor_Data/...`) plus `Data/Factor_Data/finalMonthlyLabels_aman.csv`,
   then run:
   ```bash
   npm run data:derive      # writes Data/Derived/backtest-runtime.json + universe-*.json
   ```

2. **You can read another project's Storage** (e.g. the lab's existing Supabase). The
   loader in §4 can pull the chunks straight from that bucket — you do not need them on
   disk. Set `PANEL_SOURCE_SUPABASE_URL` + `PANEL_SOURCE_SERVICE_ROLE_KEY` (and optionally
   `PANEL_SOURCE_STORAGE_BUCKET`, default `factor-data`) to that project when you run the
   load. The chunks are stored under `Derived/universe-*.json` (gzip-or-plain; the loader
   tries `.gz` first).

3. **Ask the lab for the `Data/Derived/` snapshots directly** and drop them in place.

> Sanity targets after loading: `all` = 553,959 rows · `top500` = 146,538 ·
> `top300` = 88,612 (≈ 789k total, comfortably under the 500 MB free cap).

---

## 3. Supabase: create the project + apply the schema

1. Create a **new Supabase project**. Region: pick the one closest to your users —
   **`ap-south-1` (Mumbai)** for India. Save the database password.
2. Apply the migrations **in order** (SQL Editor → paste & run, or `supabase db push`):
   - `supabase/migrations/003_factor_panel.sql` — tables.
   - `supabase/migrations/004_run_backtest_legs.sql` — RPCs (`run_backtest_legs`,
     `get_holdings`, `get_universe_meta`).
   - (optional) `supabase/migrations/001_backtest_cache.sql` if you want the persistent
     cache table.
3. From **Settings → API**, copy:
   - **Project URL** → `https://<ref>.supabase.co`
   - **`service_role` secret key** (server-only — NEVER expose in browser code or commit it).

---

## 4. Load the data into Postgres

Run from the repo root. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are the **target**
(new) project. Add `PANEL_SOURCE_*` only if pulling chunks from another project's Storage
(§2 option 2):

```bash
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role key>" \
# optional source, if chunks are not on local disk:
PANEL_SOURCE_SUPABASE_URL="https://<old-ref>.supabase.co" \
PANEL_SOURCE_SERVICE_ROLE_KEY="<old service-role key>" \
npm run data:load
```

Then upload the big **downloadable** files to a Storage bucket named `factor-data` so
`/api/download` works (creates the bucket if missing, gzips large files):

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." npm run data:upload
```

Verify the row counts match the §2 targets (Supabase SQL editor:
`select universe, count(*) from factor_panel group by universe;`).

---

## 5. Test locally (no Cloudflare account needed)

`wrangler pages dev` runs the real Pages Function on your machine against the cloud DB.

1. Create a **`.dev.vars`** file at the repo root (gitignored — never commit it):
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role key>
   SUPABASE_STORAGE_BUCKET=factor-data
   ```
2. Run:
   ```bash
   npm install
   npm run dev        # builds dist/ then serves it + functions on http://127.0.0.1:8788
   ```
3. Open `http://127.0.0.1:8788/backtester`, run a backtest, scrub the slider, toggle
   EW/VW. Results should populate near-instantly (Postgres aggregate + tiny JSON).
   Quick API check:
   ```bash
   curl "http://127.0.0.1:8788/api/backtest?universe=all"          # meta (rowCount, months)
   curl -X POST http://127.0.0.1:8788/api/backtest -H 'content-type: application/json' \
     -d '{"universe":"all","portfolios":[{"id":1,"name":"Small","config":{"strategy":"long_only","longFilters":{"Size":["S"]}}}]}'
   ```

---

## 6. Cloudflare Pages: deploy

**Recommended: Git integration** (auto-deploys on push; free preview URL per branch).

1. Create the KV namespace(s) and paste the ids into `wrangler.toml`
   (replace the `REPLACE_WITH_*_KV_ID` placeholders):
   ```bash
   npx wrangler kv namespace create BACKTEST_KV
   npx wrangler kv namespace create BACKTEST_KV --preview
   ```
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git** →
   select this repo. Build settings:
   - **Framework preset**: None
   - **Build command**: `node scripts/build-site.mjs`
   - **Build output directory**: `dist`
3. Set **environment variables / secrets** for **both Production and Preview**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`  (server-only secret)
   - `SUPABASE_STORAGE_BUCKET` = `factor-data`
4. Deploy a **branch first**, validate on its `*.pages.dev` preview URL, then merge to
   `main` for production.
5. If this repo previously used **GitHub Pages**, turn it OFF (it can't run the Function
   and would keep serving the old static-only site).

> Alternative (fastest one-off, no Git wiring): `npx wrangler login` then
> `npm run deploy` (= build + `wrangler pages deploy dist`). You still must set the env
> vars + KV binding on the project, then redeploy so they apply.

---

## 7. Keep-warm (free Supabase pauses after ~7 days idle)

Set a repo **variable** `PAGES_URL` (Settings → Secrets and variables → Actions →
Variables) to your production URL, e.g. `https://<project>.pages.dev`. The
`.github/workflows/keep-warm.yml` Action then pings `/api/backtest?warm=1` daily.
(Cloudflare Pages Functions cannot run cron themselves, which is why this is a GitHub
Action.)

---

## 8. Gotchas we actually hit (read if something fails)

- **Node/wrangler `fetch failed` → `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.** You are behind
  a corporate TLS-inspecting proxy whose root CA macOS/Linux trusts but Node's bundled CA
  store does not. Export the system trust store and point Node at it — this is **local
  only; Cloudflare's edge → Supabase needs none of it**:
  ```bash
  # macOS:
  security find-certificate -a -p /Library/Keychains/System.keychain > /tmp/ca.pem
  security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >> /tmp/ca.pem
  export NODE_EXTRA_CA_CERTS=/tmp/ca.pem            # prefix the loader / `npm run dev` with this
  ```
  (Node 22.15+/23 can instead use `--use-system-ca`.)
- **`compatibility_date ... but the newest date supported by this server binary is ...`**
  Your local `wrangler`/`workerd` is older than `wrangler.toml`'s `compatibility_date`.
  Either lower the date to one the local binary supports, or `npm i -D wrangler@latest`.
  Any date Cloudflare's edge supports is fine in production.
- **KV placeholder ids.** `wrangler.toml` ships with `REPLACE_WITH_*_KV_ID`. Replace them
  with real ids (step 6.1) before deploying, or the binding fails. The Function tolerates
  KV being *absent* (caching no-ops), but not an *invalid* id.
- **Static pages return HTTP 308.** Expected — Cloudflare Pages "pretty URLs" redirect
  `/foo.html` → `/foo`. Follow the redirect; it serves 200.
- **Free Supabase has a 2-active-project limit per owner.** Creating a new project may
  require pausing/deleting an unused one first.

---

## 9. Verification checklist

- [ ] `factor_panel` row counts match §2 targets.
- [ ] `GET /api/backtest?universe=all` returns `ok:true` with `rowCount`/`months`.
- [ ] `POST /api/backtest` returns metrics; an identical repeat returns `cache:"kv"` in a
      few ms.
- [ ] `/backtester` loads, runs a backtest, and the month slider / EW-VW toggle update.
- [ ] `/api/download?file=Data/Factor_Data/ff5.csv` (and the big files) redirect to a
      signed Storage URL.
- [ ] (optional) `npm run backtest:smoke` — the legacy Node engine oracle; compare its
      equity curves/metrics against the new path for a few preset portfolios.

---

## 10. Rollback & account portability

- **Cloudflare Pages keeps every deployment** — one-click "Rollback to this deployment".
- **The database is reproducible** — schema is in `supabase/migrations/*.sql`; the panel
  reloads from the derived snapshots via `npm run data:load`. Keep a `pg_dump` after the
  first good load if you want a fast restore.
- **Secrets live only in Cloudflare env vars + local `.dev.vars`** (gitignored) — rolling
  back code never risks leaking or losing them.
- **Moving to another account** = create a new Pages project in the new account, connect
  the *same* repo, recreate the KV namespace, and copy the env vars (~15 min). The
  `*.pages.dev` subdomain changes; nothing in the code does.
