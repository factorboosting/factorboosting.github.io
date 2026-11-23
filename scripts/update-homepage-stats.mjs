/**
 * Refresh the homepage's static return tables from the same data used by the
 * analysis engine. Run this after update-download-csvs.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeBacktest } from "../src/server/backtest-engine.js";

const ROOT = path.resolve(process.cwd());
const HTML_PATH = path.join(ROOT, "public/index.html");

function parseCsv(relativePath) {
  const lines = readFileSync(path.join(ROOT, relativePath), "utf8")
    .replace(/\r/g, "")
    .trim()
    .split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function trailingReturn(values, count) {
  const trailing = values.slice(-count);
  if (trailing.length !== count || trailing.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return trailing.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function summarize(values) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (finiteValues.length < 12) throw new Error("At least 12 monthly returns are required.");
  return [finiteValues.at(-1), trailingReturn(finiteValues, 3), trailingReturn(finiteValues, 12)];
}

function formatReturn(value) {
  if (!Number.isFinite(value)) return { className: "", text: "N/A" };
  let percent = value * 100;
  if (Math.abs(percent) < 0.005) percent = 0;
  return {
    className: percent < 0 ? "negative" : "positive",
    text: `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`,
  };
}

function textContent(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceTableBody(html, marker, statsByLabel, firstStatsCell) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Homepage table marker not found: ${marker}`);
  const previousTbody = html.lastIndexOf("<tbody", markerIndex);
  const previousTbodyOpenEnd = previousTbody === -1 ? -1 : html.indexOf(">", previousTbody);
  const markerIsInTbodyTag =
    previousTbody !== -1 && markerIndex >= previousTbody && markerIndex <= previousTbodyOpenEnd;
  const tbodyStart = markerIsInTbodyTag ? previousTbody : html.indexOf("<tbody", markerIndex);
  const tbodyOpenEnd = html.indexOf(">", tbodyStart) + 1;
  const tbodyEnd = html.indexOf("</tbody>", tbodyOpenEnd);
  if (tbodyStart === -1 || tbodyOpenEnd === 0 || tbodyEnd === -1) {
    throw new Error(`Homepage table body not found after marker: ${marker}`);
  }

  const body = html.slice(tbodyOpenEnd, tbodyEnd);
  let updatedRows = 0;
  const updatedBody = body.replace(/<tr>([\s\S]*?)<\/tr>/g, (row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    if (cells.length < firstStatsCell + 3) return row;
    const label = textContent(cells[0][1]);
    const stats = statsByLabel.get(label);
    if (!stats) return row;

    let cellIndex = 0;
    const updatedRow = row.replace(/<td([^>]*)>([\s\S]*?)<\/td>/g, (cell, attributes) => {
      const currentIndex = cellIndex++;
      if (currentIndex < firstStatsCell || currentIndex >= firstStatsCell + 3) return cell;
      const { className, text } = formatReturn(stats[currentIndex - firstStatsCell]);
      return `<td${className ? ` class="${className}"` : ""}>${text}</td>`;
    });
    updatedRows++;
    return updatedRow;
  });

  if (updatedRows !== statsByLabel.size) {
    throw new Error(
      `Updated ${updatedRows}/${statsByLabel.size} rows for homepage table marker: ${marker}`,
    );
  }
  return html.slice(0, tbodyOpenEnd) + updatedBody + html.slice(tbodyEnd);
}

function statsFromCsv(relativePath, columns) {
  const rows = parseCsv(relativePath);
  return new Map(columns.map(({ column, label }) => [
    label,
    summarize(rows.map((row) => Number.parseFloat(row[column]))),
  ]));
}

function portfolio(name, factor, size, label) {
  return {
    colorIdx: 0,
    config: { longFilters: { Size: [size], [factor]: [label] } },
    factorLabel: "",
    id: name,
    name,
  };
}

async function backtestPortfolios(portfolios) {
  const result = await computeBacktest({
    activeBenchmarkId: "nifty500",
    endMonth: null,
    holdingsMonths: [],
    portfolios,
    startMonth: "2003-10",
    transactionCost: { mode: "none" },
    universe: "all",
  });
  return new Map(result.portfolios.map((item) => [item.name, summarize(item.results.vw_rets)]));
}

async function statsForPortfolioTable(factor, rows) {
  const small = rows.filter((row) => row.size === "S");
  const big = rows.filter((row) => row.size === "B");
  const [smallStats, bigStats] = await Promise.all([
    backtestPortfolios(small.map((row) => portfolio(row.label, factor, row.size, row.value))),
    backtestPortfolios(big.map((row) => portfolio(row.label, factor, row.size, row.value))),
  ]);
  return new Map([...smallStats, ...bigStats]);
}

const ff5Rows = parseCsv("Data/Factor_Data/ff5.csv");
const latestMonth = ff5Rows.at(-1)?.Month;
if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(latestMonth || "")) {
  throw new Error(`Invalid latest ff5 month: ${latestMonth}`);
}

const coreFactorStats = new Map(
  ["MKT", "SMB", "HML", "WML", "RMW", "CMA"].map((factor) => [
    factor,
    summarize(ff5Rows.map((row) => Number.parseFloat(row[factor]))),
  ]),
);

const extendedFactorSpecs = [
  ["AT", "Asset Turnover", "H", "L"],
  ["SG", "Sales Growth", "H", "L"],
  ["ACC", "Accruals", "C", "A"],
  ["VOL", "Volatility", "L", "H"],
  ["STR", "Short-Term Reversal", "L", "H"],
];
const extendedFactorResult = await computeBacktest({
  activeBenchmarkId: "nifty500",
  endMonth: null,
  holdingsMonths: [],
  portfolios: extendedFactorSpecs.map(([code, factor, long, short], index) => ({
    colorIdx: index,
    config: {
      strategy: "long_short",
      longFilters: { [factor]: [long] },
      shortFilters: { [factor]: [short] },
    },
    factorLabel: code,
    id: index + 1,
    name: code,
  })),
  startMonth: "2003-10",
  transactionCost: { mode: "none" },
  universe: "all",
});
const extendedFactorStats = new Map(
  extendedFactorResult.portfolios.map((item) => [item.name, summarize(item.results.vw_rets)]),
);

const csvTables = [
  {
    marker: 'data-factor-panel="bookmarket"',
    file: "Data/Factor_Data/BM_Size.csv",
    columns: [["SV", "Small Value"], ["SN", "Small Neutral"], ["SG", "Small Growth"], ["BV", "Big Value"], ["BN", "Big Neutral"], ["BG", "Big Growth"]],
  },
  {
    marker: 'data-factor-panel="profitability"',
    file: "Data/Factor_Data/OP_Size.csv",
    columns: [["SR", "Small Robust"], ["SN", "Small Neutral"], ["SW", "Small Weak"], ["BR", "Big Robust"], ["BN", "Big Neutral"], ["BW", "Big Weak"]],
  },
  {
    marker: 'data-factor-panel="investment"',
    file: "Data/Factor_Data/INV_Size.csv",
    columns: [["SC", "Small Conservative"], ["SN", "Small Neutral"], ["SA", "Small Aggressive"], ["BC", "Big Conservative"], ["BN", "Big Neutral"], ["BA", "Big Aggressive"]],
  },
  {
    marker: 'data-factor-panel="momentum"',
    file: "Data/Factor_Data/MOM_Size.csv",
    columns: [["SL_mom", "Small Loser"], ["SN_mom", "Small Neutral"], ["SW_mom", "Small Winner"], ["BL_mom", "Big Loser"], ["BN_mom", "Big Neutral"], ["BW_mom", "Big Winner"]],
  },
];

const computedTables = [
  {
    marker: 'data-factor-panel="asset_turnover"',
    factor: "Asset Turnover",
    rows: [["Small High", "S", "H"], ["Small Neutral", "S", "N"], ["Small Low", "S", "L"], ["Big High", "B", "H"], ["Big Neutral", "B", "N"], ["Big Low", "B", "L"]],
  },
  {
    marker: 'data-factor-panel="sales_growth"',
    factor: "Sales Growth",
    rows: [["Small High", "S", "H"], ["Small Neutral", "S", "N"], ["Small Low", "S", "L"], ["Big High", "B", "H"], ["Big Neutral", "B", "N"], ["Big Low", "B", "L"]],
  },
  {
    marker: 'data-factor-panel="accruals"',
    factor: "Accruals",
    rows: [["Small Conservative", "S", "C"], ["Small Neutral", "S", "N"], ["Small Aggressive", "S", "A"], ["Big Conservative", "B", "C"], ["Big Neutral", "B", "N"], ["Big Aggressive", "B", "A"]],
  },
  {
    marker: 'data-factor-panel="volatility"',
    factor: "Volatility",
    rows: [["Small Low", "S", "L"], ["Small Neutral", "S", "N"], ["Small High", "S", "H"], ["Big Low", "B", "L"], ["Big Neutral", "B", "N"], ["Big High", "B", "H"]],
  },
  {
    marker: 'data-factor-panel="short_term_reversal"',
    factor: "Short-Term Reversal",
    rows: [["Small Low", "S", "L"], ["Small Neutral", "S", "N"], ["Small High", "S", "H"], ["Big Low", "B", "L"], ["Big Neutral", "B", "N"], ["Big High", "B", "H"]],
  },
];

let html = readFileSync(HTML_PATH, "utf8");
html = replaceTableBody(html, 'id="tbody-core-research"', coreFactorStats, 2);
html = replaceTableBody(html, 'id="tbody-other-research"', extendedFactorStats, 2);

for (const table of csvTables) {
  const stats = statsFromCsv(
    table.file,
    table.columns.map(([column, label]) => ({ column, label })),
  );
  html = replaceTableBody(html, table.marker, stats, 1);
}

for (const table of computedTables) {
  const stats = await statsForPortfolioTable(
    table.factor,
    table.rows.map(([label, size, value]) => ({ label, size, value })),
  );
  html = replaceTableBody(html, table.marker, stats, 1);
}

writeFileSync(HTML_PATH, html, "utf8");
console.log(`Homepage statistics updated through ${latestMonth} (11 tables, 65 rows).`);
