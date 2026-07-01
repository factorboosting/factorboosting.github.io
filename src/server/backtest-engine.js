import {
  BACKTEST_RUNTIME_FILE,
  getBacktestUniverseSnapshotFile,
  readBundledDataFile,
  readDataFile,
} from "./data-source.js";
import { parseCSV } from "./csv.js";
import {
  BENCHMARK_OPTIONS,
  FACTORS,
  getPortfolioFilter,
  getPortfolioSizeColumn,
  RET_CAP_HI,
  RET_CAP_LO,
  RET_DROP_HI,
  RET_DROP_LO,
  UNIVERSE_FILES,
} from "./factor-config.js";

const universeCache = new Map();
let benchmarkCachePromise = null;
let runtimeDataPromise = null;

export function normalizeUniverse(universe) {
  return UNIVERSE_FILES[universe] ? universe : "all";
}

function sanitizeReturn(raw) {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return { value: null, action: "drop" };
  }
  if (value <= RET_DROP_LO || value >= RET_DROP_HI) {
    return { value: null, action: "drop" };
  }
  if (value > RET_CAP_HI) return { value: RET_CAP_HI, action: "capped" };
  if (value < RET_CAP_LO) return { value: RET_CAP_LO, action: "capped" };
  return { value, action: "ok" };
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

async function loadRuntimeData() {
  if (runtimeDataPromise) return runtimeDataPromise;

  runtimeDataPromise = (async () => {
    try {
      return JSON.parse(await readBundledDataFile(BACKTEST_RUNTIME_FILE));
    } catch {
      try {
        return JSON.parse(await readDataFile(BACKTEST_RUNTIME_FILE));
      } catch {
        return null;
      }
    }
  })();

  return runtimeDataPromise;
}

async function loadBenchmarks() {
  if (benchmarkCachePromise) return benchmarkCachePromise;

  benchmarkCachePromise = (async () => {
    const runtimeData = await loadRuntimeData();
    if (runtimeData?.benchmarkByMonth && runtimeData?.rfData) {
      return {
        benchmarkByMonth: runtimeData.benchmarkByMonth,
        names: runtimeData.names || {},
        rfData: runtimeData.rfData,
      };
    }

    const rfData = {};
    const benchmarkByMonth = {};
    const names = {};

    try {
      const ff5 = await readDataFile("Data/Factor_Data/ff5.csv");
      parseCSV(ff5, (row) => {
        if (row.Month && row.Rf !== undefined && row.Rf !== "") {
          rfData[row.Month.substring(0, 7)] = Number.parseFloat(row.Rf);
        }
      });
    } catch {
      // Rf is optional for rendering; metrics fall back to zero risk-free return.
    }

    const labels = await readDataFile("Data/Factor_Data/finalMonthlyLabels_aman.csv");
    parseCSV(labels, (row) => {
      const month = row.Month ? row.Month.substring(0, 7) : "";
      const code = row.Co_Code || row.co_code;
      if (code && row.Co_Name) names[code] = row.Co_Name;
      if (!month) return;

      if (!benchmarkByMonth[month]) benchmarkByMonth[month] = {};
      const nifty50 = Number.parseFloat(row.nifty50);
      const nifty500 = Number.parseFloat(row.nifty500);
      if (!Number.isNaN(nifty50)) benchmarkByMonth[month].nifty50 = nifty50;
      if (!Number.isNaN(nifty500)) benchmarkByMonth[month].nifty500 = nifty500;
    });

    return { benchmarkByMonth, names, rfData };
  })();

  return benchmarkCachePromise;
}

async function loadUniverse(universeInput) {
  return loadUniverseRange(universeInput);
}

