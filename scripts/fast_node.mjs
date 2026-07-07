import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { computeBacktest, getUniverseMeta } from "../src/server/backtest-engine.js";

const result = await computeBacktest({
  universe: "all",
  startMonth: "2003-10",
  endMonth: "2026-05",
  activeBenchmarkId: "nifty500",
  transactionCost: { mode: "none" },
  portfolios: [
    {
      id: 1,
      name: "Momentum",
      factorLabel: "Momentum",
      colorIdx: 0,
      config: {
        strategy: "long_short",
        longFilters: { Momentum: ["W"] },
        shortFilters: { Momentum: ["L"] },
      },
    },
  ],
});

const p = result.portfolios[0];
console.log("DOUBLE SORT (Current Website Code) VW CAGR:", p.results.vw_metrics.cagr);
