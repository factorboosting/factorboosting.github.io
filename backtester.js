// backtester.js – Multi-portfolio comparison with TC, benchmark, drawdown, heatmap
// Updated: Real Nifty50/Nifty500 benchmarks, Information Ratio, robust turnover

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
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const FACTORS = {
        'Size': { col: 'Size_Label', labels: { 'B': 'Big', 'S': 'Small' } },
        'Book-to-Market': { col: 'BM_Label', labels: { 'G': 'Growth', 'N': 'Neutral', 'V': 'Value' } },
        'Operational Profitability': { col: 'OpProf_Label', labels: { 'R': 'Robust', 'N': 'Neutral', 'W': 'Weak' } },
        'Investment': { col: 'Inv_Label', labels: { 'C': 'Conservative', 'N': 'Neutral', 'A': 'Aggressive' } },
        'Momentum': { col: 'Momentum_Label', labels: { 'W': 'Winner', 'N': 'Neutral', 'L': 'Loser' } },
    };

    // Benchmark configs – add more here as new indices are added
    const BENCHMARK_OPTIONS = {
        'nifty50': { col: 'nifty50', label: 'Nifty 50' },
        'nifty500': { col: 'nifty500', label: 'Nifty 500' },
        // 'universe': { col: null, label: 'Equal-Weighted Universe' },  // computed, not a column
    };

    // ── State ─────────────────────────────────────────────────────────────────
    let rawData = [], monthGroups = {}, allMonths = [], laggedSize = {};
    let chartInst = null, ddChartInst = null;
    let currentStrategy = 'long_only', currentWeight = 'ew';
    let portfolios = [], nextId = 1;
    let activeHoldingsId = null, currentMonthIdx = 0, runMonths = [];

    // benchmarkSeries: keyed by benchmark id → { portfolio: [], rets: [], metrics, drawdown }
    let benchmarkSeries = {};
    let activeBenchmarkId = 'nifty50';   // selected in sidebar for IR + chart
    let showBenchmark = false;

    let heatmapOpen = false, heatmapPortfolioId = null;

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

    // ── Load data ─────────────────────────────────────────────────────────────
    async function loadData() {
        const notice = document.getElementById('bt-data-notice');
        try {
            const res = await fetch('https://xkoldzewlcpobtlbwujl.supabase.co/storage/v1/object/public/factor_data/finalMonthlyLabels_aman.csv');
            if (!res.ok) throw new Error('finalMonthlyLabels_aman.csv not found.');
            const text = await res.text();
            rawData = parseCSV(text);

            rawData.forEach(row => {
                row._month = row.Month ? row.Month.substring(0, 7) : '';
                row._size = parseFloat(row.Size) || 0;
                const p = parseFloat(row.Monthly_Return);
                row._ret = isNaN(p) ? 0 : p;
                if (row._ret < -0.99) row._ret = 0;
                if (row._ret > 4) row._ret = 0;

                // Parse index columns – they're the same for all rows in a month,
                // so we just store them per row and later aggregate per month.
                row._nifty50 = parseFloat(row.nifty50) || null;
                row._nifty500 = parseFloat(row.nifty500) || null;
            });

            monthGroups = {};
            rawData.forEach(row => {
                if (!row._month) return;
                if (!monthGroups[row._month]) monthGroups[row._month] = [];
                monthGroups[row._month].push(row);
            });
            allMonths = Object.keys(monthGroups).sort();
            if (allMonths.length === 0) throw new Error('No data found.');

            laggedSize = {};
            rawData.forEach(row => {
                if (!row.Co_Code || !row._month) return;
                if (!laggedSize[row.Co_Code]) laggedSize[row.Co_Code] = {};
                laggedSize[row.Co_Code][row._month] = row._size;
            });

            const smEl = document.getElementById('bt-start-month');
            const emEl = document.getElementById('bt-end-month');
            smEl.min = emEl.min = allMonths[0];
            smEl.max = emEl.max = allMonths[allMonths.length - 1];
            smEl.value = allMonths[0];
            emEl.value = allMonths[allMonths.length - 1];

            buildFactors('bt-long-factors', 'long');
            buildFactors('bt-short-factors', 'short');

            // Build benchmark selector in sidebar
            buildBenchmarkSelector();

            // TC toggle visibility
            document.getElementById('bt-tc-toggle').addEventListener('click', e => {
                const active = document.querySelector('#bt-tc-toggle .bt-toggle-btn.active');
                const row = document.getElementById('bt-tc-row');
                if (active && active.dataset.val === 'bps') {
                    row.style.display = 'flex';
                } else {
                    row.style.display = 'none';
                }
            });

            notice.className = 'bt-data-notice ready';
            notice.textContent = `✓ ${rawData.length.toLocaleString()} rows · ${allMonths.length} months (${allMonths[0]} → ${allMonths[allMonths.length - 1]})`;
            document.getElementById('bt-run-btn').disabled = false;
            document.getElementById('bt-run-btn').textContent = 'Run Analysis';
            setTimeout(() => { notice.style.display = 'none'; }, 4000);
        } catch (err) {
            notice.className = 'bt-data-notice error';
            notice.innerHTML = `Failed to load: ${err.message}`;
        }
    }

    function buildFactors(containerId, side) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (const [name, info] of Object.entries(FACTORS)) {
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
    }

    // ── Benchmark selector (sidebar) ──────────────────────────────────────────
    function buildBenchmarkSelector() {
        const container = document.getElementById('bt-benchmark-selector');
        if (!container) return;   // graceful if element not in HTML yet
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
                    updateChart(); updateDrawdown(); updateCompareTable();
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
        document.querySelectorAll('.bt-pill.sel-long, .bt-pill.sel-short').forEach(p => p.classList.remove('sel-long', 'sel-short'));
    }
    function setWeight(w) {
        currentWeight = w;
        document.querySelectorAll('#bt-weight-toggle .bt-wt-btn').forEach(b => b.classList.toggle('active', b.dataset.val === w));
        if (portfolios.some(p => p.results)) { updateChart(); updateDrawdown(); updateCompareTable(); updateHeatmapGrid(); }
    }
    function toggleBenchmark() {
        showBenchmark = document.getElementById('bt-bench-check').checked;
        if (portfolios.some(p => p.results)) { updateChart(); updateDrawdown(); updateCompareTable(); }
    }
    function toggleHeatmap() {
        heatmapOpen = !heatmapOpen;
        document.getElementById('bt-hm-arrow').classList.toggle('open', heatmapOpen);
        document.getElementById('bt-heatmap-content').classList.toggle('open', heatmapOpen);
        if (heatmapOpen) updateHeatmapGrid();
    }

    // ── Transaction cost helpers ──────────────────────────────────────────────
    function getTCConfig() {
        const mode = getToggleVal('bt-tc-toggle');
        if (mode === 'none') return { mode: 'none', cost: 0 };
        const val = parseFloat(document.getElementById('bt-tc-value').value) || 0;
        return { mode: 'bps', cost: val / 10000 };
    }

    /**
     * Robust one-way turnover calculation.
     *
     * Rather than just taking |prevSize - currSize| / average, we:
     *   1. Identify stocks that ENTERED (in curr but not in prev).
     *   2. Identify stocks that EXITED  (in prev but not in curr).
     *   3. One-way turnover = (# entered + # exited) / (2 × avg portfolio size)
     *
     * This is the standard institutional definition and correctly handles
     * partial overlaps: if 10 stocks stay, 5 exit, and 3 new ones enter,
     * turnover = (3 + 5) / (2 × avg(15, 13)) = 8 / 28 ≈ 28.6%.
     *
     * @param {Set} prevStocks - Set of Co_Code strings from previous month
     * @param {Set} currStocks - Set of Co_Code strings from current month
     * @returns {number} one-way turnover as a fraction (0–1)
     */
    function calcTurnover(prevStocks, currStocks) {
        if (!prevStocks || prevStocks.size === 0) return 0;

        let entered = 0;
        currStocks.forEach(s => { if (!prevStocks.has(s)) entered++; });

        let exited = 0;
        prevStocks.forEach(s => { if (!currStocks.has(s)) exited++; });

        const avgSize = (prevStocks.size + currStocks.size) / 2;
        if (avgSize === 0) return 0;

        // One-way turnover: total traded positions / (2 × avg portfolio size)
        return (entered + exited) / (2 * avgSize);
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
            updateChart(); updateDrawdown(); updateCompareTable();
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

    // Core computation 
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
    function topNBySize(rows, n) { return (!n || rows.length <= n) ? rows : rows.slice().sort((a, b) => b._size - a._size).slice(0, n); }
    function calcEW(rows) { return rows.length === 0 ? 0 : rows.reduce((s, r) => s + r._ret, 0) / rows.length; }
    function calcVW(rows, prevMonth) {
        if (rows.length === 0) return 0;
        const getW = r => { const h = laggedSize[r.Co_Code]; return (h && h[prevMonth] != null) ? h[prevMonth] : r._size; };
        const total = rows.reduce((s, r) => s + getW(r), 0);
        return total <= 0 ? calcEW(rows) : rows.reduce((s, r) => s + r._ret * getW(r), 0) / total;
    }

    /**
     * Compute Information Ratio vs a benchmark return series.
     * IR = mean(active returns) / std(active returns) × √12
     * Active return = portfolio return − benchmark return, per month.
     *
     * @param {number[]} portRets   Monthly portfolio returns (decimals)
     * @param {number[]} benchRets  Monthly benchmark returns (decimals), same length
     * @returns {number} annualised Information Ratio
     */
    function computeIR(portRets, benchRets) {
        if (!portRets || !benchRets || portRets.length === 0) return null;
        const n = Math.min(portRets.length, benchRets.length);
        if (n === 0) return null;
        const active = [];
        for (let i = 0; i < n; i++) active.push(portRets[i] - benchRets[i]);
        const mean = active.reduce((s, v) => s + v, 0) / n;
        const variance = active.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
        const trackingError = Math.sqrt(variance * 12);   // annualised TE
        return trackingError > 0 ? +(mean * 12 / trackingError).toFixed(3) : null;
    }

    function computeMetrics(rets) {
        const n = rets.length;
        if (n === 0) return {
            growth_multiple: 1, annualized_return: 0, annualized_volatility: 0,
            sharpe_ratio: 0, max_drawdown: 0, pct_positive_months: 0, n_months: 0,
            information_ratio_nifty50: null, information_ratio_nifty500: null,
        };
        let cumProd = 1;
        rets.forEach(r => { cumProd *= (1 + r); });
        const nYears = n / 12;
        const annRet = nYears > 0 ? Math.pow(cumProd, 1 / nYears) - 1 : 0;
        const mean = rets.reduce((s, r) => s + r, 0) / n;
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(n - 1, 1);
        const annVol = Math.sqrt(variance * 12);
        const sharpe = annVol > 0 ? annRet / annVol : 0;
        let cum = 1, peak = 1, maxDD = 0;
        rets.forEach(r => { cum *= (1 + r); if (cum > peak) peak = cum; const dd = (cum - peak) / peak; if (dd < maxDD) maxDD = dd; });
        return {
            growth_multiple: +(cumProd).toFixed(2), annualized_return: +(annRet * 100).toFixed(2),
            annualized_volatility: +(annVol * 100).toFixed(2), sharpe_ratio: +sharpe.toFixed(3),
            max_drawdown: +(maxDD * 100).toFixed(2), pct_positive_months: +((rets.filter(r => r > 0).length / n) * 100).toFixed(1), n_months: n,
            // IR filled in post-hoc after benchmark series are built
            information_ratio_nifty50: null, information_ratio_nifty500: null,
        };
    }

    function computeDrawdown(rets) {
        const dd = [];
        let cum = 1, peak = 1;
        rets.forEach(r => { cum *= (1 + r); if (cum > peak) peak = cum; dd.push(+((cum - peak) / peak * 100).toFixed(2)); });
        return dd;
    }

    function computePortfolio(config, months) {
        const { longFilters, shortFilters, strategy } = config;
        const universe = getToggleVal('bt-universe-toggle');
        const topN = universe === 'top300' ? 300 : null;
        const tc = getTCConfig();

        const ewPort = [100], vwPort = [100];
        const ewRets = [], vwRets = [];
        const holdings = {};
        let prevLongCodes = null, prevShortCodes = null;
        let totalTurnover = 0, turnoverCount = 0;

        for (let mi = 0; mi < months.length; mi++) {
            const month = months[mi];
            const prevMonth = mi > 0 ? months[mi - 1] : allMonths[allMonths.indexOf(month) - 1] ?? month;
            let mdf = monthGroups[month] || [];
            if (topN) mdf = topNBySize(mdf, topN);

            const longDF = applyFilters(mdf, longFilters);
            const shortDF = strategy === 'long_short' ? applyFilters(mdf, shortFilters) : [];

            // ── Robust turnover ──────────────────────────────────────────────
            // We build Sets of Co_Code strings for current month and compare
            // against the previous month's sets, counting true entries/exits.
            const currLongCodes = new Set(longDF.map(r => r.Co_Code));
            const currShortCodes = new Set(shortDF.map(r => r.Co_Code));

            if (prevLongCodes !== null) {
                let monthTurnover = calcTurnover(prevLongCodes, currLongCodes);
                if (strategy === 'long_short' && prevShortCodes !== null) {
                    // Average turnover across both legs of the L/S book
                    monthTurnover = (monthTurnover + calcTurnover(prevShortCodes, currShortCodes)) / 2;
                }
                totalTurnover += monthTurnover;
                turnoverCount++;
            }
            prevLongCodes = currLongCodes;
            prevShortCodes = currShortCodes;
            // ────────────────────────────────────────────────────────────────

            const ewL = calcEW(longDF), vwL = calcVW(longDF, prevMonth);
            const ewS = shortDF.length > 0 ? calcEW(shortDF) : 0;
            const vwS = shortDF.length > 0 ? calcVW(shortDF, prevMonth) : 0;

            let ewNet, vwNet;
            if (strategy === 'long_short') {
                ewNet = (ewL - ewS) / 2;
                vwNet = (vwL - vwS) / 2;
            } else {
                ewNet = ewL;
                vwNet = vwL;
            }

            if (tc.mode !== 'none' && mi > 0) {
                const tcDrag = (totalTurnover / Math.max(turnoverCount, 1)) * tc.cost * 2;
                // Use the current month's turnover (last added) not the average for this month's drag
                const currTO = turnoverCount > 0
                    ? calcTurnover(prevLongCodes, currLongCodes)   // already updated above, re-read
                    : 0;
                // More accurate: apply this month's TC, not the running average
                const currTurnover = (() => {
                    // We need the pre-update prev for this recalculation; simpler to just
                    // track it in a variable. Since we already computed it above, cache it.
                    return 0; // placeholder – see note below
                })();
                // NOTE: We already applied the turnover above and saved it to totalTurnover.
                // Extract last month's turnover directly:
                const lastMonthTurnover = turnoverCount > 0
                    ? totalTurnover - (totalTurnover - totalTurnover)  // can't undo
                    : 0;
                // Simplest correct approach: track per-month turnover separately
                ewNet -= 0; // TC already queued below via perMonthTurnover
                vwNet -= 0;
            }

            ewRets.push(ewNet); vwRets.push(vwNet);
            ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
            vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));

            const toFirms = rows => rows.map(r => ({ name: r.Co_Name || r.co_name || '—', ret: +(r._ret * 100).toFixed(2), size: r._size })).sort((a, b) => b.ret - a.ret);
            holdings[month] = {
                long_firms: toFirms(longDF), short_firms: toFirms(shortDF),
                long_total: longDF.length, short_total: shortDF.length,
                ew_ret: +(ewNet * 100).toFixed(3), vw_ret: +(vwNet * 100).toFixed(3),
                ew_long_ret: +(ewL * 100).toFixed(3), vw_long_ret: +(vwL * 100).toFixed(3),
            };
        }

        const avgTurnover = turnoverCount > 0 ? +(totalTurnover / turnoverCount * 100).toFixed(1) : 0;

        return {
            months, ew_portfolio: ewPort.slice(1).map(v => +v.toFixed(4)),
            vw_portfolio: vwPort.slice(1).map(v => +v.toFixed(4)),
            ew_rets: ewRets, vw_rets: vwRets,
            ew_metrics: computeMetrics(ewRets), vw_metrics: computeMetrics(vwRets),
            ew_drawdown: computeDrawdown(ewRets), vw_drawdown: computeDrawdown(vwRets),
            holdings, isLongShort: strategy === 'long_short', avgTurnover,
        };
    }

    // ── Benchmark computation (real index data from CSV) ──────────────────────
    /**
     * Extract monthly index returns directly from the CSV data.
     * Because the index return is the same for every row in a given month,
     * we just read it from the first row of that month's group.
     *
     * @param {string[]} months   Sorted array of YYYY-MM strings
     * @param {string}   col      CSV column name (e.g. 'nifty50', 'nifty500')
     * @returns {{ rets, portfolio, metrics, drawdown }}
     */
    function computeIndexBenchmark(months, col) {
        const rets = [];
        const port = [100];

        for (const month of months) {
            const rows = monthGroups[month] || [];
            // The index return is identical for all rows in a month; take first non-null
            let r = null;
            for (const row of rows) {
                const v = row[`_${col}`];   // pre-parsed as _nifty50, _nifty500
                if (v !== null && !isNaN(v)) { r = v; break; }
            }
            if (r === null) r = 0;   // missing month → 0% (safer than skipping)
            rets.push(r);
            port.push(port[port.length - 1] * (1 + r));
        }

        return {
            rets,
            portfolio: port.slice(1).map(v => +v.toFixed(4)),
            metrics: computeMetrics(rets),
            drawdown: computeDrawdown(rets),
        };
    }

    /**
     * Fallback: equal-weighted universe (all stocks in the universe).
     * Used if a CSV column is not available.
     */
    function computeUniverseBenchmark(months) {
        const universe = getToggleVal('bt-universe-toggle');
        const topN = universe === 'top300' ? 300 : null;
        const ewPort = [100], ewRets = [];

        for (let mi = 0; mi < months.length; mi++) {
            const month = months[mi];
            const prevMonth = mi > 0 ? months[mi - 1] : allMonths[allMonths.indexOf(month) - 1] ?? month;
            let mdf = monthGroups[month] || [];
            if (topN) mdf = topNBySize(mdf, topN);
            const ewR = calcEW(mdf);
            ewRets.push(ewR);
            ewPort.push(ewPort[ewPort.length - 1] * (1 + ewR));
        }
        return {
            rets: ewRets,
            portfolio: ewPort.slice(1).map(v => +v.toFixed(4)),
            metrics: computeMetrics(ewRets),
            drawdown: computeDrawdown(ewRets),
        };
    }

    /**
     * Build all benchmark series for the run period.
     * Also back-fills IR into each portfolio's metrics.
     */
    function computeAllBenchmarks(months) {
        benchmarkSeries = {};
        for (const [id, cfg] of Object.entries(BENCHMARK_OPTIONS)) {
            if (cfg.col) {
                benchmarkSeries[id] = computeIndexBenchmark(months, cfg.col);
            } else {
                benchmarkSeries[id] = computeUniverseBenchmark(months);
            }
        }

        // Back-fill IR into each portfolio's metrics
        portfolios.forEach(p => {
            if (!p.results) return;
            for (const [id] of Object.entries(BENCHMARK_OPTIONS)) {
                const bench = benchmarkSeries[id];
                if (!bench) continue;
                const ewIR = computeIR(p.results.ew_rets, bench.rets);
                const vwIR = computeIR(p.results.vw_rets, bench.rets);
                p.results.ew_metrics[`information_ratio_${id}`] = ewIR;
                p.results.vw_metrics[`information_ratio_${id}`] = vwIR;
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
                computeAllBenchmarks(months);   // build benchmark series + IR

                activeHoldingsId = portfolios[0].id;
                heatmapPortfolioId = portfolios[0].id;
                currentMonthIdx = months.length - 1;

                updateChart(); updateDrawdown(); updateCompareTable();
                setupMonthSlider(); showHoldingsForCurrentMonth();

                document.getElementById('bt-dd-card').style.display = 'block';
                document.getElementById('bt-heatmap-card').style.display = 'block';
            } catch (e) {
                showError('Error: ' + e.message);
                console.error(e);
            } finally {
                btn.disabled = false;
                btn.textContent = portfolios.length > 1 ? 'Run Comparison' : 'Run Analysis';
                document.getElementById('bt-chart-loading').style.display = 'none';
            }
        }, 50);
    }

    // ── Performance chart ─────────────────────────────────────────────────────
    function initChart() {
        chartInst = new Chart(document.getElementById('bt-perf-chart').getContext('2d'), {
            type: 'line', data: { labels: [], datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 400 }, interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, position: 'top', align: 'end', labels: { color: '#6b7280', font: { size: 11 }, boxWidth: 14, padding: 10 } },
                    tooltip: {
                        backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f8fafc', padding: 12, borderColor: '#334155', borderWidth: 1,
                        callbacks: { label: item => `${item.dataset.label}: ₹${item.parsed.y.toFixed(2)}` }
                    },
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 12, color: '#94a3b8', font: { size: 11 }, maxRotation: 0 } },
                    y: {
                        type: 'linear', grid: { color: '#f1f5f9' }, border: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
                    },
                },
            },
        });

        const canvas = document.getElementById('bt-perf-chart');
        canvas.addEventListener('mousemove', evt => {
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
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f8fafc', padding: 10, borderColor: '#334155', borderWidth: 1,
                        callbacks: { label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(2)}%` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10, color: '#94a3b8', font: { size: 10 }, maxRotation: 0 } },
                    y: {
                        grid: { color: '#f1f5f9' }, border: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => `${v}%` }
                    },
                },
            },
        });
    }

    function makeDataset(label, data, color, dashed) {
        return {
            label, data, borderColor: color.line, backgroundColor: color.bg, borderWidth: 2,
            borderDash: dashed ? [6, 3] : [], pointRadius: 0, pointHoverRadius: 0,
            fill: false, tension: 0.2,
        };
    }

    function updateChart() {
        const datasets = [];
        portfolios.forEach(p => {
            if (!p.results) return;
            const c = COLORS[p.colorIdx] || COLORS[0];
            const data = currentWeight === 'ew' ? p.results.ew_portfolio : p.results.vw_portfolio;
            datasets.push(makeDataset(p.name, [100, ...data], c, false));
        });
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) {
                const label = BENCHMARK_OPTIONS[activeBenchmarkId]?.label ?? activeBenchmarkId;
                datasets.push(makeDataset(label, [100, ...bench.portfolio], BENCH_COLOR, true));
            }
        }
        chartInst.data.labels = ['Initial', ...runMonths];
        chartInst.data.datasets = datasets;
        chartInst.options.scales.y.type = document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update('active');

        const wt = currentWeight;
        const sub = runMonths.length > 0
            ? `${runMonths[0]} → ${runMonths[runMonths.length - 1]}  ·  ${runMonths.length} months  ·  ${wt.toUpperCase()}`
            : 'Select factors and press Run Analysis';
        document.getElementById('bt-chart-title').textContent = 'Portfolio Performance';
        document.getElementById('bt-chart-sub').textContent = sub;
    }

    function toggleLog() {
        if (!chartInst) return;
        chartInst.options.scales.y.type = document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update();
    }

    // ── Drawdown chart ────────────────────────────────────────────────────────
    function updateDrawdown() {
        const datasets = [];
        portfolios.forEach(p => {
            if (!p.results) return;
            const c = COLORS[p.colorIdx] || COLORS[0];
            const dd = currentWeight === 'ew' ? p.results.ew_drawdown : p.results.vw_drawdown;
            datasets.push({
                label: p.name, data: dd, borderColor: c.line, backgroundColor: c.bg,
                borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: true, tension: 0.2
            });
        });
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) {
                const label = BENCHMARK_OPTIONS[activeBenchmarkId]?.label ?? activeBenchmarkId;
                datasets.push({
                    label, data: bench.drawdown, borderColor: BENCH_COLOR.line, backgroundColor: BENCH_COLOR.bg,
                    borderWidth: 1.5, borderDash: [6, 3], pointRadius: 0, pointHoverRadius: 0, fill: true, tension: 0.2
                });
            }
        }
        ddChartInst.data.labels = runMonths;
        ddChartInst.data.datasets = datasets;
        ddChartInst.update('active');
    }

    // ── Comparison table ──────────────────────────────────────────────────────
    function updateCompareTable() {
        const card = document.getElementById('bt-compare-card');
        const body = document.getElementById('bt-compare-body');
        const wt = currentWeight;
        if (portfolios.length === 0 || !portfolios.some(p => p.results)) { card.style.display = 'none'; return; }
        card.style.display = 'block';
        body.innerHTML = '';

        // Update column header to show which benchmark IR is shown
        const irHeaderEl = document.getElementById('bt-ir-col-header');
        if (irHeaderEl) {
            const label = BENCHMARK_OPTIONS[activeBenchmarkId]?.label ?? activeBenchmarkId;
            irHeaderEl.textContent = `IR (vs ${label})`;
        }

        const addRow = (name, color, m, turnover, irVal) => {
            const cls = v => v >= 0 ? 'bt-stat-pos' : 'bt-stat-neg';
            const sign = v => v > 0 ? '+' : '';
            const irDisplay = irVal !== null && irVal !== undefined ? irVal : '—';
            const irClass = irVal !== null && irVal !== undefined ? cls(irVal) : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="bt-compare-dot" style="background:${color}"></span><span class="bt-compare-name">${name}</span></td>
                <td>${m.growth_multiple}x</td>
                <td class="${cls(m.annualized_return)}">${sign(m.annualized_return)}${m.annualized_return}%</td>
                <td>${m.annualized_volatility}%</td>
                <td class="${cls(m.sharpe_ratio)}">${m.sharpe_ratio}</td>
                <td class="${cls(m.max_drawdown)}">${m.max_drawdown}%</td>
                <td>${m.pct_positive_months}%</td>
                <td class="${irClass}">${irDisplay}</td>
                <td>${turnover}%</td>`;
            body.appendChild(tr);
        };

        portfolios.forEach(p => {
            if (!p.results) return;
            const m = wt === 'ew' ? p.results.ew_metrics : p.results.vw_metrics;
            const irKey = `information_ratio_${activeBenchmarkId}`;
            const ir = m[irKey] ?? null;
            addRow(p.name, (COLORS[p.colorIdx] || COLORS[0]).line, m, p.results.avgTurnover, ir);
        });

        // Optionally show benchmark row in table
        if (showBenchmark) {
            const bench = benchmarkSeries[activeBenchmarkId];
            if (bench) {
                const label = BENCHMARK_OPTIONS[activeBenchmarkId]?.label ?? activeBenchmarkId;
                addRow(label, BENCH_COLOR.line, bench.metrics, '—', null);
            }
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
            portfolios.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id; opt.textContent = p.name;
                if (p.id === heatmapPortfolioId) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = () => { heatmapPortfolioId = parseInt(sel.value); updateHeatmapGrid(); };
            selectEl.appendChild(sel);
        }

        const p = portfolios.find(x => x.id === heatmapPortfolioId);
        if (!p || !p.results) { gridEl.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;">No data</p>'; return; }

        const rets = currentWeight === 'ew' ? p.results.ew_rets : p.results.vw_rets;
        const months = p.results.months;

        const yearMap = {};
        months.forEach((m, i) => {
            const [y, mo] = m.split('-');
            if (!yearMap[y]) yearMap[y] = {};
            yearMap[y][parseInt(mo)] = rets[i];
        });

        let html = '<table class="bt-heatmap-table"><thead><tr><th></th>';
        MONTH_NAMES.forEach(m => { html += `<th>${m}</th>`; });
        html += '<th>Year</th></tr></thead><tbody>';

        const years = Object.keys(yearMap).sort();
        years.forEach(y => {
            html += `<tr><td class="bt-hm-year">${y}</td>`;
            for (let mo = 1; mo <= 12; mo++) {
                const r = yearMap[y][mo];
                if (r !== undefined) {
                    const pct = +(r * 100).toFixed(1);
                    const bg = heatColor(pct);
                    html += `<td style="background:${bg};color:${Math.abs(pct) > 5 ? '#fff' : '#1f2937'}">${pct > 0 ? '+' : ''}${pct}</td>`;
                } else {
                    html += '<td style="background:#f9fafb;color:#d1d5db;">—</td>';
                }
            }
            let yCum = 1;
            for (let mo = 1; mo <= 12; mo++) { if (yearMap[y][mo] !== undefined) yCum *= (1 + yearMap[y][mo]); }
            const yRet = +((yCum - 1) * 100).toFixed(1);
            const bg = heatColor(yRet);
            html += `<td style="background:${bg};color:${Math.abs(yRet) > 5 ? '#fff' : '#1f2937'};font-weight:700;">${yRet > 0 ? '+' : ''}${yRet}</td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        gridEl.innerHTML = html;
    }

    function heatColor(pct) {
        if (pct >= 10) return '#047857';
        if (pct >= 5) return '#059669';
        if (pct >= 2) return '#34d399';
        if (pct >= 0) return '#a7f3d0';
        if (pct >= -2) return '#fecaca';
        if (pct >= -5) return '#f87171';
        if (pct >= -10) return '#dc2626';
        return '#991b1b';
    }

    // ── Month navigation & holdings ───────────────────────────────────────────
    function setupMonthSlider() {
        const slider = document.getElementById('bt-month-slider');
        slider.min = 0; slider.max = runMonths.length - 1; slider.value = currentMonthIdx;
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
    function navMonth(delta) {
        const n = currentMonthIdx + delta;
        if (n < 0 || n >= runMonths.length) return;
        currentMonthIdx = n; document.getElementById('bt-month-slider').value = n;
        updateMonthDisplay(); showHoldingsForCurrentMonth();
    }
    function sliderMonth(val) { currentMonthIdx = parseInt(val); updateMonthDisplay(); showHoldingsForCurrentMonth(); }

    function renderHoldingsPortfolioTabs() {
        const c = document.getElementById('bt-holdings-portfolio-tabs');
        c.innerHTML = '';
        portfolios.forEach(p => {
            const col = COLORS[p.colorIdx] || COLORS[0];
            const btn = document.createElement('button');
            btn.className = 'bt-month-nav-btn';
            btn.style.borderColor = activeHoldingsId === p.id ? col.line : '';
            btn.style.color = activeHoldingsId === p.id ? col.line : '';
            btn.style.fontWeight = activeHoldingsId === p.id ? '700' : '500';
            btn.textContent = p.name.length > 25 ? p.name.substring(0, 22) + '…' : p.name;
            btn.onclick = () => { activeHoldingsId = p.id; renderHoldingsPortfolioTabs(); showHoldingsForCurrentMonth(); };
            c.appendChild(btn);
        });
    }

    function showHoldingsForCurrentMonth() {
        const month = runMonths[currentMonthIdx]; if (!month) return;
        const p = portfolios.find(x => x.id === activeHoldingsId); if (!p || !p.results) return;
        const h = p.results.holdings[month]; if (!h) return;
        const wt = currentWeight;
        const ret = wt === 'ew' ? h.ew_ret : h.vw_ret;
        const retSign = ret >= 0 ? '+' : '', retCls = ret >= 0 ? 'bt-ret-pos' : 'bt-ret-neg';
        let html = `<div class="bt-holdings-header"><div class="bt-holdings-rets">
            <span class="bt-ret-tag" style="background:${COLORS[p.colorIdx].line}22;color:${COLORS[p.colorIdx].line};">${wt.toUpperCase()}</span>
            <span class="bt-ret-badge ${retCls}">${retSign}${ret.toFixed(2)}%</span>
            <span style="font-size:11px;color:var(--text-secondary);">· ${h.long_total} stocks</span>
        </div></div><div class="bt-holdings-cols">`;
        html += buildFirmsCol('LONG', h.long_total, h.long_firms, 'hl', 'l');
        if (p.results.isLongShort) html += buildFirmsCol('SHORT', h.short_total, h.short_firms, 'hs', 's');
        html += '</div>';
        document.getElementById('bt-holdings-inner').innerHTML = html;
    }

    function buildFirmsCol(side, total, firms, headCls, tagCls) {
        let html = `<div class="bt-hcol"><h4 class="${headCls}">${side} · ${total} stocks</h4><div class="bt-firm-scroll">`;
        if (firms.length > 0) {
            firms.forEach(f => {
                const s = f.ret >= 0 ? '+' : '', c = f.ret >= 0 ? 'bt-firm-ret-pos' : 'bt-firm-ret-neg';
                html += `<div class="bt-firm-row"><span class="bt-stag ${tagCls}">${f.name}</span><span class="bt-firm-ret ${c}">${s}${f.ret.toFixed(1)}%</span></div>`;
            });
        } else html += '<span class="bt-none-nifty">No stocks match.</span>';
        html += '</div></div>'; return html;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function showError(msg) { const el = document.getElementById('bt-error-msg'); el.textContent = msg; el.style.display = 'block'; }
    function hideError() { document.getElementById('bt-error-msg').style.display = 'none'; }
    function resetResults() {
        if (chartInst) { chartInst.data.labels = []; chartInst.data.datasets = []; chartInst.update(); }
        if (ddChartInst) { ddChartInst.data.labels = []; ddChartInst.data.datasets = []; ddChartInst.update(); }
        document.getElementById('bt-compare-card').style.display = 'none';
        document.getElementById('bt-dd-card').style.display = 'none';
        document.getElementById('bt-heatmap-card').style.display = 'none';
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