async function loadUniverseRange(universeInput, startMonth = null, endMonth = null) {
  const universe = normalizeUniverse(universeInput);
  const cacheKey = `${universe}:${startMonth || ""}:${endMonth || ""}`;
  if (universeCache.has(cacheKey)) return universeCache.get(cacheKey);

  const promise = (async () => {
    const { benchmarkByMonth, names, rfData } = await loadBenchmarks();
    const snapshot = await loadUniverseSnapshot(
      universe,
      benchmarkByMonth,
      names,
      rfData,
      startMonth,
      endMonth,
    );
    if (snapshot) return snapshot;

    const text = await readDataFile(UNIVERSE_FILES[universe]);
    const rawData = [];
    const dataQualityStats = { dropped: 0, capped: 0, total: 0 };
    let retCol = null;

    parseCSV(text, (row) => {
      dataQualityStats.total++;
      if (!retCol) {
        if ("monthly_return" in row) retCol = "monthly_return";
        else if ("monthly_ret" in row) retCol = "monthly_ret";
        else if ("Monthly_Return" in row) retCol = "Monthly_Return";
      }

      if (!retCol) return;

      const sanitized = sanitizeReturn(row[retCol]);
      if (sanitized.action === "drop") {
        dataQualityStats.dropped++;
        return;
      }
      if (sanitized.action === "capped") dataQualityStats.capped++;

      row._month = row.Month ? row.Month.substring(0, 7) : "";
      row._size = Number.parseFloat(
        firstPresent(row, ["mktcap", "eom_mcap", "Size", "lagged_mktcap", "prev_mcap"]),
      );
      if (Number.isNaN(row._size) || row._size <= 0) row._size = 0;

      if (row.prev_mktcap !== undefined && row.prev_mktcap !== "") {
        row.prev_Size = Number.parseFloat(row.prev_mktcap);
      } else if (row.prev_mcap !== undefined && row.prev_mcap !== "") {
        row.prev_Size = Number.parseFloat(row.prev_mcap);
      } else if (row.lagged_mktcap !== undefined && row.lagged_mktcap !== "") {
        row.prev_Size = Number.parseFloat(row.lagged_mktcap);
      } else if (row.prev_Size !== undefined && row.prev_Size !== "") {
        row.prev_Size = Number.parseFloat(row.prev_Size);
      }
      if (Number.isNaN(row.prev_Size) || row.prev_Size <= 0) row.prev_Size = null;

      row.Co_Code = row.co_code || row.Co_Code;
      row.Co_Name =
        row.company_name ||
        row.Co_Name ||
        names[row.Co_Code] ||
        (row.Co_Code ? `Stock ${row.Co_Code}` : "Stock");

      if (!row.Size_Label) {
        row.Size_Label =
          row.Size_Label_Yearly ||
          row.Size_Label_annual ||
          row.Size_Label_Monthly ||
          row.Size_Label_monthly_mom ||
          row.Size_Label_monthly_vol ||
          row.Size_Label_monthly_str ||
          row.Size_Label_Monthly_Any;
      }
      if (!row.Size_Label_Yearly && row.Size_Label_annual) {
        row.Size_Label_Yearly = row.Size_Label_annual;
      }
      if (!row.Size_Label_Monthly) {
        row.Size_Label_Monthly =
          row.Size_Label_monthly_mom ||
          row.Size_Label_monthly_vol ||
          row.Size_Label_monthly_str ||
          row.Size_Label_Monthly_Any;
      }
      if (!row.MOM_Label) row.MOM_Label = row.Momentum_Label || row.Mom_Label;
      if (!row.VOL_Label && row.BAV_Label) row.VOL_Label = row.BAV_Label;
      if (!row.VOL_Label && row.Vol_Label) row.VOL_Label = row.Vol_Label;
      if (!row.STR_Label && row.Str_Label) row.STR_Label = row.Str_Label;

      row._ret = sanitized.value;
      const benchmark = benchmarkByMonth[row._month] || {};
      row._nifty50 = benchmark.nifty50 !== undefined ? benchmark.nifty50 : null;
      row._nifty500 = benchmark.nifty500 !== undefined ? benchmark.nifty500 : null;

      rawData.push(row);
    });

    if (!retCol) {
      throw new Error("Return column not found in universe data.");
    }

    const stockMap = new Map();
    for (const row of rawData) {
      if (!stockMap.has(row.Co_Code)) stockMap.set(row.Co_Code, []);
      stockMap.get(row.Co_Code).push(row);
    }

    for (const rows of stockMap.values()) {
      rows.sort((a, b) => a._month.localeCompare(b._month));
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].prev_Size == null) rows[i].prev_Size = rows[i - 1]._size;
      }
    }

    const monthGroups = {};
    for (const row of rawData) {
      if (!row._month) continue;
      if (!monthGroups[row._month]) monthGroups[row._month] = [];
      monthGroups[row._month].push(row);
    }

    const allMonths = Object.keys(monthGroups).sort();
    if (allMonths.length === 0) throw new Error("No data found.");

    return {
      allMonths,
      benchmarkByMonth,
      dataQualityStats,
      monthGroups,
      rfData,
      rowCount: rawData.length,
      universe,
    };
  })();

  universeCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    universeCache.delete(cacheKey);
    throw error;
  }
}

