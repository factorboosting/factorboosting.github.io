import csv
import datetime

data = []
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            row['Monthly_Return'] = float(row['Monthly_Return'])
            row['prev_Size'] = float(row['prev_Size'])
            if row['Size_Label'] and row['Monthly_Return'] is not None:
                # Also store nifty500 for Rm-Rf
                if 'nifty500' in row and row['nifty500']:
                    row['nifty500'] = float(row['nifty500'])
                data.append(row)
        except (ValueError, TypeError):
            pass

months = sorted(list(set(row['Month'] for row in data)))
last_12 = months[-12:]
last_3 = months[-3:]
latest = months[-1]

def get_factor_returns(factor_col, long_label, short_label):
    res = {}
    for m in last_12:
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
            res[m] = (ret_s + ret_b) / 2
        elif ret_s is not None:
            res[m] = ret_s
        elif ret_b is not None:
            res[m] = ret_b
        else:
            res[m] = 0.0
    return res

def calc_compounded(ret_dict, months_list):
    comp = 1.0
    for m in months_list:
        comp *= (1.0 + ret_dict[m])
    return (comp - 1.0) * 100

factors = [
    ("SMB", "Size_Label", "S", "B", True),
    ("HML", "BM_Label", "V", "G", False),
    ("WML", "Momentum_Label", "W", "L", False),
    ("RMW", "OpProf_Label", "R", "W", False),
    ("CMA", "Inv_Label", "C", "A", False),
    ("AT (Asset Turnover)", "AT_Label", "H", "L", False),
    ("SG (Sales Growth)", "SG_Label", "L", "H", False), # Usually Sales Growth buys low, sells high. I'll use L vs H here. If I check backtester, SG is H vs L. Actually let me use H vs L to be consistent with backtester JS.
]

results = []

mkt_rets = {}
for m in last_12:
    mkt_rows = [r for r in data if r['Month'] == m and 'nifty500' in r]
    if mkt_rows:
        mkt_rets[m] = mkt_rows[0]['nifty500']
    else:
        mkt_rets[m] = 0.0

results.append([
    "Rm-Rf (Using Nifty 500)",
    f"{mkt_rets[latest]*100:.2f}",
    f"{calc_compounded(mkt_rets, last_3):.2f}",
    f"{calc_compounded(mkt_rets, last_12):.2f}"
])

factors = [
    ("SMB", "Size_Label", "S", "B", True),
    ("HML", "BM_Label", "V", "G", False),
    ("WML", "Momentum_Label", "W", "L", False),
    ("RMW", "OpProf_Label", "R", "W", False),
    ("CMA", "Inv_Label", "C", "A", False),
    ("AT (Asset Turnover)", "AT_Label", "H", "L", False),
    ("SG (Sales Growth)", "SG_Label", "L", "H", False), # Wait, let me just check update_tables.py. "map6: Small High: SH, Small Neutral: SN, Small Low: SL". Then it takes HML_SG. H minus L. So High vs Low.
    ("ACC (Accruals)", "ACC_Label", "C", "A", False),
]

for name, col, l, s, is_size in factors:
    if col == "SG_Label":
        l, s = "H", "L" # Enforce H vs L to match what update_tables.py does (SH/BH vs SL/BL)
    
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
        rets = get_factor_returns(col, l, s)
        
    results.append([
        name,
        f"{rets[latest]*100:.2f}",
        f"{calc_compounded(rets, last_3):.2f}",
        f"{calc_compounded(rets, last_12):.2f}"
    ])

dt = datetime.datetime.strptime(latest, "%Y-%m")
header_month = dt.strftime("%B %Y")

with open('factor_table.csv', 'w') as f:
    f.write(f"Factor,{header_month},Last 3 Months,Last 12 Months\n")
    for r in results:
        f.write(",".join(r) + "\n")

print(f"Updated factor_table.csv for {header_month}")
