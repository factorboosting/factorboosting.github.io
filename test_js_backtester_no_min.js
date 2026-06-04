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

const groups = {};
data.forEach(r => {
    if (!groups[r.co_code]) groups[r.co_code] = [];
    groups[r.co_code].push(r);
});
Object.values(groups).forEach(list => {
    list.sort((a, b) => a.Month.localeCompare(b.Month));
    for (let i = 1; i < list.length; i++) {
        list[i].prev_Size = list[i-1].eom_mcap;
    }
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
        let w = parseFloat(r.prev_Size);
        if (isNaN(w) || w <= 0) { w = r.eom_mcap; }
        if (w <= 0 || !isFinite(w)) continue;
        totalW += w;
        weighted += r.monthly_return * w;
    }
    if (totalW <= 0) return null;
    return weighted / totalW;
}

const factors = {
    'SMB': { labelCol: 'Size_Label', long: ['S'], short: ['B'], isPureSize: true },
    'HML': { labelCol: 'BM_Label', long: ['V'], short: ['G'] },
    'WML': { labelCol: 'MOM_Label', long: ['W'], short: ['L'] },
    'RMW': { labelCol: 'OP_Label', long: ['R'], short: ['W'] },
    'CMA': { labelCol: 'INV_Label', long: ['C'], short: ['A'] }
};

console.log(`\nFactor   Ann Ret%  Ann Vol%   Sharpe   T-stat      N`);
console.log("-".repeat(52));

for (const [fName, config] of Object.entries(factors)) {
    const rets = [];
    for (const m of months) {
        const mData = data.filter(d => d.Month.substring(0, 7) === m);
        
        let ewNet = 0, vwNet = 0;

        if (config.isPureSize) {
            const longDF = mData.filter(d => config.long.includes(d[config.labelCol]));
            const shortDF = mData.filter(d => config.short.includes(d[config.labelCol]));
            
            const bmBuckets = ['G', 'N', 'V'];
            let sub_vws_L = [], sub_vws_S = [];
            
            for (const bm of bmBuckets) {
                const subB = longDF.filter(r => r.BM_Label === bm);
                const ret = calcVW(subB);
                if (ret !== null) sub_vws_L.push(ret);
            }
            let L_vw = sub_vws_L.length > 0 ? sub_vws_L.reduce((a,b)=>a+b,0)/sub_vws_L.length : null;

            for (const bm of bmBuckets) {
                const subS = shortDF.filter(r => r.BM_Label === bm);
                const ret = calcVW(subS);
                if (ret !== null) sub_vws_S.push(ret);
            }
            let S_vw = sub_vws_S.length > 0 ? sub_vws_S.reduce((a,b)=>a+b,0)/sub_vws_S.length : null;
            
            if (L_vw !== null && S_vw !== null) {
                rets.push(L_vw - S_vw);
            }
            
        } else {
            const longDF = mData.filter(d => config.long.includes(d[config.labelCol]));
            const shortDF = mData.filter(d => config.short.includes(d[config.labelCol]));
            
            const longS = longDF.filter(r => r.Size_Label === 'S');
            const longB = longDF.filter(r => r.Size_Label === 'B');
            const shortS = shortDF.filter(r => r.Size_Label === 'S');
            const shortB = shortDF.filter(r => r.Size_Label === 'B');
            
            let S_long_ret = calcVW(longS);
            let B_long_ret = calcVW(longB);
            let S_short_ret = calcVW(shortS);
            let B_short_ret = calcVW(shortB);
            
            let countSmall = (S_long_ret !== null && S_short_ret !== null) ? 1 : 0;
            let countBig = (B_long_ret !== null && B_short_ret !== null) ? 1 : 0;
            
            let sumSmall = countSmall ? (S_long_ret - S_short_ret) : 0;
            let sumBig = countBig ? (B_long_ret - B_short_ret) : 0;
            
            if (countSmall + countBig > 0) {
                rets.push((sumSmall + sumBig) / (countSmall + countBig));
            }
        }
    }
    
    if (rets.length > 1) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (rets.length - 1);
        const std = Math.sqrt(variance);
        
        const annRet = mean * 12 * 100;
        const annVol = std * Math.sqrt(12) * 100;
        const sr = (mean / std) * Math.sqrt(12);
        const tstat = (mean / std) * Math.sqrt(rets.length);
        
        console.log(`${fName.padEnd(8)} ${annRet.toFixed(2).padStart(9)} ${annVol.toFixed(2).padStart(9)} ${sr.toFixed(3).padStart(8)} ${tstat.toFixed(2).padStart(8)} ${rets.length.toString().padStart(6)}`);
    }
}
