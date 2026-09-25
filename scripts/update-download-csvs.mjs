/**
 * update-download-csvs.mjs
 *
 * Updates all downloadable CSV files with the latest data:
 *  1. ff5.csv  - replaces MKT column with Nifty 500 TRI returns and appends
 *                missing months (Jun-Aug 2026, or whatever the runtime has).
 *  2. BM_Size / OP_Size / INV_Size / MOM_Size - appends missing months by
 *                running the JS backtest engine for each 2x3 sort portfolio.
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

for (const m of newMonths) {
  const n500 = benchmarkByMonth[m].nifty500;
  const rf = rfData[m];
  ff5Rows.push({
    Month: m,
    SMB: "",
    HML: "",
    WML: "",
    RMW: "",
    CMA: "",
    MKT: String(n500),
    Rf: rf != null ? String(rf) : "",
  });
  console.log(
    "  ff5: appended " + m + " - MKT=" + (n500 * 100).toFixed(4) + "% Rf=" + (rf != null ? (rf * 100).toFixed(4) + "%" : "N/A")
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
  const { headers, rows } = parseCSVRows(text);
  const existingMonths = new Set(rows.map((r) => r.Month));
  const lastMonth = [...existingMonths].sort().pop();

  console.log("\nRunning backtest for " + sort.file + " (last month: " + lastMonth + ")...");

  let response;
  try {
    response = await computeBacktest({
      activeBenchmarkId: "nifty500",
      endMonth: null,
      holdingsMonths: [],
      portfolios: sort.portfolios.map((p, i) => ({
        colorIdx: i,
        config: p.config,
        factorLabel: "",
        id: i + 1,
        name: p.name,
      })),
      startMonth: "2003-10",
      transactionCost: { mode: "none" },
      universe: "top500",
    });
  } catch (err) {
    console.error("Backtest failed for " + sort.file + ": " + err.message);
    continue;
  }

  const { months, portfolios } = response;
  const colNames = sort.portfolios.map((p) => p.name);

  const returnsByMonth = {};
  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi];
    returnsByMonth[m] = {};
    for (let pi = 0; pi < portfolios.length; pi++) {
      const vwRets = portfolios[pi].results.vw_rets;
      returnsByMonth[m][colNames[pi]] = vwRets[mi] ?? "";
    }
  }

  const newPortfolioMonths = months.filter((m) => m > lastMonth).sort();

  if (newPortfolioMonths.length === 0) {
    console.log("  No new months to add for " + sort.file);
    continue;
  }

  for (const m of newPortfolioMonths) {
    const ret = returnsByMonth[m];
    const newRow = { Month: m };
    for (const col of colNames) {
      newRow[col] = ret[col] != null ? String(ret[col]) : "";
    }
    rows.push(newRow);
    console.log(
      "  Appended " + m + ": " + colNames.map((c) => c + "=" + (+newRow[c] * 100).toFixed(2) + "%").join(", ")
    );
  }

  rows.sort((a, b) => a.Month.localeCompare(b.Month));
  writeFileSync(filePath, rowsToCsv(headers, rows), "utf8");
  console.log(sort.file + " updated (" + rows.length + " rows, last: " + rows[rows.length - 1].Month + ")");
}

console.log("\nAll download CSVs updated.");
const latestMonth = ff5Rows[ff5Rows.length - 1].Month;
const [yr, mo] = latestMonth.split("-");
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
console.log("Latest month: " + latestMonth + " -> \"" + monthNames[parseInt(mo) - 1] + " " + yr + "\" for HTML labels");
