/**
 * update-download-csvs.mjs
 *
 * Updates all downloadable CSV files with the latest data:
 *  1. ff5.csv  - replaces MKT column with Nifty 500 TRI returns and appends
 *                missing months (Jun-Aug 2026, or whatever the runtime has).
 *  2. BM_Size / OP_Size / INV_Size / MOM_Size - regenerates every month by
 *                running the JS backtest engine for each 2x3 sort portfolio.
 *  3. Recalculates every FF factor month from eligible, matched 2x3 cells.
 *
 * Usage:
 *   node scripts/update-download-csvs.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { computeBacktest } from "../src/server/backtest-engine.js";

function parseCSVRows(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const headers = lines[0].split(",");
  return {
    headers,
    rows: lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
      return obj;
    }),
  };
}

function rowsToCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => row[h] ?? "").join(","));
  }
  return lines.join("\n") + "\n";
}

function parseFiniteCell(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Match the analysis engine's n<5 and size-neutrality rules. A size bucket is
// eligible only when both sides of the spread survived the five-firm minimum.
// The engine averages the remaining paired spreads and emits 0 when none remain.
function pairedSpread(row, pairs) {
  const eligibleSpreads = [];
  for (const [longColumn, shortColumn] of pairs) {
    const longReturn = parseFiniteCell(row?.[longColumn]);
    const shortReturn = parseFiniteCell(row?.[shortColumn]);
    if (longReturn != null && shortReturn != null) {
      eligibleSpreads.push(longReturn - shortReturn);
    }
  }

  if (eligibleSpreads.length === 0) return 0;
  return eligibleSpreads.reduce((sum, value) => sum + value, 0) / eligibleSpreads.length;
}

const ROOT = path.resolve(process.cwd());
const runtimePath = path.join(ROOT, "src/worker/backtest-runtime-data.js");
const runtimeModule = await import(runtimePath);
const runtime = runtimeModule.default;
const benchmarkByMonth = runtime.benchmarkByMonth;
const rfData = runtime.rfData;

console.log("Loaded runtime data.");
console.log(
  "  Latest nifty500 months:",
  Object.keys(benchmarkByMonth)
    .filter((m) => benchmarkByMonth[m].nifty500 != null)
    .sort()
    .slice(-5)
);

// ---------------------------------------------------------------------------
// 1. Update ff5.csv - replace MKT with Nifty 500 TRI and add new months
// ---------------------------------------------------------------------------
const FF5_PATH = path.join(ROOT, "Data/Factor_Data/ff5.csv");
const ff5Text = readFileSync(FF5_PATH, "utf8");
const { headers: ff5Headers, rows: ff5Rows } = parseCSVRows(ff5Text);

const ff5MonthSet = new Set(ff5Rows.map((r) => r.Month));

// Replace MKT with nifty500 TRI for all existing rows
for (const row of ff5Rows) {
  const n500 = benchmarkByMonth[row.Month]?.nifty500;
  if (n500 != null) {
    row.MKT = String(n500);
  }
  const rf = rfData[row.Month];
  if (rf != null) {
    row.Rf = String(rf);
  }
}

const factorMonths = ff5Rows.map((r) => r.Month).sort();
const latestFactorMonth = factorMonths[factorMonths.length - 1];

// Append months that exist in TRI data but not yet in ff5
const newMonths = Object.keys(benchmarkByMonth)
  .filter(
    (m) =>
      m > latestFactorMonth &&
      benchmarkByMonth[m].nifty500 != null &&
      !ff5MonthSet.has(m)
  )
  .sort();

// Find the last known Rf to use as a carry-forward fallback
const lastKnownRf = ff5Rows
  .slice()
  .reverse()
  .find((r) => r.Rf && r.Rf !== "")?.Rf ?? null;

for (const m of newMonths) {
  const n500 = benchmarkByMonth[m].nifty500;
  const rf = rfData[m];
  // If runtime doesn't have Rf for this month yet, carry forward the last known
  // value as a placeholder. Log a clear warning so the operator can verify.
  const rfValue = rf != null ? String(rf) : lastKnownRf;
  const rfSource = rf != null ? "runtime" : "carried-forward (⚠️  verify manually)";
  ff5Rows.push({
    Month: m,
    SMB: "",
    HML: "",
    WML: "",
    RMW: "",
    CMA: "",
    MKT: String(n500),
    Rf: rfValue ?? "",
  });
  console.log(
    "  ff5: appended " + m +
    " - MKT=" + (n500 * 100).toFixed(4) + "%" +
    " Rf=" + (rfValue != null ? (parseFloat(rfValue) * 100).toFixed(4) + "% [" + rfSource + "]" : "N/A")
  );
}

ff5Rows.sort((a, b) => a.Month.localeCompare(b.Month));
writeFileSync(FF5_PATH, rowsToCsv(ff5Headers, ff5Rows), "utf8");
console.log("ff5.csv updated (" + ff5Rows.length + " rows, last: " + ff5Rows[ff5Rows.length - 1].Month + ")");

// ---------------------------------------------------------------------------
// 2. Update portfolio sort files
// ---------------------------------------------------------------------------
const SORT_PORTFOLIOS = [
  {
    file: "Data/Factor_Data/BM_Size.csv",
    portfolios: [
      { name: "SV", config: { longFilters: { Size: ["S"], "Book-to-Market": ["V"] } } },
      { name: "SN", config: { longFilters: { Size: ["S"], "Book-to-Market": ["N"] } } },
      { name: "SG", config: { longFilters: { Size: ["S"], "Book-to-Market": ["G"] } } },
      { name: "BV", config: { longFilters: { Size: ["B"], "Book-to-Market": ["V"] } } },
      { name: "BN", config: { longFilters: { Size: ["B"], "Book-to-Market": ["N"] } } },
      { name: "BG", config: { longFilters: { Size: ["B"], "Book-to-Market": ["G"] } } },
    ],
  },
  {
    file: "Data/Factor_Data/OP_Size.csv",
    portfolios: [
      { name: "SR", config: { longFilters: { Size: ["S"], "Profitability": ["R"] } } },
      { name: "SN", config: { longFilters: { Size: ["S"], "Profitability": ["N"] } } },
      { name: "SW", config: { longFilters: { Size: ["S"], "Profitability": ["W"] } } },
      { name: "BR", config: { longFilters: { Size: ["B"], "Profitability": ["R"] } } },
      { name: "BN", config: { longFilters: { Size: ["B"], "Profitability": ["N"] } } },
      { name: "BW", config: { longFilters: { Size: ["B"], "Profitability": ["W"] } } },
    ],
  },
  {
    file: "Data/Factor_Data/INV_Size.csv",
    portfolios: [
      { name: "SC", config: { longFilters: { Size: ["S"], Investment: ["C"] } } },
      { name: "SN", config: { longFilters: { Size: ["S"], Investment: ["N"] } } },
      { name: "SA", config: { longFilters: { Size: ["S"], Investment: ["A"] } } },
      { name: "BC", config: { longFilters: { Size: ["B"], Investment: ["C"] } } },
      { name: "BN", config: { longFilters: { Size: ["B"], Investment: ["N"] } } },
      { name: "BA", config: { longFilters: { Size: ["B"], Investment: ["A"] } } },
    ],
  },
  {
    file: "Data/Factor_Data/MOM_Size.csv",
    portfolios: [
      { name: "SW_mom", config: { longFilters: { Size: ["S"], Momentum: ["W"] } } },
      { name: "SN_mom", config: { longFilters: { Size: ["S"], Momentum: ["N"] } } },
      { name: "SL_mom", config: { longFilters: { Size: ["S"], Momentum: ["L"] } } },
      { name: "BW_mom", config: { longFilters: { Size: ["B"], Momentum: ["W"] } } },
      { name: "BN_mom", config: { longFilters: { Size: ["B"], Momentum: ["N"] } } },
      { name: "BL_mom", config: { longFilters: { Size: ["B"], Momentum: ["L"] } } },
    ],
  },
];

for (const sort of SORT_PORTFOLIOS) {
  const filePath = path.join(ROOT, sort.file);
  if (!existsSync(filePath)) {
    console.warn("File not found, skipping: " + sort.file);
    continue;
  }

  const text = readFileSync(filePath, "utf8");
  const { headers } = parseCSVRows(text);
  console.log("\nRegenerating " + sort.file + " from the analysis engine...");

  // The engine caps at 5 portfolios. Split into two batches of 3 (Small, Big).
  const smallPortfolios = sort.portfolios.filter((p) => p.name.startsWith("S"));
  const bigPortfolios   = sort.portfolios.filter((p) => p.name.startsWith("B"));

  async function runBatch(batchPortfolios) {
    return computeBacktest({
      activeBenchmarkId: "nifty500",
      endMonth: null,
      holdingsMonths: [],
      portfolios: batchPortfolios.map((p, i) => ({
        colorIdx: i, config: p.config, factorLabel: "", id: i + 1, name: p.name,
      })),
      startMonth: "2003-10",
      transactionCost: { mode: "none" },
      universe: "all",
    });
  }

  let smallRes, bigRes;
  try {
    smallRes = await runBatch(smallPortfolios);
    bigRes   = await runBatch(bigPortfolios);
  } catch (err) {
    console.error("Backtest failed for " + sort.file + ": " + err.message);
    continue;
  }

  const months = smallRes.months; // same months for both batches
  const colNames = sort.portfolios.map((p) => p.name);

  // Merge both batch results into a single month→col→value map
  const returnsByMonth = {};
  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi];
    returnsByMonth[m] = {};
    for (let bi = 0; bi < smallRes.portfolios.length; bi++) {
      const ret   = smallRes.portfolios[bi].results.vw_rets[mi];
      const count = smallRes.portfolios[bi].results.longCounts?.[mi] ?? 0;
      const name  = smallPortfolios[bi].name;
      // Apply the same n<5 eligibility rule as the analysis engine. Do not use
      // ret===0 as the signal: a valid portfolio can genuinely return zero.
      returnsByMonth[m][name] = count < 5 ? "" : (ret ?? "");
    }
    for (let bi = 0; bi < bigRes.portfolios.length; bi++) {
      const ret   = bigRes.portfolios[bi].results.vw_rets[mi];
      const count = bigRes.portfolios[bi].results.longCounts?.[mi] ?? 0;
      const name  = bigPortfolios[bi].name;
      returnsByMonth[m][name] = count < 5 ? "" : (ret ?? "");
    }
  }

  const regeneratedRows = [];
  for (const m of months) {
    const ret = returnsByMonth[m];
    const newRow = { Month: m };
    for (const col of colNames) {
      const v = ret[col];
      newRow[col] = v !== "" && v != null ? String(v) : "";
    }
    regeneratedRows.push(newRow);
  }

  writeFileSync(filePath, rowsToCsv(headers, regeneratedRows), "utf8");
  const blankCells = regeneratedRows.reduce(
    (total, row) => total + colNames.filter((column) => row[column] === "").length,
    0,
  );
  console.log(
    sort.file + " regenerated (" + regeneratedRows.length + " rows, " +
    blankCells + " n<5 cells, last: " + regeneratedRows.at(-1).Month + ")"
  );
}

// ---------------------------------------------------------------------------
// 3. Fill missing Fama-French Factor Returns in ff5.csv
// ---------------------------------------------------------------------------
console.log("\nRecalculating all factor returns for ff5.csv...");
const bmData = parseCSVRows(readFileSync(path.join(ROOT, "Data/Factor_Data/BM_Size.csv"), "utf8")).rows;
const opData = parseCSVRows(readFileSync(path.join(ROOT, "Data/Factor_Data/OP_Size.csv"), "utf8")).rows;
const invData = parseCSVRows(readFileSync(path.join(ROOT, "Data/Factor_Data/INV_Size.csv"), "utf8")).rows;
const momData = parseCSVRows(readFileSync(path.join(ROOT, "Data/Factor_Data/MOM_Size.csv"), "utf8")).rows;

const indexByMonth = (rows) => rows.reduce((acc, r) => { acc[r.Month] = r; return acc; }, {});
const bm = indexByMonth(bmData);
const op = indexByMonth(opData);
const inv = indexByMonth(invData);
const mom = indexByMonth(momData);

const factorDefinitions = {
  SMB: { rows: bm, pairs: [["SV", "BV"], ["SN", "BN"], ["SG", "BG"]] },
  HML: { rows: bm, pairs: [["SV", "SG"], ["BV", "BG"]] },
  WML: { rows: mom, pairs: [["SW_mom", "SL_mom"], ["BW_mom", "BL_mom"]] },
  RMW: { rows: op, pairs: [["SR", "SW"], ["BR", "BW"]] },
  CMA: { rows: inv, pairs: [["SC", "SA"], ["BC", "BA"]] },
};

let factorRowsUpdated = 0;
for (const row of ff5Rows) {
  const m = row.Month;
  if (!Object.values(factorDefinitions).every((definition) => definition.rows[m])) {
    console.warn("  Missing 2x3 portfolio data for " + m + "; retaining existing FF factors.");
    continue;
  }

  for (const [factor, definition] of Object.entries(factorDefinitions)) {
    row[factor] = String(pairedSpread(definition.rows[m], definition.pairs));
  }
  factorRowsUpdated++;
}

if (factorRowsUpdated > 0) {
  writeFileSync(FF5_PATH, rowsToCsv(ff5Headers, ff5Rows), "utf8");
  console.log(
    "ff5.csv recalculated for " + factorRowsUpdated +
    " months using matched n>=5 size buckets."
  );
}

console.log("\nAll download CSVs updated.");
const latestMonth = ff5Rows[ff5Rows.length - 1].Month;
const [yr, mo] = latestMonth.split("-");
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
console.log("Latest month: " + latestMonth + " -> \"" + monthNames[parseInt(mo) - 1] + " " + yr + "\" for HTML labels");
