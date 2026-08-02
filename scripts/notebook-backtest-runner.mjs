import { computeBacktest } from "../src/server/backtest-engine.js";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function runKey(spec) {
  return stableStringify({
    activeBenchmarkId: spec.activeBenchmarkId || "nifty500",
    endMonth: spec.endMonth || null,
    startMonth: spec.startMonth || null,
    transactionCost: spec.transactionCost || { mode: "none" },
    universe: spec.universe || "all",
  });
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function slimBenchmarkSeries(series) {
  const out = {};
  for (const [id, value] of Object.entries(series || {})) {
    out[id] = {
      drawdown: value.drawdown,
      metrics: value.metrics,
      portfolio: value.portfolio,
      rets: value.rets,
    };
  }
  return out;
}

function slimPortfolio(spec, portfolio) {
  return {
    activeBenchmarkId: spec.activeBenchmarkId || "nifty500",
    baseId: spec.baseId || spec.specId,
    benchmarkSeries: spec.includeBenchmarkSeries ? undefined : null,
    colorIdx: spec.colorIdx,
    config: spec.config,
    endMonth: spec.endMonth || null,
    factorLabel: spec.factorLabel || "",
    name: spec.name || portfolio.name,
    source: spec.source || "custom",
    specId: spec.specId,
    startMonth: spec.startMonth || null,
    transactionCost: spec.transactionCost || { mode: "none" },
    tags: Array.isArray(spec.tags) ? spec.tags : [],
    universe: spec.universe || "all",
    results: {
      avgTurnover: portfolio.results.avgTurnover,
      avgLongStocks: portfolio.results.avgLongStocks,
      avgShortStocks: portfolio.results.avgShortStocks,
      ew_drawdown: portfolio.results.ew_drawdown,
      ew_metrics: portfolio.results.ew_metrics,
      ew_portfolio: portfolio.results.ew_portfolio,
      ew_rets: portfolio.results.ew_rets,
      isLongShort: portfolio.results.isLongShort,
      lastLongStocks: portfolio.results.lastLongStocks,
      lastShortStocks: portfolio.results.lastShortStocks,
      longCounts: portfolio.results.longCounts,
      maxLongStocks: portfolio.results.maxLongStocks,
      maxShortStocks: portfolio.results.maxShortStocks,
      minLongStocks: portfolio.results.minLongStocks,
      minShortStocks: portfolio.results.minShortStocks,
      shortCounts: portfolio.results.shortCounts,
      vw_drawdown: portfolio.results.vw_drawdown,
      vw_metrics: portfolio.results.vw_metrics,
      vw_portfolio: portfolio.results.vw_portfolio,
      vw_rets: portfolio.results.vw_rets,
    },
  };
}

async function main() {
  const payload = JSON.parse((await readStdin()) || "{}");
  const specs = Array.isArray(payload.specs) ? payload.specs : [];
  const grouped = new Map();
  const results = [];
  const errors = [];
  const benchmarkSeriesByKey = {};

  for (const spec of specs) {
    const key = runKey(spec);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(spec);
  }

  for (const [key, group] of grouped.entries()) {
    for (const part of chunk(group, 5)) {
      const first = part[0];
      try {
        const response = await computeBacktest({
          activeBenchmarkId: first.activeBenchmarkId || "nifty500",
          endMonth: first.endMonth,
          holdingsMonths: first.holdingsMonths || [],
          portfolios: part.map((spec, index) => ({
            colorIdx: spec.colorIdx ?? index,
            config: spec.config,
            factorLabel: spec.factorLabel || "",
            id: spec.specId ?? index + 1,
            name: spec.name || `Portfolio ${index + 1}`,
          })),
          startMonth: first.startMonth,
          transactionCost: first.transactionCost || { mode: "none" },
          universe: first.universe || "all",
        });

        if (payload.includeBenchmarkSeries && !benchmarkSeriesByKey[key]) {
          benchmarkSeriesByKey[key] = {
            activeBenchmarkId: response.activeBenchmarkId,
            benchmarkSeries: slimBenchmarkSeries(response.benchmarkSeries),
            months: response.months,
            runKey: key,
          };
        }

        response.portfolios.forEach((portfolio, index) => {
          const spec = part[index];
          results.push({
            ...slimPortfolio(spec, portfolio),
            months: response.months,
            runKey: key,
          });
        });
      } catch (error) {
        errors.push({
          message: error?.message || String(error),
          runKey: key,
          specIds: part.map((spec) => spec.specId),
        });
      }
    }
  }

  process.stdout.write(
    JSON.stringify({
      benchmarkSeriesByKey,
      errors,
      results,
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
