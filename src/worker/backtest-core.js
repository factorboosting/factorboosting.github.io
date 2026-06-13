// Backtest core for the Cloudflare Pages Function.
//
// The heavy per-month aggregation runs in Postgres (run_backtest_legs RPC); this
// module does only the cheap composition. The math (computeMetrics / computeDrawdown
// / computeIR / calcTurnover / normalizeTransactionCost) and the computePortfolio
// control-flow (validity, long-short coupling, isPureSize BM-bucketing, txn-cost
// drag, +/-2 clamp, equity compounding) are a faithful port of
// src/server/backtest-engine.js, operating on RPC aggregates instead of raw rows.
// Once verified against the oracle (scripts/smoke-backtest.mjs), the legacy
// server + client engines become dead code and should be removed.

import { BENCHMARK_OPTIONS, FACTORS } from "../server/factor-config.js";

const UNIVERSES = new Set(["all", "top500", "top300"]);
const MIN_FIRMS = 5;
const PORT_CAP = 2;

export function normalizeUniverse(universe) {
  return UNIVERSES.has(universe) ? universe : "all";
}

// ── Supabase PostgREST helpers ───────────────────────────────────────────────
function supabaseBase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function callRpc(env, fn, args) {
  const { url, key } = supabaseBase(env);
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`RPC ${fn} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function selectTable(env, table, query) {
  const { url, key } = supabaseBase(env);
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`Select ${table} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// ── Filter / size-column translation (mirrors the engine) ────────────────────
export function getSizeColumn(longFilters = {}, shortFilters = {}) {
  const has = (k) => Boolean(longFilters[k] || shortFilters[k]);
  if (has("Momentum")) return "Size_Label_Monthly";
  if (has("Op. Profitability")) return "Size_Label_OP";
  if (has("Investment")) return "Size_Label_INV";
  if (has("Asset Turnover")) return "Size_Label_AT";
  if (has("Sales Growth")) return "Size_Label_SG";
  if (has("Accruals")) return "Size_Label_ACC";
  return "Size_Label_Yearly";
}

// Translate the frontend's factor-name filters into RPC params: a jsonb object
// of {db_label_column: labels} for non-size factors, plus the size labels.
// Empty label lists and unknown factors are skipped (matches engine applyFilters).
function buildLegParams(filters = {}) {
  const pFilters = {};
  let sizeLabels = null;
  for (const [factor, labels] of Object.entries(filters)) {
    if (!labels || !labels.length) continue;
    if (factor === "Size") {
      sizeLabels = labels.slice();
      continue;
    }
    const def = FACTORS[factor];
    if (!def) continue;
    pFilters[def.col] = labels.slice();
  }
  return { pFilters, sizeLabels };
}

// ── Aggregate index + EW/VW ──────────────────────────────────────────────────
function emptyCell() {
  return { n: 0, sum_ret: 0, sum_ret_w: 0, sum_w: 0, codes: new Set(), byBm: {} };
}

function rpcRowsToIndex(rows) {
  const index = {};
  for (const r of rows || []) {
    const month = r.month;
    const sb = r.size_bucket || "";
    const bm = r.bm_bucket || "";
    if (!index[month]) index[month] = {};
    if (!index[month][sb]) index[month][sb] = emptyCell();
    const cell = index[month][sb];
    cell.n += r.n;
    cell.sum_ret += r.sum_ret;
    cell.sum_ret_w += r.sum_ret_w;
    cell.sum_w += r.sum_w;
    if (Array.isArray(r.co_codes)) {
      for (const c of r.co_codes) cell.codes.add(c);
    }
    cell.byBm[bm] = { n: r.n, sum_ret: r.sum_ret, sum_ret_w: r.sum_ret_w, sum_w: r.sum_w };
  }
  return index;
}

function aggEW(a) {
  return a && a.n > 0 ? a.sum_ret / a.n : 0;
}

function aggVW(a) {
  if (!a) return 0;
  return a.sum_w > 0 ? a.sum_ret_w / a.sum_w : aggEW(a);
}

// ── Pure metric math (verbatim from backtest-engine.js) ───────────────────────
function calcTurnover(prevStocks, currStocks) {
  if (!prevStocks || prevStocks.size === 0) return { entered: 0, exited: 0, ratio: 0 };
  let entered = 0;
  let exited = 0;
  currStocks.forEach((stock) => {
    if (!prevStocks.has(stock)) entered++;
  });
  prevStocks.forEach((stock) => {
    if (!currStocks.has(stock)) exited++;
  });
  const avgSize = (prevStocks.size + currStocks.size) / 2;
  return { entered, exited, ratio: avgSize > 0 ? (entered + exited) / avgSize : 0 };
}

function computeIR(portRets, benchRets) {
  if (!portRets || !benchRets || portRets.length === 0) return null;
  const active = [];
  const count = Math.min(portRets.length, benchRets.length);
  for (let i = 0; i < count; i++) {
    if (benchRets[i] == null) continue;
    active.push(portRets[i] - benchRets[i]);
  }
  if (active.length < 2) return null;
  const mean = active.reduce((sum, value) => sum + value, 0) / active.length;
  const variance =
    active.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (active.length - 1);
  const trackingError = Math.sqrt(variance * 12);
  return trackingError > 0 ? +((mean * 12) / trackingError).toFixed(3) : null;
}

function computeMetrics(rets, rfs = []) {
  const count = rets.length;
  if (count === 0) {
    return {
      growth_multiple: 1,
      annualized_return: 0,
      annualized_volatility: 0,
      sharpe_ratio: 0,
      max_drawdown: 0,
    };
  }
  let cumulativeProduct = 1;
  for (const ret of rets) cumulativeProduct *= 1 + ret;
  const years = count / 12;
  const annualizedReturn =
    years > 0 && cumulativeProduct > 0 ? Math.pow(cumulativeProduct, 1 / years) - 1 : 0;
  const mean = rets.reduce((sum, ret) => sum + ret, 0) / count;
  const variance =
    rets.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) / Math.max(count - 1, 1);
  const annualizedVolatility = Math.sqrt(variance * 12);
  const excessRets = rets.map((ret, index) => ret - (rfs[index] || 0));
  const meanExcess = excessRets.reduce((sum, ret) => sum + ret, 0) / count;
  const sharpe = annualizedVolatility > 0 ? (meanExcess * 12) / annualizedVolatility : 0;
  let cumulative = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const ret of rets) {
    cumulative *= 1 + ret;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak > 0 ? (cumulative - peak) / peak : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  return {
    growth_multiple: +cumulativeProduct.toFixed(2),
    annualized_return: +(annualizedReturn * 100).toFixed(2),
    annualized_volatility: +(annualizedVolatility * 100).toFixed(2),
    sharpe_ratio: +sharpe.toFixed(3),
    max_drawdown: +(maxDrawdown * 100).toFixed(2),
  };
}

