import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { computeBacktest, getUniverseMeta } from "../src/server/backtest-engine.js";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const meta = await getUniverseMeta("top500");
const result = await computeBacktest({
  universe: "top500",
  startMonth: "2016-06",
  endMonth: "2026-05",
  activeBenchmarkId: "nifty500",
  transactionCost: { mode: "bps", bps: 100 },
  portfolios: [
    {
      id: 1,
      name: "Winner",
      factorLabel: "Momentum",
      colorIdx: 0,
      config: {
        strategy: "long_only",
        longFilters: { Momentum: ["W"] },
        shortFilters: {},
      },
    },
  ],
});

const latestMonth = result.months[result.months.length - 1];
const portfolio = result.portfolios[0];

console.log(
  JSON.stringify(
    {
      universe: meta.universe,
      months: result.months.length,
      rowCount: meta.rowCount,
      latestMonth,
      vwMetrics: portfolio.results.vw_metrics,
      holdings: portfolio.results.holdings[latestMonth]?.long_total,
      cacheShape: Boolean(result.benchmarkSeries.nifty500),
    },
    null,
    2,
  ),
);
