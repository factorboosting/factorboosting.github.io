// backtester.js – Multi-portfolio comparison
// 10 factors with collapsible picker, TC, benchmark (Nifty50/500), drawdown, heatmap, IR

const BT = (() => {
    'use strict';

    const MAX_PORTFOLIOS = 4;
    const COLORS = [
        { line: '#3b82f6', bg: 'rgba(59,130,246,0.08)', chip: '#3b82f6' },
        { line: '#10b981', bg: 'rgba(16,185,129,0.08)', chip: '#10b981' },
        { line: '#f59e0b', bg: 'rgba(245,158,11,0.08)', chip: '#f59e0b' },
        { line: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', chip: '#8b5cf6' },
    ];
    const BENCH_COLOR = { line: '#ef4444', bg: 'rgba(239,68,68,0.06)' };
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // ── Return sanitization config ────────────────────────────────────────────
    // Monthly returns above/below these get *winsorized* (capped), not zeroed.
    // Zeroing biases portfolios downward; capping preserves direction.
    const RET_CAP_HI = 1.50;   // +150% in a month → cap
    const RET_CAP_LO = -0.90;  // −90% in a month → cap (true delisting/wipeout is rare and noisy)
    const RET_DROP_HI = 5.00;  // Beyond this, treat as corrupt and DROP the row entirely
    const RET_DROP_LO = -0.99; // ≤ −99% almost certainly a data error (would be delisted)

    // ── All 10 factors ────────────────────────────────────────────────────────
    const FACTOR_GROUPS = {
        'Classic (FF5 + Momentum)': {
            'Size':           { col: 'Size_Label',     labels: { 'B': 'Big',          'S': 'Small' } },
            'Book-to-Market': { col: 'BM_Label',       labels: { 'G': 'Growth',       'N': 'Neutral', 'V': 'Value' } },
            'Op. Profitability': { col: 'OpProf_Label', labels: { 'R': 'Robust',       'N': 'Neutral', 'W': 'Weak' } },
            'Investment':     { col: 'Inv_Label',      labels: { 'C': 'Conservative', 'N': 'Neutral', 'A': 'Aggressive' } },
            'Momentum':       { col: 'Momentum_Label', labels: { 'W': 'Winner',       'N': 'Neutral', 'L': 'Loser' } },
        },
        'Extended Factors': {
            'Asset Turnover':      { col: 'AT_Label',  labels: { 'H': 'High',  'N': 'Neutral', 'L': 'Low' } },
            'Sales Growth':        { col: 'SG_Label',  labels: { 'H': 'High',  'N': 'Neutral', 'L': 'Low' } },
            'Accruals':            { col: 'ACC_Label', labels: { 'C': 'Conservative', 'N': 'Neutral', 'A': 'Aggressive' } },
            'Volatility':          { col: 'VOL_Label', labels: { 'L': 'Low',   'N': 'Neutral', 'H': 'High' } },
            'Short-Term Reversal': { col: 'STR_Label', labels: { 'L': 'Loser', 'N': 'Neutral', 'H': 'Winner' } },
        },
    };

    const FACTORS = {};
    for (const group of Object.values(FACTOR_GROUPS)) {
        for (const [name, info] of Object.entries(group)) FACTORS[name] = info;
    }

    const BENCHMARK_OPTIONS = {
        'nifty50':  { col: 'nifty50',  label: 'Nifty 50' },
        'nifty500': { col: 'nifty500', label: 'Nifty 500' },
    };

    // ── State ─────────────────────────────────────────────────────────────────
    let rawData = [], monthGroups = {}, allMonths = [];
    let chartInst = null, ddChartInst = null;
    let currentStrategy = 'long_only', currentWeight = 'ew';
    let portfolios = [], nextId = 1;
    let activeHoldingsId = null, currentMonthIdx = 0, runMonths = [];
    let benchmarkSeries = {};
    let activeBenchmarkId = 'nifty50';
    let showBenchmark = false;
    let heatmapOpen = false, heatmapPortfolioId = null;
    let activeFactors = new Set(['Size', 'Book-to-Market', 'Momentum']);
    let dataQualityStats = { dropped: 0, capped: 0, total: 0 };

    // ── CSV parser ────────────────────────────────────────────────────────────
    function parseCSV(text) {
        const lines = text.split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx] : ''; });
            rows.push(obj);
        }
        return rows;
    }

    // ── Sanitize a single return: returns { value, action: 'ok'|'capped'|'drop' }
    function sanitizeReturn(raw) {
        const v = parseFloat(raw);
        if (isNaN(v) || !isFinite(v)) return { value: null, action: 'drop' };
        // Drop totally implausible values (data errors)
        if (v <= RET_DROP_LO || v >= RET_DROP_HI) return { value: null, action: 'drop' };
        // Winsorize moderately extreme values
        if (v > RET_CAP_HI) return { value: RET_CAP_HI, action: 'capped' };
        if (v < RET_CAP_LO) return { value: RET_CAP_LO, action: 'capped' };
        return { value: v, action: 'ok' };
    }

    // ── Load data ─────────────────────────────────────────────────────────────
    async function loadData() {
        const notice = document.getElementById('bt-data-notice');
        try {
            const res = await fetch('Data/Factor_Data/finalMonthlyLabels_aman.csv');
            if (!res.ok) throw new Error(`CSV fetch failed (HTTP ${res.status}).`);
            const parsed = parseCSV(await res.text());

            // Detect the return column (handle both monthly_ret and Monthly_Return)
            const sample = parsed[0] || {};
            const retCol = 'monthly_ret' in sample ? 'monthly_ret'
                         : 'Monthly_Return' in sample ? 'Monthly_Return'
                         : null;
            if (!retCol) throw new Error('Return column not found. Expected "monthly_ret" or "Monthly_Return".');

            dataQualityStats = { dropped: 0, capped: 0, total: parsed.length };
            rawData = [];

            parsed.forEach(row => {
                row._month = row.Month ? row.Month.substring(0, 7) : '';
                row._size = parseFloat(row.Size);
                if (isNaN(row._size) || row._size <= 0) row._size = 0;

                const sanitized = sanitizeReturn(row[retCol]);
                if (sanitized.action === 'drop') {
                    dataQualityStats.dropped++;
                    return; // skip this row entirely
                }
                if (sanitized.action === 'capped') dataQualityStats.capped++;
                row._ret = sanitized.value;

                // Benchmarks: keep null if missing/invalid (do NOT default to 0)
                const n50 = parseFloat(row.nifty50);
                const n500 = parseFloat(row.nifty500);
                row._nifty50  = (isNaN(n50)  || !isFinite(n50))  ? null : n50;
                row._nifty500 = (isNaN(n500) || !isFinite(n500)) ? null : n500;

                rawData.push(row);
            });

            monthGroups = {};
            rawData.forEach(row => {
                if (!row._month) return;
                if (!monthGroups[row._month]) monthGroups[row._month] = [];
                monthGroups[row._month].push(row);
            });
            allMonths = Object.keys(monthGroups).sort();
            if (allMonths.length === 0) throw new Error('No data found.');

            const smEl = document.getElementById('bt-start-month');
            const emEl = document.getElementById('bt-end-month');
            smEl.min = emEl.min = allMonths[0];
            smEl.max = emEl.max = allMonths[allMonths.length - 1];
            smEl.value = allMonths[0];
            emEl.value = allMonths[allMonths.length - 1];

            buildFactorPicker();
            buildFactorPills('bt-long-factors', 'long');
            buildFactorPills('bt-short-factors', 'short');
            buildBenchmarkSelector();

            document.getElementById('bt-tc-toggle').addEventListener('click', () => {
                const active = document.querySelector('#bt-tc-toggle .bt-toggle-btn.active');
                document.getElementById('bt-tc-row').style.display =
                    (active && active.dataset.val === 'bps') ? 'flex' : 'none';
            });

            notice.className = 'bt-data-notice ready';
            const qMsg = (dataQualityStats.dropped + dataQualityStats.capped > 0)
                ? `  ·  ${dataQualityStats.dropped} dropped, ${dataQualityStats.capped} capped`
                : '';
            notice.textContent = `✓ ${rawData.length.toLocaleString()} rows · ${allMonths.length} months (${allMonths[0]} → ${allMonths[allMonths.length - 1]})${qMsg}`;
            document.getElementById('bt-run-btn').disabled = false;
            document.getElementById('bt-run-btn').textContent = 'Run Analysis';
            setTimeout(() => { notice.style.display = 'none'; }, 5000);
        } catch (err) {
            notice.className = 'bt-data-notice error';
            notice.innerHTML = `Failed to load: ${err.message}`;
        }
    }

    // ── Factor picker ─────────────────────────────────────────────────────────
    function buildFactorPicker() {
        const container = document.getElementById('bt-factor-picker');
        if (!container) return;
        container.innerHTML = '';

        for (const [groupName, factors] of Object.entries(FACTOR_GROUPS)) {
            const groupDiv = document.createElement('div');
            groupDiv.style.marginBottom = '8px';
            const groupLabel = document.createElement('div');
            groupLabel.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#64748b;margin-bottom:4px;';
            groupLabel.textContent = groupName;
            groupDiv.appendChild(groupLabel);

            const pillsDiv = document.createElement('div');
            pillsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

            for (const factorName of Object.keys(factors)) {
                const btn = document.createElement('button');
                btn.className = 'bt-pill' + (activeFactors.has(factorName) ? ' sel-long' : '');
                btn.textContent = factorName;
                btn.style.fontSize = '10px';
                btn.onclick = () => {
                    if (activeFactors.has(factorName)) {
                        activeFactors.delete(factorName);
                        btn.classList.remove('sel-long');
                    } else {
                        activeFactors.add(factorName);
                        btn.classList.add('sel-long');
                    }
                    buildFactorPills('bt-long-factors', 'long');
                    buildFactorPills('bt-short-factors', 'short');
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
        container.innerHTML = '';

        for (const [name, info] of Object.entries(FACTORS)) {
            if (!activeFactors.has(name)) continue;
            const row = document.createElement('div');
            row.className = 'bt-factor-row';
            row.innerHTML = `<div class="bt-factor-name">${name}</div><div class="bt-pills"></div>`;
            container.appendChild(row);
            const pillsEl = row.querySelector('.bt-pills');
            for (const [code, label] of Object.entries(info.labels)) {
                const btn = document.createElement('button');
                btn.className = 'bt-pill'; btn.textContent = label;
                btn.dataset.factor = name; btn.dataset.code = code; btn.dataset.side = side;
                btn.onclick = () => btn.classList.toggle(side === 'long' ? 'sel-long' : 'sel-short');
                pillsEl.appendChild(btn);
            }
        }

        if (activeFactors.size === 0) {
            container.innerHTML = '<div style="font-size:10.5px;color:#64748b;padding:8px 0;">Select factors above to see portfolio options</div>';
        }
    }

    function buildBenchmarkSelector() {
        const container = document.getElementById('bt-benchmark-selector');
        if (!container) return;
        container.innerHTML = '';
        for (const [id, cfg] of Object.entries(BENCHMARK_OPTIONS)) {
            const btn = document.createElement('button');
            btn.className = 'bt-toggle-btn' + (id === activeBenchmarkId ? ' active' : '');
            btn.dataset.val = id;
            btn.textContent = cfg.label;
            btn.onclick = () => {
                activeBenchmarkId = id;
                document.querySelectorAll('#bt-benchmark-selector .bt-toggle-btn')
                    .forEach(b => b.classList.toggle('active', b.dataset.val === id));
                if (portfolios.some(p => p.results)) {
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
        document.querySelectorAll('#bt-strategy-toggle .bt-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('bt-short-wrapper').style.display = currentStrategy === 'long_short' ? 'block' : 'none';
    }
    function setToggle(groupId, btn) {
        document.querySelectorAll(`#${groupId} .bt-toggle-btn`).forEach(b => b.classList.toggle('active', b === btn));
    }
    function getToggleVal(groupId) {
        const a = document.querySelector(`#${groupId} .bt-toggle-btn.active`);
        return a ? a.dataset.val : null;
    }
    function getFilters(side) {
        const cls = side === 'long' ? 'sel-long' : 'sel-short';
        const f = {};
        document.querySelectorAll(`.bt-pill.${cls}[data-side="${side}"]`).forEach(p => {
            if (!f[p.dataset.factor]) f[p.dataset.factor] = [];
            f[p.dataset.factor].push(p.dataset.code);
        });
        return f;
    }
    function clearPills() {
        document.querySelectorAll('.bt-pill.sel-long[data-side], .bt-pill.sel-short[data-side]').forEach(p => p.classList.remove('sel-long', 'sel-short'));
    }
    function setWeight(w) {
        currentWeight = w;
        document.querySelectorAll('#bt-weight-toggle .bt-wt-btn').forEach(b => b.classList.toggle('active', b.dataset.val === w));
        if (portfolios.some(p => p.results)) refreshAll();
    }
    function toggleBenchmark() {
        showBenchmark = document.getElementById('bt-bench-check').checked;
        if (portfolios.some(p => p.results)) refreshAll();
    }
    function toggleHeatmap() {
        heatmapOpen = !heatmapOpen;
        document.getElementById('bt-hm-arrow').classList.toggle('open', heatmapOpen);
        document.getElementById('bt-heatmap-content').classList.toggle('open', heatmapOpen);
        if (heatmapOpen) updateHeatmapGrid();
    }
    function refreshAll() { updateChart(); updateDrawdown(); updateCompareTable(); updateHeatmapGrid(); }

    // ── Transaction cost ──────────────────────────────────────────────────────
    function getTCConfig() {
        const mode = getToggleVal('bt-tc-toggle');
        if (mode === 'none') return { mode: 'none', cost: 0 };
        const val = parseFloat(document.getElementById('bt-tc-value').value) || 0;
        return { mode: 'bps', cost: val / 10000 };
    }

    function calcTurnover(prevStocks, currStocks) {
        if (!prevStocks || prevStocks.size === 0) return { entered: 0, exited: 0, ratio: 0 };
        let entered = 0, exited = 0;
        currStocks.forEach(s => { if (!prevStocks.has(s)) entered++; });
        prevStocks.forEach(s => { if (!currStocks.has(s)) exited++; });
        const avgSize = (prevStocks.size + currStocks.size) / 2;
        return { entered, exited, ratio: avgSize > 0 ? (entered + exited) / avgSize : 0 };
    }

    // ── Portfolio management ──────────────────────────────────────────────────
    function addPortfolio() {
        if (portfolios.length >= MAX_PORTFOLIOS) return;
        const longFilters = getFilters('long');
        const shortFilters = currentStrategy === 'long_short' ? getFilters('short') : {};
        if (!Object.values(longFilters).some(v => v && v.length)) { showError('Select at least one factor label.'); return; }
        if (currentStrategy === 'long_short' && !Object.values(shortFilters).some(v => v && v.length)) { showError('Select at least one short-side label.'); return; }

        const nameParts = [];
        for (const [f, codes] of Object.entries(longFilters)) nameParts.push(codes.map(c => FACTORS[f]?.labels[c] || c).join('/'));
        let name = nameParts.join(' · ');
        if (currentStrategy === 'long_short') {
            const sp = [];
            for (const [f, codes] of Object.entries(shortFilters)) sp.push(codes.map(c => FACTORS[f]?.labels[c] || c).join('/'));
            name += ' − ' + sp.join(' · ');
        }

        portfolios.push({
            id: nextId++, name: name.length > 50 ? name.substring(0, 47) + '…' : name,
            colorIdx: portfolios.length,
            config: { longFilters: JSON.parse(JSON.stringify(longFilters)), shortFilters: JSON.parse(JSON.stringify(shortFilters)), strategy: currentStrategy },
            results: null,
        });
        clearPills(); renderShelf(); hideError();
    }

    function removePortfolio(id) {
        portfolios = portfolios.filter(p => p.id !== id);
        portfolios.forEach((p, i) => { p.colorIdx = i; });
        renderShelf();
        if (portfolios.some(p => p.results)) {
            refreshAll();
            if (activeHoldingsId === id) { activeHoldingsId = portfolios.length > 0 ? portfolios[0].id : null; showHoldingsForCurrentMonth(); }
        } else resetResults();
    }

    function renderShelf() {
        const shelf = document.getElementById('bt-portfolio-shelf');
        shelf.innerHTML = '';
        portfolios.forEach(p => {
            const c = COLORS[p.colorIdx] || COLORS[0];
            const chip = document.createElement('div');
            chip.className = 'bt-portfolio-chip' + (activeHoldingsId === p.id ? ' active-chip' : '');
            chip.style.background = c.chip;
            chip.innerHTML = `<span class="bt-chip-label" title="${p.name}">${p.name}</span><button class="bt-chip-close" onclick="BT.removePortfolio(${p.id})">×</button>`;
            shelf.appendChild(chip);
        });
        document.getElementById('bt-shelf-limit').classList.toggle('visible', portfolios.length >= MAX_PORTFOLIOS);
        document.getElementById('bt-add-btn').disabled = portfolios.length >= MAX_PORTFOLIOS;
        const runBtn = document.getElementById('bt-run-btn');
        if (rawData.length === 0) { runBtn.textContent = 'Loading data…'; runBtn.disabled = true; }
        else { runBtn.textContent = portfolios.length > 1 ? 'Run Comparison' : 'Run Analysis'; runBtn.disabled = false; }
    }

    // ── Core computation ──────────────────────────────────────────────────────
    function applyFilters(rows, filters) {
        let result = rows;
        for (const [factor, labels] of Object.entries(filters)) {
            if (labels && labels.length && FACTORS[factor]) {
                const col = FACTORS[factor].col, set = new Set(labels);
                result = result.filter(r => set.has(r[col]));
            }
        }
        return result;
    }
    function topNBySize(rows, n) {
        return (!n || rows.length <= n) ? rows : rows.slice().sort((a,b) => b._size - a._size).slice(0, n);
    }
    // Equal-weight: simple mean of constituent returns
    function calcEW(rows) {
        if (rows.length === 0) return 0;
        let sum = 0, n = 0;
        for (const r of rows) {
            if (r._ret != null && isFinite(r._ret)) { sum += r._ret; n++; }
        }
        return n === 0 ? 0 : sum / n;
    }
    // Value-weight: weights MUST be from PRIOR month's size to avoid look-ahead bias.
    // Falls back to current size if prev_Size is unavailable; falls back to EW if no positive weights.
    function calcVW(rows) {
        if (rows.length === 0) return 0;
        let totalW = 0, weighted = 0, usedFallback = false;
        for (const r of rows) {
            if (r._ret == null || !isFinite(r._ret)) continue;
            let w = parseFloat(r.prev_Size);
            if (isNaN(w) || w <= 0) { w = r._size; usedFallback = true; }
            if (w <= 0 || !isFinite(w)) continue;
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
        const variance = active.reduce((s, v) => s + (v - mean) ** 2, 0) / (active.length - 1);
        const te = Math.sqrt(variance * 12);
        return te > 0 ? +(mean * 12 / te).toFixed(3) : null;
    }

    function computeMetrics(rets) {
        const n = rets.length;
        if (n === 0) return { growth_multiple:1, annualized_return:0, annualized_volatility:0,
            sharpe_ratio:0, max_drawdown:0, pct_positive_months:0, n_months:0 };
        let cumProd = 1;
        rets.forEach(r => { cumProd *= (1 + r); });
        const nYears = n / 12;
        // Guard against negative cumProd (which can happen for a wiped-out L-S portfolio)
        const annRet = (nYears > 0 && cumProd > 0) ? Math.pow(cumProd, 1 / nYears) - 1 : 0;
        const mean = rets.reduce((s, r) => s + r, 0) / n;
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(n - 1, 1);
        const annVol = Math.sqrt(variance * 12);
        const sharpe = annVol > 0 ? annRet / annVol : 0;
        let cum = 1, peak = 1, maxDD = 0;
        rets.forEach(r => { cum *= (1+r); if (cum > peak) peak = cum; const dd = peak > 0 ? (cum-peak)/peak : 0; if (dd < maxDD) maxDD = dd; });
        return {
            growth_multiple: +(cumProd).toFixed(2), annualized_return: +(annRet*100).toFixed(2),
            annualized_volatility: +(annVol*100).toFixed(2), sharpe_ratio: +sharpe.toFixed(3),
            max_drawdown: +(maxDD*100).toFixed(2), pct_positive_months: +((rets.filter(r=>r>0).length/n)*100).toFixed(1), n_months: n,
        };
    }

    function computeDrawdown(rets) {
        const dd = []; let cum = 1, peak = 1;
        rets.forEach(r => { cum *= (1+r); if (cum > peak) peak = cum; dd.push(+(peak > 0 ? (cum-peak)/peak*100 : 0).toFixed(2)); });
        return dd;
    }

    function computePortfolio(config, months) {
        const { longFilters, shortFilters, strategy } = config;
        const universe = getToggleVal('bt-universe-toggle');
        const topN = universe === 'top300' ? 300 : null;
        const tc = getTCConfig();
        const ewPort = [100], vwPort = [100], ewRets = [], vwRets = [];
        const holdings = {};
        let prevLongCodes = null, prevShortCodes = null;
        let totalTO = 0, toCount = 0;

        for (let mi = 0; mi < months.length; mi++) {
            const month = months[mi];
            let mdf = monthGroups[month] || [];
            if (topN) mdf = topNBySize(mdf, topN);
            const longDF = applyFilters(mdf, longFilters);
            const shortDF = strategy === 'long_short' ? applyFilters(mdf, shortFilters) : [];

            const currLongCodes = new Set(longDF.map(r => r.Co_Code));
            const currShortCodes = new Set(shortDF.map(r => r.Co_Code));

            // Turnover: long-only counts only long leg; long-short pays TC on BOTH legs (sum).
            let monthTurnoverRatio = 0;
            if (prevLongCodes) {
                const longTO = calcTurnover(prevLongCodes, currLongCodes);
                if (strategy === 'long_short' && prevShortCodes) {
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

            const ewL = calcEW(longDF), vwL = calcVW(longDF);
            const ewS = shortDF.length > 0 ? calcEW(shortDF) : 0;
            const vwS = shortDF.length > 0 ? calcVW(shortDF) : 0;

            // Standard dollar-neutral L-S: long return MINUS short return (NOT divided by 2).
            // This matches Fama-French factor construction. Dividing by 2 would understate.
            let ewNet, vwNet;
            if (strategy === 'long_short') { ewNet = ewL - ewS; vwNet = vwL - vwS; }
            else { ewNet = ewL; vwNet = vwL; }

            // Apply TC drag after month 0
            if (tc.mode !== 'none' && mi > 0) {
                const drag = monthTurnoverRatio * tc.cost;
                ewNet -= drag; vwNet -= drag;
            }

            // Final safety guard on net portfolio return
            if (!isFinite(ewNet)) ewNet = 0;
            if (!isFinite(vwNet)) vwNet = 0;
            // Cap monthly portfolio return at sensible bounds to prevent compounding blowup
            // from any residual data issue. ±50% in a single month for an aggregate portfolio
            // would itself be highly anomalous.
            const PORT_CAP = 0.50;
            if (ewNet > PORT_CAP) ewNet = PORT_CAP; else if (ewNet < -PORT_CAP) ewNet = -PORT_CAP;
            if (vwNet > PORT_CAP) vwNet = PORT_CAP; else if (vwNet < -PORT_CAP) vwNet = -PORT_CAP;

            ewRets.push(ewNet); vwRets.push(vwNet);
            ewPort.push(ewPort[ewPort.length-1] * (1+ewNet));
            vwPort.push(vwPort[vwPort.length-1] * (1+vwNet));

            const toFirms = rows => rows
                .filter(r => r._ret != null && isFinite(r._ret))
                .map(r => ({ name: r.Co_Name || r.co_name || '—', ret: +(r._ret*100).toFixed(2), size: r._size }))
                .sort((a,b) => b.ret - a.ret);
            holdings[month] = {
                long_firms: toFirms(longDF), short_firms: toFirms(shortDF),
                long_total: longDF.length, short_total: shortDF.length,
                ew_ret: +(ewNet*100).toFixed(3), vw_ret: +(vwNet*100).toFixed(3),
            };
        }

        return {
            months, ew_portfolio: ewPort.slice(1).map(v => +v.toFixed(4)),
            vw_portfolio: vwPort.slice(1).map(v => +v.toFixed(4)),
            ew_rets: ewRets, vw_rets: vwRets,
            ew_metrics: computeMetrics(ewRets), vw_metrics: computeMetrics(vwRets),
            ew_drawdown: computeDrawdown(ewRets), vw_drawdown: computeDrawdown(vwRets),
            holdings, isLongShort: strategy === 'long_short',
            avgTurnover: toCount > 0 ? +(totalTO / toCount * 100).toFixed(1) : 0,
        };
    }

    // ── Benchmarks from CSV ───────────────────────────────────────────────────
    // Use null-aware extraction: each month's benchmark is the FIRST non-null value
    // among the rows. If no row has a value for that month, carry forward 0 (flat).
    function computeIndexBenchmark(months, col) {
        const rets = [], port = [100];
        const key = `_${col}`;
        for (const month of months) {
            const rows = monthGroups[month] || [];
            let r = null;
            for (const row of rows) {
                const v = row[key];
                if (v != null && isFinite(v)) { r = v; break; }
            }
            // If truly no benchmark observation this month, record null (don't fake a 0)
            rets.push(r);
            const compoundR = (r == null) ? 0 : r;
            port.push(port[port.length-1] * (1+compoundR));
        }
        return { rets, portfolio: port.slice(1).map(v => +v.toFixed(4)), metrics: computeMetrics(rets.map(x => x == null ? 0 : x)), drawdown: computeDrawdown(rets.map(x => x == null ? 0 : x)) };
    }

    function computeAllBenchmarks(months) {
        benchmarkSeries = {};
        for (const [id, cfg] of Object.entries(BENCHMARK_OPTIONS)) {
            benchmarkSeries[id] = computeIndexBenchmark(months, cfg.col);
        }
        portfolios.forEach(p => {
            if (!p.results) return;
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) {
                p.results.ew_metrics.ir = computeIR(p.results.ew_rets, bench.rets);
                p.results.vw_metrics.ir = computeIR(p.results.vw_rets, bench.rets);
            }
        });
    }

    // ── Run ───────────────────────────────────────────────────────────────────
    function runAll() {
        hideError();
        if (portfolios.length === 0) {
            const lf = getFilters('long');
            if (Object.values(lf).some(v => v && v.length)) addPortfolio();
        }
        if (portfolios.length === 0) { showError('Select at least one factor label, then press Run.'); return; }

        const start = document.getElementById('bt-start-month').value;
        const end = document.getElementById('bt-end-month').value;
        const months = allMonths.filter(m => m >= start && m <= end);
        if (months.length === 0) { showError('No data in selected range.'); return; }

        const btn = document.getElementById('bt-run-btn');
        btn.disabled = true; btn.textContent = 'Running…';
        document.getElementById('bt-chart-loading').style.display = 'flex';

        setTimeout(() => {
            try {
                runMonths = months;
                portfolios.forEach(p => { p.results = computePortfolio(p.config, months); });
                computeAllBenchmarks(months);
                activeHoldingsId = portfolios[0].id;
                heatmapPortfolioId = portfolios[0].id;
                currentMonthIdx = months.length - 1;
                refreshAll(); setupMonthSlider(); showHoldingsForCurrentMonth();
                document.getElementById('bt-dd-card').style.display = 'block';
                document.getElementById('bt-heatmap-card').style.display = 'block';
            } catch (e) { showError('Error: ' + e.message); console.error(e); }
            finally {
                btn.disabled = false;
                btn.textContent = portfolios.length > 1 ? 'Run Comparison' : 'Run Analysis';
                document.getElementById('bt-chart-loading').style.display = 'none';
            }
        }, 50);
    }

    // ── Charts ────────────────────────────────────────────────────────────────
    function initChart() {
        chartInst = new Chart(document.getElementById('bt-perf-chart').getContext('2d'), {
            type: 'line', data: { labels: [], datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 400 }, interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, position: 'top', align: 'end', labels: { color: '#6b7280', font: { size: 11 }, boxWidth: 14, padding: 10 } },
                    tooltip: { backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f8fafc', padding: 12, borderColor: '#334155', borderWidth: 1,
                        callbacks: { label: item => `${item.dataset.label}: ₹${item.parsed.y.toFixed(2)}` } },
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 12, color: '#94a3b8', font: { size: 11 }, maxRotation: 0 } },
                    y: { type: 'linear', grid: { color: '#f1f5f9' }, border: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => `₹${v.toLocaleString('en-IN',{maximumFractionDigits:0})}` } },
                },
            },
        });
        document.getElementById('bt-perf-chart').addEventListener('mousemove', evt => {
            if (!chartInst || runMonths.length === 0) return;
            const pts = chartInst.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
            if (pts.length > 0) {
                const mIdx = pts[0].index - 1;
                if (mIdx >= 0 && mIdx < runMonths.length) {
                    currentMonthIdx = mIdx; updateMonthDisplay(); showHoldingsForCurrentMonth();
                    document.getElementById('bt-month-slider').value = mIdx;
                }
            }
        });

        ddChartInst = new Chart(document.getElementById('bt-dd-chart').getContext('2d'), {
            type: 'line', data: { labels: [], datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 300 }, interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: false },
                    tooltip: { backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f8fafc', padding: 10, borderColor: '#334155', borderWidth: 1,
                        callbacks: { label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(2)}%` } } },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10, color: '#94a3b8', font: { size: 10 }, maxRotation: 0 } },
                    y: { grid: { color: '#f1f5f9' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => `${v}%` } },
                },
            },
        });
    }

    function makeDataset(label, data, color, dashed) {
        return { label, data, borderColor: color.line, backgroundColor: color.bg, borderWidth: 2,
            borderDash: dashed ? [6,3] : [], pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0.2 };
    }

    function updateChart() {
        const wt = currentWeight, datasets = [];
        portfolios.forEach(p => {
            if (!p.results) return;
            const c = COLORS[p.colorIdx] || COLORS[0];
            datasets.push(makeDataset(p.name, [100, ...(wt === 'ew' ? p.results.ew_portfolio : p.results.vw_portfolio)], c, false));
        });
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) datasets.push(makeDataset(BENCHMARK_OPTIONS[activeBenchmarkId]?.label || activeBenchmarkId, [100, ...bench.portfolio], BENCH_COLOR, true));
        }
        chartInst.data.labels = ['Initial', ...runMonths];
        chartInst.data.datasets = datasets;
        chartInst.options.scales.y.type = document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update('active');
        document.getElementById('bt-chart-title').textContent = 'Portfolio Performance';
        document.getElementById('bt-chart-sub').textContent = runMonths.length > 0
            ? `${runMonths[0]} → ${runMonths[runMonths.length-1]}  ·  ${runMonths.length} months  ·  ${wt.toUpperCase()}` : 'Select factors and press Run';
    }

    function toggleLog() { if (!chartInst) return; chartInst.options.scales.y.type = document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear'; chartInst.update(); }

    function updateDrawdown() {
        const wt = currentWeight, datasets = [];
        portfolios.forEach(p => {
            if (!p.results) return;
            const c = COLORS[p.colorIdx] || COLORS[0];
            datasets.push({ label: p.name, data: wt === 'ew' ? p.results.ew_drawdown : p.results.vw_drawdown,
                borderColor: c.line, backgroundColor: c.bg, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: true, tension: 0.2 });
        });
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) datasets.push({ label: BENCHMARK_OPTIONS[activeBenchmarkId]?.label || '', data: bench.drawdown,
                borderColor: BENCH_COLOR.line, backgroundColor: BENCH_COLOR.bg, borderWidth: 1.5, borderDash: [6,3], pointRadius: 0, pointHoverRadius: 0, fill: true, tension: 0.2 });
        }
        ddChartInst.data.labels = runMonths; ddChartInst.data.datasets = datasets; ddChartInst.update('active');
    }

    // ── Comparison table ──────────────────────────────────────────────────────
    function updateCompareTable() {
        const card = document.getElementById('bt-compare-card');
        const body = document.getElementById('bt-compare-body');
        const wt = currentWeight;
        if (!portfolios.some(p => p.results)) { card.style.display = 'none'; return; }
        card.style.display = 'block'; body.innerHTML = '';

        const irHeader = document.getElementById('bt-ir-col-header');
        if (irHeader) irHeader.textContent = `IR (vs ${BENCHMARK_OPTIONS[activeBenchmarkId]?.label || ''})`;

        const addRow = (name, color, m, turnover, ir) => {
            const cls = v => v >= 0 ? 'bt-stat-pos' : 'bt-stat-neg';
            const sign = v => v > 0 ? '+' : '';
            const irDisplay = ir != null ? ir : '—';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="bt-compare-dot" style="background:${color}"></span><span class="bt-compare-name">${name}</span></td>
                <td>${m.growth_multiple}x</td>
                <td class="${cls(m.annualized_return)}">${sign(m.annualized_return)}${m.annualized_return}%</td>
                <td>${m.annualized_volatility}%</td>
                <td class="${cls(m.sharpe_ratio)}">${m.sharpe_ratio}</td>
                <td class="${cls(m.max_drawdown)}">${m.max_drawdown}%</td>
                <td>${m.pct_positive_months}%</td>
                <td class="${ir != null ? cls(ir) : ''}">${irDisplay}</td>
                <td>${turnover}</td>`;
            body.appendChild(tr);
        };

        portfolios.forEach(p => {
            if (!p.results) return;
            const m = wt === 'ew' ? p.results.ew_metrics : p.results.vw_metrics;
            addRow(p.name, (COLORS[p.colorIdx]||COLORS[0]).line, m, p.results.avgTurnover + '%', m.ir);
        });
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) addRow(BENCHMARK_OPTIONS[activeBenchmarkId]?.label || '', BENCH_COLOR.line, bench.metrics, '—', null);
        }
    }

    // ── Heatmap ───────────────────────────────────────────────────────────────
    function updateHeatmapGrid() {
        if (!heatmapOpen) return;
        const selectEl = document.getElementById('bt-hm-portfolio-select');
        const gridEl = document.getElementById('bt-heatmap-grid');
        selectEl.innerHTML = '';
        if (portfolios.length > 1) {
            const sel = document.createElement('select');
            portfolios.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; if (p.id === heatmapPortfolioId) opt.selected = true; sel.appendChild(opt); });
            sel.onchange = () => { heatmapPortfolioId = parseInt(sel.value); updateHeatmapGrid(); };
            selectEl.appendChild(sel);
        }
        const p = portfolios.find(x => x.id === heatmapPortfolioId);
        if (!p || !p.results) { gridEl.innerHTML = ''; return; }
        const rets = currentWeight === 'ew' ? p.results.ew_rets : p.results.vw_rets;
        const months = p.results.months;
        const yearMap = {};
        months.forEach((m, i) => { const [y, mo] = m.split('-'); if (!yearMap[y]) yearMap[y] = {}; yearMap[y][parseInt(mo)] = rets[i]; });

        let html = '<table class="bt-heatmap-table"><thead><tr><th></th>';
        MONTH_NAMES.forEach(m => { html += `<th>${m}</th>`; });
        html += '<th>Year</th></tr></thead><tbody>';
        Object.keys(yearMap).sort().forEach(y => {
            html += `<tr><td class="bt-hm-year">${y}</td>`;
            for (let mo = 1; mo <= 12; mo++) {
                const r = yearMap[y][mo];
                if (r !== undefined) { const pct = +(r*100).toFixed(1); html += `<td style="background:${heatColor(pct)};color:${Math.abs(pct)>5?'#fff':'#1f2937'}">${pct>0?'+':''}${pct}</td>`; }
                else html += '<td style="background:#f9fafb;color:#d1d5db;">—</td>';
            }
            let yCum = 1; for (let mo = 1; mo <= 12; mo++) { if (yearMap[y][mo] !== undefined) yCum *= (1+yearMap[y][mo]); }
            const yRet = +((yCum-1)*100).toFixed(1);
            html += `<td style="background:${heatColor(yRet)};color:${Math.abs(yRet)>5?'#fff':'#1f2937'};font-weight:700;">${yRet>0?'+':''}${yRet}</td></tr>`;
        });
        html += '</tbody></table>'; gridEl.innerHTML = html;
    }

    function heatColor(pct) {
        if (pct >= 10) return '#047857'; if (pct >= 5) return '#059669'; if (pct >= 2) return '#34d399';
        if (pct >= 0) return '#a7f3d0'; if (pct >= -2) return '#fecaca'; if (pct >= -5) return '#f87171';
        if (pct >= -10) return '#dc2626'; return '#991b1b';
    }

    // ── Month nav & holdings ──────────────────────────────────────────────────
    function setupMonthSlider() {
        const slider = document.getElementById('bt-month-slider');
        slider.min = 0; slider.max = runMonths.length-1; slider.value = currentMonthIdx;
        updateMonthDisplay();
        document.getElementById('bt-holdings-empty').style.display = 'none';
        document.getElementById('bt-holdings-content').style.display = 'block';
        renderHoldingsPortfolioTabs();
    }
    function updateMonthDisplay() {
        document.getElementById('bt-month-display').textContent = runMonths[currentMonthIdx] || '—';
        document.getElementById('bt-month-prev').disabled = currentMonthIdx <= 0;
        document.getElementById('bt-month-next').disabled = currentMonthIdx >= runMonths.length - 1;
    }
    function navMonth(d) { const n = currentMonthIdx+d; if (n<0||n>=runMonths.length) return; currentMonthIdx = n; document.getElementById('bt-month-slider').value = n; updateMonthDisplay(); showHoldingsForCurrentMonth(); }
    function sliderMonth(v) { currentMonthIdx = parseInt(v); updateMonthDisplay(); showHoldingsForCurrentMonth(); }

    function renderHoldingsPortfolioTabs() {
        const c = document.getElementById('bt-holdings-portfolio-tabs'); c.innerHTML = '';
        portfolios.forEach(p => {
            const col = COLORS[p.colorIdx] || COLORS[0];
            const btn = document.createElement('button'); btn.className = 'bt-month-nav-btn';
            btn.style.borderColor = activeHoldingsId === p.id ? col.line : '';
            btn.style.color = activeHoldingsId === p.id ? col.line : '';
            btn.style.fontWeight = activeHoldingsId === p.id ? '700' : '500';
            btn.textContent = p.name.length > 25 ? p.name.substring(0,22)+'…' : p.name;
            btn.onclick = () => { activeHoldingsId = p.id; renderHoldingsPortfolioTabs(); showHoldingsForCurrentMonth(); };
            c.appendChild(btn);
        });
    }

    function showHoldingsForCurrentMonth() {
        const month = runMonths[currentMonthIdx]; if (!month) return;
        const p = portfolios.find(x => x.id === activeHoldingsId); if (!p || !p.results) return;
        const h = p.results.holdings[month]; if (!h) return;
        const wt = currentWeight, ret = wt === 'ew' ? h.ew_ret : h.vw_ret;
        const retSign = ret >= 0 ? '+' : '', retCls = ret >= 0 ? 'bt-ret-pos' : 'bt-ret-neg';
        let html = `<div class="bt-holdings-header"><div class="bt-holdings-rets">
            <span class="bt-ret-tag" style="background:${COLORS[p.colorIdx].line}22;color:${COLORS[p.colorIdx].line};">${wt.toUpperCase()}</span>
            <span class="bt-ret-badge ${retCls}">${retSign}${ret.toFixed(2)}%</span>
            <span style="font-size:11px;color:var(--text-secondary);">· ${h.long_total} stocks</span></div></div><div class="bt-holdings-cols">`;
        html += buildFirmsCol('LONG', h.long_total, h.long_firms, 'hl', 'l');
        if (p.results.isLongShort) html += buildFirmsCol('SHORT', h.short_total, h.short_firms, 'hs', 's');
        html += '</div>'; document.getElementById('bt-holdings-inner').innerHTML = html;
    }

    function buildFirmsCol(side, total, firms, headCls, tagCls) {
        let html = `<div class="bt-hcol"><h4 class="${headCls}">${side} · ${total} stocks</h4><div class="bt-firm-scroll">`;
        if (firms.length > 0) { firms.forEach(f => { const s = f.ret>=0?'+':'', c = f.ret>=0?'bt-firm-ret-pos':'bt-firm-ret-neg';
            html += `<div class="bt-firm-row"><span class="bt-stag ${tagCls}">${f.name}</span><span class="bt-firm-ret ${c}">${s}${f.ret.toFixed(1)}%</span></div>`; });
        } else html += '<span class="bt-none-nifty">No stocks match.</span>';
        html += '</div></div>'; return html;
    }

    function showError(msg) { document.getElementById('bt-error-msg').textContent = msg; document.getElementById('bt-error-msg').style.display = 'block'; }
    function hideError() { document.getElementById('bt-error-msg').style.display = 'none'; }
    function resetResults() {
        if (chartInst) { chartInst.data.labels = []; chartInst.data.datasets = []; chartInst.update(); }
        if (ddChartInst) { ddChartInst.data.labels = []; ddChartInst.data.datasets = []; ddChartInst.update(); }
        ['bt-compare-card','bt-dd-card','bt-heatmap-card'].forEach(id => document.getElementById(id).style.display = 'none');
        document.getElementById('bt-holdings-empty').style.display = 'block';
        document.getElementById('bt-holdings-content').style.display = 'none';
    }

    function init() { initChart(); loadData(); renderShelf(); }

    return {
        init, runAll, setStrategy, setToggle, toggleLog, setWeight,
        addPortfolio, removePortfolio, toggleBenchmark, toggleHeatmap,
        navMonth, sliderMonth,
    };
})();

document.addEventListener('DOMContentLoaded', BT.init);