function computeDrawdown(rets) {
  const drawdown = [];
  let cumulative = 1;
  let peak = 1;
  for (const ret of rets) {
    cumulative *= 1 + ret;
    if (cumulative > peak) peak = cumulative;
    drawdown.push(+(peak > 0 ? ((cumulative - peak) / peak) * 100 : 0).toFixed(2));
  }
  return drawdown;
}

function normalizeTransactionCost(input = {}) {
  if (input.mode !== "bps") return { mode: "none", cost: 0 };
  const bps = Number.parseFloat(input.bps ?? input.costBps ?? 0);
  return { mode: "bps", cost: Number.isFinite(bps) ? bps / 10000 : 0 };
}

function toFirms(rows) {
  return (rows || []).map((r) => ({
    name: r.co_name || "—",
    ret: +((r.ret || 0) * 100).toFixed(2),
    size: r.size,
  }));
}

// ── Composition: one portfolio from its long/short aggregate indexes ─────────
function computePortfolioFromLegs(longIndex, shortIndex, config, months, transactionCost, rfData) {
  const longFilters = config.longFilters || {};
  const shortFilters = config.shortFilters || {};
  const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
  const ewPort = [100];
  const vwPort = [100];
  const ewRets = [];
  const vwRets = [];
  const netByMonth = {};
  let prevLongCodes = null;
  let prevShortCodes = null;
  let totalTurnover = 0;
  let turnoverCount = 0;

  for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
    const month = months[monthIndex];
    const L = longIndex[month] || {};
    const Sh = shortIndex[month] || {};
    const longS = L.S || emptyCell();
    const longB = L.B || emptyCell();
    const shortS = strategy === "long_short" ? Sh.S || emptyCell() : emptyCell();
    const shortB = strategy === "long_short" ? Sh.B || emptyCell() : emptyCell();

    const longAllowsS = !longFilters.Size || longFilters.Size.includes("S");
    const longAllowsB = !longFilters.Size || longFilters.Size.includes("B");
    const shortAllowsS =
      strategy === "long_short" && (!shortFilters.Size || shortFilters.Size.includes("S"));
    const shortAllowsB =
      strategy === "long_short" && (!shortFilters.Size || shortFilters.Size.includes("B"));

    let validLongS = longAllowsS && longS.n >= MIN_FIRMS;
    let validLongB = longAllowsB && longB.n >= MIN_FIRMS;
    let validShortS = shortAllowsS && shortS.n >= MIN_FIRMS;
    let validShortB = shortAllowsB && shortB.n >= MIN_FIRMS;

    if (strategy === "long_short") {
      if (longAllowsS && shortAllowsS && (!validLongS || !validShortS)) {
        validLongS = false;
        validShortS = false;
      }
      if (longAllowsB && shortAllowsB && (!validLongB || !validShortB)) {
        validLongB = false;
        validShortB = false;
      }
    }

    const currLongCodes = new Set();
    if (validLongS) for (const c of longS.codes) currLongCodes.add(c);
    if (validLongB) for (const c of longB.codes) currLongCodes.add(c);
    const currShortCodes = new Set();
    if (strategy === "long_short") {
      if (validShortS) for (const c of shortS.codes) currShortCodes.add(c);
      if (validShortB) for (const c of shortB.codes) currShortCodes.add(c);
    }

    let monthTurnoverRatio = 0;
    if (prevLongCodes) {
      const longTurnover = calcTurnover(prevLongCodes, currLongCodes);
      if (strategy === "long_short" && prevShortCodes) {
        const shortTurnover = calcTurnover(prevShortCodes, currShortCodes);
        monthTurnoverRatio = longTurnover.ratio + shortTurnover.ratio;
      } else {
        monthTurnoverRatio = longTurnover.ratio;
      }
      totalTurnover += monthTurnoverRatio;
      turnoverCount++;
    }
    prevLongCodes = currLongCodes;
    prevShortCodes = currShortCodes;

    let longEW = null;
    let longVW = null;
    let shortEW = null;
    let shortVW = null;

    const isPureSize =
      Object.keys(longFilters).length === 1 &&
      Object.keys(shortFilters).length === 1 &&
      longFilters.Size &&
      shortFilters.Size &&
      ((longFilters.Size.includes("B") && shortFilters.Size.includes("S")) ||
        (longFilters.Size.includes("S") && shortFilters.Size.includes("B")));

    if (isPureSize) {
      const bmBuckets = ["G", "N", "V"];
      const isLongSmall = longFilters.Size.includes("S");
      const longLeg = isLongSmall ? longS : longB;
      const shortLeg = isLongSmall ? shortB : shortS;
      const isValidLong = isLongSmall ? validLongS : validLongB;
      const isValidShort = isLongSmall ? validShortB : validShortS;
      const validBuckets = [];

      if (isValidLong && isValidShort) {
        for (const bucket of bmBuckets) {
          const subLong = longLeg.byBm[bucket];
          const subShort = shortLeg.byBm[bucket];
          if ((subLong?.n || 0) >= MIN_FIRMS && (subShort?.n || 0) >= MIN_FIRMS) {
            validBuckets.push(bucket);
          }
        }
      }

      if (validBuckets.length > 0) {
        const lE = [];
        const lV = [];
        const sE = [];
        const sV = [];
        for (const bucket of validBuckets) {
          lE.push(aggEW(longLeg.byBm[bucket]));
          lV.push(aggVW(longLeg.byBm[bucket]));
          sE.push(aggEW(shortLeg.byBm[bucket]));
          sV.push(aggVW(shortLeg.byBm[bucket]));
        }
        longEW = lE.reduce((s, v) => s + v, 0) / validBuckets.length;
        longVW = lV.reduce((s, v) => s + v, 0) / validBuckets.length;
        shortEW = sE.reduce((s, v) => s + v, 0) / validBuckets.length;
        shortVW = sV.reduce((s, v) => s + v, 0) / validBuckets.length;
      }
    } else {
      if (validLongS && validLongB) {
        longEW = (aggEW(longS) + aggEW(longB)) / 2;
        longVW = (aggVW(longS) + aggVW(longB)) / 2;
      } else if (validLongS) {
        longEW = aggEW(longS);
        longVW = aggVW(longS);
      } else if (validLongB) {
        longEW = aggEW(longB);
        longVW = aggVW(longB);
      }

      if (strategy === "long_short") {
        if (validShortS && validShortB) {
          shortEW = (aggEW(shortS) + aggEW(shortB)) / 2;
          shortVW = (aggVW(shortS) + aggVW(shortB)) / 2;
        } else if (validShortS) {
          shortEW = aggEW(shortS);
          shortVW = aggVW(shortS);
        } else if (validShortB) {
          shortEW = aggEW(shortB);
          shortVW = aggVW(shortB);
        }
      }
    }

    let ewNet = strategy === "long_short" ? longEW - shortEW : longEW;
    let vwNet = strategy === "long_short" ? longVW - shortVW : longVW;

    if (transactionCost.mode !== "none" && monthIndex > 0) {
      const drag = monthTurnoverRatio * transactionCost.cost;
      ewNet -= drag;
      vwNet -= drag;
    }

    if (!Number.isFinite(ewNet)) ewNet = 0;
    if (!Number.isFinite(vwNet)) vwNet = 0;

    ewNet = Math.max(-PORT_CAP, Math.min(PORT_CAP, ewNet));
    vwNet = Math.max(-PORT_CAP, Math.min(PORT_CAP, vwNet));

    ewRets.push(ewNet);
    vwRets.push(vwNet);
    ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
    vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));
    netByMonth[month] = {
      ew_ret: +(ewNet * 100).toFixed(3),
      vw_ret: +(vwNet * 100).toFixed(3),
    };
  }

  const rfSeries = months.map((month) => rfData[month] || 0);

  const results = {
    months,
    ew_portfolio: ewPort.slice(1).map((value) => +value.toFixed(4)),
    vw_portfolio: vwPort.slice(1).map((value) => +value.toFixed(4)),
    ew_rets: ewRets,
    vw_rets: vwRets,
    ew_metrics: computeMetrics(ewRets, rfSeries),
    vw_metrics: computeMetrics(vwRets, rfSeries),
    ew_drawdown: computeDrawdown(ewRets),
    vw_drawdown: computeDrawdown(vwRets),
    holdings: {},
    isLongShort: strategy === "long_short",
    avgTurnover:
      turnoverCount > 0 ? +((totalTurnover / turnoverCount) * 100).toFixed(1) : 0,
  };
  return { results, netByMonth };
}

