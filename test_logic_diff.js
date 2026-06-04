const fs = require('fs');

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

function sanitizeReturn(val) {
    if (val === null || val === undefined || val === '') return { action: 'drop', value: null };
    const num = parseFloat(val);
    if (isNaN(num)) return { action: 'drop', value: null };
    if (num > 3) return { action: 'capped', value: 3.0 };
    if (num < -1) return { action: 'capped', value: -1.0 };
    return { action: 'keep', value: num };
}

function calcEW(rows) {
    if (rows.length === 0) return 0;
    let sum = 0, n = 0;
    for (const r of rows) {
        if (r._ret != null && isFinite(r._ret)) { sum += r._ret; n++; }
    }
    return n === 0 ? 0 : sum / n;
}

function calcVW(rows) {
    if (rows.length === 0) return 0;
    let totalW = 0, weighted = 0;
    for (const r of rows) {
        if (r._ret == null || !isFinite(r._ret)) continue;
        let w = parseFloat(r.prev_Size);
        if (isNaN(w) || w <= 0) { w = r._size; }
        if (w <= 0 || !isFinite(w)) continue;
        totalW += w;
        weighted += r._ret * w;
    }
    if (totalW <= 0) return calcEW(rows);
    return weighted / totalW;
}

const csvText = fs.readFileSync('Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv', 'utf8');
const parsed = parseCSV(csvText);
const monthGroups = {};

parsed.forEach(row => {
    row._month = row.Month ? row.Month.substring(0, 7) : '';
    row._size = parseFloat(row.eom_mcap || row.Size);
    if (isNaN(row._size) || row._size <= 0) row._size = 0;
    
    const retCol = row.Monthly_Return !== undefined ? 'Monthly_Return' : 'monthly_return';
    const sanitized = sanitizeReturn(row[retCol]);
    if (sanitized.action === 'drop') return;
    row._ret = sanitized.value;
    
    if (!monthGroups[row._month]) monthGroups[row._month] = [];
    monthGroups[row._month].push(row);
});

const allMonths = Object.keys(monthGroups).sort();

function runBacktest(useNewLogic) {
    let rets = [];
    for (const m of allMonths) {
        const mRows = monthGroups[m];
        
        // Let's test Value (V) vs Growth (G)
        const longS = mRows.filter(r => r.Size_Label === 'S' && r['BM_Label'] === 'V');
        const longB = mRows.filter(r => r.Size_Label === 'B' && r['BM_Label'] === 'V');
        const shortS = mRows.filter(r => r.Size_Label === 'S' && r['BM_Label'] === 'G');
        const shortB = mRows.filter(r => r.Size_Label === 'B' && r['BM_Label'] === 'G');
        
        let validLongS = longS.length >= 5;
        let validLongB = longB.length >= 5;
        let validShortS = shortS.length >= 5;
        let validShortB = shortB.length >= 5;
        
        if (useNewLogic) {
            if (!validLongS || !validShortS) { validLongS = false; validShortS = false; }
            if (!validLongB || !validShortB) { validLongB = false; validShortB = false; }
        }
        
        let L_vw = null, S_vw = null;
        if (validLongS && validLongB) {
            L_vw = (calcVW(longS) + calcVW(longB)) / 2;
        } else if (validLongS) {
            L_vw = calcVW(longS);
        } else if (validLongB) {
            L_vw = calcVW(longB);
        }

        if (validShortS && validShortB) {
            S_vw = (calcVW(shortS) + calcVW(shortB)) / 2;
        } else if (validShortS) {
            S_vw = calcVW(shortS);
        } else if (validShortB) {
            S_vw = calcVW(shortB);
        }
        
        if (L_vw !== null && S_vw !== null) {
            rets.push(L_vw - S_vw);
        } else {
            rets.push(0);
        }
    }
    
    let cumProd = 1;
    rets.forEach(r => cumProd *= (1 + r));
    const nYears = rets.length / 12;
    const annRet = (nYears > 0 && cumProd > 0) ? Math.pow(cumProd, 1 / nYears) - 1 : 0;
    return annRet * 100;
}

console.log("OLD LOGIC HML Ann. Ret:", runBacktest(false).toFixed(2) + "%");
console.log("NEW LOGIC HML Ann. Ret:", runBacktest(true).toFixed(2) + "%");