async function loadUniverseSnapshot(
  universe,
  benchmarkByMonth,
  names,
  rfData,
  startMonth = null,
  endMonth = null,
) {
  try {
    const runtimeData = await loadRuntimeData();
    const meta = runtimeData?.universes?.[universe];
    const chunkMetas = meta?.chunks?.length
      ? meta.chunks.filter(
          (chunk) =>
            (!startMonth || chunk.lastMonth >= startMonth) &&
            (!endMonth || chunk.firstMonth <= endMonth),
        )
      : [{ file: getBacktestUniverseSnapshotFile(universe) }];
    if (!chunkMetas.length) return null;

    const monthGroups = {};
    let rowCount = 0;

    const snapshots = await Promise.all(
      chunkMetas.map(async (chunk) => JSON.parse(await readDataFile(chunk.file))),
    );

    for (const snapshot of snapshots) {
      if (!snapshot?.columns || !snapshot?.monthGroups) continue;
      for (const [month, rows] of Object.entries(snapshot.monthGroups)) {
        if ((startMonth && month < startMonth) || (endMonth && month > endMonth)) {
          continue;
        }
        monthGroups[month] = rows.map((values) => {
          const row = {};
          for (let i = 0; i < snapshot.columns.length; i++) {
            row[snapshot.columns[i]] = values[i];
          }
          row._month = month;
          row.Co_Code = row.Co_Code == null ? "" : String(row.Co_Code);
          row.Co_Name = row.Co_Name || names[row.Co_Code] || `Stock ${row.Co_Code}`;
          return row;
        });
        rowCount += monthGroups[month].length;
      }
    }

    if (Object.keys(monthGroups).length === 0) return null;

    return {
      allMonths: Object.keys(monthGroups).sort(),
      benchmarkByMonth,
      dataQualityStats: meta?.dataQualityStats || { dropped: 0, capped: 0, total: 0 },
      monthGroups,
      rfData,
      rowCount,
      universe,
    };
  } catch {
    return null;
  }
}

export async function getUniverseMeta(universeInput = "all") {
  const universe = normalizeUniverse(universeInput);
  const runtimeData = await loadRuntimeData();
  const meta = runtimeData?.universes?.[universe];
  if (meta?.months?.length) {
    return {
      universe,
      rowCount: meta.rowCount,
      months: meta.months,
      firstMonth: meta.firstMonth || meta.months[0],
      lastMonth: meta.lastMonth || meta.months[meta.months.length - 1],
      dataQualityStats: meta.dataQualityStats,
    };
  }

  const data = await loadUniverse(universeInput);
  return {
    universe: data.universe,
    rowCount: data.rowCount,
    months: data.allMonths,
    firstMonth: data.allMonths[0],
    lastMonth: data.allMonths[data.allMonths.length - 1],
    dataQualityStats: data.dataQualityStats,
  };
}

export async function preloadUniverse(universeInput = "all") {
  return loadUniverseRange(universeInput);
}

export async function preloadUniverseRange(
  universeInput = "all",
  startMonth = null,
  endMonth = null,
) {
  return loadUniverseRange(universeInput, startMonth, endMonth);
}

function getSizeColumn(longFilters = {}, shortFilters = {}, options = {}) {
  if (options.usePortfolioCodes) {
    const portfolioCol = getPortfolioSizeColumn(longFilters, shortFilters);
    if (portfolioCol) return portfolioCol;
  }
  const has = (k) => Boolean(longFilters[k] || shortFilters[k]);
  const needsMonthly =
    has("Momentum") || has("Volatility") || has("Short-Term Reversal");
  if (needsMonthly) return "Size_Label_Monthly";
  if (has("Profitability") || has("Op. Profitability")) return "Size_Label_OP";
  if (has("Investment")) return "Size_Label_INV";
  if (has("Asset Turnover")) return "Size_Label_AT";
  if (has("Sales Growth")) return "Size_Label_SG";
  if (has("Accruals")) return "Size_Label_ACC";
  return "Size_Label_Yearly";
}

