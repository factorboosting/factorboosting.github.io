import re

with open('backtester.js', 'r') as f:
    js = f.read()

# 1. Update loadData function
load_data_replacement = '''
    let benchmarkCache = null;
    let currentUniverse = null;

    async function loadBenchmarks() {
        if (benchmarkCache) return benchmarkCache;
        try {
            const res = await fetch('Data/Factor_Data/finalMonthlyLabels_aman.csv');
            if (!res.ok) return {};
            const parsed = parseCSV(await res.text());
            const b = {};
            parsed.forEach(row => {
                const m = row.Month ? row.Month.substring(0, 7) : '';
                if (!m) return;
                const n50 = parseFloat(row.nifty50);
                const n500 = parseFloat(row.nifty500);
                if (!b[m]) b[m] = {};
                if (!isNaN(n50)) b[m].nifty50 = n50;
                if (!isNaN(n500)) b[m].nifty500 = n500;
            });
            benchmarkCache = b;
            return b;
        } catch(e) {
            console.error(e);
            return {};
        }
    }

    async function loadData() {
        const notice = document.getElementById('bt-data-notice');
        const universe = getToggleVal('bt-universe-toggle') || 'all';
        if (currentUniverse === universe && rawData && rawData.length > 0) return;
        
        if (notice) { notice.style.display = 'block'; notice.textContent = 'Loading universe data...'; }
        
        let url = 'Data/Updated_Factor_Data/5_all_labels.csv';
        if (universe === 'top500') url = 'Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv';
        else if (universe === 'top300') url = 'Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv';

        try {
            const benchmarks = await loadBenchmarks();
            const res = await fetch(url);
            if (!res.ok) throw new Error(`CSV fetch failed (HTTP ${res.status}).`);
            const parsed = parseCSV(await res.text());

            const sample = parsed[0] || {};
            const retCol = 'monthly_return' in sample ? 'monthly_return'
                         : 'monthly_ret' in sample ? 'monthly_ret'
                         : 'Monthly_Return' in sample ? 'Monthly_Return' : null;
            if (!retCol) throw new Error('Return column not found.');

            dataQualityStats = { dropped: 0, capped: 0, total: parsed.length };
            rawData = [];

            parsed.forEach(row => {
                row._month = row.Month ? row.Month.substring(0, 7) : '';
                // New data uses eom_mcap, old uses Size
                row._size = parseFloat(row.eom_mcap || row.Size);
                if (isNaN(row._size) || row._size <= 0) row._size = 0;
                
                row.Co_Code = row.co_code || row.Co_Code;

                const sanitized = sanitizeReturn(row[retCol]);
                if (sanitized.action === 'drop') {
                    dataQualityStats.dropped++;
                    return;
                }
                if (sanitized.action === 'capped') dataQualityStats.capped++;
                row._ret = sanitized.value;

                const b = benchmarks[row._month] || {};
                row._nifty50 = b.nifty50 !== undefined ? b.nifty50 : null;
                row._nifty500 = b.nifty500 !== undefined ? b.nifty500 : null;

                rawData.push(row);
            });

            groupDataByMonth();
            currentUniverse = universe;
            if (notice) notice.style.display = 'none';
        } catch (error) {
            console.error('Data loading error:', error);
            if (notice) notice.textContent = 'Failed to load data. See console.';
        }
    }
'''

js = re.sub(r'async function loadData\(\) \{[\s\S]*?groupDataByMonth\(\);\s*if \(notice\) notice\.style\.display = \'none\';\s*\} catch \(error\) \{[\s\S]*?\}\s*\}', load_data_replacement, js, flags=re.DOTALL)

# 2. Modify the toggle listener in initBacktester to await loadData for universe changes
# old:
#        control.addEventListener('click', () => {
#            if (control.classList.contains('universe')) {
#                if (activeFactors.size > 0) { ... plotPerformance(); }
#            }
# new:
#        control.addEventListener('click', async () => {
#            if (control.classList.contains('universe')) {
#                await loadData();
#                if (activeFactors.size > 0) { ... plotPerformance(); }
#            }

js = js.replace("control.addEventListener('click', () => {", "control.addEventListener('click', async () => {")
js = js.replace("if (control.classList.contains('universe')) {\n                if (activeFactors.size > 0) {", "if (control.classList.contains('universe')) {\n                await loadData();\n                if (activeFactors.size > 0) {")

# 3. Disable topN filtering in computePortfolio since data is already filtered
js = js.replace("if (topN) mdf = topNBySize(mdf, topN);", "// if (topN) mdf = topNBySize(mdf, topN); // Handled by loadData")

with open('backtester.js', 'w') as f:
    f.write(js)
