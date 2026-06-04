const fs = require('fs');
const content = fs.readFileSync('Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv', 'utf8');
const lines = content.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());
let data = lines.slice(1).map(l => {
    const cols = l.split(',');
    const obj = {};
    headers.forEach((h, i) => {
        let val = cols[i] ? cols[i].trim() : null;
        if (['co_code', 'Month', 'Size_Label', 'BM_Label', 'OP_Label', 'INV_Label', 'MOM_Label'].includes(h)) {
            obj[h] = val;
        } else {
            obj[h] = parseFloat(val);
        }
    });
    return obj;
});

const start = "2003-10";
const end = "2025-12";
data = data.filter(d => {
    const m = d.Month ? d.Month.substring(0, 7) : "";
    return m >= start && m <= end;
});
const months = [...new Set(data.map(d => d.Month.substring(0, 7)))].sort();

function calcVW(rows) {
    if (rows.length === 0) return null;
    let totalW = 0, weighted = 0;
    for (const r of rows) {
        if (r.monthly_return == null || !isFinite(r.monthly_return)) continue;
        let w = parseFloat(r.eom_mcap); // Current Size
        if (w <= 0 || !isFinite(w)) continue;
        totalW += w;
        weighted += r.monthly_return * w;
    }
    if (totalW <= 0) return null;
    return weighted / totalW;
}

const factors = {
    'SMB': { labelCol: 'Size_Label', long: ['S'], short: ['B'] },
    'HML': { labelCol: 'BM_Label', long: ['V'], short: ['G'] },
    'WML': { labelCol: 'MOM_Label', long: ['W'], short: ['L'] },
    'RMW': { labelCol: 'OP_Label', long: ['R'], short: ['W'] },
    'CMA': { labelCol: 'INV_Label', long: ['C'], short: ['A'] }
};

for (const [fName, config] of Object.entries(factors)) {
    const rets = [];
    for (const m of months) {
        const mData = data.filter(d => d.Month.substring(0, 7) === m);
        const longDF = mData.filter(d => config.long.includes(d[config.labelCol]));
        const shortDF = mData.filter(d => config.short.includes(d[config.labelCol]));
        
        let l_ret = calcVW(longDF);
        let s_ret = calcVW(shortDF);
        if (l_ret !== null && s_ret !== null) {
            rets.push(l_ret - s_ret);
        }
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    console.log(`${fName}: ${(mean * 12 * 100).toFixed(2)}`);
}