function applyFilters(rows, filters, options = {}) {
  let result = rows;
  const portfolioFilter = options.usePortfolioCodes ? getPortfolioFilter(filters) : null;
  if (portfolioFilter && rows.some((row) => row[portfolioFilter.col])) {
    const set = new Set(portfolioFilter.labels);
    return result.filter((row) => set.has(row[portfolioFilter.col]));
  }

  const sizeCol = getSizeColumn(filters, {}, options);

  for (const [factor, labels] of Object.entries(filters || {})) {
    if (!labels?.length || !FACTORS[factor]) continue;
    const set = new Set(labels);
    if (factor === "Size") {
      result = result.filter((row) => set.has(getRowSizeLabel(row, sizeCol)));
    } else {
      const col = FACTORS[factor].col;
      result = result.filter((row) => set.has(row[col]));
    }
  }

  return result;
}

function getRowSizeLabel(row, sizeCol) {
  if (sizeCol === "RMW_Portfolio" || sizeCol === "CMA_Portfolio") {
    return row[sizeCol]?.[0] || "";
  }
  return (
    row[sizeCol] ||
    row.Size_Label_Yearly ||
    row.Size_Label_Monthly ||
    row.Size_Label ||
    ""
  );
}

function calcEW(rows) {
  if (rows.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    if (row._ret != null && Number.isFinite(row._ret)) {
      sum += row._ret;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function calcVW(rows) {
  if (rows.length === 0) return 0;
  let totalWeight = 0;
  let weighted = 0;
  for (const row of rows) {
    if (row._ret == null || !Number.isFinite(row._ret)) continue;
    const weight = Number.parseFloat(row.prev_Size);
    if (Number.isNaN(weight) || weight <= 0) continue;
    totalWeight += weight;
    weighted += row._ret * weight;
  }
  return totalWeight <= 0 ? calcEW(rows) : weighted / totalWeight;
}

// Old calcTurnover removed in favor of weight-based turnover

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
    active.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (active.length - 1);
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
    years > 0 && cumulativeProduct > 0
      ? Math.pow(cumulativeProduct, 1 / years) - 1
      : 0;

  const mean = rets.reduce((sum, ret) => sum + ret, 0) / count;
  const variance =
    rets.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) /
    Math.max(count - 1, 1);
  const annualizedVolatility = Math.sqrt(variance * 12);
  const excessRets = rets.map((ret, index) => ret - (isLongShort ? 0 : (rfs[index] || 0)));
  const meanExcess = excessRets.reduce((sum, ret) => sum + ret, 0) / count;
  const sharpe =
    annualizedVolatility > 0 ? (meanExcess * 12) / annualizedVolatility : 0;

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
  return rows
    .filter((row) => row._ret != null && Number.isFinite(row._ret))
    .map((row) => ({
      name:
        row.Co_Name ||
        row.co_name ||
        row.company_name ||
        row["Company Name"] ||
        "—",
      ret: +(row._ret * 100).toFixed(2),
      size: row._size,
    }))
    .sort((a, b) => b.ret - a.ret);
}

function computePortfolio(data, config, months, transactionCost, options = {}) {
  const longFilters = config.longFilters || {};
  const shortFilters = config.shortFilters || {};
  const strategy = config.strategy === "long_short" ? "long_short" : "long_only";
  const filterOptions = { usePortfolioCodes: data.universe === "all" };
  const ewPort = [100];
  const vwPort = [100];
  const ewRets = [];
  const vwRets = [];
  const holdings = {};
  const holdingsMonthSet = Array.isArray(options.holdingsMonths)
    ? new Set(options.holdingsMonths)
    : null;
  const minFirms = 5;
  let prevEwWeights = new Map();
  let prevVwWeights = new Map();
  let totalEwTurnover = 0;
  let totalVwTurnover = 0;
  let turnoverCount = 0;

  for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
    const month = months[monthIndex];
    const monthRows = data.monthGroups[month] || [];
    const longDF = applyFilters(monthRows, longFilters, filterOptions);
    const shortDF =
      strategy === "long_short" ? applyFilters(monthRows, shortFilters, filterOptions) : [];

    const sizeCol = getSizeColumn(longFilters, shortFilters, filterOptions);
    const longS = longDF.filter((row) => getRowSizeLabel(row, sizeCol) === "S");
    const longB = longDF.filter((row) => getRowSizeLabel(row, sizeCol) === "B");
    const shortS = shortDF.filter((row) => getRowSizeLabel(row, sizeCol) === "S");
    const shortB = shortDF.filter((row) => getRowSizeLabel(row, sizeCol) === "B");

    const longAllowsS = !longFilters.Size || longFilters.Size.includes("S");
    const longAllowsB = !longFilters.Size || longFilters.Size.includes("B");
    const shortAllowsS =
      strategy === "long_short" &&
      (!shortFilters.Size || shortFilters.Size.includes("S"));
    const shortAllowsB =
      strategy === "long_short" &&
      (!shortFilters.Size || shortFilters.Size.includes("B"));

    let validLongS = longAllowsS && longS.length >= minFirms;
    let validLongB = longAllowsB && longB.length >= minFirms;
    let validShortS = shortAllowsS && shortS.length >= minFirms;
    let validShortB = shortAllowsB && shortB.length >= minFirms;

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

    let finalLongDF = [];
    let finalShortDF = [];
    if (validLongS) finalLongDF = finalLongDF.concat(longS);
    if (validLongB) finalLongDF = finalLongDF.concat(longB);
    if (strategy === "long_short") {
      if (validShortS) finalShortDF = finalShortDF.concat(shortS);
      if (validShortB) finalShortDF = finalShortDF.concat(shortB);
    }

    let longEW = null;
    let longVW = null;
    let shortEW = null;
    let shortVW = null;

    const currWeights = new Map();
    function addWeights(cellRows, macroEwWeight, macroVwWeight) {
      if (!cellRows || cellRows.length === 0) return;
      
      const validRows = cellRows.filter(r => r._ret != null && Number.isFinite(r._ret));
      if (validRows.length === 0) return;
      
      const ewMicro = macroEwWeight / validRows.length;
      let sum_mcap = 0;
      for (const row of validRows) {
        const weight = Number.parseFloat(row.prev_Size);
        if (!Number.isNaN(weight) && weight > 0) sum_mcap += weight;
      }
      
      for (const row of validRows) {
        if (!currWeights.has(row.Co_Code)) currWeights.set(row.Co_Code, { ew: 0, vw: 0, r: row._ret });
        const w = currWeights.get(row.Co_Code);
        w.ew += ewMicro;
        const weight = Number.parseFloat(row.prev_Size);
        if (sum_mcap > 0 && !Number.isNaN(weight) && weight > 0) {
          w.vw += macroVwWeight * (weight / sum_mcap);
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
          const subLong = longLeg.filter((row) => row.BM_Label === bucket);
          const subShort = shortLeg.filter((row) => row.BM_Label === bucket);
          if (subLong.length >= minFirms && subShort.length >= minFirms) {
            validBuckets.push(bucket);
          }
        }
      }

      if (validBuckets.length > 0) {
        const longEws = [];
        const longVws = [];
        const shortEws = [];
        const shortVws = [];
        const macro = 1.0 / validBuckets.length;

        for (const bucket of validBuckets) {
          const subLong = longLeg.filter((row) => row.BM_Label === bucket);
          const subShort = shortLeg.filter((row) => row.BM_Label === bucket);
          longEws.push(calcEW(subLong));
          longVws.push(calcVW(subLong));
          shortEws.push(calcEW(subShort));
          shortVws.push(calcVW(subShort));
          
          addWeights(subLong, macro, macro);
          if (strategy === "long_short") {
            addWeights(subShort, -macro, -macro);
          }
        }

        longEW = longEws.reduce((sum, value) => sum + value, 0) / validBuckets.length;
        longVW = longVws.reduce((sum, value) => sum + value, 0) / validBuckets.length;
        shortEW =
          shortEws.reduce((sum, value) => sum + value, 0) / validBuckets.length;
        shortVW =
          shortVws.reduce((sum, value) => sum + value, 0) / validBuckets.length;
      }
    } else {
      if (validLongS && validLongB) {
        longEW = (calcEW(longS) + calcEW(longB)) / 2;
        longVW = (calcVW(longS) + calcVW(longB)) / 2;
        addWeights(longS, 0.5, 0.5);
        addWeights(longB, 0.5, 0.5);
      } else if (validLongS) {
        longEW = calcEW(longS);
        longVW = calcVW(longS);
        addWeights(longS, 1.0, 1.0);
      } else if (validLongB) {
        longEW = calcEW(longB);
        longVW = calcVW(longB);
        addWeights(longB, 1.0, 1.0);
      }

      if (strategy === "long_short") {
        if (validShortS && validShortB) {
          shortEW = (calcEW(shortS) + calcEW(shortB)) / 2;
          shortVW = (calcVW(shortS) + calcVW(shortB)) / 2;
          addWeights(shortS, -0.5, -0.5);
          addWeights(shortB, -0.5, -0.5);
        } else if (validShortS) {
          shortEW = calcEW(shortS);
          shortVW = calcVW(shortS);
          addWeights(shortS, -1.0, -1.0);
        } else if (validShortB) {
          shortEW = calcEW(shortB);
          shortVW = calcVW(shortB);
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

    const portCap = 2;
    ewNet = Math.max(-portCap, Math.min(portCap, ewNet));
    vwNet = Math.max(-portCap, Math.min(portCap, vwNet));

    ewRets.push(ewNet);
    vwRets.push(vwNet);
    ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
    vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));

    if (!holdingsMonthSet || holdingsMonthSet.has(month)) {
      holdings[month] = {
        long_firms: toFirms(longDF),
        short_firms: toFirms(shortDF),
        long_total: longDF.length,
        short_total: shortDF.length,
        ew_ret: +(ewNet * 100).toFixed(3),
        vw_ret: +(vwNet * 100).toFixed(3),
      };
    }
  }

  const rfSeries = months.map((month) => data.rfData[month] || 0);

  return {
    months,
    ew_portfolio: ewPort.slice(1).map((value) => +value.toFixed(4)),
    vw_portfolio: vwPort.slice(1).map((value) => +value.toFixed(4)),
    ew_rets: ewRets,
    vw_rets: vwRets,
    ew_metrics: computeMetrics(ewRets, rfSeries, strategy === "long_short"),
    vw_metrics: computeMetrics(vwRets, rfSeries, strategy === "long_short"),
    ew_drawdown: computeDrawdown(ewRets),
    vw_drawdown: computeDrawdown(vwRets),
    holdings,
    isLongShort: strategy === "long_short",
    avgTurnover:
      turnoverCount > 0 ? +(((totalEwTurnover + totalVwTurnover) / 2 / turnoverCount) * 100).toFixed(1) : 0,
  };
}

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

export async function computeBacktest(input) {
  const meta = await getUniverseMeta(input.universe);
  const startMonth = input.startMonth || meta.months[Math.max(0, meta.months.length - 120)];
  const endMonth = input.endMonth || meta.months[meta.months.length - 1];
  const data = await loadUniverseRange(input.universe, startMonth, endMonth);
  const months = meta.months.filter(
    (month) => month >= startMonth && month <= endMonth,
  );

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
  const benchmarkSeries = computeAllBenchmarks(data, months);

  const portfolios = input.portfolios.slice(0, 5).map((portfolio, index) => ({
    id: portfolio.id ?? index + 1,
    name: portfolio.name || `Portfolio ${index + 1}`,
    factorLabel: portfolio.factorLabel || "—",
    colorIdx: portfolio.colorIdx ?? index,
    config: portfolio.config,
    results: computePortfolio(data, portfolio.config || {}, months, transactionCost, {
      holdingsMonths,
    }),
  }));

  const activeBenchmark = benchmarkSeries[activeBenchmarkId];
  for (const portfolio of portfolios) {
    portfolio.results.ew_metrics.ir = computeIR(
      portfolio.results.ew_rets,
      activeBenchmark.rets,
    );
    portfolio.results.vw_metrics.ir = computeIR(
      portfolio.results.vw_rets,
      activeBenchmark.rets,
    );
  }

  return {
    activeBenchmarkId,
    benchmarkSeries,
    months,
    portfolios,
    meta: {
      universe: data.universe,
      rowCount: meta.rowCount,
      firstMonth: meta.firstMonth,
      lastMonth: meta.lastMonth,
      dataQualityStats: data.dataQualityStats,
    },
  };
}
