# 📅 Monthly Data Update Guide

This document explains how to update the website with new monthly factor data.  
After following these steps, the following will all be updated automatically:

- ✅ The **Analysis / Backtester page** (default end date moves to new month)
- ✅ The **Downloadable CSV files** (ff5, BM_Size, OP_Size, INV_Size, MOM_Size)
- ✅ The **Download section date labels** on the homepage
- ✅ **Supabase storage** (the live database powering the website)

---

## What you need each month

Update **five source files** before running the automation script:

| # | File to update | What it is | Source |
|---|---|---|---|
| 1 | `Data/Factor_Data/firm_labels_top500_XXX.csv` | Monthly factor labels (BM, OP, INV, MOM, Size) for top-500 universe | Internal research pipeline |
| 2 | `Data/NIFTY Total Returns Historical Data.csv` | Nifty 50 **Total Return Index** (TRI) — used as the Nifty 50 benchmark | [Investing.com – NIFTY TRI](https://in.investing.com/indices/s-p-cnx-nifty-total-returns) |
| 3 | `Data/Nifty 50 Historical Data.csv` | Nifty 50 **Price Index** — used as the Nifty 50 price return benchmark | [Investing.com – Nifty 50](https://in.investing.com/indices/s-p-cnx-nifty) |
| 4 | `Data/Nifty 500 Historical Data.csv` | Nifty 500 **Price/Total Return Index** — used as the broad market benchmark | [Investing.com – Nifty 500](https://in.investing.com/indices/nifty-500) |
| 5 | `Data/Factor_Data/ff5.csv` — `Rf` column | Risk-free rate (monthly) from RBI 91-day T-Bill yields | [RBI Auction Results](https://www.rbi.org.in/Scripts/BS_ViewPDFAuction.aspx) |

---

## Step-by-step

### Step 1 — Update the three benchmark index CSVs

For each of the three Investing.com files:

1. Go to the relevant Investing.com page (links in table above)
2. Click **Download Data** (top-right of the historical data table)
3. Export as CSV — choose the **maximum available date range**
4. **Replace** the existing file in `Data/` with the new download:
   - The new Nifty TRI download → **replaces** `Data/NIFTY Total Returns Historical Data.csv`
   - The new Nifty 50 download → **replaces** `Data/Nifty 50 Historical Data.csv`
   - The new Nifty 500 download → **replaces** `Data/Nifty 500 Historical Data.csv`

> ⚠️ Keep the **exact same filename** — the scripts reference these files by name.

---

### Step 2 — Place the new label CSV

Copy your new `firm_labels_top500_XXX.csv` into `Data/Factor_Data/` and update the path in `src/server/factor-config.js`:

```js
// src/server/factor-config.js  (line ~73)
top500: "Data/Factor_Data/firm_labels_top500_sep.csv",  // ← update to new filename
```

---

### Step 3 — Update the Risk-Free Rate (Rf)

The Rf rate comes from **RBI 91-day T-Bill cut-off yields**. Each month:

1. Go to [RBI Auction Results](https://www.rbi.org.in/Scripts/BS_ViewPDFAuction.aspx)
2. Find all **91-day T-Bill auctions** for the new month
3. Average the cut-off yields (exclude any auction where all bids were rejected)
4. Convert to a **monthly decimal**:
   ```
   Monthly Rf = Annual yield (%) ÷ 12 ÷ 100
   Example:  5.32% annual  →  5.32 / 12 / 100  =  0.004432917
   ```
5. Open `Data/Factor_Data/ff5.csv` and update the `Rf` cell for the new month

> ⚠️ If you skip this step, the script will **carry the previous month's Rf forward** and print a warning. You can always correct it later and re-run `npm run data:update-csvs`.

---

### Step 4 — Run the automation script

From the project root directory, run:

```bash
npm run data:monthly-update
```

This runs **5 steps automatically** (takes ~3–5 minutes):

| Step | What it does |
|---|---|
| 1 | Regenerates the backtest runtime JSON from the new label + benchmark CSVs |
| 2 | Appends new month returns to ff5 + portfolio CSVs; auto-calculates SMB, HML, RMW, CMA, WML |
| 3 | Updates date labels on the homepage (e.g. "Oct 2003 – Aug 2026" → "Sep 2026") |
| 4 | Rebuilds the static site (`dist/`) |
| 5 | Uploads all updated files to Supabase storage |

> The **Analysis page end date updates automatically** — it reads the latest month from the runtime JSON dynamically. No manual change needed there.

---

### Step 5 — Commit and push to GitHub

```bash
git add -A
git commit -m "data: update to Sep 2026"
git push origin main
```

Cloudflare Pages picks up the push and deploys the site automatically.

---

## Optional flags

| Command | What it does |
|---|---|
| `SKIP_SUPABASE=true npm run data:monthly-update` | Dry-run — skips the Supabase upload |
| `SKIP_DERIVE=true npm run data:monthly-update` | Skips the slow derive step (if already done separately) |
| `npm run data:update-csvs` | Only updates the downloadable CSVs (no derive/upload/build) |

---

## What updates automatically vs manually

| Data | Auto? | Notes |
|---|---|---|
| Portfolio returns (BM, OP, INV, MOM) | ✅ Auto | Computed from label CSV via backtest engine |
| FF5 factors (SMB, HML, RMW, CMA, WML) | ✅ Auto | Derived from portfolio returns using FF formulas |
| MKT return in ff5.csv | ✅ Auto | Pulled from Nifty 500 TRI CSV |
| Nifty 50 / 500 benchmark history | ✅ Auto | Read from the three CSVs you replace in Step 1 |
| Risk-free rate (Rf) in ff5.csv | ⚠️ Manual | Enter from RBI T-Bill data (Step 3) |
| Analysis page end date | ✅ Auto | Reads dynamically from runtime JSON |
| Homepage date labels | ✅ Auto | Updated by `monthly-update.mjs` step 3 |
| Supabase storage | ✅ Auto | |
| GitHub repo | ❌ Manual | `git add -A && git commit && git push` |

---

## Checklist (copy this each month)

```
Month: ___________

[ ] 1. Downloaded and replaced NIFTY Total Returns Historical Data.csv
[ ] 2. Downloaded and replaced Nifty 50 Historical Data.csv
[ ] 3. Downloaded and replaced Nifty 500 Historical Data.csv
[ ] 4. Placed new firm_labels_top500_XXX.csv in Data/Factor_Data/
[ ] 5. Updated factor-config.js with new label filename
[ ] 6. Updated Rf in ff5.csv from RBI T-Bill data
[ ] 7. Ran: npm run data:monthly-update
[ ] 8. Verified no ⚠️ warnings in script output
[ ] 9. git add -A && git commit -m "data: update to XXX YYYY" && git push
```

---

## Relevant scripts

| Script | npm command | Purpose |
|---|---|---|
| `scripts/monthly-update.mjs` | `npm run data:monthly-update` | **Main entry point** — runs all 5 steps |
| `scripts/update-download-csvs.mjs` | `npm run data:update-csvs` | Updates ff5 + portfolio CSVs, calculates factors |
| `scripts/generate-backtest-derived.mjs` | `npm run data:derive` | Builds runtime JSON from label + benchmark CSVs |
| `scripts/upload-data-to-supabase-storage.mjs` | `npm run data:upload` | Syncs all files to Supabase |
| `scripts/build-site.mjs` | `npm run build` | Builds `dist/` for deployment |

## Relevant data files

| File | Role |
|---|---|
| `Data/NIFTY Total Returns Historical Data.csv` | Nifty 50 TRI benchmark **[update monthly]** |
| `Data/Nifty 50 Historical Data.csv` | Nifty 50 price index benchmark **[update monthly]** |
| `Data/Nifty 500 Historical Data.csv` | Nifty 500 TRI benchmark **[update monthly]** |
| `Data/Factor_Data/firm_labels_top500_XXX.csv` | Raw monthly factor labels (input) **[update monthly]** |
| `Data/Factor_Data/ff5.csv` | Downloadable Fama-French 5-factor data |
| `Data/Factor_Data/BM_Size.csv` | Book-to-Market 2×3 sort portfolios |
| `Data/Factor_Data/OP_Size.csv` | Profitability 2×3 sort portfolios |
| `Data/Factor_Data/INV_Size.csv` | Investment 2×3 sort portfolios |
| `Data/Factor_Data/MOM_Size.csv` | Momentum 2×3 sort portfolios |
| `src/server/factor-config.js` | Universe file paths — **update label filename here each month** |
