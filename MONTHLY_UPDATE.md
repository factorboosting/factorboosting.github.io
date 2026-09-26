# 📅 Monthly Data Update Guide

This document explains how to update the website with new monthly factor data.  
After following these steps, the following will all be updated automatically:

- ✅ The **Analysis / Backtester page** (default end date moves to new month)
- ✅ The **Downloadable CSV files** (ff5, BM_Size, OP_Size, INV_Size, MOM_Size)
- ✅ The **Download section date labels** on the homepage
- ✅ **Supabase storage** (the live database powering the website)

---

## What you need each month

You need to update **two source files** before running the automation:

| File | What it is | Where to get it |
|---|---|---|
| `Data/Factor_Data/firm_labels_top500_XXX.csv` | Monthly factor labels (BM, OP, INV, MOM, Size) for the top-500 universe | Internal research pipeline |
| `Data/NIFTY Total Returns Historical Data.csv` | Nifty 500 TRI benchmark returns | [Investing.com – Nifty 500 TRI](https://www.investing.com/) — export as CSV |

> **Note on file naming:** The label file is referenced in `src/server/factor-config.js`.  
> If you rename it (e.g. `firm_labels_top500_sep.csv`), update the path in that config file too.

---

## Step-by-step

### Step 1 — Place the new label CSV locally

Copy your new `firm_labels_top500_XXX.csv` into `Data/Factor_Data/` and update the path in `src/server/factor-config.js`:

```js
// src/server/factor-config.js
top500: "Data/Factor_Data/firm_labels_top500_sep.csv",   // ← update to new filename
```

---

### Step 2 — Update the Nifty 500 TRI data

1. Go to [Investing.com – NIFTY 500 TRI](https://www.investing.com/)
2. Export the full history as CSV
3. **Replace** the file at `Data/NIFTY Total Returns Historical Data.csv` with the new export

---

### Step 3 — Update the Risk-Free Rate (Rf)

The Rf rate comes from **RBI 91-day T-Bill cut-off yields**. Each month:

1. Go to [RBI Auction Results](https://www.rbi.org.in/Scripts/BS_ViewPDFAuction.aspx) and look up all 91-day T-Bill auctions for the new month
2. Average the cut-off yields (exclude any auction where all bids were rejected)
3. Convert the annualised yield to a **monthly decimal**:
   ```
   Monthly Rf = Annual yield (%) ÷ 12 ÷ 100
   Example:  5.32% annual  →  5.32 / 12 / 100  =  0.004432917
   ```
4. Open `Data/Factor_Data/ff5.csv` and set the `Rf` value for the new month row

> ⚠️ If you skip this step, the script will **carry the previous month's Rf forward** and print a warning.  
> You can always fix it later and re-run `npm run data:update-csvs`.

---

### Step 4 — Run the automation script

From the project root, run:

```bash
npm run data:monthly-update
```

This runs **5 steps automatically** (~3–5 min):

| Step | What it does |
|---|---|
| 1 | Regenerates the backtest runtime JSON from the new label CSV |
| 2 | Appends new month returns to ff5 + portfolio CSVs; calculates SMB, HML, RMW, CMA, WML |
| 3 | Updates "Oct 2003 – **Aug 2026**" date labels on the homepage |
| 4 | Rebuilds the static site (`dist/`) |
| 5 | Uploads all updated files to Supabase storage |

The **Analysis page end date is already dynamic** — it reads the latest month from the runtime JSON automatically. No manual change needed there.

---

### Step 5 — Commit and push to GitHub

```bash
git add -A
git commit -m "data: update to Sep 2026"
git push origin main
```

Cloudflare Pages picks up the push and deploys automatically.

---

## Optional flags

| Command | What it does |
|---|---|
| `SKIP_SUPABASE=true npm run data:monthly-update` | Dry-run — skips the Supabase upload |
| `SKIP_DERIVE=true npm run data:monthly-update` | Skips the slow derive step (if already done) |
| `npm run data:update-csvs` | Only updates the downloadable CSVs (no derive/upload) |

---

## What updates automatically vs manually

| Data | Auto? | Notes |
|---|---|---|
| Portfolio returns (BM, OP, INV, MOM) | ✅ Auto | Computed from label CSV via backtest engine |
| FF5 factors (SMB, HML, RMW, CMA, WML) | ✅ Auto | Derived from portfolio returns using FF formulas |
| MKT return in ff5.csv | ✅ Auto | Pulled from Nifty 500 TRI CSV |
| Risk-free rate (Rf) in ff5.csv | ⚠️ Manual | Enter from RBI T-Bill data before running script |
| Analysis page end date | ✅ Auto | Reads dynamically from runtime JSON |
| Homepage date labels | ✅ Auto | Updated by `monthly-update.mjs` step 3 |
| Supabase storage | ✅ Auto | |
| GitHub repo | ❌ Manual | `git add -A && git commit && git push` |

---

## Relevant scripts

| Script | Purpose |
|---|---|
| `scripts/monthly-update.mjs` | **Main entry point** — runs all 5 steps |
| `scripts/update-download-csvs.mjs` | Updates ff5 + portfolio CSVs, calculates factors |
| `scripts/generate-backtest-derived.mjs` | Builds runtime JSON from label CSVs |
| `scripts/upload-data-to-supabase-storage.mjs` | Syncs all files to Supabase |
| `scripts/build-site.mjs` | Builds `dist/` for deployment |

## Relevant data files

| File | Purpose |
|---|---|
| `Data/Factor_Data/ff5.csv` | Downloadable Fama-French 5-factor data |
| `Data/Factor_Data/BM_Size.csv` | Book-to-Market 2×3 sort portfolios |
| `Data/Factor_Data/OP_Size.csv` | Profitability 2×3 sort portfolios |
| `Data/Factor_Data/INV_Size.csv` | Investment 2×3 sort portfolios |
| `Data/Factor_Data/MOM_Size.csv` | Momentum 2×3 sort portfolios |
| `Data/Factor_Data/firm_labels_top500_XXX.csv` | Raw monthly factor labels (input) |
| `Data/NIFTY Total Returns Historical Data.csv` | Nifty 500 TRI benchmark (input) |
| `src/server/factor-config.js` | Universe file paths — update filename here each month |
