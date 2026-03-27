// backtester.js – Multi-portfolio comparison
// Data source: finalMonthlyLabels_aman.csv

const BT = (() => {
    'use strict';

    // ── Constants ─────────────────────────────────────────────────────────────
    const MAX_PORTFOLIOS = 4;
    const COLORS = [
        { line: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  chip: '#3b82f6' },  // blue
        { line: '#10b981', bg: 'rgba(16,185,129,0.08)',  chip: '#10b981' },  // green
        { line: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  chip: '#f59e0b' },  // amber
        { line: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',  chip: '#8b5cf6' },  // purple
    ];

    const FACTORS = {
        'Size':                        { col: 'Size_Label',     labels: { 'B': 'Big',          'S': 'Small' } },
        'Book-to-Market':              { col: 'BM_Label',       labels: { 'G': 'Growth',       'N': 'Neutral', 'V': 'Value' } },
        'Operational Profitability':   { col: 'OpProf_Label',   labels: { 'R': 'Robust',       'N': 'Neutral', 'W': 'Weak' } },
        'Investment':                  { col: 'Inv_Label',      labels: { 'C': 'Conservative', 'N': 'Neutral', 'A': 'Aggressive' } },
        'Momentum':                    { col: 'Momentum_Label', labels: { 'W': 'Winner',       'N': 'Neutral', 'L': 'Loser' } },
    };

    // ── State ─────────────────────────────────────────────────────────────────
    let rawData      = [];
    let monthGroups  = {};
    let allMonths    = [];
    let laggedSize   = {};
    let chartInst    = null;
    let currentStrategy = 'long_only';
    let currentWeight   = 'ew';           // 'ew' or 'vw'

    // Multi-portfolio state
    let portfolios     = [];              // [{ id, name, config, results }]
    let nextId         = 1;
    let activeHoldingsId = null;          // which portfolio's holdings are shown
    let currentMonthIdx  = 0;            // slider position
    let runMonths        = [];            // months array from last run

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

            rawData.forEach(row => {
                row._month = row.Month ? row.Month.substring(0, 7) : '';
                row._size  = parseFloat(row.Size) || 0;
                const parsed = parseFloat(row.Monthly_Return);
                row._ret = isNaN(parsed) ? 1 : parsed;
                if (row._ret < 0) row._ret = 0;
                if (row._ret > 3) row._ret = 1;
            });

            monthGroups = {};
            rawData.forEach(row => {
                if (!row._month) return;
                if (!monthGroups[row._month]) monthGroups[row._month] = [];
                monthGroups[row._month].push(row);
            });
            allMonths = Object.keys(monthGroups).sort();
            if (allMonths.length === 0) throw new Error('No monthly data found.');

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

            buildFactors('bt-long-factors',  'long');
            buildFactors('bt-short-factors', 'short');

            notice.className = 'bt-data-notice ready';
            notice.textContent =
                `✓ ${rawData.length.toLocaleString()} rows · ${allMonths.length} months` +
                ` (${allMonths[0]} → ${allMonths[allMonths.length - 1]})`;

            const btn = document.getElementById('bt-run-btn');
            btn.disabled = false;
            btn.textContent = 'Run Comparison';
            setTimeout(() => { notice.style.display = 'none'; }, 4000);
        } catch (err) {
            notice.className = 'bt-data-notice error';
            notice.innerHTML = `Failed to load data: ${err.message}`;
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
                btn.onclick = () => btn.classList.toggle(side === 'long' ? 'sel-long' : 'sel-short');
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
        const a = document.querySelector(`#${groupId} .bt-toggle-btn.active`);
        return a ? a.dataset.val : null;
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

    function clearPills() {
        document.querySelectorAll('.bt-pill.sel-long, .bt-pill.sel-short').forEach(p => {
            p.classList.remove('sel-long', 'sel-short');
        });
    }

    // ── Weight toggle ─────────────────────────────────────────────────────────
    function setWeight(w) {
        currentWeight = w;
        document.querySelectorAll('#bt-weight-toggle .bt-wt-btn')
            .forEach(b => b.classList.toggle('active', b.dataset.val === w));
        if (portfolios.some(p => p.results)) {
            updateChart();
            updateCompareTable();
        }
    }

    // ── Portfolio management ──────────────────────────────────────────────────
    function addPortfolio() {
        console.log('addPortfolio called, current count:', portfolios.length);
        if (portfolios.length >= MAX_PORTFOLIOS) {
            console.log('Max portfolios reached');
            return;
        }

        const longFilters  = getFilters('long');
        const shortFilters = currentStrategy === 'long_short' ? getFilters('short') : {};

        console.log('Long filters:', longFilters);
        console.log('Short filters:', shortFilters);

        if (!Object.values(longFilters).some(v => v && v.length)) {
            showError('Select at least one factor label before adding.');
            return;
        }

        if (currentStrategy === 'long_short' && !Object.values(shortFilters).some(v => v && v.length)) {
            showError('Select at least one label for the short side.');
            return;
        }

        // Build a human-readable name
        const nameParts = [];
        for (const [factor, codes] of Object.entries(longFilters)) {
            const labels = codes.map(c => FACTORS[factor]?.labels[c] || c);
            nameParts.push(labels.join('/'));
        }
        let name = nameParts.join(' · ');
        if (currentStrategy === 'long_short') {
            const shortParts = [];
            for (const [factor, codes] of Object.entries(shortFilters)) {
                const labels = codes.map(c => FACTORS[factor]?.labels[c] || c);
                shortParts.push(labels.join('/'));
            }
            name += ' − ' + shortParts.join(' · ');
        }

        const colorIdx = portfolios.length;
        const p = {
            id: nextId++,
            name: name.length > 50 ? name.substring(0, 47) + '…' : name,
            colorIdx,
            config: {
                longFilters:  JSON.parse(JSON.stringify(longFilters)),
                shortFilters: JSON.parse(JSON.stringify(shortFilters)),
                strategy: currentStrategy,
            },
            results: null,
        };
        portfolios.push(p);
        clearPills();
        renderShelf();
        hideError();
    }

    function removePortfolio(id) {
        portfolios = portfolios.filter(p => p.id !== id);
        // Reassign color indices
        portfolios.forEach((p, i) => { p.colorIdx = i; });
        renderShelf();
        if (portfolios.some(p => p.results)) {
            updateChart();
            updateCompareTable();
            // Reset holdings if we removed the active one
            if (activeHoldingsId === id) {
                activeHoldingsId = portfolios.length > 0 ? portfolios[0].id : null;
                showHoldingsForCurrentMonth();
            }
        } else {
            resetResults();
        }
    }

    function renderShelf() {
        const shelf = document.getElementById('bt-portfolio-shelf');
        const limit = document.getElementById('bt-shelf-limit');
        const addBtn = document.getElementById('bt-add-btn');

        shelf.innerHTML = '';
        portfolios.forEach(p => {
            const c = COLORS[p.colorIdx] || COLORS[0];
            const chip = document.createElement('div');
            chip.className = 'bt-portfolio-chip' + (activeHoldingsId === p.id ? ' active-chip' : '');
            chip.style.background = c.chip;
            chip.innerHTML = `
                <span class="bt-chip-label" title="${p.name}">${p.name}</span>
                <button class="bt-chip-close" onclick="BT.removePortfolio(${p.id})">×</button>
            `;
            shelf.appendChild(chip);
        });

        limit.classList.toggle('visible', portfolios.length >= MAX_PORTFOLIOS);
        addBtn.disabled = portfolios.length >= MAX_PORTFOLIOS;

        const runBtn = document.getElementById('bt-run-btn');
        if (rawData.length === 0) {
            runBtn.textContent = 'Loading data…';
            runBtn.disabled = true;
        } else {
            runBtn.textContent = portfolios.length > 0 ? 'Run Comparison' : 'Run Analysis';
            runBtn.disabled = false;
        }
    }

    // ── Portfolio computation ─────────────────────────────────────────────────
    function applyFilters(rows, filters) {
        let result = rows;
        for (const [factor, labels] of Object.entries(filters)) {
            if (labels && labels.length && FACTORS[factor]) {
                const col = FACTORS[factor].col;
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

    function calcEW(rows) {
        if (rows.length === 0) return 0;
        return rows.reduce((s, r) => s + (r._ret - 1), 0) / rows.length;
    }

    function calcVW(rows, prevMonth) {
        if (rows.length === 0) return 0;
        const getW = r => {
            const h = laggedSize[r.Co_Code];
            return (h && h[prevMonth] != null) ? h[prevMonth] : r._size;
        };
        const total = rows.reduce((s, r) => s + getW(r), 0);
        if (total <= 0) return calcEW(rows);
        return rows.reduce((s, r) => s + (r._ret - 1) * getW(r), 0) / total;
    }

    function computeMetrics(rets) {
        const n = rets.length;
        if (n === 0) return { growth_multiple: 1, annualized_return: 0, annualized_volatility: 0,
                              sharpe_ratio: 0, max_drawdown: 0, pct_positive_months: 0, n_months: 0 };
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
            growth_multiple:       +(cumProd).toFixed(2),
            annualized_return:     +(annRet * 100).toFixed(2),
            annualized_volatility: +(annVol * 100).toFixed(2),
            sharpe_ratio:          +sharpe.toFixed(3),
            max_drawdown:          +(maxDD * 100).toFixed(2),
            pct_positive_months:   +((rets.filter(r => r > 0).length / n) * 100).toFixed(1),
            n_months: n,
        };
    }

    function computePortfolio(config, months) {
        const { longFilters, shortFilters, strategy } = config;
        const universe = getToggleVal('bt-universe-toggle');
        const topN = universe === 'top300' ? 300 : null;

        const ewPort = [100], vwPort = [100];
        const ewRets = [], vwRets = [];
        const holdings = {};

        for (let mi = 0; mi < months.length; mi++) {
            const month = months[mi];
            const prevMonth = mi > 0 ? months[mi - 1] : allMonths[allMonths.indexOf(month) - 1] ?? month;
            let mdf = monthGroups[month] || [];
            if (topN) mdf = topNBySize(mdf, topN);

            const longDF  = applyFilters(mdf, longFilters);
            const shortDF = strategy === 'long_short' ? applyFilters(mdf, shortFilters) : [];

            const ewL = calcEW(longDF),  vwL = calcVW(longDF, prevMonth);
            const ewS = shortDF.length > 0 ? calcEW(shortDF) : 0;
            const vwS = shortDF.length > 0 ? calcVW(shortDF, prevMonth) : 0;

            const ewNet = ewL - ewS, vwNet = vwL - vwS;
            ewRets.push(ewNet);
            vwRets.push(vwNet);
            ewPort.push(ewPort[ewPort.length - 1] * (1 + ewNet));
            vwPort.push(vwPort[vwPort.length - 1] * (1 + vwNet));

            const toFirms = rows => rows
                .map(r => ({ name: r.Co_Name || r.co_name || '—', ret: +((r._ret - 1) * 100).toFixed(2), size: r._size }))
                .sort((a, b) => b.ret - a.ret);

            holdings[month] = {
                long_firms: toFirms(longDF), short_firms: toFirms(shortDF),
                long_total: longDF.length, short_total: shortDF.length,
                ew_ret: +(ewNet * 100).toFixed(3), vw_ret: +(vwNet * 100).toFixed(3),
            };
        }

        return {
            months,
            ew_portfolio: ewPort.slice(1).map(v => +v.toFixed(4)),
            vw_portfolio: vwPort.slice(1).map(v => +v.toFixed(4)),
            ew_metrics: computeMetrics(ewRets),
            vw_metrics: computeMetrics(vwRets),
            holdings,
            isLongShort: strategy === 'long_short',
        };
    }

    // ── Run all portfolios ────────────────────────────────────────────────────
    function runAll() {
        console.log('runAll called, portfolios:', portfolios.length);
        hideError();

        // If no portfolios saved yet, auto-add current selection first
        if (portfolios.length === 0) {
            const longFilters = getFilters('long');
            if (Object.values(longFilters).some(v => v && v.length)) {
                addPortfolio();
            }
        }

        if (portfolios.length === 0) {
            showError('Select at least one factor label, then press Run or Add Portfolio.');
            return;
        }

        const start = document.getElementById('bt-start-month').value;
        const end   = document.getElementById('bt-end-month').value;
        const months = allMonths.filter(m => m >= start && m <= end);
        if (months.length === 0) { showError('No data in the selected date range.'); return; }

        const btn = document.getElementById('bt-run-btn');
        btn.disabled = true;
        btn.textContent = 'Running…';
        document.getElementById('bt-chart-loading').style.display = 'flex';

        setTimeout(() => {
            try {
                runMonths = months;
                portfolios.forEach(p => {
                    p.results = computePortfolio(p.config, months);
                });

                activeHoldingsId = portfolios[0].id;
                currentMonthIdx = months.length - 1;

                updateChart();
                updateCompareTable();
                setupMonthSlider();
                showHoldingsForCurrentMonth();

            } catch (e) {
                showError('Computation error: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Run Comparison';
                document.getElementById('bt-chart-loading').style.display = 'none';
            }
        }, 50);
    }

    // ── Chart ─────────────────────────────────────────────────────────────────
    function initChart() {
        const ctx = document.getElementById('bt-perf-chart').getContext('2d');
        chartInst = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true, position: 'top', align: 'end',
                        labels: { color: '#6b7280', font: { size: 11 }, boxWidth: 14, padding: 10 },
                    },
                    tooltip: {
                        backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f8fafc',
                        padding: 12, borderColor: '#334155', borderWidth: 1,
                        callbacks: {
                            label: item => `${item.dataset.label}: ₹${item.parsed.y.toFixed(2)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false }, border: { display: false },
                        ticks: { maxTicksLimit: 12, color: '#94a3b8', font: { size: 11 }, maxRotation: 0 },
                    },
                    y: {
                        type: 'linear',
                        grid: { color: '#f1f5f9' }, border: { display: false },
                        ticks: { color: '#94a3b8', font: { size: 11 },
                            callback: v => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
                    },
                },
            },
        });

        // Hover → update month index
        const canvas = document.getElementById('bt-perf-chart');
        canvas.addEventListener('mousemove', evt => {
            if (!chartInst || runMonths.length === 0) return;
            const pts = chartInst.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
            if (pts.length > 0) {
                const mIdx = pts[0].index - 1; // subtract 1 for "Initial"
                if (mIdx >= 0 && mIdx < runMonths.length) {
                    currentMonthIdx = mIdx;
                    updateMonthDisplay();
                    showHoldingsForCurrentMonth();
                    // Sync slider
                    document.getElementById('bt-month-slider').value = mIdx;
                }
            }
        });
        canvas.addEventListener('mouseleave', () => {
            // Keep whatever month was last hovered
        });
    }

    function updateChart() {
        const wt = currentWeight;
        const datasets = [];
        portfolios.forEach(p => {
            if (!p.results) return;
            const c = COLORS[p.colorIdx] || COLORS[0];
            const data = wt === 'ew' ? p.results.ew_portfolio : p.results.vw_portfolio;
            datasets.push({
                label: p.name,
                data: [100, ...data],
                borderColor: c.line,
                backgroundColor: c.bg,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: c.line,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2,
                fill: false,
                tension: 0.2,
            });
        });

        const months = runMonths.length > 0 ? runMonths : [];
        chartInst.data.labels = ['Initial', ...months];
        chartInst.data.datasets = datasets;
        chartInst.options.scales.y.type =
            document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update('active');

        const sub = months.length > 0
            ? `${months[0]} → ${months[months.length - 1]}  ·  ${months.length} months  ·  ${wt.toUpperCase()}`
            : 'Add portfolios and press Run Comparison';
        document.getElementById('bt-chart-title').textContent = 'Portfolio Performance';
        document.getElementById('bt-chart-sub').textContent = sub;
    }

    function toggleLog() {
        if (!chartInst) return;
        chartInst.options.scales.y.type =
            document.getElementById('bt-log-scale').checked ? 'logarithmic' : 'linear';
        chartInst.update();
    }

    // ── Comparison table ──────────────────────────────────────────────────────
    function updateCompareTable() {
        const card = document.getElementById('bt-compare-card');
        const body = document.getElementById('bt-compare-body');
        const wt = currentWeight;

        if (portfolios.length === 0 || !portfolios.some(p => p.results)) {
            card.style.display = 'none';
            return;
        }
        card.style.display = 'block';
        body.innerHTML = '';

        portfolios.forEach(p => {
            if (!p.results) return;
            const m = wt === 'ew' ? p.results.ew_metrics : p.results.vw_metrics;
            const c = COLORS[p.colorIdx] || COLORS[0];
            const cls = v => v >= 0 ? 'bt-stat-pos' : 'bt-stat-neg';
            const sign = v => v > 0 ? '+' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="bt-compare-dot" style="background:${c.line}"></span><span class="bt-compare-name">${p.name}</span></td>
                <td>${m.growth_multiple}x</td>
                <td class="${cls(m.annualized_return)}">${sign(m.annualized_return)}${m.annualized_return}%</td>
                <td>${m.annualized_volatility}%</td>
                <td class="${cls(m.sharpe_ratio)}">${m.sharpe_ratio}</td>
                <td class="${cls(m.max_drawdown)}">${m.max_drawdown}%</td>
                <td>${m.pct_positive_months}%</td>
            `;
            body.appendChild(tr);
        });
    }

    // ── Month navigation & holdings ───────────────────────────────────────────
    function setupMonthSlider() {
        const slider = document.getElementById('bt-month-slider');
        slider.min = 0;
        slider.max = runMonths.length - 1;
        slider.value = currentMonthIdx;
        updateMonthDisplay();

        document.getElementById('bt-holdings-empty').style.display = 'none';
        document.getElementById('bt-holdings-content').style.display = 'block';

        renderHoldingsPortfolioTabs();
    }

    function updateMonthDisplay() {
        const display = document.getElementById('bt-month-display');
        display.textContent = runMonths[currentMonthIdx] || '—';
        document.getElementById('bt-month-prev').disabled = currentMonthIdx <= 0;
        document.getElementById('bt-month-next').disabled = currentMonthIdx >= runMonths.length - 1;
    }

    function navMonth(delta) {
        const next = currentMonthIdx + delta;
        if (next < 0 || next >= runMonths.length) return;
        currentMonthIdx = next;
        document.getElementById('bt-month-slider').value = next;
        updateMonthDisplay();
        showHoldingsForCurrentMonth();
    }

    function sliderMonth(val) {
        currentMonthIdx = parseInt(val);
        updateMonthDisplay();
        showHoldingsForCurrentMonth();
    }

    function renderHoldingsPortfolioTabs() {
        const container = document.getElementById('bt-holdings-portfolio-tabs');
        container.innerHTML = '';
        portfolios.forEach(p => {
            const c = COLORS[p.colorIdx] || COLORS[0];
            const btn = document.createElement('button');
            btn.className = 'bt-month-nav-btn';
            btn.style.borderColor = activeHoldingsId === p.id ? c.line : '';
            btn.style.color = activeHoldingsId === p.id ? c.line : '';
            btn.style.fontWeight = activeHoldingsId === p.id ? '700' : '500';
            btn.textContent = p.name.length > 25 ? p.name.substring(0, 22) + '…' : p.name;
            btn.onclick = () => {
                activeHoldingsId = p.id;
                renderHoldingsPortfolioTabs();
                showHoldingsForCurrentMonth();
            };
            container.appendChild(btn);
        });
    }

    function showHoldingsForCurrentMonth() {
        const month = runMonths[currentMonthIdx];
        if (!month) return;

        const p = portfolios.find(x => x.id === activeHoldingsId);
        if (!p || !p.results) return;

        const h = p.results.holdings[month];
        if (!h) return;

        const wt = currentWeight;
        const ret = wt === 'ew' ? h.ew_ret : h.vw_ret;
        const retSign = ret >= 0 ? '+' : '';
        const retCls  = ret >= 0 ? 'bt-ret-pos' : 'bt-ret-neg';

        let html = `
            <div class="bt-holdings-header">
                <div class="bt-holdings-rets">
                    <span class="bt-ret-tag" style="background:${COLORS[p.colorIdx].line}22; color:${COLORS[p.colorIdx].line};">${wt.toUpperCase()}</span>
                    <span class="bt-ret-badge ${retCls}">${retSign}${ret.toFixed(2)}%</span>
                    <span style="font-size:11px; color:var(--text-secondary);">· ${h.long_total} stocks</span>
                </div>
            </div>
            <div class="bt-holdings-cols">
        `;

        html += buildFirmsCol('LONG', h.long_total, h.long_firms, 'hl', 'l');
        if (p.results.isLongShort) {
            html += buildFirmsCol('SHORT', h.short_total, h.short_firms, 'hs', 's');
        }

        html += '</div>';
        document.getElementById('bt-holdings-inner').innerHTML = html;
    }

    function buildFirmsCol(side, total, firms, headCls, tagCls) {
        let html = `
            <div class="bt-hcol">
                <h4 class="${headCls}">${side} · ${total} stocks</h4>
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

    // ── Helpers ───────────────────────────────────────────────────────────────
    function showError(msg) {
        const el = document.getElementById('bt-error-msg');
        el.textContent = msg;
        el.style.display = 'block';
    }

    function hideError() {
        document.getElementById('bt-error-msg').style.display = 'none';
    }

    function resetResults() {
        if (chartInst) {
            chartInst.data.labels = [];
            chartInst.data.datasets = [];
            chartInst.update();
        }
        document.getElementById('bt-compare-card').style.display = 'none';
        document.getElementById('bt-holdings-empty').style.display = 'block';
        document.getElementById('bt-holdings-content').style.display = 'none';
        document.getElementById('bt-chart-sub').textContent = 'Add portfolios and press Run Comparison';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        initChart();
        loadData();
        renderShelf();
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return {
        init, runAll, setStrategy, setToggle, toggleLog, setWeight,
        addPortfolio, removePortfolio,
        navMonth, sliderMonth,
    };
})();

document.addEventListener('DOMContentLoaded', BT.init);
