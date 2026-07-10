const fs = require('fs');
const readline = require('readline');

const html = `
<tbody class=""><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/sterlite-technologies-ltd"><span class="holdings_link__kjPQ5">Sterlite Technologies Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Technology</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">8.30%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/aditya-infotech-ltd"><span class="holdings_link__kjPQ5">Aditya Infotech Ltd.</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Technology</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">6.16%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/onesource-specialty-pharma-ltd"><span class="holdings_link__kjPQ5">Onesource Specialty Pharma Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Healthcare</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">5.66%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/shaily-engineering-plastics-ltd"><span class="holdings_link__kjPQ5">Shaily Engineering Plastics Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Materials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">4.50%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><span class="cur-no">Net Receivables</span></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Unspecified</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Net Receivables</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">4.32%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/suzlon-energy-ltd"><span class="holdings_link__kjPQ5">Suzlon Energy Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">4.09%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/ge-td-india-ltd"><span class="holdings_link__kjPQ5">GE T&amp;D India Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.87%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/data-patterns-india-ltd"><span class="holdings_link__kjPQ5">Data Patterns (India) Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.80%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/kei-industries-ltd"><span class="holdings_link__kjPQ5">Kei Industries Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.63%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/anand-rathi-wealth-services-ltd"><span class="holdings_link__kjPQ5">Anand Rathi Wealth Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.55%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/dewan-housing-finance-corporation-ltd"><span class="holdings_link__kjPQ5">DEWAN HOUSING FINANCE CORP. LTD. EQ</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.44%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/jain-resource-recycling-ltd"><span class="holdings_link__kjPQ5">Jain Resource Recycling Ltd.</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Materials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.43%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/multi-commodity-exchange-of-india-ltd"><span class="holdings_link__kjPQ5">Multi Commodity Exchange Of India Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.41%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/ami-organics-ltd"><span class="holdings_link__kjPQ5">Ami Organics Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Healthcare</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.36%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/reliance-nippon-life-asset-management-ltd"><span class="holdings_link__kjPQ5">Nippon Life India Asset Management Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.28%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/solar-industries-india-ltd"><span class="holdings_link__kjPQ5">Solar Industries India Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Materials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.24%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/garware-polyester-ltd"><span class="holdings_link__kjPQ5">Garware Hi-Tech Films Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Materials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.21%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/muthoot-finance-ltd"><span class="holdings_link__kjPQ5">Muthoot Finance Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.14%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/mtar-technologies-ltd"><span class="holdings_link__kjPQ5">MTAR Technologies Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.10%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/icici-prudential-asset-management-company-ltd"><span class="holdings_link__kjPQ5">ICICI Prudential Asset Management Company Ltd.</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">3.03%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/bharat-heavy-electricals-ltd"><span class="holdings_link__kjPQ5">Bharat Heavy Electricals Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.88%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/abb-india-ltd"><span class="holdings_link__kjPQ5">ABB India Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.69%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/bse-ltd"><span class="holdings_link__kjPQ5">BSE Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Financial</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.64%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/sjs-enterprises-ltd"><span class="holdings_link__kjPQ5">S.J.S Enterprises Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Consumer Discretionary</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.62%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/fractal-analytics-ltd"><span class="holdings_link__kjPQ5">Fractal Analytics Ltd.</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Technology</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.37%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/td-power-systems-ltd"><span class="holdings_link__kjPQ5">TD Power Systems Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.33%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/premier-energies-ltd"><span class="holdings_link__kjPQ5">Premier Energies Ltd.</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Energy &amp; Utilities</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">2.19%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/abb-power-products-systems-india-ltd"><span class="holdings_link__kjPQ5">Hitachi Energy India Ltd</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Industrials</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Equity</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">1.75%</td></tr><tr class="holdings_row__go8vY"><td colspan="1" rowspan="1" class="bodyBase holdings_companyName__25NK7" style="padding: 20px 8px 20px 20px;"><a class="contentPrimary cur-po" href="/stocks/tvs-motors-ltd-prefernece-shares"><span class="holdings_link__kjPQ5">TVS Motor Company Ltd - Pref. Shares</span></a></td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Consumer Discretionary</td><td colspan="1" rowspan="1" class="bodyBase" style="padding: 20px 8px;">Preference Shares</td><td colspan="1" rowspan="1" class="bodyBase right-align" style="padding: 20px 20px 20px 8px;">0.01%</td></tr></tbody>
`;

const matches = [...html.matchAll(/<span class="holdings_link__kjPQ5">(.*?)<\/span>/g)].map(m => m[1]);
const compNames = matches.map(m => m.replace(/<[^>]+>/g, '')).filter(c => c !== 'Net Receivables');

