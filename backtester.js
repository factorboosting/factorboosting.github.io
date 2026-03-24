// backtester.js – Cross-sectional portfolio analysis
// Data source: finalMonthlyLabels_aman.csv
// Shows both equal-weighted (EW) and value-weighted (VW) cumulative returns
// Lists ALL firms in the selected portfolio below the chart

const BT = (() => {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    let rawData      = [];
    let monthGroups  = {};   // { "2009-10": [rows...], ... }
    let allMonths    = [];
    let laggedSize   = {};   // { co_code: { "YYYY-MM": size } } — prev-month size for VW weights
    let chartInst    = null;
    let backtestData = null;
    let currentStrategy = 'long_only';

    const FACTORS = {
        'Size':     { col: 'Size_Label',     labels: { 'B': 'Big',          'S': 'Small' } },
        'Book-to-Market':      { col: 'BM_Label',       labels: { 'G': 'Growth',       'N': 'Neutral', 'V': 'Value' } },
        'Operatioanl Profitability':   { col: 'OpProf_Label',   labels: { 'R': 'Robust',       'N': 'Neutral', 'W': 'Weak' } },
        'Investment':      { col: 'Inv_Label',      labels: { 'C': 'Conservative', 'N': 'Neutral', 'A': 'Aggressive' } },
        'Momentum': { col: 'Momentum_Label', labels: { 'W': 'Winner',       'N': 'Neutral', 'L': 'Loser' } },
    };

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
            const res = await fetch('Data/Factor_Data/finalMonthlyLabels_aman.csv');
            if (!res.ok) throw new Error('finalMonthlyLabels_aman.csv not found.');

            const text = await res.text();
            rawData = parseCSV(text);

            // Pre-compute typed fields
            rawData.forEach(row => {
                // Month column is "YYYY-MM-DD" → extract "YYYY-MM" for grouping
                row._month = row.Month ? row.Month.substring(0, 7) : '';
                // Size = market cap (used as VW weight)
                row._size  = parseFloat(row.Size) || 0;
                // Monthly_Return is a gross return (1 + r), e.g. 1.11 = +11%
                const parsed = parseFloat(row.Monthly_Return);
                row._ret = isNaN(parsed) ? 1 : parsed;
                // a filter for abnormal returns
                if (row._ret < 0 || row._ret > 3) row._ret = 1;
            });

            // Group by "YYYY-MM"
            monthGroups = {};
            rawData.forEach(row => {
                if (!row._month) return;
                if (!monthGroups[row._month]) monthGroups[row._month] = [];
                monthGroups[row._month].push(row);
            });
            allMonths = Object.keys(monthGroups).sort();

            if (allMonths.length === 0) throw new Error('No monthly data found in CSV.');

            // Build lagged-size lookup: for each stock, map each month → prev month's size
            // VW weights should use beginning-of-period market cap to avoid look-ahead bias
            laggedSize = {};
            rawData.forEach(row => {
                if (!row.Co_Code || !row._month) return;
                if (!laggedSize[row.Co_Code]) laggedSize[row.Co_Code] = {};
                laggedSize[row.Co_Code][row._month] = row._size;
            });

            // Set date-range inputs
            const smEl = document.getElementById('bt-start-month');
            const emEl = document.getElementById('bt-end-month');
            smEl.min = emEl.min = allMonths[0];
            smEl.max = emEl.max = allMonths[allMonths.length - 1];
            smEl.value = allMonths[0];
            emEl.value = allMonths[allMonths.length - 1];

            // Build factor pill UIs
            buildFactors('bt-long-factors',  'long');
            buildFactors('bt-short-factors', 'short');

            notice.className = 'bt-data-notice ready';
            notice.textContent =
                `✓ ${rawData.length.toLocaleString()} rows | ${allMonths.length} months` +
                ` (${allMonths[0]} → ${allMonths[allMonths.length - 1]})`;

            const btn = document.getElementById('bt-run-btn');
            btn.disabled  = false;
            btn.textContent = 'Run Analysis';

            setTimeout(() => { notice.style.display = 'none'; }, 4000);

        } catch (err) {
            notice.className = 'bt-data-notice error';
            notice.innerHTML =
                `Failed to load data: ${err.message}<br>` +
                `<small>Make sure <code>finalMonthlyLabels_aman.csv</code> is in <code>Data/Factor_Data/</code></small>`;
        }
    }

    // ── Build factor pill selectors ───────────────────────────────────────────
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
                btn.className   = 'bt-pill';
                btn.textContent = label;
                btn.dataset.factor = name;
                btn.dataset.code   = code;
                btn.dataset.side   = side;
                btn.onclick = () => {
                    btn.classList.toggle(side === 'long' ? 'sel-long' : 'sel-short');
                };
                pillsEl.appendChild(btn);
            }
        }
    }

    // ── Toggle helpers ────────────────────────────────────────────────────────
    function setStrategy(btn) {
        currentStrategy = btn.dataset.val;
        document.querySelectorAll('#bt-strategy-toggle .bt-toggle-btn')
            .forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('bt-short-wrapper').style.display =
            currentStrategy === 'long_short' ? 'block' : 'none';
    }

    function setToggle(groupId, btn) {
        document.querySelectorAll(`#${groupId} .bt-toggle-btn`)
            .forEach(b => b.classList.toggle('active', b === btn));
    }

    function getToggleVal(groupId) {
        const active = document.querySelector(`#${groupId} .bt-toggle-btn.active`);
        return active ? active.dataset.val : null;
    }

    function getFilters(side) {
        const cls = side === 'long' ? 'sel-long' : 'sel-short';
        const filters = {};
        document.querySelectorAll(`.bt-pill.${cls}[data-side="${side}"]`).forEach(p => {
            if (!filters[p.dataset.factor]) filters[p.dataset.factor] = [];
            filters[p.dataset.factor].push(p.dataset.code);
        });
        return filters;
    }

    // ── Portfolio filtering & return calculation ───────────────────────────────
    function applyFilters(rows, filters) {
        let result = rows;
        for (const [factor, labels] of Object.entries(filters)) {
            if (labels && labels.length && FACTORS[factor]) {
                const col      = FACTORS[factor].col;
                const labelSet = new Set(labels);
                result = result.filter(r => labelSet.has(r[col]));
            }
        }
        return result;
    }

    function topNBySize(rows, n) {
        if (!n || rows.length <= n) return rows;
        return rows.slice().sort((a, b) => b._size - a._size).slice(0, n);
    }

    // Equal-weighted net return (gross return already includes 1)
    function calcEW(rows) {
        if (rows.length === 0) return 0;
        return rows.reduce((s, r) => s + (r._ret - 1), 0) / rows.length;
    }

    // Value-weighted using PREVIOUS month's market cap as weights (no look-ahead bias)
    function calcVW(rows, prevMonth) {
        if (rows.length === 0) return 0;
        // For each stock, look up its size from prevMonth; fall back to current if unavailable
        const getWeight = r => {
            const hist = laggedSize[r.Co_Code];
            return (hist && hist[prevMonth] != null) ? hist[prevMonth]: r._size;
        };
        const totalSize = rows.reduce((s, r) => s + getWeight(r), 0);
        if (totalSize <= 0) return calcEW(rows);   // fallback to EW
        return rows.reduce((s, r) => s + (r._ret - 1) * getWeight(r), 0) / totalSize;
    }

    // ── Performance metrics ───────────────────────────────────────────────────
    function computeMetrics(rets) {
        const n = rets.length;
        if (n === 0) {
            return { total_return: 0, annualized_return: 0, annualized_volatility: 0,
                     sharpe_ratio: 0, max_drawdown: 0, pct_positive_months: 0, n_months: 0 };
        }
        let cumProd = 1;
        rets.forEach(r => { cumProd *= (1 + r); });
        const total  = cumProd - 1;
        const nYears = n / 12;
        const annRet = nYears > 0 ? Math.pow(1 + total, 1 / nYears) - 1 : 0;
        const mean   = rets.reduce((s, r) => s + r, 0) / n;
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(n - 1, 1);
        const annVol = Math.sqrt(variance * 12);
        const sharpe = annVol > 0 ? annRet / annVol : 0;

        let cum = 1, peak = 1, maxDD = 0;
        rets.forEach(r => {
            cum *= (1 + r);
            if (cum > peak) peak = cum;
            const dd = (cum - peak) / peak;
            if (dd < maxDD) maxDD = dd;
        });

        return {
            total_return:         +(total   * 100).toFixed(2),
            growth_multiple:      +(cumProd).toFixed(2),
            annualized_return:    +(annRet  * 100).toFixed(2),
            annualized_volatility:+(annVol  * 100).toFixed(2),
            sharpe_ratio:         +sharpe.toFixed(3),
            max_drawdown:         +(maxDD   * 100).toFixed(2),
            pct_positive_months:  +((rets.filter(r => r > 0).length / n) * 100).toFixed(1),
            n_months: n,
        };
    }

    // ── Run analysis ──────────────────────────────────────────────────────────
    function run() {
        const errEl = document.getElementById('bt-error-msg');
        errEl.style.display = 'none';

        const longFilters  = getFilters('long');
        const shortFilters = currentStrategy === 'long_short' ? getFilters('short') : {};
        const universe     = getToggleVal('bt-universe-toggle');
        const topNval      = universe === 'top300' ? 300 : null;
        const start        = document.getElementById('bt-start-month').value;
        const end          = document.getElementById('bt-end-month').value;

        if (!Object.values(longFilters).some(v => v && v.length)) {
            showError('Select at least one label for the long portfolio.');
            return;
        }

        const months = allMonths.filter(m => m >= start && m <= end);
        if (months.length === 0) {
            showError('No data in the selected date range.');
            return;
        }


        const btn = document.getElementById('bt-run-btn');
        btn.disabled    = true;
        btn.textContent = 'Running…';
        document.getElementById('bt-chart-loading').style.display = 'flex';

        // Yield to the UI before heavy computation
        setTimeout(() => {
            try {
                const ewPort = [100], vwPort = [100];
                const ewRets = [], vwRets = [];
                const holdings = {};

                for (let mi = 0; mi < months.length; mi++) {
                    const month    = months[mi];
                    const prevMonth = mi > 0 ? months[mi - 1] : allMonths[allMonths.indexOf(month) - 1] ?? month;
                    let mdf = monthGroups[month] || [];
                    if (topNval) mdf = topNBySize(mdf, topNval);

                    const longDF  = applyFilters(mdf, longFilters);
                    const shortDF = currentStrategy === 'long_short'
                        ? applyFilters(mdf, shortFilters) : [];

                    const ewL = calcEW(longDF),  vwL = calcVW(longDF, prevMonth);
                    const ewS = shortDF.length > 0 ? calcEW(shortDF) : 0;
                    const vwS = shortDF.length > 0 ? calcVW(shortDF, prevMonth) : 0;

                    const ewNet = ewL - ewS;
                    const vwNet = vwL - vwS;

                    ewRets.push(ewNet);
                    vwRets.push(vwNet);
                    ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
                    vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));

                    // Store ALL firms sorted by monthly return (descending)
                    const toFirms = rows => rows
                        .map(r => ({
                            name: r.Co_Name || r.co_name || '—',
                            ret:  +((r._ret - 1) * 100).toFixed(2),
                            size: r._size,
                        }))
                        .sort((a, b) => b.ret - a.ret);

                    holdings[month] = {
                        long_firms:  toFirms(longDF),
                        short_firms: toFirms(shortDF),
                        long_total:  longDF.length,
                        short_total: shortDF.length,
                        ew_ret: +(ewNet * 100).toFixed(3),
                        vw_ret: +(vwNet * 100).toFixed(3),
                    };
                }

                backtestData = {
                    months,
                    ew_portfolio: ewPort.slice(1).map(v => +v.toFixed(4)),
                    vw_portfolio: vwPort.slice(1).map(v => +v.toFixed(4)),
                    ew_metrics:  computeMetrics(ewRets),
                    vw_metrics:  computeMetrics(vwRets),
                    holdings,
                    isLongShort: currentStrategy === 'long_short',
                };

                updateChart(backtestData);
                updateMetrics(backtestData.ew_metrics, backtestData.vw_metrics);
                // Show the most recent month's holdings after run
                showHoldingsForMonth(months[months.length - 1]);

            } catch (e) {
                showError('Computation error: ' + e.message);
            } finally {
                btn.disabled    = false;
                btn.textContent = 'Run Analysis';
                document.getElementById('bt-chart-loading').style.display = 'none';
            }
        }, 50);
    }

    function showError(msg) {
        const el = document.getElementById('bt-error-msg');
        el.textContent    = msg;
        el.style.display  = 'block';
    }

    // ── Chart (two lines: EW + VW) ────────────────────────────────────────────
    function initChart() {
        const ctx = document.getElementById('bt-perf-chart').getContext('2d');
        chartInst = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Equal Weighted',
                        data: [],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59,130,246,0.06)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#3b82f6',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 2,
                        fill: false,
                        tension: 0.2,
                    },
                    {
                        label: 'Value Weighted',
                        data: [],
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.06)',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#10b981',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 2,
                        fill: false,
                        tension: 0.2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: { color: '#6b7280', font: { size: 12 }, boxWidth: 16, padding: 12 },
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#94a3b8',
                        bodyColor: '#f8fafc',
                        padding: 12,
                        borderColor: '#334155',
                        borderWidth: 1,
                        callbacks: {
                            title: items => items[0].label,
                            label: item => {
                                const tag = item.datasetIndex === 0 ? 'EW' : 'VW';
                                return `${tag}: ₹${item.parsed.y.toFixed(2)}`;
                            },
                            afterBody: items => {
                                if (!backtestData || items.length === 0) return [];
                                const idx = items[0].dataIndex - 1;
                                if (idx < 0 || idx >= backtestData.months.length) return [];
                                const h = backtestData.holdings[backtestData.months[idx]];
                                if (!h) return [];
                                const eSign = h.ew_ret >= 0 ? '+' : '';
                                const vSign = h.vw_ret >= 0 ? '+' : '';
                                return [`Month: EW ${eSign}${h.ew_ret.toFixed(2)}%  |  VW ${vSign}${h.vw_ret.toFixed(2)}%`];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { maxTicksLimit: 12, color: '#94a3b8', font: { size: 11 }, maxRotation: 0 },
                    },
                    y: {
                        type: 'linear',
                        grid: { color: '#f1f5f9' },
                        border: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 11 },
                            callback: v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                        },
                    },
                },
            },
        });

        // Hover → update firms panel
        const canvas = document.getElementById('bt-perf-chart');
        canvas.addEventListener('mousemove', evt => {
            if (!chartInst || !backtestData) return;
            const pts = chartInst.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
            if (pts.length > 0) {
                const mIdx = pts[0].index - 1;
                if (mIdx >= 0 && mIdx < backtestData.months.length) {
                    showHoldingsForMonth(backtestData.months[mIdx]);
                }
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (backtestData) {
                // Revert to last month on mouse leave
                showHoldingsForMonth(backtestData.months[backtestData.months.length - 1]);
            }
        });
    }

    function updateChart(data) {
        chartInst.data.labels              = ['Initial', ...data.months];
        chartInst.data.datasets[0].data   = [100, ...data.ew_portfolio];
        chartInst.data.datasets[1].data   = [100, ...data.vw_portfolio];
        chartInst.options.scales.y.type   =
            document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update('active');

        const m = data.ew_metrics;
        document.getElementById('bt-chart-title').textContent = 'Portfolio Performance';
        document.getElementById('bt-chart-sub').textContent   =
            `${data.months[0]} → ${data.months[data.months.length - 1]}  ·  ${m.n_months} months`;
    }

    function toggleLog() {
        if (!chartInst) return;
        chartInst.options.scales.y.type =
            document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update();
    }

    // ── Metrics (dual EW / VW per card) ──────────────────────────────────────
    function updateMetrics(ewM, vwM) {
        const pairs = [
            ['bt-m-total',  ewM.growth_multiple,       vwM.growth_multiple,       'x',  false],
            ['bt-m-ann',    ewM.annualized_return,      vwM.annualized_return,     '%',  false ],
            ['bt-m-vol',    ewM.annualized_volatility,  vwM.annualized_volatility, '%',  false],
            ['bt-m-sharpe', ewM.sharpe_ratio,           vwM.sharpe_ratio,          '',   false ],
            ['bt-m-dd',     ewM.max_drawdown,           vwM.max_drawdown,          '%',  false ],
            ['bt-m-pos',    ewM.pct_positive_months,    vwM.pct_positive_months,   '%',  false],
        ];
        pairs.forEach(([id, ewVal, vwVal, suffix, useColor]) => {
            setMetricPair(id, ewVal, vwVal, suffix, useColor);
        });
    }

    function setMetricPair(baseId, ewVal, vwVal, suffix, useColor) {
        const ewEl = document.getElementById(`${baseId}-ew`);
        const vwEl = document.getElementById(`${baseId}-vw`);
    
        if (ewEl) {
            const prefix = useColor && ewVal > 0 ? '+' : '';
            ewEl.textContent = `${prefix}${ewVal}${suffix}`;
            ewEl.classList.remove('pos', 'neg');
            if (useColor) ewEl.classList.add(ewVal > 0 ? 'pos' : ewVal < 0 ? 'neg' : '');
            else ewEl.className = 'bt-metric-value';  // neutral blue
        }
        if (vwEl) {
            const prefix = useColor && vwVal > 0 ? '+' : '';
            vwEl.textContent = `${prefix}${vwVal}${suffix}`;
            vwEl.classList.remove('pos', 'neg');
            if (useColor) vwEl.classList.add(vwVal > 0 ? 'pos' : vwVal < 0 ? 'neg' : '');
            else vwEl.className = 'bt-metric-vw';  // neutral green
        }
    }

    // ── Firms panel (all firms, scrollable) ───────────────────────────────────
    function showHoldingsForMonth(month) {
        if (!backtestData || !month) return;
        const h = backtestData.holdings[month];
        if (!h) return;

        document.getElementById('bt-holdings-empty').style.display = 'none';
        const content = document.getElementById('bt-holdings-content');
        content.style.display = 'block';

        const ewSign   = h.ew_ret >= 0 ? '+' : '';
        const vwSign   = h.vw_ret >= 0 ? '+' : '';
        const ewCls    = h.ew_ret >= 0 ? 'bt-ret-pos' : 'bt-ret-neg';
        const vwCls    = h.vw_ret >= 0 ? 'bt-ret-pos' : 'bt-ret-neg';

        let html = `
            <div class="bt-holdings-header">
                <div class="bt-holdings-month">${month}</div>
                <div class="bt-holdings-rets">
                    <span class="bt-ret-tag bt-ret-tag-ew">EW</span>
                    <span class="bt-ret-badge ${ewCls}">${ewSign}${h.ew_ret.toFixed(2)}%</span>
                    <span class="bt-ret-tag bt-ret-tag-vw">VW</span>
                    <span class="bt-ret-badge ${vwCls}">${vwSign}${h.vw_ret.toFixed(2)}%</span>
                </div>
            </div>
            <div class="bt-holdings-cols">
        `;

        html += buildFirmsCol('LONG', h.long_total, h.long_firms, 'hl', 'l');
        if (backtestData.isLongShort) {
            html += buildFirmsCol('SHORT', h.short_total, h.short_firms, 'hs', 's');
        }

        html += '</div>';
        content.innerHTML = html;
    }

    function buildFirmsCol(side, total, firms, headCls, tagCls) {
        let html = `
            <div class="bt-hcol">
                <h4 class="${headCls}">${side} &nbsp;·&nbsp; ${total} stocks</h4>
                <div class="bt-firm-scroll">
        `;

        if (firms.length > 0) {
            firms.forEach(f => {
                const retSign = f.ret >= 0 ? '+' : '';
                const retCls  = f.ret >= 0 ? 'bt-firm-ret-pos' : 'bt-firm-ret-neg';
                html += `
                    <div class="bt-firm-row">
                        <span class="bt-stag ${tagCls}">${f.name}</span>
                        <span class="bt-firm-ret ${retCls}">${retSign}${f.ret.toFixed(1)}%</span>
                    </div>`;
            });
        } else {
            html += `<span class="bt-none-nifty">No stocks match the selected filters.</span>`;
        }

        html += '</div></div>';
        return html;
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        initChart();
        loadData();
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return { init, run, setStrategy, setToggle, toggleLog };
})();

document.addEventListener('DOMContentLoaded', BT.init);


