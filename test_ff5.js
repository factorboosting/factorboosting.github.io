const fs = require('fs');
const content = fs.readFileSync('Data/Factor_Data/ff5.csv', 'utf8');
const lines = content.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());
const data = lines.slice(1).map(l => {
    const cols = l.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i] ? cols[i].trim() : null);
    return obj;
});

const start = "2003-10";
const end = "2025-12";
const filtered = data.filter(d => {
    if (!d.Month) return false;
    const m = d.Month.substring(0, 7);
    return m >= start && m <= end;
});

const factors = ["SMB", "HML", "WML", "RMW", "CMA"];
console.log(`\nFactor   Ann Ret%  Ann Vol%   Sharpe   T-stat      N`);
console.log("-".repeat(52));

factors.forEach(f => {
    const vals = filtered.map(d => parseFloat(d[f])).filter(v => !isNaN(v));
    if (vals.length > 1) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (vals.length - 1);
        const std = Math.sqrt(variance);
        
        const annRet = mean * 12 * 100;
        const annVol = std * Math.sqrt(12) * 100;
        const sr = (mean / std) * Math.sqrt(12);
        const tstat = (mean / std) * Math.sqrt(vals.length);
        
        console.log(`${f.padEnd(8)} ${annRet.toFixed(2).padStart(9)} ${annVol.toFixed(2).padStart(9)} ${sr.toFixed(3).padStart(8)} ${tstat.toFixed(2).padStart(8)} ${vals.length.toString().padStart(6)}`);
    }
});
