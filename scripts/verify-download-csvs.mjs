import { readFileSync } from "node:fs";
import path from "node:path";
import { computeBacktest } from "../src/server/backtest-engine.js";

const ROOT = path.resolve(process.cwd());
const FF5_PATH = path.join(ROOT, "Data/Factor_Data/ff5.csv");
const TOLERANCE = 1e-12;

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

const factorSpecs = [
  ["SMB", { Size: ["S"] }, { Size: ["B"] }],
  ["HML", { "Book-to-Market": ["V"] }, { "Book-to-Market": ["G"] }],
  ["WML", { Momentum: ["W"] }, { Momentum: ["L"] }],
  ["RMW", { Profitability: ["R"] }, { Profitability: ["W"] }],
  ["CMA", { Investment: ["C"] }, { Investment: ["A"] }],
];

const ff5Rows = parseCsv(readFileSync(FF5_PATH, "utf8"));
if (ff5Rows.length === 0) throw new Error("ff5.csv has no data rows.");

const startMonth = ff5Rows[0].Month;
const endMonth = ff5Rows.at(-1).Month;
const result = await computeBacktest({
  activeBenchmarkId: "nifty500",
  endMonth,
  holdingsMonths: [],
  portfolios: factorSpecs.map(([name, longFilters, shortFilters], index) => ({
    colorIdx: index,
    config: { strategy: "long_short", longFilters, shortFilters },
    factorLabel: name,
    id: index + 1,
    name,
  })),
  startMonth,
  transactionCost: { mode: "none" },
  universe: "all",
});

const ff5ByMonth = new Map(ff5Rows.map((row) => [row.Month, row]));
const mismatches = [];
for (const portfolio of result.portfolios) {
  const factor = portfolio.name;
  for (let index = 0; index < result.months.length; index++) {
    const month = result.months[index];
    const actual = Number.parseFloat(ff5ByMonth.get(month)?.[factor]);
    const expected = portfolio.results.vw_rets[index];
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > TOLERANCE) {
      mismatches.push({ factor, month, actual, expected });
    }
  }
}

if (mismatches.length > 0) {
  console.error("Download factors do not match the analysis engine:");
  console.error(mismatches.slice(0, 20));
  throw new Error(`${mismatches.length} factor-month mismatch(es) found.`);
}

const cagrEndMonth = endMonth < "2026-05" ? endMonth : "2026-05";
const cagrRows = ff5Rows.filter((row) => row.Month >= "2003-10" && row.Month <= cagrEndMonth);
function cagr(column) {
  const growth = cagrRows.reduce((product, row) => product * (1 + Number(row[column])), 1);
  return (Math.pow(growth, 12 / cagrRows.length) - 1) * 100;
}

console.log(
  `Verified ${result.months.length} months: SMB/HML/WML/RMW/CMA match the analysis engine.`,
);
console.log(`CAGR check (2003-10 to ${cagrEndMonth}, ${cagrRows.length} months):`);
for (const factor of ["MKT", ...factorSpecs.map(([name]) => name)]) {
  console.log(`  ${factor.padEnd(3)} ${cagr(factor).toFixed(2)}%`);
}