function cleanName(n) {
  return n.toLowerCase()
    .replace(/\b(ltd\.?|co\.?|company|shares|pref\.?|eq\.?|corporation|corp\.?|services)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function main() {
  const companyNamesMap = {}; // name => { code, name }
  const fileStream = fs.createReadStream('Data/Factor_Data/firm_labels_top500_may_26.csv');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let firstLine = true;
  for await (const line of rl) {
    if (firstLine) { firstLine = false; continue; }
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const code = parts[0];
    const name = parts[1];
    companyNamesMap[cleanName(name)] = { code, name };
  }

  function levenshteinDistance(s, t) {
      if (!s.length) return t.length;
      if (!t.length) return s.length;
      const arr = [];
      for (let i = 0; i <= t.length; i++) {
          arr[i] = [i];
          for (let j = 1; j <= s.length; j++) {
              arr[i][j] = i === 0 ? j : Math.min(
                  arr[i - 1][j] + 1,
                  arr[i][j - 1] + 1,
                  arr[i - 1][j - 1] + (s[j - 1] === t[i - 1] ? 0 : 1)
              );
          }
      }
      return arr[t.length][s.length];
  }

  const requestedCodes = [];

  for (const comp of compNames) {
    const cln = cleanName(comp);
    let bestMatch = null;
    
    // Try exact substring match
    for (const [dbClean, info] of Object.entries(companyNamesMap)) {
      if (dbClean.includes(cln) || cln.includes(dbClean)) {
        bestMatch = info;
        break;
      }
    }
    
    if (!bestMatch) {
      let bestDist = Infinity;
      for (const [dbClean, info] of Object.entries(companyNamesMap)) {
        const d = levenshteinDistance(cln, dbClean);
        if (d < bestDist && d < 6) { 
          bestDist = d;
          bestMatch = info;
        }
      }
    }
    
    if (bestMatch) {
      console.log(`${comp}|${bestMatch.name}|${bestMatch.code}`);
      requestedCodes.push({ code: bestMatch.code, name: bestMatch.name, orig: comp });
    } else {
      console.log(`${comp}|NOT FOUND|`);
      requestedCodes.push({ code: null, name: null, orig: comp });
    }
  }
  
  // Now we need to scan the 3 CSV files for the last factor labels for these codes.
  const files = [
    { name: "all", path: "Data/Factor_Data/company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv", sizeCol: 'Size_Label_Monthly', momCol: 'MOM_Label' },
    { name: "top500", path: "Data/Factor_Data/firm_labels_top500_may_26.csv", sizeCol: 'Size_Label_monthly_mom', momCol: 'Mom_Label' },
    { name: "top300", path: "Data/Factor_Data/firm_labels_top300_may_26.csv", sizeCol: 'Size_Label_monthly_mom', momCol: 'Mom_Label' }
  ];

  const results = {}; // comp -> { all: "", top500: "", top300: "" }
  for (const rc of requestedCodes) {
    if (rc.code) results[rc.code] = { all: "-", top500: "-", top300: "-" };
  }
  const codesSet = new Set(requestedCodes.filter(c => c.code).map(c => c.code));

  for (const f of files) {
    const stream = fs.createReadStream(f.path);
    const fl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let isFirst = true;
    let codeIdx = 0, sizeIdx = -1, momIdx = -1, monthIdx = -1;
    for await (const line of fl) {
      const parts = line.split(',');
      if (isFirst) {
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === 'co_code') codeIdx = i;
          if (parts[i] === 'Month' || parts[i] === 'Month_str') monthIdx = i; // using latest doesn't strictly matter if they are sorted by time, but they usually are
          if (parts[i] === f.sizeCol) sizeIdx = i;
          if (parts[i] === f.momCol) momIdx = i;
        }
        isFirst = false;
        continue;
      }
      const code = parts[codeIdx];
      if (codesSet.has(code)) {
        // since data is usually ordered by date ascending, we just keep overwriting and the last one is the most recent
        results[code][f.name] = `${parts[sizeIdx]}, ${parts[momIdx]}`;
      }
    }
  }

  console.log("\nMarkdown Table:");
  console.log("| Original Company | Mapped Name | All Universe (Size, MOM) | Top 500 Universe | Top 300 Universe |");
  console.log("|---|---|---|---|---|");
  for (const rc of requestedCodes) {
    if (rc.code) {
      const r = results[rc.code];
      console.log(`| ${rc.orig} | ${rc.name} | ${r.all} | ${r.top500} | ${r.top300} |`);
    } else {
      console.log(`| ${rc.orig} | NOT FOUND | - | - | - |`);
    }
  }
}

main().catch(console.error);
