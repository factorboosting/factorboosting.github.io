import csv
import re
import datetime

print("Loading data...")
data = []
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            row['Monthly_Return'] = float(row['Monthly_Return'])
            row['prev_Size'] = float(row['prev_Size'])
            if row['Size_Label'] and row['Monthly_Return'] is not None:
                if 'nifty500' in row and row['nifty500']:
                    row['nifty500'] = float(row['nifty500'])
                data.append(row)
        except (ValueError, TypeError):
            pass

months = sorted(list(set(row['Month'] for row in data)))
last_12 = months[-12:]
last_3 = months[-3:]
latest = months[-1]

def get_portfolio_ret(m, col1, val1, col2, val2):
    m_rows = [r for r in data if r['Month'] == m]
    if col2 and val2:
        rows = [r for r in m_rows if r.get(col1) == val1 and r.get(col2) == val2]
    else:
        rows = [r for r in m_rows if r.get(col1) == val1]
    if len(rows) > 0:
        return sum(r['Monthly_Return'] * r['prev_Size'] for r in rows) / sum(r['prev_Size'] for r in rows)
    return 0.0

def get_factor_ret(m, factor_col, long_label, short_label):
    m_rows = [r for r in data if r['Month'] == m]
    
    ret_s = None
    ret_b = None
    
    for size_bucket in ['S', 'B']:
        bucket_rows = [r for r in m_rows if r['Size_Label'] == size_bucket]
        long_rows = [r for r in bucket_rows if r.get(factor_col) == long_label]
        short_rows = [r for r in bucket_rows if r.get(factor_col) == short_label]
        
        if len(long_rows) >= 5 and len(short_rows) >= 5:
            long_ret = sum(r['Monthly_Return'] * r['prev_Size'] for r in long_rows) / sum(r['prev_Size'] for r in long_rows)
            short_ret = sum(r['Monthly_Return'] * r['prev_Size'] for r in short_rows) / sum(r['prev_Size'] for r in short_rows)
            if size_bucket == 'S':
                ret_s = long_ret - short_ret
            else:
                ret_b = long_ret - short_ret
                
    if ret_s is not None and ret_b is not None:
        return (ret_s + ret_b) / 2
    elif ret_s is not None:
        return ret_s
    elif ret_b is not None:
        return ret_b
    return 0.0


def calc_comp(m_rets, m_list):
    comp = 1.0
    for m in m_list:
        comp *= (1.0 + m_rets[m])
    return (comp - 1.0) * 100

all_results = {}

def add_res(key, m_rets):
    all_results[key] = {
        "1m": m_rets[latest] * 100,
        "3m": calc_comp(m_rets, last_3),
        "12m": calc_comp(m_rets, last_12)
    }

# 1. Size & Book-to-Market
for size in ['S', 'B']:
    for bm in ['V', 'N', 'G']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'BM_Label', bm) for m in last_12}
        add_res(f"{size}{bm}", rets)

# 2. Size & Momentum
for size in ['S', 'B']:
    for mom in ['W', 'L']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'Momentum_Label', mom) for m in last_12}
        add_res(f"{size}{mom}", rets)

# 3. Op Prof
for size in ['S', 'B']:
    for op in ['R', 'N', 'W']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'OpProf_Label', op) for m in last_12}
        add_res(f"{size}{op}", rets)

# 4. Investment
for size in ['S', 'B']:
    for inv in ['C', 'N', 'A']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'Inv_Label', inv) for m in last_12}
        add_res(f"{size}{inv}", rets)

# 5. AT
for size in ['S', 'B']:
    for at in ['H', 'N', 'L']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'AT_Label', at) for m in last_12}
        add_res(f"{size}{at}", rets)

# 6. SG
for size in ['S', 'B']:
    for sg in ['H', 'N', 'L']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'SG_Label', sg) for m in last_12}
        add_res(f"{size}{sg}", rets)

# 7. ACC
for size in ['S', 'B']:
    for acc in ['C', 'N', 'A']:
        rets = {m: get_portfolio_ret(m, 'Size_Label', size, 'ACC_Label', acc) for m in last_12}
        add_res(f"{size}{acc}", rets)


# Now compute main factors for the first tab
mkt_rets = {}
for m in last_12:
    mkt_rows = [r for r in data if r['Month'] == m and 'nifty500' in r]
    mkt_rets[m] = mkt_rows[0]['nifty500'] if mkt_rows else 0.0
add_res("Rm-Rf", mkt_rets)

factors = [
    ("SMB", "Size_Label", "S", "B", True),
    ("HML", "BM_Label", "V", "G", False),
    ("WML", "Momentum_Label", "W", "L", False),
    ("RMW", "OpProf_Label", "R", "W", False),
    ("CMA", "Inv_Label", "C", "A", False),
    ("AT", "AT_Label", "H", "L", False),
    ("SG", "SG_Label", "L", "H", False), # Wait, SG long is H in update_tables map6. SG H vs L.
    ("ACC", "ACC_Label", "C", "A", False),
]

