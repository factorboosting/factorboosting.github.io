import csv
import re

# Read data
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
    rows = [r for r in m_rows if r.get(col1) == val1 and r.get(col2) == val2]
    if len(rows) > 0:
        return sum(r['Monthly_Return'] * r['prev_Size'] for r in rows) / sum(r['prev_Size'] for r in rows)
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

factors_conf = [
    ("bookmarket", "BM_Label", ['V', 'N', 'G'], "Small Value", "SV"),
    ("momentum", "Momentum_Label", ['W', 'L'], "Small Winner", "SW"),
    ("profitability", "OpProf_Label", ['R', 'N', 'W'], "Small Robust", "SR"),
    ("investment", "Inv_Label", ['C', 'N', 'A'], "Small Conservative", "SC"),
    ("asset_turnover", "AT_Label", ['H', 'N', 'L'], "Small High", "SH"),
    ("sales_growth", "SG_Label", ['H', 'N', 'L'], "Small High", "SH"),
    ("accruals", "ACC_Label", ['C', 'N', 'A'], "Small Conservative", "SC"),
    ("volatility", "VOL_Label", ['H', 'N', 'L'], "Small High", "SH"),
    ("short_term_reversal", "STR_Label", ['H', 'N', 'L'], "Small High", "SH")
]

for tab, col, vals, _, _ in factors_conf:
    for size in ['S', 'B']:
        for v in vals:
            rets = {m: get_portfolio_ret(m, 'Size_Label', size, col, v) for m in last_12}
            add_res(f"{tab}_{size}{v}", rets)

def format_val(v):
    if v is None: return "-"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.2f}%"

def get_class(v):
    if v is None: return ""
    return "positive" if v >= 0 else "negative"

def update_tab_html(tab_html, factor_map, tab_id):
    for label, suffix in factor_map.items():
        col_name = f"{tab_id}_{suffix}"
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
        
        pattern = r'(<td[^>]*>[\s\S]*?' + re.escape(label) + r'[\s\S]*?</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
        replacement = r'\g<1>' + f'<td class="{c_1m}">{f_1m}</td>\n                                    <td class="{c_3m}">{f_3m}</td>\n                                    <td class="{c_12m}">{f_12m}</td>'
        tab_html = re.sub(pattern, replacement, tab_html, flags=re.DOTALL)
    return tab_html

with open('index.html', 'r') as f:
    html = f.read()

# For the main factors tab, wait, main factors are not computed here.
# But the main factors tab "factors" doesn't have "Small High". It has "SMB", "AT (Asset Turnover)".
# They are fine. The issue is only with the detailed tabs.

# For each tab, we replace it inside its data-content block
maps = {
    "bookmarket": {"Small Value": "SV", "Small Neutral": "SN", "Small Growth": "SG", "Big Value": "BV", "Big Neutral": "BN", "Big Growth": "BG"},
    "momentum": {"Small Winner": "SW", "Small Loser": "SL", "Big Winner": "BW", "Big Loser": "BL"},
    "profitability": {"Small Robust": "SR", "Small Neutral": "SN", "Small Weak": "SW", "Big Robust": "BR", "Big Neutral": "BN", "Big Weak": "BW"},
    "investment": {"Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA", "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"},
    "asset_turnover": {"Small High": "SH", "Small Neutral": "SN", "Small Low": "SL", "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"},
    "sales_growth": {"Small High": "SH", "Small Neutral": "SN", "Small Low": "SL", "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"},
    "accruals": {"Small Conservative": "SC", "Small Neutral": "SN", "Small Aggressive": "SA", "Big Conservative": "BC", "Big Neutral": "BN", "Big Aggressive": "BA"},
    "volatility": {"Small High": "SH", "Small Neutral": "SN", "Small Low": "SL", "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"},
    "short_term_reversal": {"Small High": "SH", "Small Neutral": "SN", "Small Low": "SL", "Big High": "BH", "Big Neutral": "BN", "Big Low": "BL"}
}

for tab_id, fmap in maps.items():
    block_pattern = r'(<div class="tab-content" data-content="' + tab_id + r'">.*?)(<div class="tab-content"|</section>)'
    
    def repl(m):
        tab_content = m.group(1)
        tab_content = update_tab_html(tab_content, fmap, tab_id)
        return tab_content + m.group(2)
        
    html = re.sub(block_pattern, repl, html, flags=re.DOTALL)

with open('index.html', 'w') as f:
    f.write(html)
print("Updated index.html correctly!")