// ── Benchmarks (verbatim from engine) ────────────────────────────────────────
function computeIndexBenchmark(data, months, col) {
  const rets = [];
  const port = [100];
  for (const month of months) {
    const value = data.benchmarkByMonth?.[month]?.[col];
    const ret = value != null && Number.isFinite(value) ? value : null;
    rets.push(ret);
    port.push(port[port.length - 1] * (1 + (ret == null ? 0 : ret)));
  }
  const rfSeries = months.map((month) => data.rfData[month] || 0);
  const zeroFilledRets = rets.map((ret) => (ret == null ? 0 : ret));
  return {
    rets,
    portfolio: port.slice(1).map((value) => +value.toFixed(4)),
    metrics: computeMetrics(zeroFilledRets, rfSeries),
    drawdown: computeDrawdown(zeroFilledRets),
  };
}

function computeAllBenchmarks(data, months) {
  return Object.fromEntries(
    Object.entries(BENCHMARK_OPTIONS).map(([id, config]) => [
      id,
      computeIndexBenchmark(data, months, config.col),
    ]),
  );
}

async function loadMarketData(env, start, end) {
  const range = `month=gte.${encodeURIComponent(start)}&month=lte.${encodeURIComponent(end)}`;
  const [bench, rf] = await Promise.all([
    selectTable(env, "benchmark_monthly", `select=month,nifty50,nifty500&${range}&order=month.asc`),
    selectTable(env, "rf_monthly", `select=month,rf&${range}&order=month.asc`),
  ]);
  const benchmarkByMonth = {};
  for (const b of bench) benchmarkByMonth[b.month] = { nifty50: b.nifty50, nifty500: b.nifty500 };
  const rfData = {};
  for (const r of rf) rfData[r.month] = r.rf;
  return { benchmarkByMonth, rfData };
}