for name, col, l, s, is_size in factors:
    if col == "SG_Label":
        l, s = "H", "L"
        
    if is_size:
        rets = {}
        for m in last_12:
            m_rows = [r for r in data if r['Month'] == m]
            long_rows = [r for r in m_rows if r.get(col) == l]
            short_rows = [r for r in m_rows if r.get(col) == s]
            if len(long_rows) >= 5 and len(short_rows) >= 5:
                long_ret = sum(r['Monthly_Return'] * r['prev_Size'] for r in long_rows) / sum(r['prev_Size'] for r in long_rows)
                short_ret = sum(r['Monthly_Return'] * r['prev_Size'] for r in short_rows) / sum(r['prev_Size'] for r in short_rows)
                rets[m] = long_ret - short_ret
            else:
                rets[m] = 0.0
    else:
        rets = {m: get_factor_ret(m, col, l, s) for m in last_12}
        
    add_res(name, rets)

def format_val(v):
    if v is None: return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.2f}%"

def get_class(v):
    if v is None: return ""
    return "positive" if v >= 0 else "negative"

def update_html(html_content, factor_map):
    for label, col_name in factor_map.items():
        if col_name not in all_results:
            continue
            
        r_1m = all_results[col_name]["1m"]
        r_3m = all_results[col_name]["3m"]
        r_12m = all_results[col_name]["12m"]
        
        c_1m = get_class(r_1m)
        c_3m = get_class(r_3m)
        c_12m = get_class(r_12m)
        
        f_1m = format_val(r_1m)
        f_3m = format_val(r_3m)
        f_12m = format_val(r_12m)
        
        # Regex matching the <td> for label, then 3 subsequent <td> elements
        pattern = r'(<td[^>]*>\s*' + re.escape(label) + r'\s*</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
        # if the label contains HTML (like <span...>), we must match only a part of it.
        # But `label` here is just plain text. In index.html, it's inside a span!
        # E.g. <td class="factor-name"> <span ...> Rm-Rf (Using Nifty 500) </span> </td>
        # Let's adjust pattern to find the label ANYWHERE inside the first td.
        pattern = r'(<td[^>]*>[\s\S]*?' + re.escape(label) + r'[\s\S]*?</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
        
        replacement = r'\g<1>' + f'<td class="{c_1m}">{f_1m}</td>\n                                        <td class="{c_3m}">{f_3m}</td>\n                                        <td class="{c_12m}">{f_12m}</td>'
        
        html_content = re.sub(pattern, replacement, html_content, flags=re.DOTALL)
        
    return html_content

print("Updating index.html...")
with open('index.html', 'r') as f:
    html = f.read()

# Replace March 2025 with April 2026
html = html.replace('March 2025', 'April 2026')
html = html.replace('March 2026', 'April 2026') # just in case

map_main = {
    "Rm-Rf (Using Nifty 500)": "Rm-Rf",
    "SMB": "SMB",
    "HML": "HML",
    "WML": "WML",
    "RMW": "RMW",
    "CMA": "CMA",
    "AT (Asset Turnover)": "AT",
    "SG (Sales Growth)": "SG",
    "ACC (Accruals)": "ACC"
}
map1 = {
    "Small Value": "SV", "Small Neutral": "SN", "Small Growth": "SG",
    "Big Value": "BV", "Big Neutral": "BN", "Big Growth": "BG"
}
map2 = {
    "Small Winner": "SW", "Small Loser": "SL",
    "Big Winner": "BW", "Big Loser": "BL"
}
map3 = {
    "Small Robust": "SR", "Small Neutral": "SN", "Small Weak": "SW",
    "Big Robust": "BR", "Big Neutral": "BN", "Big Weak": "BW"
}
map4 = {
    "Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA",
    "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"
}
map5 = {
    "Small High": "SH", "Small Neutral": "SN", "Small Low": "SL",
    "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"
}
map6 = {
    "Small High": "SH", "Small Neutral": "SN", "Small Low": "SL",
    "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"
}
map7 = {
    "Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA",
    "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"
}

tabs = html.split('data-content="')
new_tabs = [tabs[0]]
# Actually the first tab doesn't have data-content. It's inside tabs[0]!
# Let's just run update_html on the whole document sequentially.
html = update_html(html, map_main)
html = update_html(html, map1)
html = update_html(html, map2)
html = update_html(html, map3)
html = update_html(html, map4)
html = update_html(html, map5)
html = update_html(html, map6)
html = update_html(html, map7)

with open('index.html', 'w') as f:
    f.write(html)
print("Done!")
