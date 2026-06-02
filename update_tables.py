import csv
import os
import re
from datetime import datetime

DATA_DIR = "Data/Updated_Factor_Data/"

def calc_returns(file_path, cols):
    if not os.path.exists(file_path):
        return {}, ""
    
    rows = []
    with open(file_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
            
    if not rows:
        return {}, ""
        
    date_col = 'Month' if 'Month' in rows[0] else 'holding_month'
    
    # Sort by date
    rows.sort(key=lambda x: x[date_col])
    
    # We need the last 12 months
    last_12 = rows[-12:] if len(rows) >= 12 else rows
    last_3 = rows[-3:] if len(rows) >= 3 else rows
    last_1 = rows[-1:]
    
    last_month_str = last_1[0][date_col]
    try:
        # Convert YYYY-MM to Month YYYY
        dt = datetime.strptime(last_month_str[:7], '%Y-%m')
        last_month_str = dt.strftime('%B %Y')
    except:
        pass
    
    res = {}
    for col in cols:
        if col not in rows[0]:
            res[col] = {"1m": None, "3m": None, "12m": None}
            continue
            
        try:
            r_1m = float(last_1[0][col])
            
            p_3m = 1.0
            for row in last_3:
                p_3m *= (1.0 + float(row[col]))
            r_3m = p_3m - 1.0
            
            p_12m = 1.0
            for row in last_12:
                p_12m *= (1.0 + float(row[col]))
            r_12m = p_12m - 1.0
            
            res[col] = {
                "1m": r_1m * 100,
                "3m": r_3m * 100,
                "12m": r_12m * 100
            }
        except:
            res[col] = {"1m": None, "3m": None, "12m": None}
            
    return res, last_month_str

def format_val(v):
    if v is None:
        return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.2f}%"

def get_class(v):
    if v is None:
        return ""
    return "positive" if v >= 0 else "negative"

def update_html(html_content, factor_map, results):
    for label, col_name in factor_map.items():
        if col_name not in results or results[col_name]["1m"] is None:
            continue
        
        r_1m = results[col_name]["1m"]
        r_3m = results[col_name]["3m"]
        r_12m = results[col_name]["12m"]
        
        c_1m = get_class(r_1m)
        c_3m = get_class(r_3m)
        c_12m = get_class(r_12m)
        
        f_1m = format_val(r_1m)
        f_3m = format_val(r_3m)
        f_12m = format_val(r_12m)
        
        pattern = r'(<td[^>]*>\s*' + re.escape(label) + r'\s*</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
        replacement = r'\g<1>' + f'<td class="{c_1m}">{f_1m}</td>\n                                    <td class="{c_3m}">{f_3m}</td>\n                                    <td class="{c_12m}">{f_12m}</td>'
        
        html_content = re.sub(pattern, replacement, html_content, flags=re.DOTALL)
        
    return html_content

all_results = {}

res1, _ = calc_returns(os.path.join(DATA_DIR, "1_size_value_portfolio.csv"), ["SV", "SN", "SG", "BV", "BN", "BG"])
all_results.update(res1)
map1 = {
    "Small Value": "SV", "Small Neutral": "SN", "Small Growth": "SG",
    "Big Value": "BV", "Big Neutral": "BN", "Big Growth": "BG"
}

res2, _ = calc_returns(os.path.join(DATA_DIR, "2_size_motm_portfolio.csv"), ["SW", "SL", "BW", "BL"])
all_results.update(res2)
map2 = {
    "Small Winner": "SW", "Small Loser": "SL",
    "Big Winner": "BW", "Big Loser": "BL"
}

res3, _ = calc_returns(os.path.join(DATA_DIR, "3_operating_prof_portfolios.csv"), ["SR", "SN", "SW", "BR", "BN", "BW"])
all_results.update(res3)
map3 = {
    "Small Robust": "SR", "Small Neutral": "SN", "Small Weak": "SW",
    "Big Robust": "BR", "Big Neutral": "BN", "Big Weak": "BW"
}

res4, _ = calc_returns(os.path.join(DATA_DIR, "4_investment_portfolios.csv"), ["SC", "SN", "SA", "BC", "BN", "BA"])
all_results.update(res4)
map4 = {
    "Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA",
    "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"
}

