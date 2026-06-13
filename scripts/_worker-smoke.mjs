// TEMP: exercises the Worker compute core directly against the loaded Supabase
// (bypasses workerd, so it works even if the corporate TLS proxy blocks workerd).
// Run: NODE_EXTRA_CA_CERTS=/tmp/macos-ca.pem node scripts/_worker-smoke.mjs
import { runBacktest, getUniverseMeta } from "../src/worker/backtest-core.js";

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

for (const u of ["all", "top500", "top300"]) {
  const m = await getUniverseMeta(env, u);
  console.log(`meta[${u}]: rows=${m.rowCount} months=${m.months.length} ${m.firstMonth}..${m.lastMonth}`);
}

const input = {
  universe: "all",
  activeBenchmarkId: "nifty50",
  transactionCost: 0,
  portfolios: [
    { id: 1, name: "Small (long-only)", config: { strategy: "long_only", longFilters: { Size: ["S"] } } },
    {
      id: 2,
      name: "Value-minus-Growth (L/S)",
      config: {
        strategy: "long_short",
        longFilters: { "Book-to-Market": ["V"] },
        shortFilters: { "Book-to-Market": ["G"] },
      },
    },
  ],
};

const t0 = Date.now();
const res = await runBacktest(env, input);
const ms = Date.now() - t0;
console.log(`\nrunBacktest: ${ms}ms  months=${res.months.length}  benchmark=${res.activeBenchmarkId}`);
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(2) + "%");
const num = (x) => (x == null ? "n/a" : Number(x).toFixed(2));
for (const p of res.portfolios) {
  const ew = p.results.ew_metrics;
  const vw = p.results.vw_metrics;
  console.log(
    `  ${p.name}\n` +
      `    EW: ann=${pct(ew.annualized_return)} vol=${pct(ew.annualized_volatility)} sharpe=${num(ew.sharpe_ratio)} mdd=${pct(ew.max_drawdown)} growth=${num(ew.growth_multiple)}x ir=${num(ew.ir)}\n` +
      `    VW: ann=${pct(vw.annualized_return)} vol=${pct(vw.annualized_volatility)} sharpe=${num(vw.sharpe_ratio)} mdd=${pct(vw.max_drawdown)} growth=${num(vw.growth_multiple)}x ir=${num(vw.ir)}`,
  );
}
console.log("\nOK");
