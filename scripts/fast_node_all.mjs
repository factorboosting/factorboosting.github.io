import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { computeBacktest, getUniverseMeta } from "../src/server/backtest-engine-single.js";

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

async function testFactor(name, factorLabel, longLabel, shortLabel, longFilterObj, shortFilterObj) {
  const result = await computeBacktest({
    universe: "all",
    startMonth: "2003-10",
    endMonth: "2026-05",
    activeBenchmarkId: "nifty500",
    transactionCost: { mode: "none" },
    portfolios: [
      {
        id: 1,
        name: name,
        factorLabel: factorLabel,
        colorIdx: 0,
        config: {
          strategy: "long_short",
          longFilters: longFilterObj,
          shortFilters: shortFilterObj,
        },
      },
    ],
  });

  const p = result.portfolios[0];
  console.log(`${name}: CAGR ${p.results.vw_metrics.cagr}% | Cum ${p.results.vw_metrics.cumulative}x | Ann. Vol ${p.results.vw_metrics.volatility}%`);
}

async function main() {
  console.log("--- SINGLE SORT RESULTS (Like Email Tables) ---");
  await testFactor("Momentum (WML)", "Momentum", "W", "L", { Momentum: ["W"] }, { Momentum: ["L"] });
  await testFactor("Size (SMB)", "Size", "S", "B", { Size: ["S"] }, { Size: ["B"] });
  await testFactor("Value (HML)", "BM", "V", "G", { BM: ["V"] }, { BM: ["G"] });
  await testFactor("Quality (RMW)", "OP", "R", "W", { OP: ["R"] }, { OP: ["W"] });
  await testFactor("Investment (CMA)", "INV", "C", "A", { INV: ["C"] }, { INV: ["A"] });
}

main().catch(console.error);