export async function getUniverseMeta(env, universeInput = "all") {
  const universe = normalizeUniverse(universeInput);
  const meta = await callRpc(env, "get_universe_meta", { p_universe: universe });
  return {
    universe,
    rowCount: meta?.rowCount ?? 0,
    months: meta?.months ?? [],
    firstMonth: meta?.firstMonth ?? null,
    lastMonth: meta?.lastMonth ?? null,
    dataQualityStats: meta?.dataQualityStats ?? { dropped: 0, capped: 0, total: 0 },
  };
}

async function attachHoldings(env, universe, portfolio, sizeCol, monthsList, netByMonth) {
  const config = portfolio.config || {};
  const longFilters = config.longFilters || {};
  const shortFilters = config.shortFilters || {};
  const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
  const longParams = buildLegParams(longFilters);
  const shortParams = buildLegParams(shortFilters);

  for (const month of monthsList) {
    const longRows = await callRpc(env, "get_holdings", {
      p_universe: universe,
      p_month: month,
      p_size_col: sizeCol,
      p_size_labels: longParams.sizeLabels,
      p_filters: longParams.pFilters,
    });
    let shortRows = [];
    if (strategy === "long_short") {
      shortRows = await callRpc(env, "get_holdings", {
        p_universe: universe,
        p_month: month,
        p_size_col: sizeCol,
        p_size_labels: shortParams.sizeLabels,
        p_filters: shortParams.pFilters,
      });
    }
    const net = netByMonth[month] || { ew_ret: 0, vw_ret: 0 };
    portfolio.results.holdings[month] = {
      long_firms: toFirms(longRows),
      short_firms: toFirms(shortRows),
      long_total: longRows.length,
      short_total: shortRows.length,
      ew_ret: net.ew_ret,
      vw_ret: net.vw_ret,
    };
  }
}