res5, _ = calc_returns(os.path.join(DATA_DIR, "5_at_long_short.csv"), ["SH", "SN", "SL", "BH", "BN", "BL", "HML_AT"])
all_results.update(res5)
map5 = {
    "Small High": "SH", "Small Neutral": "SN", "Small Low": "SL",
    "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"
}

res6, _ = calc_returns(os.path.join(DATA_DIR, "6_sg_long_short.csv"), ["SH", "SN", "SL", "BH", "BN", "BL", "HML_SG"])
all_results.update(res6)
map6 = {
    "Small High": "SH", "Small Neutral": "SN", "Small Low": "SL",
    "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"
}

with open('index.html', 'r') as f:
    html = f.read()

tabs = html.split('data-content="')
new_tabs = [tabs[0]]
for tab in tabs[1:]:
    tab_name = tab.split('"')[0]
    if tab_name == 'bookmarket':
        tab = update_html(tab, map1, all_results)
    elif tab_name == 'momentum':
        tab = update_html(tab, map2, all_results)
    elif tab_name == 'profitability':
        tab = update_html(tab, map3, all_results)
    elif tab_name == 'investment':
        tab = update_html(tab, map4, all_results)
    elif tab_name == 'asset_turnover':
        tab = update_html(tab, map5, all_results)
    elif tab_name == 'sales_growth':
        tab = update_html(tab, map6, all_results)
    elif tab_name == 'accruals':
        res7, _ = calc_returns(os.path.join(DATA_DIR, "7_acc_long_short.csv"), ["SA", "SN", "SC", "BA", "BN", "BC", "HML_ACC"])
        all_results.update(res7)
        map7 = {
            "Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA",
            "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"
        }
        tab = update_html(tab, map7, all_results)
    new_tabs.append(tab)

html = 'data-content="'.join(new_tabs)

res_smb, _ = calc_returns(os.path.join(DATA_DIR, "1_smb_hml_mine.csv"), ["SMB", "HML"])
all_results.update(res_smb)

res_wml, _ = calc_returns(os.path.join(DATA_DIR, "2_motm_factor_mine.csv"), ["WML"])
all_results.update(res_wml)

res_rmw, _ = calc_returns(os.path.join(DATA_DIR, "3_rmw_long_short.csv"), ["RMW"])
all_results.update(res_rmw)

res_cma, _ = calc_returns(os.path.join(DATA_DIR, "4_cma_long_short.csv"), ["CMA"])
all_results.update(res_cma)

with open('factor_table.csv', 'r') as f:
    lines = f.readlines()

new_lines = [lines[0]]
for line in lines[1:]:
    cols = line.strip().split(',')
    if len(cols) < 4: continue
    factor = cols[0]
    
    col_map = {
        'SMB': 'SMB', 'HML': 'HML', 'WML': 'WML', 'RMW': 'RMW', 'CMA': 'CMA'
    }
    
    if factor in col_map:
        key = col_map[factor]
        if all_results.get(key, {}).get("1m") is not None:
            r1 = all_results[key]['1m']
            r3 = all_results[key]['3m']
            r12 = all_results[key]['12m']
            new_lines.append(f"{factor},{r1:.2f},{r3:.2f},{r12:.2f}\n")
        else:
            new_lines.append(line)
    elif factor == 'Rm-Rf (Using Nifty 500)':
        new_lines.append(line)

def get_res(key):
    r1 = all_results.get(key, {}).get('1m', 0)
    r3 = all_results.get(key, {}).get('3m', 0)
    r12 = all_results.get(key, {}).get('12m', 0)
    return r1, r3, r12

r1, r3, r12 = get_res('HML_AT')
if r1 is not None: new_lines.append(f"AT (Asset Turnover),{r1:.2f},{r3:.2f},{r12:.2f}\n")
r1, r3, r12 = get_res('HML_SG')
if r1 is not None: new_lines.append(f"SG (Sales Growth),{r1:.2f},{r3:.2f},{r12:.2f}\n")
r1, r3, r12 = get_res('HML_ACC')
if r1 is not None: new_lines.append(f"ACC (Accruals),{r1:.2f},{r3:.2f},{r12:.2f}\n")

with open('factor_table.csv', 'w') as f:
    f.writelines(new_lines)

with open('index.html', 'w') as f:
    f.write(html)
    
print("Updated successfully!")
