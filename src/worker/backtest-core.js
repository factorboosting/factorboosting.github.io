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

import {
  BENCHMARK_OPTIONS,
  FACTORS,
  getPortfolioFilter,
  getPortfolioSizeColumn,
} from "../server/factor-config.js";
import runtimeData from "./backtest-runtime-data.js";

const UNIVERSES = new Set(["all", "top500", "top300"]);
const MIN_FIRMS = 5;
const PORT_CAP = 2;
const BACKTEST_CACHE_VERSION = "rpc-json-benchmarks-20260811-v21-tri-benchmarks";
const RPC_PAGE_SIZE = 1000;
const UNIVERSE_META = {
  all: { rowCount: 557866, firstMonth: "2003-10", lastMonth: "2026-07" },
  top500: { rowCount: 136040, firstMonth: "2003-10", lastMonth: "2026-07" },
  top300: { rowCount: 81708, firstMonth: "2003-10", lastMonth: "2026-07" },
};

export function normalizeUniverse(universe) {
  return UNIVERSES.has(universe) ? universe : "all";
}

function monthRange(start, end) {
  const months = [];
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${month.toString().padStart(2, "0")}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
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

async function callRpc(env, fn, args, options = {}) {
  const { url, key } = supabaseBase(env);
  const fetchPage = async (from = null) => {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const pageQuery = from == null ? "" : `?limit=${RPC_PAGE_SIZE}&offset=${from}`;
    const res = await fetch(`${url}/rest/v1/rpc/${fn}${pageQuery}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(`RPC ${fn} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  };

  if (!options.paginate) return fetchPage();

  const rows = [];
  for (let from = 0; ; from += RPC_PAGE_SIZE) {
    const page = await fetchPage(from);
    if (!Array.isArray(page)) return page;
    rows.push(...page);
    if (page.length < RPC_PAGE_SIZE) break;
  }
  return rows;
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
export function getSizeColumn(longFilters = {}, shortFilters = {}, options = {}) {
  if (options.usePortfolioCodes) {
    const portfolioCol = getPortfolioSizeColumn(longFilters, shortFilters);
    if (portfolioCol) return portfolioCol;
  }
  const has = (k) => Boolean(longFilters[k] || shortFilters[k]);
  if (has("Momentum")) return "Size_Label_Monthly";
  if (has("Volatility")) return "Size_Label_Monthly";
  if (has("Short-Term Reversal")) return "Size_Label_Monthly";
  if (has("Profitability") || has("Op. Profitability")) return "Size_Label_OP";
  if (has("Investment")) return "Size_Label_INV";
  if (has("Asset Turnover")) return "Size_Label_AT";
  if (has("Sales Growth")) return "Size_Label_SG";
  if (has("Accruals")) return "Size_Label_ACC";
  return "Size_Label_Yearly";
}

// Translate the frontend's factor-name filters into RPC params: a jsonb object
// of {db_label_column: labels} for non-size factors, plus the size labels.
// Empty label lists and unknown factors are skipped (matches engine applyFilters).
function buildLegParams(filters = {}, options = {}) {
  if (options.usePortfolioCodes) {
    const portfolioFilter = getPortfolioFilter(filters);
    if (portfolioFilter) {
      return {
        pFilters: { [portfolioFilter.col]: portfolioFilter.labels },
        sizeLabels: null,
      };
    }
  }

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
  return { n: 0, sum_ret: 0, sum_ret_w: 0, sum_w: 0, codes: new Set(), members: [], byBm: {} };
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
    
    if (!cell.byBm[bm]) {
      cell.byBm[bm] = { n: 0, sum_ret: 0, sum_ret_w: 0, sum_w: 0, members: [] };
    }
    const bmCell = cell.byBm[bm];
    bmCell.n += r.n;
    bmCell.sum_ret += r.sum_ret;
    bmCell.sum_ret_w += r.sum_ret_w;
    bmCell.sum_w += r.sum_w;

    if (Array.isArray(r.co_codes)) {
      for (let i = 0; i < r.co_codes.length; i++) {
        const c = r.co_codes[i];
        cell.codes.add(c);
        const member = {
          c: c,
          r: (r.rets && r.rets[i]) || 0,
          m: (r.mcaps && r.mcaps[i]) || 0
        };
        cell.members.push(member);
        bmCell.members.push(member);
      }
    }
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
// Old count-based calcTurnover removed in favor of weight-based turnover

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

function computeMetrics(rets, rfs = [], isLongShort = false) {
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
  const excessRets = rets.map((ret, index) => ret - (isLongShort ? 0 : (rfs[index] || 0)));
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
  if (input.mode !== "bps") return { mode: "none", cost: 0, includeFormation: false };
  const bps = Number.parseFloat(input.bps ?? input.costBps ?? 0);
  return { 
    mode: "bps", 
    cost: Number.isFinite(bps) ? bps / 10000 : 0, 
    includeFormation: Boolean(input.includeFormation)
  };
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
  let prevEwWeights = new Map();
  let prevVwWeights = new Map();
  let totalEwTurnover = 0;
  let totalVwTurnover = 0;
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

    let longEW = null;
    let longVW = null;
    let shortEW = null;
    let shortVW = null;

    const currWeights = new Map();
    function addWeights(cell, macroEwWeight, macroVwWeight) {
      if (!cell || cell.n === 0) return;
      const ewMicro = macroEwWeight / cell.n;
      const sum_mcap = cell.sum_w;
      for (const m of cell.members) {
        if (!currWeights.has(m.c)) currWeights.set(m.c, { ew: 0, vw: 0, r: m.r });
        const w = currWeights.get(m.c);
        w.ew += ewMicro;
        if (sum_mcap > 0 && m.m > 0) {
          w.vw += macroVwWeight * (m.m / sum_mcap);
        } else {
          w.vw += ewMicro;
        }
      }
    }

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
        const macro = 1.0 / validBuckets.length;
        for (const bucket of validBuckets) {
          lE.push(aggEW(longLeg.byBm[bucket]));
          lV.push(aggVW(longLeg.byBm[bucket]));
          sE.push(aggEW(shortLeg.byBm[bucket]));
          sV.push(aggVW(shortLeg.byBm[bucket]));
          
          addWeights(longLeg.byBm[bucket], macro, macro);
          if (strategy === "long_short") {
            addWeights(shortLeg.byBm[bucket], -macro, -macro);
          }
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
        addWeights(longS, 0.5, 0.5);
        addWeights(longB, 0.5, 0.5);
      } else if (validLongS) {
        longEW = aggEW(longS);
        longVW = aggVW(longS);
        addWeights(longS, 1.0, 1.0);
      } else if (validLongB) {
        longEW = aggEW(longB);
        longVW = aggVW(longB);
        addWeights(longB, 1.0, 1.0);
      }

      if (strategy === "long_short") {
        if (validShortS && validShortB) {
          shortEW = (aggEW(shortS) + aggEW(shortB)) / 2;
          shortVW = (aggVW(shortS) + aggVW(shortB)) / 2;
          addWeights(shortS, -0.5, -0.5);
          addWeights(shortB, -0.5, -0.5);
        } else if (validShortS) {
          shortEW = aggEW(shortS);
          shortVW = aggVW(shortS);
          addWeights(shortS, -1.0, -1.0);
        } else if (validShortB) {
          shortEW = aggEW(shortB);
          shortVW = aggVW(shortB);
          addWeights(shortB, -1.0, -1.0);
        }
      }
    }

    const ewGross = strategy === "long_short" ? longEW - shortEW : longEW;
    const vwGross = strategy === "long_short" ? longVW - shortVW : longVW;
    let ewNet = ewGross;
    let vwNet = vwGross;

    let monthEwTurnover = 0;
    let monthVwTurnover = 0;
    const allCodes = new Set([...prevEwWeights.keys(), ...currWeights.keys()]);
    
    for (const c of allCodes) {
      const pEw = prevEwWeights.get(c) || 0;
      const pVw = prevVwWeights.get(c) || 0;
      const curr = currWeights.get(c) || { ew: 0, vw: 0, r: 0 };
      monthEwTurnover += Math.abs(curr.ew - pEw);
      monthVwTurnover += Math.abs(curr.vw - pVw);
    }

    if (monthIndex > 0 || transactionCost.includeFormation) {
      totalEwTurnover += monthEwTurnover;
      totalVwTurnover += monthVwTurnover;
      turnoverCount++;
      if (transactionCost.mode !== "none") {
        ewNet -= monthEwTurnover * transactionCost.cost;
        vwNet -= monthVwTurnover * transactionCost.cost;
      }
    }

    // Prepare drift for next month based on gross return
    prevEwWeights = new Map();
    prevVwWeights = new Map();
    const ewDenom = 1 + (ewGross || 0);
    const vwDenom = 1 + (vwGross || 0);
    
    for (const [c, w] of currWeights.entries()) {
      if (ewDenom > 0) prevEwWeights.set(c, (w.ew * (1 + w.r)) / ewDenom);
      if (vwDenom > 0) prevVwWeights.set(c, (w.vw * (1 + w.r)) / vwDenom);
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
    ew_metrics: computeMetrics(ewRets, rfSeries, strategy === "long_short"),
    vw_metrics: computeMetrics(vwRets, rfSeries, strategy === "long_short"),
    ew_drawdown: computeDrawdown(ewRets),
    vw_drawdown: computeDrawdown(vwRets),
    holdings: {},
    isLongShort: strategy === "long_short",
    avgTurnover:
      turnoverCount > 0 ? +(((totalEwTurnover + totalVwTurnover) / 2 / turnoverCount) * 100).toFixed(1) : 0,
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
  const benchmarkByMonth = {};
  for (const [month, benchmark] of Object.entries(runtimeData.benchmarkByMonth || {})) {
    if (month >= start && month <= end) {
      benchmarkByMonth[month] = {
        nifty50: benchmark.nifty50,
        nifty500: benchmark.nifty500,
      };
    }
  }
  return { benchmarkByMonth, rfData: runtimeData.rfData || {} };
}

export async function getUniverseMeta(env, universeInput = "all") {
  const universe = normalizeUniverse(universeInput);
  const meta = UNIVERSE_META[universe];
  const months = monthRange(meta.firstMonth, meta.lastMonth);

  return {
    universe,
    rowCount: meta.rowCount,
    months,
    firstMonth: meta.firstMonth,
    lastMonth: meta.lastMonth,
    dataQualityStats: { dropped: 0, capped: 0, total: meta.rowCount },
  };
}

export async function warmUniverse(env, universeInput = "all") {
  const universe = normalizeUniverse(universeInput);
  await selectTable(env, "factor_panel", `select=month&limit=1&universe=eq.${universe}`);
}

async function attachHoldings(env, universe, portfolio, sizeCol, monthsList, netByMonth) {
  const config = portfolio.config || {};
  const longFilters = config.longFilters || {};
  const shortFilters = config.shortFilters || {};
  const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
  const usePortfolioCodes = universe === "all";
  const longParams = buildLegParams(longFilters, { usePortfolioCodes });
  const shortParams = buildLegParams(shortFilters, { usePortfolioCodes });

  for (const month of monthsList) {
    const longRows = await callRpc(env, "get_holdings", {
      p_universe: universe,
      p_month: month,
      p_size_col: sizeCol,
      p_size_labels: longParams.sizeLabels,
      p_filters: longParams.pFilters,
    }, { paginate: true });
    let shortRows = [];
    if (strategy === "long_short") {
      shortRows = await callRpc(env, "get_holdings", {
        p_universe: universe,
        p_month: month,
        p_size_col: sizeCol,
        p_size_labels: shortParams.sizeLabels,
        p_filters: shortParams.pFilters,
      }, { paginate: true });
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
    : "nifty500";

  const data = await loadMarketData(env, startMonth, endMonth);
  const benchmarkSeries = computeAllBenchmarks(data, months);

  const inputPorts = input.portfolios.slice(0, 5);
  const portfolios = await Promise.all(inputPorts.map(async (portfolio, index) => {
    const config = portfolio.config || {};
    const longFilters = config.longFilters || {};
    const shortFilters = config.shortFilters || {};
    const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
    const usePortfolioCodes = universe === "all";
    const sizeCol = getSizeColumn(longFilters, shortFilters, { usePortfolioCodes });
    const includeTurnover = transactionCost.mode !== "none";

    const longParams = buildLegParams(longFilters, { usePortfolioCodes });
    const longRowsPromise = callRpc(
      env,
      "run_backtest_legs_json",
      {
        p_universe: universe,
        p_start: startMonth,
        p_end: endMonth,
        p_size_col: sizeCol,
        p_size_labels: longParams.sizeLabels,
        p_filters: longParams.pFilters,
        p_include_turnover: includeTurnover,
      },
    );

    let shortRowsPromise = Promise.resolve([]);
    if (strategy === "long_short") {
      const shortParams = buildLegParams(shortFilters, { usePortfolioCodes });
      shortRowsPromise = callRpc(
        env,
        "run_backtest_legs_json",
        {
          p_universe: universe,
          p_start: startMonth,
          p_end: endMonth,
          p_size_col: sizeCol,
          p_size_labels: shortParams.sizeLabels,
          p_filters: shortParams.pFilters,
          p_include_turnover: includeTurnover,
        },
      );
    }

    const [longRows, shortRows] = await Promise.all([longRowsPromise, shortRowsPromise]);

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
    return built;
  }));

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
  const universe = normalizeUniverse(input?.universe);
  const data = new TextEncoder().encode(
    stableStringify({
      version: BACKTEST_CACHE_VERSION,
      universe,
      input: { ...input, universe },
    }),
  );
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
