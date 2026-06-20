// backtester.js – Multi-portfolio comparison
// 10 factors with collapsible picker, TC, benchmark (Nifty50/500), drawdown, heatmap, IR

const BT = (() => {
  "use strict";

  const MAX_PORTFOLIOS = 5;
  const COLORS = [
    { line: "#3b82f6", bg: "rgba(59,130,246,0.08)", chip: "#3b82f6" },
    { line: "#10b981", bg: "rgba(16,185,129,0.08)", chip: "#10b981" },
    { line: "#f59e0b", bg: "rgba(245,158,11,0.08)", chip: "#f59e0b" },
    { line: "#8b5cf6", bg: "rgba(139,92,246,0.08)", chip: "#8b5cf6" },
    { line: "#ec4899", bg: "rgba(236,72,153,0.08)", chip: "#ec4899" },
  ];
  const BENCH_COLOR = { line: "#ef4444", bg: "rgba(239,68,68,0.06)" };
  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // ── Return sanitization config ────────────────────────────────────────────
  // Monthly returns above/below these get *winsorized* (capped), not zeroed.
  // Zeroing biases portfolios downward; capping preserves direction.
  const RET_CAP_HI = Infinity; // cap it at the max return seen in CSV (effectively no cap)
  const RET_CAP_LO = -Infinity; 
  const RET_DROP_HI = Infinity; // also disable drop to ensure max return is kept
  const RET_DROP_LO = -Infinity;

  // ── All 10 factors ────────────────────────────────────────────────────────
  const FACTOR_GROUPS = {
    "Classic (FF5 + Momentum)": {
      Size: { col: "Size_Label", labels: { B: "Big", S: "Small" } },
      "Book-to-Market": {
        col: "BM_Label",
        labels: { G: "Growth", N: "Neutral", V: "Value" },
      },
      "Profitability": {
        col: "OP_Label",
        labels: { R: "Robust", N: "Neutral", W: "Weak" },
      },
      Investment: {
        col: "INV_Label",
        labels: { A: "Aggressive", N: "Neutral", C: "Conservative" },
      },
      Momentum: {
        col: "MOM_Label",
        labels: { W: "Winner", N: "Neutral", L: "Loser" },
      },
    },
    "Other Factors": {
      "Asset Turnover": {
        col: "AT_Label",
        labels: { H: "High", N: "Neutral", L: "Low" },
      },
      "Sales Growth": {
        col: "SG_Label",
        labels: { H: "High", N: "Neutral", L: "Low" },
      },
      Accruals: {
        col: "ACC_Label",
        labels: { C: "Conservative", N: "Neutral", A: "Aggressive" },
      },
      Volatility: {
        col: "VOL_Label",
        labels: { L: "Low", N: "Neutral", H: "High" },
      },
      "Short-Term Reversal": {
        col: "STR_Label",
        labels: { L: "Loser", N: "Neutral", H: "Winner" },
      },
    },
  };

  const FACTORS = {};
  for (const group of Object.values(FACTOR_GROUPS)) {
    for (const [name, info] of Object.entries(group)) FACTORS[name] = info;
  }

  const BENCHMARK_OPTIONS = {
    nifty50: { col: "nifty50", label: "NIFTY500" },
    nifty500: { col: "nifty500", label: "Market" },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let rawData = [],
    monthGroups = {},
    allMonths = [];
  let serverMode = false,
    dataLoaded = false,
    urlPresetApplied = false;
  let chartInst = null,
    ddChartInst = null;
  let currentStrategy = "long_only",
    currentWeight = "vw";
  let portfolios = [],
    nextId = 1;
  let activeHoldingsId = null,
    currentMonthIdx = 0,
    runMonths = [];
  let benchmarkSeries = {};
  let activeBenchmarkId = "nifty50";
  let showBenchmark = true;
  let heatmapOpen = false,
    heatmapPortfolioId = null;
  let holdingsFetchTimer = null,
    holdingsRenderToken = 0;
  const holdingsFetches = new Map();
  let activeFactors = new Set(["Momentum"]);
  let dataQualityStats = { dropped: 0, capped: 0, total: 0 };

  // ── CSV parser ────────────────────────────────────────────────────────────
  function parseCSV(text) {
    const lines = text.split("\n");
    if (lines.length < 2) return [];

    function splitCSVRow(str) {
      const result = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '"' && str[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    }

    const headers = splitCSVRow(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const vals = splitCSVRow(line);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = vals[idx] !== undefined ? vals[idx] : "";
      });
      rows.push(obj);
    }
    return rows;
  }

  function firstPresent(row, keys) {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== "") return row[key];
    }
    return "";
  }

  // ── Sanitize a single return: returns { value, action: 'ok'|'capped'|'drop' }
  function sanitizeReturn(raw) {
    const v = parseFloat(raw);
    if (isNaN(v) || !isFinite(v)) return { value: null, action: "drop" };
    // Drop totally implausible values (data errors)
    if (v <= RET_DROP_LO || v >= RET_DROP_HI)
      return { value: null, action: "drop" };
    // Winsorize moderately extreme values
    if (v > RET_CAP_HI) return { value: RET_CAP_HI, action: "capped" };
    if (v < RET_CAP_LO) return { value: RET_CAP_LO, action: "capped" };
    return { value: v, action: "ok" };
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  let benchmarkCache = null;
  let currentUniverse = null;
  let rfData = {};

  function getApiError(payload, fallbackMessage) {
    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
    return fallbackMessage;
  }

  function shouldUseStaticFallback(error) {
    return error?.fallbackToStatic || window.location.protocol === "file:";
  }

  function showDataLoadError(message) {
    const notice = document.getElementById("bt-data-notice");
    if (notice) {
      notice.style.display = "block";
      notice.className = "bt-data-notice error";
      notice.innerHTML = `Failed to load server data: ${message}`;
    }

    const runBtn = document.getElementById("bt-run-btn");
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = "Data unavailable";
    }

    const loaderOverlay = document.getElementById("data-loading-overlay");
    if (loaderOverlay) loaderOverlay.style.display = "none";
  }

  function warmServerUniverse(universe) {
    if (window.location.protocol === "file:") return;
    const start = document.getElementById("bt-start-month")?.value || "";
    const end = document.getElementById("bt-end-month")?.value || "";
    const params = new URLSearchParams({
      universe,
      warm: "1",
    });
    if (start) params.set("startMonth", start);
    if (end) params.set("endMonth", end);
    fetch(`/api/backtest?${params.toString()}`, {
      cache: "no-store",
    }).catch((error) => {
      console.info("Backtest warmup skipped.", error);
    });
  }

  async function loadBenchmarks() {
    if (benchmarkCache) return benchmarkCache;
    try {
      try {
        const rfRes = await fetch("Data/Factor_Data/ff5.csv");
        if (rfRes.ok) {
          const rfText = await rfRes.text();
          const rfParsed = parseCSV(rfText);
          rfParsed.forEach((row) => {
            if (row.Month && row.Rf !== undefined && row.Rf !== "") {
              rfData[row.Month.substring(0, 7)] = parseFloat(row.Rf);
            }
          });
        }
      } catch (e) {
        console.error("Failed to load ff5.csv Rf data", e);
      }

      const res = await fetch("Data/Factor_Data/finalMonthlyLabels_aman.csv");
      if (!res.ok) return { b: {}, names: {} };
      const parsed = parseCSV(await res.text());
      const b = {};
      const names = {};
      parsed.forEach((row) => {
        const m = row.Month ? row.Month.substring(0, 7) : "";
        const code = row.Co_Code || row.co_code;
        if (code && row.Co_Name) names[code] = row.Co_Name;
        if (!m) return;
        const n50 = parseFloat(row.nifty50);
        const n500 = parseFloat(row.nifty500);
        if (!b[m]) b[m] = {};
        if (!isNaN(n50)) b[m].nifty50 = n50;
        if (!isNaN(n500)) b[m].nifty500 = n500;
      });
      benchmarkCache = { b, names };
      return benchmarkCache;
    } catch (e) {
      console.error(e);
      return { b: {}, names: {} };
    }
  }

  function bindTransactionCostToggle() {
    const toggle = document.getElementById("bt-tc-toggle");
    if (!toggle || toggle.dataset.bound === "true") return;
    toggle.dataset.bound = "true";
    toggle.addEventListener("click", () => {
      const active = document.querySelector(
        "#bt-tc-toggle .bt-toggle-btn.active",
      );
      document.getElementById("bt-tc-row").style.display =
        active && active.dataset.val === "bps" ? "flex" : "none";
    });
  }

  function buildUrlPreset(code) {
    const simple = {
      MKT: { targetFactors: [{ name: "Size", long: ["B", "S"] }] },
      SMB: {
        targetFactors: [{ name: "Size", long: ["S"], short: ["B"] }],
        isLongShort: true,
      },
      HML: {
        targetFactors: [
          { name: "Book-to-Market", long: ["V"], short: ["G"] },
        ],
        isLongShort: true,
      },
      WML: {
        targetFactors: [{ name: "Momentum", long: ["W"], short: ["L"] }],
        isLongShort: true,
      },
      RMW: {
        targetFactors: [
          { name: "Profitability", long: ["R"], short: ["W"] },
        ],
        isLongShort: true,
      },
      CMA: {
        targetFactors: [{ name: "Investment", long: ["C"], short: ["A"] }],
        isLongShort: true,
      },
      AT: {
        targetFactors: [
          { name: "Asset Turnover", long: ["H"], short: ["L"] },
        ],
        isLongShort: true,
      },
      SG: {
        targetFactors: [{ name: "Sales Growth", long: ["H"], short: ["L"] }],
        isLongShort: true,
      },
      ACC: {
        targetFactors: [{ name: "Accruals", long: ["C"], short: ["A"] }],
        isLongShort: true,
      },
      VOL: {
        targetFactors: [{ name: "Volatility", long: ["L"], short: ["H"] }],
        isLongShort: true,
      },
      STR: {
        targetFactors: [
          { name: "Short-Term Reversal", long: ["L"], short: ["H"] },
        ],
        isLongShort: true,
      },
    };
    if (simple[code]) return simple[code];

    const size = code?.[0];
    if (!["S", "B"].includes(size)) return null;
    const factorCode = code.slice(1);
    const factorMaps = [
      {
        prefix: "BM_",
        name: "Book-to-Market",
        labels: { N: "N" },
      },
      {
        prefix: "M_",
        name: "Momentum",
        labels: { L: "L", N: "N", W: "W" },
      },
      {
        prefix: "OP_",
        name: "Profitability",
        labels: { N: "N" },
      },
      {
        prefix: "I_",
        name: "Investment",
        labels: { N: "N" },
      },
      {
        prefix: "AT_",
        name: "Asset Turnover",
        labels: { H: "H", N: "N", L: "L" },
      },
      {
        prefix: "SG_",
        name: "Sales Growth",
        labels: { H: "H", N: "N", L: "L" },
      },
      {
        prefix: "ACC_",
        name: "Accruals",
        labels: { C: "C", N: "N", A: "A" },
      },
      {
        prefix: "VOL_",
        name: "Volatility",
        labels: { L: "L", N: "N", H: "H" },
      },
      {
        prefix: "STR_",
        name: "Short-Term Reversal",
        labels: { L: "L", N: "N", H: "H" },
      },
    ];
    const direct = {
      V: { name: "Book-to-Market", label: "V" },
      G: { name: "Book-to-Market", label: "G" },
      R: { name: "Profitability", label: "R" },
      W: { name: "Profitability", label: "W" },
      C: { name: "Investment", label: "C" },
      A: { name: "Investment", label: "A" },
    };
    if (direct[factorCode]) {
      return {
        targetFactors: [
          { name: "Size", long: [size] },
          { name: direct[factorCode].name, long: [direct[factorCode].label] },
        ],
      };
    }
    for (const item of factorMaps) {
      if (!factorCode.startsWith(item.prefix)) continue;
      const label = factorCode.slice(item.prefix.length);
      if (!item.labels[label]) return null;
      return {
        targetFactors: [
          { name: "Size", long: [size] },
          { name: item.name, long: [item.labels[label]] },
        ],
      };
    }
    return null;
  }

  function applyUrlPresetFromUrl() {
    if (urlPresetApplied) return;
    const factorParam = new URLSearchParams(window.location.search).get(
      "factor",
    );
    const preset = buildUrlPreset(factorParam);
    if (!preset?.targetFactors?.length) return;
    urlPresetApplied = true;

    activeFactors.clear();
    preset.targetFactors.forEach((factor) => activeFactors.add(factor.name));
    buildFactorPicker();
    buildFactorPills("bt-long-factors", "long");
    buildFactorPills("bt-short-factors", "short");

    const strategyBtn = document.querySelector(
      `#bt-strategy-toggle .bt-toggle-btn[data-val="${preset.isLongShort ? "long_short" : "long_only"}"]`,
    );
    if (strategyBtn) setStrategy(strategyBtn);

    preset.targetFactors.forEach((factor) => {
      (factor.long || []).forEach((code) => {
        const btn = document.querySelector(
          `.bt-pill[data-factor="${factor.name}"][data-code="${code}"][data-side="long"]`,
        );
        if (btn) btn.classList.add("sel-long");
      });
      if (!preset.isLongShort) return;
      (factor.short || []).forEach((code) => {
        const btn = document.querySelector(
          `.bt-pill[data-factor="${factor.name}"][data-code="${code}"][data-side="short"]`,
        );
        if (btn) btn.classList.add("sel-short");
      });
    });

    addPortfolio();
    setTimeout(() => {
      runAll();
    }, 100);
  }

  async function loadData() {
    const notice = document.getElementById("bt-data-notice");
    const universe = getToggleVal("bt-universe-toggle") || "all";
    if (currentUniverse === universe && dataLoaded && serverMode) return;

    if (notice) {
      notice.style.display = "block";
      notice.className = "bt-data-notice loading";
      notice.textContent = "Preparing analysis engine...";
    }

    try {
      const res = await fetch(
        `/api/backtest?universe=${encodeURIComponent(universe)}`,
      );
      let meta = null;
      try {
        meta = await res.json();
      } catch {
        meta = null;
      }
      if (!res.ok || !meta?.ok) {
        const error = new Error(
          getApiError(meta, `API metadata failed (${res.status})`),
        );
        error.fallbackToStatic = res.status === 404;
        throw error;
      }

      serverMode = true;
      dataLoaded = true;
      rawData = [];
      monthGroups = {};
      allMonths = meta.months || [];
      currentUniverse = universe;
      dataQualityStats = meta.dataQualityStats || {
        dropped: 0,
        capped: 0,
        total: meta.rowCount || 0,
      };

      const smEl = document.getElementById("bt-start-month");
      const emEl = document.getElementById("bt-end-month");
      const oldStart = smEl.value;
      const oldEnd = emEl.value;
      smEl.min = emEl.min = meta.firstMonth || allMonths[0];
      smEl.max = emEl.max = meta.lastMonth || allMonths[allMonths.length - 1];
      const defaultStartIdx = Math.max(0, allMonths.length - 120);
      
      if (oldStart && oldStart >= smEl.min && oldStart <= smEl.max) {
        smEl.value = oldStart;
      } else {
        smEl.value = allMonths[defaultStartIdx];
      }
      
      if (oldEnd && oldEnd >= emEl.min && oldEnd <= emEl.max) {
        emEl.value = oldEnd;
      } else {
        emEl.value = allMonths[allMonths.length - 1];
      }

      buildFactorPicker();
      buildFactorPills("bt-long-factors", "long");
      buildFactorPills("bt-short-factors", "short");
      buildBenchmarkSelector();
      bindTransactionCostToggle();

      notice.className = "bt-data-notice ready";
      const qMsg =
        dataQualityStats.dropped + dataQualityStats.capped > 0
          ? `  ·  ${dataQualityStats.dropped} dropped, ${dataQualityStats.capped} capped`
          : "";
      notice.textContent = `✓ Server engine ready · ${(meta.rowCount || 0).toLocaleString()} rows · ${allMonths.length} months (${allMonths[0]} → ${allMonths[allMonths.length - 1]})${qMsg}`;
      document.getElementById("bt-run-btn").disabled = false;
      document.getElementById("bt-run-btn").textContent = "Run Analysis";
      setTimeout(() => {
        notice.style.display = "none";
      }, 5000);

      const loaderOverlay = document.getElementById("data-loading-overlay");
      if (loaderOverlay) loaderOverlay.style.display = "none";
      applyUrlPresetFromUrl();
    } catch (error) {
      if (shouldUseStaticFallback(error)) {
        console.info("Backtest API unavailable; falling back to browser mode.", error);
        serverMode = false;
        dataLoaded = false;
        await loadDataLocal();
        return;
      }

      console.error("Backtest API failed.", error);
      serverMode = false;
      dataLoaded = false;
      showDataLoadError(error.message || "API metadata failed");
    }
  }

  async function loadDataLocal() {
    const notice = document.getElementById("bt-data-notice");
    const universe = getToggleVal("bt-universe-toggle") || "all";
    if (currentUniverse === universe && rawData && rawData.length > 0) return;

    if (notice) {
      notice.style.display = "block";
      notice.textContent = "Loading universe data...";
    }

    let url =
      "Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv";
    if (universe === "top500")
      url =
        "Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv";
    else if (universe === "top300")
      url =
        "Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv";

    try {
      const cache = await loadBenchmarks();
      const benchmarks = cache.b || {};
      const namesMap = cache.names || {};

      const res = await fetch(url);
      if (!res.ok) throw new Error(`CSV fetch failed (HTTP ${res.status}).`);
      const parsed = parseCSV(await res.text());

      // Detect the return column
      const sample = parsed[0] || {};
      const retCol =
        "monthly_return" in sample
          ? "monthly_return"
          : "monthly_ret" in sample
            ? "monthly_ret"
            : "Monthly_Return" in sample
              ? "Monthly_Return"
              : null;
      if (!retCol)
        throw new Error(
          "The website is under maintainance. We will get back soon.",
        );
      // if (!retCol) throw new Error('Return column not found. Expected "monthly_ret" or "Monthly_Return".');

      dataQualityStats = { dropped: 0, capped: 0, total: parsed.length };
      rawData = [];

      parsed.forEach((row) => {
        row._month = row.Month ? row.Month.substring(0, 7) : "";
        row._size = parseFloat(
          firstPresent(row, ["mktcap", "eom_mcap", "Size", "lagged_mktcap", "prev_mcap"]),
        );
        if (isNaN(row._size) || row._size <= 0) row._size = 0;

        if (row.prev_mktcap !== undefined && row.prev_mktcap !== "") {
          row.prev_Size = parseFloat(row.prev_mktcap);
          if (isNaN(row.prev_Size) || row.prev_Size <= 0) row.prev_Size = null;
        } else if (row.prev_mcap !== undefined && row.prev_mcap !== "") {
          row.prev_Size = parseFloat(row.prev_mcap);
          if (isNaN(row.prev_Size) || row.prev_Size <= 0) row.prev_Size = null;
        } else if (row.lagged_mktcap !== undefined && row.lagged_mktcap !== "") {
          row.prev_Size = parseFloat(row.lagged_mktcap);
          if (isNaN(row.prev_Size) || row.prev_Size <= 0) row.prev_Size = null;
        }

        row.Co_Code = row.co_code || row.Co_Code;
        row.Co_Name = namesMap[row.Co_Code] || `Stock ${row.Co_Code}`;

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

        const sanitized = sanitizeReturn(row[retCol]);
        if (sanitized.action === "drop") {
          dataQualityStats.dropped++;
          return; // skip this row entirely
        }
        if (sanitized.action === "capped") dataQualityStats.capped++;
        row._ret = sanitized.value;

        // Benchmarks: keep null if missing/invalid
        const b = benchmarks[row._month] || {};
        row._nifty50 = b.nifty50 !== undefined ? b.nifty50 : null;
        row._nifty500 = b.nifty500 !== undefined ? b.nifty500 : null;

        // We temporarily push rawData, then we'll compute prev_Size
        rawData.push(row);
      });

      const stockMap = {};
      for (let i = 0; i < rawData.length; i++) {
        const code = rawData[i].Co_Code;
        if (!stockMap[code]) stockMap[code] = [];
        stockMap[code].push(rawData[i]);
      }

      Object.values(stockMap).forEach((rows) => {
        rows.sort((a, b) => a._month.localeCompare(b._month));
        for (let i = 1; i < rows.length; i++) {
          const curr = rows[i];
          const prev = rows[i - 1];
          // Strict Fama-French requires lagged size.
          // Use pre-computed prev_Size from file if available, else compute from previous row.
          if (curr.prev_Size == null) {
            curr.prev_Size = prev._size;
          }
        }
        // First month naturally has no prev_Size
      });

      monthGroups = {};
      rawData.forEach((row) => {
        if (!row._month) return;
        if (!monthGroups[row._month]) monthGroups[row._month] = [];
        monthGroups[row._month].push(row);
      });
      allMonths = Object.keys(monthGroups).sort();
      currentUniverse = universe;
      dataLoaded = true;
      serverMode = false;
      if (allMonths.length === 0) throw new Error("No data found.");

      const smEl = document.getElementById("bt-start-month");
      const emEl = document.getElementById("bt-end-month");
      const oldStart = smEl.value;
      const oldEnd = emEl.value;
      smEl.min = emEl.min = allMonths[0];
      smEl.max = emEl.max = allMonths[allMonths.length - 1];
      const defaultStartIdx = Math.max(0, allMonths.length - 120);
      
      if (oldStart && oldStart >= smEl.min && oldStart <= smEl.max) {
        smEl.value = oldStart;
      } else {
        smEl.value = allMonths[defaultStartIdx];
      }
      
      if (oldEnd && oldEnd >= emEl.min && oldEnd <= emEl.max) {
        emEl.value = oldEnd;
      } else {
        emEl.value = allMonths[allMonths.length - 1];
      }

      buildFactorPicker();
      buildFactorPills("bt-long-factors", "long");
      buildFactorPills("bt-short-factors", "short");
      buildBenchmarkSelector();
      bindTransactionCostToggle();

      notice.className = "bt-data-notice ready";
      const qMsg =
        dataQualityStats.dropped + dataQualityStats.capped > 0
          ? `  ·  ${dataQualityStats.dropped} dropped, ${dataQualityStats.capped} capped`
          : "";
      notice.textContent = `✓ ${rawData.length.toLocaleString()} rows · ${allMonths.length} months (${allMonths[0]} → ${allMonths[allMonths.length - 1]})${qMsg}`;
      document.getElementById("bt-run-btn").disabled = false;
      document.getElementById("bt-run-btn").textContent = "Run Analysis";
      setTimeout(() => {
        notice.style.display = "none";
      }, 5000);

      // Hide the full-screen data loading overlay
      const loaderOverlay = document.getElementById("data-loading-overlay");
      if (loaderOverlay) loaderOverlay.style.display = "none";

      // Handle URL Parameters for deep linking
      const urlParams = new URLSearchParams(window.location.search);
      const factorParam = urlParams.get("factor");
      if (factorParam) {
        // Clear default selections
        activeFactors.clear();

        let targetFactors = [];
        let isLongShort = false;

        switch (factorParam) {
          case "MKT":
            targetFactors = [{ name: "Size", long: ["B", "S"] }];
            break;
          case "SMB":
            targetFactors = [{ name: "Size", long: ["S"], short: ["B"] }];
            isLongShort = true;
            break;
          case "HML":
            targetFactors = [
              { name: "Book-to-Market", long: ["V"], short: ["G"] },
            ];
            isLongShort = true;
            break;
          case "WML":
            targetFactors = [{ name: "Momentum", long: ["W"], short: ["L"] }];
            isLongShort = true;
            break;
          case "RMW":
            targetFactors = [
              { name: "Profitability", long: ["R"], short: ["W"] },
            ];
            isLongShort = true;
            break;
          case "CMA":
            targetFactors = [{ name: "Investment", long: ["C"], short: ["A"] }];
            isLongShort = true;
            break;
          case "AT":
            targetFactors = [
              { name: "Asset Turnover", long: ["H"], short: ["L"] },
            ];
            isLongShort = true;
            break;
          case "SG":
            targetFactors = [
              { name: "Sales Growth", long: ["H"], short: ["L"] },
            ];
            isLongShort = true;
            break;
          case "ACC":
            targetFactors = [{ name: "Accruals", long: ["C"], short: ["A"] }];
            isLongShort = true;
            break;

          // Size & Book-to-Market
          case "SV":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Book-to-Market", long: ["V"] },
            ];
            break;
          case "SBM_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Book-to-Market", long: ["N"] },
            ];
            break;
          case "SG":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Book-to-Market", long: ["G"] },
            ];
            break;
          case "BV":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Book-to-Market", long: ["V"] },
            ];
            break;
          case "BBM_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Book-to-Market", long: ["N"] },
            ];
            break;
          case "BG":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Book-to-Market", long: ["G"] },
            ];
            break;

          // Size & Operating Profitability
          case "SR":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Profitability", long: ["R"] },
            ];
            break;
          case "SOP_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Profitability", long: ["N"] },
            ];
            break;
          case "SW":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Profitability", long: ["W"] },
            ];
            break;
          case "BR":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Profitability", long: ["R"] },
            ];
            break;
          case "BOP_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Profitability", long: ["N"] },
            ];
            break;
          case "BW":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Profitability", long: ["W"] },
            ];
            break;

          // Size & Investment
          case "SC":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Investment", long: ["C"] },
            ];
            break;
          case "SI_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Investment", long: ["N"] },
            ];
            break;
          case "SA":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Investment", long: ["A"] },
            ];
            break;
          case "BC":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Investment", long: ["C"] },
            ];
            break;
          case "BI_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Investment", long: ["N"] },
            ];
            break;
          case "BA":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Investment", long: ["A"] },
            ];
            break;

          // Momentum
          case "SM_L":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Momentum", long: ["L"] },
            ];
            break;
          case "SM_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Momentum", long: ["N"] },
            ];
            break;
          case "SM_W":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Momentum", long: ["W"] },
            ];
            break;
          case "BM_L":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Momentum", long: ["L"] },
            ];
            break;
          case "BM_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Momentum", long: ["N"] },
            ];
            break;
          case "BM_W":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Momentum", long: ["W"] },
            ];
            break;

          // Asset Turnover
          case "SAT_H":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Asset Turnover", long: ["H"] },
            ];
            break;
          case "SAT_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Asset Turnover", long: ["N"] },
            ];
            break;
          case "SAT_L":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Asset Turnover", long: ["L"] },
            ];
            break;
          case "BAT_H":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Asset Turnover", long: ["H"] },
            ];
            break;
          case "BAT_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Asset Turnover", long: ["N"] },
            ];
            break;
          case "BAT_L":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Asset Turnover", long: ["L"] },
            ];
            break;

          // Sales Growth
          case "SSG_H":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Sales Growth", long: ["H"] },
            ];
            break;
          case "SSG_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Sales Growth", long: ["N"] },
            ];
            break;
          case "SSG_L":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Sales Growth", long: ["L"] },
            ];
            break;
          case "BSG_H":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Sales Growth", long: ["H"] },
            ];
            break;
          case "BSG_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Sales Growth", long: ["N"] },
            ];
            break;
          case "BSG_L":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Sales Growth", long: ["L"] },
            ];
            break;

          // Accruals
          case "SACC_C":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Accruals", long: ["C"] },
            ];
            break;
          case "SACC_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Accruals", long: ["N"] },
            ];
            break;
          case "SACC_A":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Accruals", long: ["A"] },
            ];
            break;
          case "BACC_C":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Accruals", long: ["C"] },
            ];
            break;
          case "BACC_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Accruals", long: ["N"] },
            ];
            break;
          case "BACC_A":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Accruals", long: ["A"] },
            ];
            break;

          // Volatility
          case "SVOL_L":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Volatility", long: ["L"] },
            ];
            break;
          case "SVOL_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Volatility", long: ["N"] },
            ];
            break;
          case "SVOL_H":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Volatility", long: ["H"] },
            ];
            break;
          case "BVOL_L":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Volatility", long: ["L"] },
            ];
            break;
          case "BVOL_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Volatility", long: ["N"] },
            ];
            break;
          case "BVOL_H":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Volatility", long: ["H"] },
            ];
            break;

          // Short-Term Reversal
          case "SSTR_L":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Short-Term Reversal", long: ["L"] },
            ];
            break;
          case "SSTR_N":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Short-Term Reversal", long: ["N"] },
            ];
            break;
          case "SSTR_H":
            targetFactors = [
              { name: "Size", long: ["S"] },
              { name: "Short-Term Reversal", long: ["H"] },
            ];
            break;
          case "BSTR_L":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Short-Term Reversal", long: ["L"] },
            ];
            break;
          case "BSTR_N":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Short-Term Reversal", long: ["N"] },
            ];
            break;
          case "BSTR_H":
            targetFactors = [
              { name: "Size", long: ["B"] },
              { name: "Short-Term Reversal", long: ["H"] },
            ];
            break;
        }

        if (targetFactors.length > 0) {
          targetFactors.forEach((f) => activeFactors.add(f.name));
          buildFactorPicker();
          buildFactorPills("bt-long-factors", "long");
          buildFactorPills("bt-short-factors", "short");

          // Set strategy
          const strategyBtn = document.querySelector(
            `#bt-strategy-toggle .bt-toggle-btn[data-val="${isLongShort ? "long_short" : "long_only"}"]`,
          );
          if (strategyBtn) setStrategy(strategyBtn);

          targetFactors.forEach((f) => {
            // Click the long pills
            if (f.long) {
              f.long.forEach((code) => {
                const btn = document.querySelector(
                  `.bt-pill[data-factor="${f.name}"][data-code="${code}"][data-side="long"]`,
                );
                if (btn) btn.classList.add("sel-long");
              });
            }

            // Click the short pills
            if (isLongShort && f.short) {
              f.short.forEach((code) => {
                const btn = document.querySelector(
                  `.bt-pill[data-factor="${f.name}"][data-code="${code}"][data-side="short"]`,
                );
                if (btn) btn.classList.add("sel-short");
              });
            }
          });

          // Auto-run
          addPortfolio();
          setTimeout(() => {
            runAll();
          }, 100);
        }
      }
    } catch (err) {
      notice.className = "bt-data-notice error";
      notice.innerHTML = `Failed to load: ${err.message}`;

      // Hide the full-screen data loading overlay on error
      const loaderOverlay = document.getElementById("data-loading-overlay");
      if (loaderOverlay) loaderOverlay.style.display = "none";
    }
  }

  // ── Factor picker ─────────────────────────────────────────────────────────
  function buildFactorPicker() {
    const container = document.getElementById("bt-factor-picker");
    if (!container) return;
    container.innerHTML = "";

    for (const [groupName, factors] of Object.entries(FACTOR_GROUPS)) {
      const groupDiv = document.createElement("div");
      groupDiv.style.marginBottom = "8px";
      const groupLabel = document.createElement("div");
      groupLabel.style.cssText =
        "font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#64748b;margin-bottom:4px;";
      groupLabel.textContent = groupName;
      groupDiv.appendChild(groupLabel);

      const pillsDiv = document.createElement("div");
      pillsDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";

      for (const factorName of Object.keys(factors)) {
        const btn = document.createElement("button");
        btn.className =
          "bt-pill" + (activeFactors.has(factorName) ? " sel-long" : "");
        btn.textContent = factorName;
        btn.style.fontSize = "10px";
        btn.onclick = () => {
          if (activeFactors.has(factorName)) {
            activeFactors.delete(factorName);
            btn.classList.remove("sel-long");
          } else {
            activeFactors.add(factorName);
            btn.classList.add("sel-long");
          }
          buildFactorPills("bt-long-factors", "long");
          buildFactorPills("bt-short-factors", "short");
        };
        pillsDiv.appendChild(btn);
      }
      groupDiv.appendChild(pillsDiv);
      container.appendChild(groupDiv);
    }
  }

  function buildFactorPills(containerId, side) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    for (const [name, info] of Object.entries(FACTORS)) {
      if (!activeFactors.has(name)) continue;
      const row = document.createElement("div");
      row.className = "bt-factor-row";
      row.innerHTML = `<div class="bt-factor-name">${name}</div><div class="bt-pills"></div>`;
      container.appendChild(row);
      const pillsEl = row.querySelector(".bt-pills");
      for (const [code, label] of Object.entries(info.labels)) {
        const btn = document.createElement("button");
        btn.className = "bt-pill";
        btn.textContent = label;
        btn.dataset.factor = name;
        btn.dataset.code = code;
        btn.dataset.side = side;
        btn.onclick = () =>
          btn.classList.toggle(side === "long" ? "sel-long" : "sel-short");
        pillsEl.appendChild(btn);
      }
    }

    if (activeFactors.size === 0) {
      container.innerHTML =
        '<div style="font-size:10.5px;color:#64748b;padding:8px 0;">Select factors above to see portfolio options</div>';
    }
  }

  function buildBenchmarkSelector() {
    const container = document.getElementById("bt-benchmark-selector");
    if (!container) return;
    container.innerHTML = "";
    for (const [id, cfg] of Object.entries(BENCHMARK_OPTIONS)) {
      const btn = document.createElement("button");
      btn.className =
        "bt-toggle-btn" + (id === activeBenchmarkId ? " active" : "");
      btn.dataset.val = id;
      btn.textContent = cfg.label;
      btn.onclick = () => {
        activeBenchmarkId = id;
        document
          .querySelectorAll("#bt-benchmark-selector .bt-toggle-btn")
          .forEach((b) => b.classList.toggle("active", b.dataset.val === id));
        if (portfolios.some((p) => p.results)) {
          computeAllBenchmarks(runMonths);
          refreshAll();
        }
      };
      container.appendChild(btn);
    }
  }

  // ── Toggles ───────────────────────────────────────────────────────────────
  function setStrategy(btn) {
    currentStrategy = btn.dataset.val;
    document
      .querySelectorAll("#bt-strategy-toggle .bt-toggle-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("bt-short-wrapper").style.display =
      currentStrategy === "long_short" ? "block" : "none";

    const benchCheck = document.getElementById("bt-bench-check");
    if (benchCheck) {
      benchCheck.checked = currentStrategy === "long_only";
      showBenchmark = benchCheck.checked;
    }

    if (portfolios.some((p) => p.results)) refreshAll();
  }
  async function setToggle(groupId, btn) {
    document
      .querySelectorAll(`#${groupId} .bt-toggle-btn`)
      .forEach((b) => b.classList.toggle("active", b === btn));
    if (groupId === "bt-universe-toggle") {
      await loadData();
      if (portfolios.some((p) => p.results)) {
        runAll();
      }
    }
  }
  function getToggleVal(groupId) {
    const a = document.querySelector(`#${groupId} .bt-toggle-btn.active`);
    return a ? a.dataset.val : null;
  }
  function getFilters(side) {
    const cls = side === "long" ? "sel-long" : "sel-short";
    const f = {};
    document
      .querySelectorAll(`.bt-pill.${cls}[data-side="${side}"]`)
      .forEach((p) => {
        if (!f[p.dataset.factor]) f[p.dataset.factor] = [];
        f[p.dataset.factor].push(p.dataset.code);
      });
    return f;
  }
  function clearPills() {
    document
      .querySelectorAll(
        ".bt-pill.sel-long[data-side], .bt-pill.sel-short[data-side]",
      )
      .forEach((p) => p.classList.remove("sel-long", "sel-short"));
  }
  function setWeight(w) {
    currentWeight = w;
    document
      .querySelectorAll("#bt-weight-toggle .bt-wt-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.val === w));
    if (portfolios.some((p) => p.results)) refreshAll();
  }
  function toggleBenchmark() {
    showBenchmark = document.getElementById("bt-bench-check").checked;
    if (portfolios.some((p) => p.results)) refreshAll();
  }
  function toggleHeatmap() {
    heatmapOpen = !heatmapOpen;
    document
      .getElementById("bt-hm-arrow")
      .classList.toggle("open", heatmapOpen);
    document
      .getElementById("bt-heatmap-content")
      .classList.toggle("open", heatmapOpen);
    if (heatmapOpen) updateHeatmapGrid();
  }
  function refreshAll() {
    updateChart();
    updateDrawdown();
    updateCompareTable();
    updateHeatmapGrid();
  }

  // ── Transaction cost ──────────────────────────────────────────────────────
  function getTCConfig() {
    const mode = getToggleVal("bt-tc-toggle");
    if (mode === "none") return { mode: "none", cost: 0 };
    const val = parseFloat(document.getElementById("bt-tc-value").value) || 0;
    return { mode: "bps", cost: val / 10000 };
  }

  function calcTurnover(prevStocks, currStocks) {
    if (!prevStocks || prevStocks.size === 0)
      return { entered: 0, exited: 0, ratio: 0 };
    let entered = 0,
      exited = 0;
    currStocks.forEach((s) => {
      if (!prevStocks.has(s)) entered++;
    });
    prevStocks.forEach((s) => {
      if (!currStocks.has(s)) exited++;
    });
    const avgSize = (prevStocks.size + currStocks.size) / 2;
    return {
      entered,
      exited,
      ratio: avgSize > 0 ? (entered + exited) / avgSize : 0,
    };
  }

  // ── Portfolio management ──────────────────────────────────────────────────
  function addPortfolio() {
    if (portfolios.length >= MAX_PORTFOLIOS) return;
    const longFilters = getFilters("long");
    const shortFilters =
      currentStrategy === "long_short" ? getFilters("short") : {};
    if (!Object.values(longFilters).some((v) => v && v.length)) {
      showError("Select at least one factor label.");
      return;
    }
    if (
      currentStrategy === "long_short" &&
      !Object.values(shortFilters).some((v) => v && v.length)
    ) {
      showError("Select at least one short-side label.");
      return;
    }

    const nameParts = [];
    for (const [f, codes] of Object.entries(longFilters)) {
      const vals = codes.map((c) => FACTORS[f]?.labels[c] || c).join("/");
      nameParts.push(vals);
    }
    const factorLabel = getPortfolioFactorLabel(longFilters, shortFilters);

    let name = nameParts.join(" · ");
    if (currentStrategy === "long_short") {
      const isSize = longFilters["Size"]?.includes("S") && shortFilters["Size"]?.includes("B");
      const isValue = longFilters["Book-to-Market"]?.includes("V") && shortFilters["Book-to-Market"]?.includes("G");
      const isProf = longFilters["Profitability"]?.includes("R") && shortFilters["Profitability"]?.includes("W");
      const isInv = longFilters["Investment"]?.includes("C") && shortFilters["Investment"]?.includes("A");
      const isMom = longFilters["Momentum"]?.includes("W") && shortFilters["Momentum"]?.includes("L");

      if (Object.keys(longFilters).length === 1 && Object.keys(shortFilters).length === 1) {
        if (isSize) name = "SMB";
        else if (isValue) name = "HML";
        else if (isProf) name = "RMW";
        else if (isInv) name = "CMA";
        else if (isMom) name = "WML";
        else {
          const sp = [];
          for (const [f, codes] of Object.entries(shortFilters)) {
            const vals = codes.map((c) => FACTORS[f]?.labels[c] || c).join("/");
            sp.push(vals);
          }
          name += " − " + sp.join(" · ");
        }
      } else {
        const sp = [];
        for (const [f, codes] of Object.entries(shortFilters)) {
          const vals = codes.map((c) => FACTORS[f]?.labels[c] || c).join("/");
          sp.push(vals);
        }
        name += " − " + sp.join(" · ");
      }
    }

    portfolios.push({
      id: nextId++,
      name: name.length > 50 ? name.substring(0, 47) + "…" : name,
      factorLabel,
      colorIdx: portfolios.length,
      config: {
        longFilters: JSON.parse(JSON.stringify(longFilters)),
        shortFilters: JSON.parse(JSON.stringify(shortFilters)),
        strategy: currentStrategy,
      },
      results: null,
    });
    clearPills();
    renderShelf();
    hideError();
  }

  function removePortfolio(id) {
    portfolios = portfolios.filter((p) => p.id !== id);
    portfolios.forEach((p, i) => {
      p.colorIdx = i;
    });
    renderShelf();
    if (portfolios.some((p) => p.results)) {
      refreshAll();
      if (activeHoldingsId === id) {
        activeHoldingsId = portfolios.length > 0 ? portfolios[0].id : null;
        showHoldingsForCurrentMonth();
      }
    } else resetResults();
  }

  function renderShelf() {
    const shelf = document.getElementById("bt-portfolio-shelf");
    shelf.innerHTML = "";
    portfolios.forEach((p) => {
      const c = COLORS[p.colorIdx] || COLORS[0];
      const chip = document.createElement("div");
      chip.className =
        "bt-portfolio-chip" + (activeHoldingsId === p.id ? " active-chip" : "");
      chip.style.background = c.chip;
      chip.innerHTML = `<span class="bt-chip-label" title="${p.name}">${p.name}</span><button class="bt-chip-close" onclick="BT.removePortfolio(${p.id})">×</button>`;
      shelf.appendChild(chip);
    });
    document
      .getElementById("bt-shelf-limit")
      .classList.toggle("visible", portfolios.length >= MAX_PORTFOLIOS);
    document.getElementById("bt-add-btn").disabled =
      portfolios.length >= MAX_PORTFOLIOS;
    const runBtn = document.getElementById("bt-run-btn");
    if (!dataLoaded && rawData.length === 0) {
      runBtn.textContent = "Loading data…";
      runBtn.disabled = true;
    } else {
      runBtn.textContent =
        portfolios.length > 1 ? "Run Comparison" : "Run Analysis";
      runBtn.disabled = false;
    }
  }

  // ── Core computation ──────────────────────────────────────────────────────
  function getRowSizeLabel(row, sizeCol) {
    return (
      row[sizeCol] ||
      row.Size_Label_Yearly ||
      row.Size_Label_Monthly ||
      row.Size_Label ||
      ""
    );
  }

  function getSizeColumn(longFilters = {}, shortFilters = {}) {
    const has = (factor) => Boolean(longFilters[factor] || shortFilters[factor]);
    if (has("Momentum") || has("Volatility") || has("Short-Term Reversal")) return "Size_Label_Monthly";
    if (has("Profitability") || has("Op. Profitability")) return "Size_Label_OP";
    if (has("Investment")) return "Size_Label_INV";
    if (has("Asset Turnover")) return "Size_Label_AT";
    if (has("Sales Growth")) return "Size_Label_SG";
    if (has("Accruals")) return "Size_Label_ACC";
    return "Size_Label_Yearly";
  }

  function applyFilters(rows, filters) {
    let result = rows;
    const sizeCol = getSizeColumn(filters, {});
    
    for (const [factor, labels] of Object.entries(filters)) {
      if (labels && labels.length && FACTORS[factor]) {
        const col = factor === "Size" ? sizeCol : FACTORS[factor].col;
        const set = new Set(labels);
        result = result.filter((r) =>
          factor === "Size" ? set.has(getRowSizeLabel(r, col)) : set.has(r[col]),
        );
      }
    }
    return result;
  }
  function topNBySize(rows, n) {
    return !n || rows.length <= n
      ? rows
      : rows
          .slice()
          .sort((a, b) => b._size - a._size)
          .slice(0, n);
  }
  // Equal-weight: simple mean of constituent returns
  function calcEW(rows) {
    if (rows.length === 0) return 0;
    let sum = 0,
      n = 0;
    for (const r of rows) {
      if (r._ret != null && isFinite(r._ret)) {
        sum += r._ret;
        n++;
      }
    }
    return n === 0 ? 0 : sum / n;
  }
  // Value-weight: weights MUST be from PRIOR month's size to avoid look-ahead bias.
  // Skips the row if prev_Size is unavailable; falls back to EW if no positive weights.
  function calcVW(rows) {
    if (rows.length === 0) return 0;
    let totalW = 0,
      weighted = 0;
    for (const r of rows) {
      if (r._ret == null || !isFinite(r._ret)) continue;
      let w = parseFloat(r.prev_Size);
      if (isNaN(w) || w <= 0) continue; // strictly require valid lagged size
      totalW += w;
      weighted += r._ret * w;
    }
    if (totalW <= 0) return calcEW(rows);
    return weighted / totalW;
  }

  function computeIR(portRets, benchRets) {
    if (!portRets || !benchRets || portRets.length === 0) return null;
    const n = Math.min(portRets.length, benchRets.length);
    const active = [];
    for (let i = 0; i < n; i++) {
      if (benchRets[i] == null) continue;
      active.push(portRets[i] - benchRets[i]);
    }
    if (active.length < 2) return null;
    const mean = active.reduce((s, v) => s + v, 0) / active.length;
    const variance =
      active.reduce((s, v) => s + (v - mean) ** 2, 0) / (active.length - 1);
    const te = Math.sqrt(variance * 12);
    return te > 0 ? +((mean * 12) / te).toFixed(3) : null;
  }

  function getPeriodDescriptor(monthCount = runMonths.length) {
    if (!monthCount) return { label: "", titlePrefix: "" };
    if (monthCount % 12 === 0) {
      const years = monthCount / 12;
      return {
        label: `${years} ${years === 1 ? "year" : "years"}`,
        titlePrefix: `${years}-Year`,
      };
    }
    return {
      label: `${monthCount} ${monthCount === 1 ? "month" : "months"}`,
      titlePrefix: `${monthCount}-Month`,
    };
  }

  function computeMetrics(rets, rfs = []) {
    const n = rets.length;
    if (n === 0)
      return {
        growth_multiple: 1,
        annualized_return: 0,
        annualized_volatility: 0,
        sharpe_ratio: 0,
        max_drawdown: 0,
      };
    let cumProd = 1;
    rets.forEach((r) => {
      cumProd *= 1 + r;
    });
    const nYears = n / 12;
    // Guard against negative cumProd (which can happen for a wiped-out L-S portfolio)
    const annRet =
      nYears > 0 && cumProd > 0 ? Math.pow(cumProd, 1 / nYears) - 1 : 0;
    
    // For standard display
    const mean = rets.reduce((s, r) => s + r, 0) / n;
    const variance =
      rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(n - 1, 1);
    const annVol = Math.sqrt(variance * 12);

    // Compute Sharpe using Excess Returns
    const excessRets = rets.map((r, i) => r - (rfs[i] || 0));
    const meanExcess = excessRets.reduce((s, r) => s + r, 0) / n;
    const annMeanExcess = meanExcess * 12;
    
    const sharpe = annVol > 0 ? annMeanExcess / annVol : 0;
    let cum = 1,
      peak = 1,
      maxDD = 0;
    rets.forEach((r) => {
      cum *= 1 + r;
      if (cum > peak) peak = cum;
      const dd = peak > 0 ? (cum - peak) / peak : 0;
      if (dd < maxDD) maxDD = dd;
    });
    return {
      growth_multiple: +cumProd.toFixed(2),
      annualized_return: +(annRet * 100).toFixed(2),
      annualized_volatility: +(annVol * 100).toFixed(2),
      sharpe_ratio: +sharpe.toFixed(3),
      max_drawdown: +(maxDD * 100).toFixed(2),
    };
  }

  function computeDrawdown(rets) {
    const dd = [];
    let cum = 1,
      peak = 1;
    rets.forEach((r) => {
      cum *= 1 + r;
      if (cum > peak) peak = cum;
      dd.push(+(peak > 0 ? ((cum - peak) / peak) * 100 : 0).toFixed(2));
    });
    return dd;
  }

  function computePortfolio(config, months) {
    const { longFilters, shortFilters, strategy } = config;
    const universe = getToggleVal("bt-universe-toggle");
    const tc = getTCConfig();
    const ewPort = [100],
      vwPort = [100],
      ewRets = [],
      vwRets = [];
    const holdings = {};
    let prevLongCodes = null,
      prevShortCodes = null;
    let totalTO = 0,
      toCount = 0;

    for (let mi = 0; mi < months.length; mi++) {
      const month = months[mi];
      let mdf = monthGroups[month] || [];
      const longDF = applyFilters(mdf, longFilters);
      const shortDF =
        strategy === "long_short" ? applyFilters(mdf, shortFilters) : [];

      // 2x3 Double-Sort & 5-Firm Minimum Logic
      const minFirms = 5;
      
      const sizeCol = getSizeColumn(longFilters, shortFilters);

      const longS = longDF.filter((r) => getRowSizeLabel(r, sizeCol) === "S");
      const longB = longDF.filter((r) => getRowSizeLabel(r, sizeCol) === "B");
      const shortS = shortDF.filter((r) => getRowSizeLabel(r, sizeCol) === "S");
      const shortB = shortDF.filter((r) => getRowSizeLabel(r, sizeCol) === "B");

      // Determine if the user's filters INTEND to include S or B
      const longAllowsS =
        !longFilters["Size"] || longFilters["Size"].includes("S");
      const longAllowsB =
        !longFilters["Size"] || longFilters["Size"].includes("B");
      const shortAllowsS =
        strategy === "long_short" &&
        (!shortFilters["Size"] || shortFilters["Size"].includes("S"));
      const shortAllowsB =
        strategy === "long_short" &&
        (!shortFilters["Size"] || shortFilters["Size"].includes("B"));

      let validLongS = longAllowsS && longS.length >= minFirms;
      let validLongB = longAllowsB && longB.length >= minFirms;
      let validShortS = shortAllowsS && shortS.length >= minFirms;
      let validShortB = shortAllowsB && shortB.length >= minFirms;

      // If a strategy is long-short and BOTH legs intend to trade a size bracket,
      // we enforce size neutrality: if one leg fails the firm count, drop it from the other leg too.
      if (strategy === "long_short") {
        if (longAllowsS && shortAllowsS) {
          if (!validLongS || !validShortS) {
            validLongS = false;
            validShortS = false;
          }
        }
        if (longAllowsB && shortAllowsB) {
          if (!validLongB || !validShortB) {
            validLongB = false;
            validShortB = false;
          }
        }
      }

      let finalLongDF = [],
        finalShortDF = [];
      if (validLongS) finalLongDF = finalLongDF.concat(longS);
      if (validLongB) finalLongDF = finalLongDF.concat(longB);

      if (strategy === "long_short") {
        if (validShortS) finalShortDF = finalShortDF.concat(shortS);
        if (validShortB) finalShortDF = finalShortDF.concat(shortB);
      }

      const currLongCodes = new Set(finalLongDF.map((r) => r.Co_Code));
      const currShortCodes = new Set(finalShortDF.map((r) => r.Co_Code));

      // Turnover: long-only counts only long leg; long-short pays TC on BOTH legs (sum).
      let monthTurnoverRatio = 0;
      if (prevLongCodes) {
        const longTO = calcTurnover(prevLongCodes, currLongCodes);
        if (strategy === "long_short" && prevShortCodes) {
          const shortTO = calcTurnover(prevShortCodes, currShortCodes);
          monthTurnoverRatio = longTO.ratio + shortTO.ratio; // pay on both legs
        } else {
          monthTurnoverRatio = longTO.ratio;
        }
        totalTO += monthTurnoverRatio;
        toCount++;
      }
      prevLongCodes = currLongCodes;
      prevShortCodes = currShortCodes;

      let ewNet = 0,
        vwNet = 0;

      let L_ew = null,
        L_vw = null,
        S_ew = null,
        S_vw = null;

      // Check if user is building a pure Big vs Small (or Small vs Big) factor
      const isPureSize =
        Object.keys(longFilters).length === 1 &&
        Object.keys(shortFilters).length === 1 &&
        longFilters["Size"] &&
        shortFilters["Size"] &&
        ((longFilters["Size"].includes("B") &&
          shortFilters["Size"].includes("S")) ||
          (longFilters["Size"].includes("S") &&
            shortFilters["Size"].includes("B")));

      // For pure size factor, ensure strict matching of BM buckets across both legs.
      if (isPureSize) {
        const bmBuckets = ["G", "N", "V"];
        const isLongS = longFilters["Size"].includes("S");
        const legDF_L = isLongS ? longS : longB;
        const legDF_S = isLongS ? shortB : shortS;
        const isValidL = isLongS ? validLongS : validLongB;
        const isValidS = isLongS ? validShortB : validShortS;

        let validBuckets = [];
        if (isValidL && isValidS) {
          for (const bm of bmBuckets) {
            const subL = legDF_L.filter((r) => r.BM_Label === bm);
            const subS = legDF_S.filter((r) => r.BM_Label === bm);
            if (subL.length >= minFirms && subS.length >= minFirms) {
              validBuckets.push(bm);
            }
          }
        }

        if (validBuckets.length > 0) {
          let l_ews = [],
            l_vws = [],
            s_ews = [],
            s_vws = [];
          for (const bm of validBuckets) {
            const subL = legDF_L.filter((r) => r.BM_Label === bm);
            const subS = legDF_S.filter((r) => r.BM_Label === bm);
            l_ews.push(calcEW(subL));
            l_vws.push(calcVW(subL));
            s_ews.push(calcEW(subS));
            s_vws.push(calcVW(subS));
          }
          L_ew = l_ews.reduce((a, b) => a + b, 0) / validBuckets.length;
          L_vw = l_vws.reduce((a, b) => a + b, 0) / validBuckets.length;
          S_ew = s_ews.reduce((a, b) => a + b, 0) / validBuckets.length;
          S_vw = s_vws.reduce((a, b) => a + b, 0) / validBuckets.length;
        } else {
          L_ew = null;
          L_vw = null;
          S_ew = null;
          S_vw = null;
        }
      } else {
        if (validLongS && validLongB) {
          L_ew = (calcEW(longS) + calcEW(longB)) / 2;
          L_vw = (calcVW(longS) + calcVW(longB)) / 2;
        } else if (validLongS) {
          L_ew = calcEW(longS);
          L_vw = calcVW(longS);
        } else if (validLongB) {
          L_ew = calcEW(longB);
          L_vw = calcVW(longB);
        }

        if (strategy === "long_short") {
          if (validShortS && validShortB) {
            S_ew = (calcEW(shortS) + calcEW(shortB)) / 2;
            S_vw = (calcVW(shortS) + calcVW(shortB)) / 2;
          } else if (validShortS) {
            S_ew = calcEW(shortS);
            S_vw = calcVW(shortS);
          } else if (validShortB) {
            S_ew = calcEW(shortB);
            S_vw = calcVW(shortB);
          }
        }
      }

      // Standard dollar-neutral L-S: long return MINUS short return (NOT divided by 2).
      // This matches Fama-French factor construction. Dividing by 2 would understate.
      if (strategy === "long_short") {
        ewNet = L_ew - S_ew;
        vwNet = L_vw - S_vw;
      } else {
        ewNet = L_ew;
        vwNet = L_vw;
      }

      // Apply TC drag after month 0
      if (tc.mode !== "none" && mi > 0) {
        const drag = monthTurnoverRatio * tc.cost;
        ewNet -= drag;
        vwNet -= drag;
      }

      // Final safety guard on net portfolio return
      if (!isFinite(ewNet)) ewNet = 0;
      if (!isFinite(vwNet)) vwNet = 0;
      // Cap monthly portfolio return at 200%
      const PORT_CAP = 2.0;
      if (ewNet > PORT_CAP) ewNet = PORT_CAP;
      else if (ewNet < -PORT_CAP) ewNet = -PORT_CAP;
      if (vwNet > PORT_CAP) vwNet = PORT_CAP;
      else if (vwNet < -PORT_CAP) vwNet = -PORT_CAP;

      ewRets.push(ewNet);
      vwRets.push(vwNet);
      ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
      vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));

      const toFirms = (rows) =>
        rows
          .filter((r) => r._ret != null && isFinite(r._ret))
          .map((r) => ({
            name: r.Co_Name || r.co_name || r.company_name || r["Company Name"] || "—",
            ret: +(r._ret * 100).toFixed(2),
            size: r._size,
          }))
          .sort((a, b) => b.ret - a.ret);
      holdings[month] = {
        long_firms: toFirms(longDF),
        short_firms: toFirms(shortDF),
        long_total: longDF.length,
        short_total: shortDF.length,
        ew_ret: +(ewNet * 100).toFixed(3),
        vw_ret: +(vwNet * 100).toFixed(3),
      };
    }

    return {
      months,
      ew_portfolio: ewPort.slice(1).map((v) => +v.toFixed(4)),
      vw_portfolio: vwPort.slice(1).map((v) => +v.toFixed(4)),
      ew_rets: ewRets,
      vw_rets: vwRets,
      ew_metrics: computeMetrics(ewRets, months.map(m => rfData[m] || 0)),
      vw_metrics: computeMetrics(vwRets, months.map(m => rfData[m] || 0)),
      ew_drawdown: computeDrawdown(ewRets),
      vw_drawdown: computeDrawdown(vwRets),
      holdings,
      isLongShort: strategy === "long_short",
      avgTurnover: toCount > 0 ? +((totalTO / toCount) * 100).toFixed(1) : 0,
    };
  }

  // ── Benchmarks from CSV ───────────────────────────────────────────────────
  // Use null-aware extraction: each month's benchmark is the FIRST non-null value
  // among the rows. If no row has a value for that month, carry forward 0 (flat).
  function computeIndexBenchmark(months, col) {
    const rets = [],
      port = [100];
    const key = `_${col}`;
    for (const month of months) {
      const rows = monthGroups[month] || [];
      let r = null;
      for (const row of rows) {
        const v = row[key];
        if (v != null && isFinite(v)) {
          r = v;
          break;
        }
      }
      // If truly no benchmark observation this month, record null (don't fake a 0)
      rets.push(r);
      const compoundR = r == null ? 0 : r;
      port.push(port[port.length - 1] * (1 + compoundR));
    }
    return {
      rets,
      portfolio: port.slice(1).map((v) => +v.toFixed(4)),
      metrics: computeMetrics(rets.map((x) => (x == null ? 0 : x)), months.map(m => rfData[m] || 0)),
      drawdown: computeDrawdown(rets.map((x) => (x == null ? 0 : x))),
    };
  }

  function computeAllBenchmarks(months) {
    benchmarkSeries = {};
    for (const [id, cfg] of Object.entries(BENCHMARK_OPTIONS)) {
      benchmarkSeries[id] = computeIndexBenchmark(months, cfg.col);
    }
    portfolios.forEach((p) => {
      if (!p.results) return;
      const bench = benchmarkSeries[activeBenchmarkId];
      if (bench) {
        p.results.ew_metrics.ir = computeIR(p.results.ew_rets, bench.rets);
        p.results.vw_metrics.ir = computeIR(p.results.vw_rets, bench.rets);
      }
    });
  }

  function getActiveBenchmark() {
    return benchmarkSeries[activeBenchmarkId] || null;
  }

  function getGrowthVsBenchmark(m, benchMetrics) {
    if (!m || !benchMetrics || benchMetrics.growth_multiple === 0) return null;
    return +(m.growth_multiple / benchMetrics.growth_multiple).toFixed(2);
  }

  async function runAllServer(months) {
    const btn = document.getElementById("bt-run-btn");
    btn.disabled = true;
    btn.textContent = "Running…";
    document.getElementById("bt-chart-loading").style.display = "flex";
    holdingsFetches.clear();
    holdingsRenderToken++;

    try {
      const tc = getTCConfig();
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe: getToggleVal("bt-universe-toggle") || "all",
          startMonth: months[0],
          endMonth: months[months.length - 1],
          holdingsMonths: [months[months.length - 1]],
          activeBenchmarkId,
          transactionCost: {
            mode: tc.mode,
            bps: tc.mode === "bps" ? tc.cost * 10000 : 0,
          },
          portfolios: portfolios.map((portfolio) => ({
            id: portfolio.id,
            name: portfolio.name,
            factorLabel: portfolio.factorLabel,
            colorIdx: portfolio.colorIdx,
            config: portfolio.config,
          })),
        }),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok || !payload?.ok) {
        throw new Error(getApiError(payload, `Backtest failed (${res.status})`));
      }

      runMonths = payload.months || months;
      benchmarkSeries = payload.benchmarkSeries || {};
      portfolios = (payload.portfolios || []).map((portfolio, index) => ({
        ...portfolio,
        colorIdx: portfolio.colorIdx ?? index,
      }));
      activeHoldingsId = portfolios[0]?.id || null;
      heatmapPortfolioId = portfolios[0]?.id || null;
      currentMonthIdx = Math.max(0, runMonths.length - 1);
      renderShelf();
      refreshAll();
      setupMonthSlider();
      showHoldingsForCurrentMonth();
      document.getElementById("bt-dd-card").style.display = "block";
      document.getElementById("bt-heatmap-card").style.display = "block";
    } catch (error) {
      showError("Error: " + error.message);
      console.error(error);
    } finally {
      btn.disabled = false;
      btn.textContent =
        portfolios.length > 1 ? "Run Comparison" : "Run Analysis";
      document.getElementById("bt-chart-loading").style.display = "none";
    }
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  function runAll() {
    hideError();

    // Ensure state matches DOM UI before running
    const activeWtBtn = document.querySelector(
      "#bt-weight-toggle .bt-wt-btn.active",
    );
    if (activeWtBtn) currentWeight = activeWtBtn.dataset.val;
    const benchCheck = document.getElementById("bt-bench-check");
    if (benchCheck) showBenchmark = benchCheck.checked;

    if (portfolios.length === 0) {
      const lf = getFilters("long");
      if (Object.values(lf).some((v) => v && v.length)) addPortfolio();
    }
    if (portfolios.length === 0) {
      showError("Select at least one factor label, then press Run.");
      return;
    }

    const start = document.getElementById("bt-start-month").value;
    const end = document.getElementById("bt-end-month").value;
    const months = allMonths.filter((m) => m >= start && m <= end);
    if (months.length === 0) {
      showError("No data in selected range.");
      return;
    }

    if (serverMode) {
      runAllServer(months);
      return;
    }

    const btn = document.getElementById("bt-run-btn");
    btn.disabled = true;
    btn.textContent = "Running…";
    document.getElementById("bt-chart-loading").style.display = "flex";

    setTimeout(() => {
      try {
        runMonths = months;
        portfolios.forEach((p) => {
          p.results = computePortfolio(p.config, months);
        });
        computeAllBenchmarks(months);
        activeHoldingsId = portfolios[0].id;
        heatmapPortfolioId = portfolios[0].id;
        currentMonthIdx = months.length - 1;
        refreshAll();
        setupMonthSlider();
        showHoldingsForCurrentMonth();
        document.getElementById("bt-dd-card").style.display = "block";
        document.getElementById("bt-heatmap-card").style.display = "block";
      } catch (e) {
        showError("Error: " + e.message);
        console.error(e);
      } finally {
        btn.disabled = false;
        btn.textContent =
          portfolios.length > 1 ? "Run Comparison" : "Run Analysis";
        document.getElementById("bt-chart-loading").style.display = "none";
      }
    }, 50);
  }

  // ── Charts ────────────────────────────────────────────────────────────────
  function initChart() {
    chartInst = new Chart(
      document.getElementById("bt-perf-chart").getContext("2d"),
      {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true,
              position: "top",
              align: "end",
              labels: {
                color: "#6b7280",
                font: { size: 11 },
                boxWidth: 14,
                padding: 10,
              },
            },
            tooltip: {
              backgroundColor: "#1e293b",
              titleColor: "#94a3b8",
              bodyColor: "#f8fafc",
              padding: 12,
              borderColor: "#334155",
              borderWidth: 1,
              callbacks: {
                label: (item) =>
                  `${item.dataset.label}: ₹${item.parsed.y.toFixed(2)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                maxTicksLimit: 12,
                color: "#94a3b8",
                font: { size: 11 },
                maxRotation: 0,
              },
            },
            y: {
              type: "linear",
              grid: { color: "#f1f5f9" },
              border: { display: false },
              ticks: {
                color: "#94a3b8",
                font: { size: 11 },
                callback: (v) =>
                  `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
              },
            },
          },
        },
      },
    );
    document
      .getElementById("bt-perf-chart")
      .addEventListener("mousemove", (evt) => {
        if (!chartInst || runMonths.length === 0) return;
        const pts = chartInst.getElementsAtEventForMode(
          evt,
          "index",
          { intersect: false },
          true,
        );
        if (pts.length > 0) {
          const mIdx = pts[0].index - 1;
          if (mIdx >= 0 && mIdx < runMonths.length) {
            currentMonthIdx = mIdx;
            updateMonthDisplay();
            showHoldingsForCurrentMonth();
            document.getElementById("bt-month-slider").value = mIdx;
          }
        }
      });

    ddChartInst = new Chart(
      document.getElementById("bt-dd-chart").getContext("2d"),
      {
        type: "line",
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1e293b",
              titleColor: "#94a3b8",
              bodyColor: "#f8fafc",
              padding: 10,
              borderColor: "#334155",
              borderWidth: 1,
              callbacks: {
                label: (item) =>
                  `${item.dataset.label}: ${item.parsed.y.toFixed(2)}%`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                maxTicksLimit: 10,
                color: "#94a3b8",
                font: { size: 10 },
                maxRotation: 0,
              },
            },
            y: {
              grid: { color: "#f1f5f9" },
              border: { display: false },
              ticks: {
                color: "#94a3b8",
                font: { size: 10 },
                callback: (v) => `${v}%`,
              },
            },
          },
        },
      },
    );
  }

  function makeDataset(label, data, color, dashed) {
    return {
      label,
      data,
      borderColor: color.line,
      backgroundColor: color.bg,
      borderWidth: 2,
      borderDash: dashed ? [6, 3] : [],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      tension: 0.2,
    };
  }

  function updateChart() {
    const wt = currentWeight,
      datasets = [];
    portfolios.forEach((p) => {
      if (!p.results) return;
      const c = COLORS[p.colorIdx] || COLORS[0];
      datasets.push(
        makeDataset(
          p.name,
          [
            100,
            ...(wt === "ew" ? p.results.ew_portfolio : p.results.vw_portfolio),
          ],
          c,
          false,
        ),
      );
    });
    if (showBenchmark) {
      const bench = benchmarkSeries[activeBenchmarkId];
      if (bench)
        datasets.push(
          makeDataset(
            BENCHMARK_OPTIONS[activeBenchmarkId]?.label || activeBenchmarkId,
            [100, ...bench.portfolio],
            BENCH_COLOR,
            true,
          ),
        );
    }
    chartInst.data.labels = ["Initial", ...runMonths];
    chartInst.data.datasets = datasets;
    setChartEmpty(datasets.length === 0);
    chartInst.options.scales.y.type = document.getElementById("bt-log-scale")
      .checked
      ? "logarithmic"
      : "linear";
    chartInst.update("active");
    const period = getPeriodDescriptor();
    document.getElementById("bt-chart-title").textContent =
      runMonths.length > 0
        ? `${period.titlePrefix} Portfolio Returns`
        : "Portfolio Returns";
    document.getElementById("bt-chart-sub").textContent =
      runMonths.length > 0
        ? `${runMonths[0]} → ${runMonths[runMonths.length - 1]}  ·  ${period.label}  ·  ${wt.toUpperCase()}`
        : "Build a portfolio to view performance over time";
  }

  function setChartEmpty(isEmpty) {
    const empty = document.getElementById("bt-chart-empty");
    if (empty) empty.style.display = isEmpty ? "flex" : "none";
  }

  function toggleLog() {
    if (!chartInst) return;
    chartInst.options.scales.y.type = document.getElementById("bt-log-scale")
      .checked
      ? "logarithmic"
      : "linear";
    chartInst.update();
  }

  function updateDrawdown() {
    const wt = currentWeight,
      datasets = [];
    portfolios.forEach((p) => {
      if (!p.results) return;
      const c = COLORS[p.colorIdx] || COLORS[0];
      datasets.push({
        label: p.name,
        data: wt === "ew" ? p.results.ew_drawdown : p.results.vw_drawdown,
        borderColor: c.line,
        backgroundColor: c.bg,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: true,
        tension: 0.2,
      });
    });
    if (showBenchmark) {
      const bench = benchmarkSeries[activeBenchmarkId];
      if (bench)
        datasets.push({
          label: BENCHMARK_OPTIONS[activeBenchmarkId]?.label || "",
          data: bench.drawdown,
          borderColor: BENCH_COLOR.line,
          backgroundColor: BENCH_COLOR.bg,
          borderWidth: 1.5,
          borderDash: [6, 3],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: true,
          tension: 0.2,
        });
    }
    ddChartInst.data.labels = runMonths;
    ddChartInst.data.datasets = datasets;
    ddChartInst.update("active");
  }

  // ── Comparison table ──────────────────────────────────────────────────────
  function updateCompareTable() {
    const card = document.getElementById("bt-compare-card");
    const body = document.getElementById("bt-compare-body");
    const wt = currentWeight;
    if (!portfolios.some((p) => p.results)) {
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    body.innerHTML = "";

    const period = getPeriodDescriptor();
    const benchmarkLabel = BENCHMARK_OPTIONS[activeBenchmarkId]?.label || "NIFTY";
    const showGrowthVsNifty = currentStrategy === "long_only";
    const periodHeader = document.getElementById("bt-period-col-header");
    const growthVsHeader = document.getElementById("bt-growth-vs-nifty-header");
    const growthVsCol = document.getElementById("bt-growth-vs-nifty-col");

    if (periodHeader) periodHeader.textContent = period.titlePrefix;
    if (growthVsHeader) {
      growthVsHeader.innerHTML = `Growth<br>vs ${benchmarkLabel}`;
      growthVsHeader.hidden = !showGrowthVsNifty;
    }
    if (growthVsCol) growthVsCol.style.display = showGrowthVsNifty ? "" : "none";

    const bench = getActiveBenchmark();
    const benchMetrics = bench?.metrics || null;

    const addRow = (name, factorLabel, color, m, growthVsNifty) => {
      const cls = (v) => (v >= 0 ? "bt-stat-pos" : "bt-stat-neg");
      const sign = (v) => (v > 0 ? "+" : "");
      const growthDisplay = growthVsNifty != null ? `${sign(growthVsNifty)}${growthVsNifty}x` : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td><span class="bt-compare-dot" style="background:${color}"></span><span class="bt-compare-name">${name}</span></td>
                <td style="padding-left: 15px;"><span class="bt-compare-factor">${factorLabel || "—"}</span></td>
                <td style="text-align: center;">${m.growth_multiple}x</td>
                <td class="${cls(m.annualized_return)}" style="text-align: center;">${sign(m.annualized_return)}${m.annualized_return}%</td>
                <td style="text-align: center;">${m.annualized_volatility}%</td>
                <td class="${cls(m.sharpe_ratio)}" style="text-align: center;">${m.sharpe_ratio}</td>
                <td class="${cls(m.max_drawdown)}" style="text-align: center;">${m.max_drawdown}%</td>
                ${
                  showGrowthVsNifty
                    ? `<td class="${growthVsNifty != null ? cls(growthVsNifty) : ""}" style="text-align: center;">${growthDisplay}</td>`
                    : ""
                }`;
      body.appendChild(tr);
    };

    portfolios.forEach((p) => {
      if (!p.results) return;
      const m = wt === "ew" ? p.results.ew_metrics : p.results.vw_metrics;
      addRow(
        p.name,
        p.factorLabel,
        (COLORS[p.colorIdx] || COLORS[0]).line,
        m,
        showGrowthVsNifty ? getGrowthVsBenchmark(m, benchMetrics) : null,
      );
    });
    if (showBenchmark) {
      if (bench)
        addRow(
          BENCHMARK_OPTIONS[activeBenchmarkId]?.label || "",
          "Benchmark",
          BENCH_COLOR.line,
          bench.metrics,
          "1.00"
        );
    }
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────
  function updateHeatmapGrid() {
    if (!heatmapOpen) return;
    const selectEl = document.getElementById("bt-hm-portfolio-select");
    const gridEl = document.getElementById("bt-heatmap-grid");
    selectEl.innerHTML = "";
    if (portfolios.length > 1) {
      const sel = document.createElement("select");
      portfolios.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === heatmapPortfolioId) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        heatmapPortfolioId = parseInt(sel.value);
        updateHeatmapGrid();
      };
      selectEl.appendChild(sel);
    }
    const p = portfolios.find((x) => x.id === heatmapPortfolioId);
    if (!p || !p.results) {
      gridEl.innerHTML = "";
      return;
    }
    const rets = currentWeight === "ew" ? p.results.ew_rets : p.results.vw_rets;
    const months = p.results.months;
    const yearMap = {};
    months.forEach((m, i) => {
      const [y, mo] = m.split("-");
      if (!yearMap[y]) yearMap[y] = {};
      yearMap[y][parseInt(mo)] = rets[i];
    });

    let html = '<table class="bt-heatmap-table"><thead><tr><th></th>';
    MONTH_NAMES.forEach((m) => {
      html += `<th>${m}</th>`;
    });
    html += "<th>Year</th></tr></thead><tbody>";
    Object.keys(yearMap)
      .sort()
      .forEach((y) => {
        html += `<tr><td class="bt-hm-year">${y}</td>`;
        for (let mo = 1; mo <= 12; mo++) {
          const r = yearMap[y][mo];
          if (r !== undefined) {
            const pct = +(r * 100).toFixed(1);
            html += `<td style="background:${heatColor(pct)};color:${Math.abs(pct) > 5 ? "#fff" : "#1f2937"}">${pct > 0 ? "+" : ""}${pct}</td>`;
          } else html += '<td style="background:#f9fafb;color:#d1d5db;">—</td>';
        }
        let yCum = 1;
        for (let mo = 1; mo <= 12; mo++) {
          if (yearMap[y][mo] !== undefined) yCum *= 1 + yearMap[y][mo];
        }
        const yRet = +((yCum - 1) * 100).toFixed(1);
        html += `<td style="background:${heatColor(yRet)};color:${Math.abs(yRet) > 5 ? "#fff" : "#1f2937"};font-weight:700;">${yRet > 0 ? "+" : ""}${yRet}</td></tr>`;
      });
    html += "</tbody></table>";
    gridEl.innerHTML = html;
  }

  function heatColor(pct) {
    if (pct >= 10) return "#047857";
    if (pct >= 5) return "#059669";
    if (pct >= 2) return "#34d399";
    if (pct >= 0) return "#a7f3d0";
    if (pct >= -2) return "#fecaca";
    if (pct >= -5) return "#f87171";
    if (pct >= -10) return "#dc2626";
    return "#991b1b";
  }

  // ── Month nav & holdings ──────────────────────────────────────────────────
  function setupMonthSlider() {
    const slider = document.getElementById("bt-month-slider");
    slider.min = 0;
    slider.max = runMonths.length - 1;
    slider.value = currentMonthIdx;
    updateMonthDisplay();
    document.getElementById("bt-holdings-empty").style.display = "none";
    document.getElementById("bt-holdings-content").style.display = "block";
    renderHoldingsPortfolioTabs();
  }
  function updateMonthDisplay() {
    document.getElementById("bt-month-display").textContent =
      runMonths[currentMonthIdx] || "—";
    document.getElementById("bt-month-prev").disabled = currentMonthIdx <= 0;
    document.getElementById("bt-month-next").disabled =
      currentMonthIdx >= runMonths.length - 1;
  }
  function navMonth(d) {
    const n = currentMonthIdx + d;
    if (n < 0 || n >= runMonths.length) return;
    currentMonthIdx = n;
    document.getElementById("bt-month-slider").value = n;
    updateMonthDisplay();
    showHoldingsForCurrentMonth();
  }
  function sliderMonth(v) {
    currentMonthIdx = parseInt(v);
    updateMonthDisplay();
    showHoldingsForCurrentMonth();
  }

  function renderHoldingsPortfolioTabs() {
    const c = document.getElementById("bt-holdings-portfolio-tabs");
    c.innerHTML = "";
    portfolios.forEach((p) => {
      const col = COLORS[p.colorIdx] || COLORS[0];
      const btn = document.createElement("button");
      btn.className = "bt-month-nav-btn";
      btn.style.borderColor = activeHoldingsId === p.id ? col.line : "";
      btn.style.color = activeHoldingsId === p.id ? col.line : "";
      btn.style.fontWeight = activeHoldingsId === p.id ? "700" : "500";
      btn.textContent =
        p.name.length > 25 ? p.name.substring(0, 22) + "…" : p.name;
      btn.onclick = () => {
        activeHoldingsId = p.id;
        renderHoldingsPortfolioTabs();
        showHoldingsForCurrentMonth();
      };
      c.appendChild(btn);
    });
  }

  async function fetchServerHoldingsForMonth(portfolio, month) {
    if (!serverMode || !portfolio?.config || !month) return null;
    const key = `${portfolio.id}:${month}`;
    if (holdingsFetches.has(key)) return holdingsFetches.get(key);

    const tc = getTCConfig();
    const request = fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        universe: getToggleVal("bt-universe-toggle") || "all",
        startMonth: month,
        endMonth: month,
        holdingsMonths: [month],
        activeBenchmarkId,
        transactionCost: {
          mode: tc.mode,
          bps: tc.mode === "bps" ? tc.cost * 10000 : 0,
        },
        portfolios: [
          {
            id: portfolio.id,
            name: portfolio.name,
            factorLabel: portfolio.factorLabel,
            colorIdx: portfolio.colorIdx,
            config: portfolio.config,
          },
        ],
      }),
    })
      .then(async (res) => {
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }
        if (!res.ok || !payload?.ok) {
          throw new Error(getApiError(payload, `Holdings failed (${res.status})`));
        }
        const returned = payload.portfolios?.[0];
        const holdings = returned?.results?.holdings?.[month] || null;
        if (holdings) portfolio.results.holdings[month] = holdings;
        return holdings;
      })
      .finally(() => {
        holdingsFetches.delete(key);
      });

    holdingsFetches.set(key, request);
    return request;
  }

  function renderHoldingsLoading(month) {
    document.getElementById("bt-holdings-inner").innerHTML =
      `<div class="bt-empty-state">Loading holdings for ${month}...</div>`;
  }

  function renderHoldingsError(message) {
    document.getElementById("bt-holdings-inner").innerHTML =
      `<div class="bt-empty-state">Holdings could not load: ${message}</div>`;
  }

  async function showHoldingsForCurrentMonth() {
    const month = runMonths[currentMonthIdx];
    if (!month) return;
    const p = portfolios.find((x) => x.id === activeHoldingsId);
    if (!p || !p.results) return;
    if (holdingsFetchTimer) {
      clearTimeout(holdingsFetchTimer);
      holdingsFetchTimer = null;
    }
    let h = p.results.holdings[month];

    if (!h && serverMode) {
      const token = ++holdingsRenderToken;
      renderHoldingsLoading(month);
      holdingsFetchTimer = setTimeout(async () => {
        try {
          const loaded = await fetchServerHoldingsForMonth(p, month);
          if (token !== holdingsRenderToken || runMonths[currentMonthIdx] !== month) {
            return;
          }
          if (!loaded) {
            renderHoldingsError("No holdings returned for this month.");
            return;
          }
          showHoldingsForCurrentMonth();
        } catch (error) {
          if (token === holdingsRenderToken && runMonths[currentMonthIdx] === month) {
            renderHoldingsError(error.message || "request failed");
          }
        }
      }, 160);
      return;
    }

    if (!h) return;
    const wt = currentWeight,
      ret = wt === "ew" ? h.ew_ret : h.vw_ret;
    const retSign = ret >= 0 ? "+" : "",
      retCls = ret >= 0 ? "bt-ret-pos" : "bt-ret-neg";
    let html = `<div class="bt-holdings-header"><div class="bt-holdings-rets">
            <span class="bt-ret-tag" style="background:${COLORS[p.colorIdx].line}22;color:${COLORS[p.colorIdx].line};">${wt.toUpperCase()}</span>
            <span class="bt-ret-badge ${retCls}">${retSign}${ret.toFixed(2)}%</span>
            <span style="font-size:11px;color:var(--text-secondary);">· ${h.long_total} stocks</span></div></div><div class="bt-holdings-cols">`;
    html += buildFirmsCol("LONG", h.long_total, h.long_firms, "hl", "l");
    if (p.results.isLongShort)
      html += buildFirmsCol("SHORT", h.short_total, h.short_firms, "hs", "s");
    html += "</div>";
    document.getElementById("bt-holdings-inner").innerHTML = html;
  }

  function buildFirmsCol(side, total, firms, headCls, tagCls) {
    let html = `<div class="bt-hcol"><h4 class="${headCls}">${side} · ${total} stocks</h4><div class="bt-firm-scroll">`;
    if (firms.length > 0) {
      firms.forEach((f) => {
        const s = f.ret >= 0 ? "+" : "",
          c = f.ret >= 0 ? "bt-firm-ret-pos" : "bt-firm-ret-neg";
        html += `<div class="bt-firm-row"><span class="bt-stag ${tagCls}">${f.name}</span><span class="bt-firm-ret ${c}">${s}${f.ret.toFixed(1)}%</span></div>`;
      });
    } else html += '<span class="bt-none-nifty">No stocks match.</span>';
    html += "</div></div>";
    return html;
  }

  function showError(msg) {
    document.getElementById("bt-error-msg").textContent = msg;
    document.getElementById("bt-error-msg").style.display = "block";
  }
  function hideError() {
    const error = document.getElementById("bt-error-msg");
    error.textContent = "";
    error.style.display = "none";
  }
  function resetResults() {
    if (chartInst) {
      chartInst.data.labels = [];
      chartInst.data.datasets = [];
      chartInst.update();
    }
    setChartEmpty(true);
    document.getElementById("bt-chart-title").textContent = "Portfolio Returns";
    document.getElementById("bt-chart-sub").textContent =
      "Build a portfolio to view performance over time";
    if (ddChartInst) {
      ddChartInst.data.labels = [];
      ddChartInst.data.datasets = [];
      ddChartInst.update();
    }
    ["bt-compare-card", "bt-dd-card", "bt-heatmap-card"].forEach(
      (id) => (document.getElementById(id).style.display = "none"),
    );
    document.getElementById("bt-holdings-empty").style.display = "block";
    document.getElementById("bt-holdings-content").style.display = "none";
  }

  function init() {
    initChart();
    loadData();
    renderShelf();
  }

  function getPortfolioFactorLabel(longFilters, shortFilters = {}) {
    const factors = new Set([
      ...Object.keys(longFilters || {}),
      ...Object.keys(shortFilters || {}),
    ]);
    if (factors.size === 0) return "—";
    return [...factors].join(" + ");
  }

  return {
    init,
    runAll,
    setStrategy,
    setToggle,
    toggleLog,
    setWeight,
    addPortfolio,
    removePortfolio,
    toggleBenchmark,
    toggleHeatmap,
    navMonth,
    sliderMonth,
  };
})();

document.addEventListener("DOMContentLoaded", BT.init);
