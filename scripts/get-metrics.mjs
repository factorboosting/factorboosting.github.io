import { computeBacktest } from "../src/server/backtest-engine.js";

async function main() {
  const result1 = await computeBacktest({
    universe: "top500",
    startMonth: "2016-06",
    endMonth: "2026-05",
    activeBenchmarkId: "nifty500",
    transactionCost: { mode: "none", bps: 0 },
    portfolios: [
      { id: 1, name: "SMB", config: { strategy: "long_short", longFilters: { Size: ["S"] }, shortFilters: { Size: ["B"] } } },
      { id: 2, name: "HML", config: { strategy: "long_short", longFilters: { "Book-to-Market": ["V"] }, shortFilters: { "Book-to-Market": ["G"] } } },
      { id: 3, name: "RMW", config: { strategy: "long_short", longFilters: { "Profitability": ["R"] }, shortFilters: { "Profitability": ["W"] } } },
      { id: 4, name: "CMA", config: { strategy: "long_short", longFilters: { "Investment": ["C"] }, shortFilters: { "Investment": ["A"] } } },
      { id: 5, name: "WML", config: { strategy: "long_short", longFilters: { "Momentum": ["W"] }, shortFilters: { "Momentum": ["L"] } } },
    ],
  });

  const result2 = await computeBacktest({
    universe: "top500",
    startMonth: "2016-06",
    endMonth: "2026-05",
    activeBenchmarkId: "nifty500",
    transactionCost: { mode: "none", bps: 0 },
    portfolios: [
      { id: 6, name: "Small", config: { strategy: "long_only", longFilters: { Size: ["S"] }, shortFilters: {} } },
      { id: 7, name: "Value", config: { strategy: "long_only", longFilters: { "Book-to-Market": ["V"] }, shortFilters: {} } },
      { id: 8, name: "Robust", config: { strategy: "long_only", longFilters: { "Profitability": ["R"] }, shortFilters: {} } },
      { id: 9, name: "Conservative", config: { strategy: "long_only", longFilters: { "Investment": ["C"] }, shortFilters: {} } },
      { id: 10, name: "Winner", config: { strategy: "long_only", longFilters: { "Momentum": ["W"] }, shortFilters: {} } },
    ],
  });

  for (const p of [...result1.portfolios, ...result2.portfolios]) {
    const m = p.results.vw_metrics || p.results.metrics;
    if (!m) {
      console.log(`${p.name} metrics not found`);
      continue;
    }
    console.log(
      `${p.name.padEnd(15)} | Growth: ${m.growth_multiple.toFixed(2)}x | Annual: ${(m.annualized_return).toFixed(2)}% | Vol: ${(m.annualized_volatility).toFixed(2)}% | Sharpe: ${m.sharpe_ratio.toFixed(3)} | DD: ${(m.max_drawdown).toFixed(2)}%`
    );
  }
}

main().catch(console.error);