// ── Orchestrator: reproduces computeBacktest's output shape ──────────────────
export async function runBacktest(env, input) {
  const universe = normalizeUniverse(input.universe);
  const meta = await getUniverseMeta(env, universe);
  const allMonths = meta.months;
  if (!allMonths.length) throw new Error("No data for universe.");

  const startMonth = input.startMonth || allMonths[Math.max(0, allMonths.length - 120)];
  const endMonth = input.endMonth || allMonths[allMonths.length - 1];
  const months = allMonths.filter((month) => month >= startMonth && month <= endMonth);
  if (months.length === 0) throw new Error("No data in selected range.");
  if (!Array.isArray(input.portfolios) || input.portfolios.length === 0) {
    throw new Error("No portfolios provided.");
  }

  const transactionCost = normalizeTransactionCost(input.transactionCost);
  const holdingsMonths = Array.isArray(input.holdingsMonths)
    ? input.holdingsMonths.filter((month) => months.includes(month))
    : null;
  const activeBenchmarkId = BENCHMARK_OPTIONS[input.activeBenchmarkId]
    ? input.activeBenchmarkId
    : "nifty50";

  const data = await loadMarketData(env, startMonth, endMonth);
  const benchmarkSeries = computeAllBenchmarks(data, months);

  const inputPorts = input.portfolios.slice(0, 5);
  const portfolios = [];

  for (let index = 0; index < inputPorts.length; index++) {
    const portfolio = inputPorts[index];
    const config = portfolio.config || {};
    const longFilters = config.longFilters || {};
    const shortFilters = config.shortFilters || {};
    const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
    const sizeCol = getSizeColumn(longFilters, shortFilters);

    const longParams = buildLegParams(longFilters);
    const longRows = await callRpc(env, "run_backtest_legs", {
      p_universe: universe,
      p_start: startMonth,
      p_end: endMonth,
      p_size_col: sizeCol,
      p_size_labels: longParams.sizeLabels,
      p_filters: longParams.pFilters,
    });

    let shortRows = [];
    if (strategy === "long_short") {
      const shortParams = buildLegParams(shortFilters);
      shortRows = await callRpc(env, "run_backtest_legs", {
        p_universe: universe,
        p_start: startMonth,
        p_end: endMonth,
        p_size_col: sizeCol,
        p_size_labels: shortParams.sizeLabels,
        p_filters: shortParams.pFilters,
      });
    }

    const longIndex = rpcRowsToIndex(longRows);
    const shortIndex = rpcRowsToIndex(shortRows);
    const { results, netByMonth } = computePortfolioFromLegs(
      longIndex,
      shortIndex,
      config,
      months,
      transactionCost,
      data.rfData,
    );

    const built = {
      id: portfolio.id ?? index + 1,
      name: portfolio.name || `Portfolio ${index + 1}`,
      factorLabel: portfolio.factorLabel || "—",
      colorIdx: portfolio.colorIdx ?? index,
      config: portfolio.config,
      results,
    };

    if (holdingsMonths && holdingsMonths.length) {
      await attachHoldings(env, universe, built, sizeCol, holdingsMonths, netByMonth);
    }
    portfolios.push(built);
  }

  const activeBenchmark = benchmarkSeries[activeBenchmarkId];
  for (const portfolio of portfolios) {
    portfolio.results.ew_metrics.ir = computeIR(portfolio.results.ew_rets, activeBenchmark.rets);
    portfolio.results.vw_metrics.ir = computeIR(portfolio.results.vw_rets, activeBenchmark.rets);
  }

  return {
    activeBenchmarkId,
    benchmarkSeries,
    months,
    portfolios,
    meta: {
      universe,
      rowCount: meta.rowCount,
      firstMonth: meta.firstMonth,
      lastMonth: meta.lastMonth,
      dataQualityStats: meta.dataQualityStats,
    },
  };
}

// ── Cache key (stable hash of the request) ───────────────────────────────────
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function createBacktestCacheKey(input) {
  const data = new TextEncoder().encode(stableStringify(input));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
