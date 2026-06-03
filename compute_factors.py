import pandas as pd
import numpy as np
import datetime

# Load data
df = pd.read_csv('Data/Factor_Data/finalMonthlyLabels_aman.csv')

# Convert necessary columns
df['Monthly_Return'] = pd.to_numeric(df['Monthly_Return'], errors='coerce')
df['prev_Size'] = pd.to_numeric(df['prev_Size'], errors='coerce')

# Filter valid rows
df = df.dropna(subset=['Monthly_Return', 'prev_Size', 'Size_Label'])

# Get months
months = sorted(df['Month'].unique())
# We only care about the last 12 months for the table
last_12 = months[-12:]
last_3 = months[-3:]
latest = months[-1]

def get_factor_returns(factor_col, long_label, short_label):
    # Returns a dict of month -> return
    res = {}
    for m in last_12:
        m_df = df[df['Month'] == m]
        
        # We need small and big buckets
        ret_s = None
        ret_b = None
        
        for size_bucket in ['S', 'B']:
            bucket_df = m_df[m_df['Size_Label'] == size_bucket]
            long_df = bucket_df[bucket_df[factor_col] == long_label]
            short_df = bucket_df[bucket_df[factor_col] == short_label]
            
            if len(long_df) >= 5 and len(short_df) >= 5:
                # Value weighted returns
                long_ret = (long_df['Monthly_Return'] * long_df['prev_Size']).sum() / long_df['prev_Size'].sum()
                short_ret = (short_df['Monthly_Return'] * short_df['prev_Size']).sum() / short_df['prev_Size'].sum()
                if size_bucket == 'S':
                    ret_s = long_ret - short_ret
                else:
                    ret_b = long_ret - short_ret
                    
        # Average size buckets
        if ret_s is not None and ret_b is not None:
            res[m] = (ret_s + ret_b) / 2
        elif ret_s is not None:
            res[m] = ret_s
        elif ret_b is not None:
            res[m] = ret_b
        else:
            res[m] = 0.0 # Default if both invalid
            
    return res

def calc_compounded(ret_dict, months_list):
    comp = 1.0
    for m in months_list:
        comp *= (1.0 + ret_dict[m])
    return (comp - 1.0) * 100

factors = [
    ("SMB", "Size_Label", "S", "B", True), # Wait, SMB is a bit different: average of all 3 value/growth buckets? Or just simple S-B?
    # For SMB in our backtester, we just select Size_Label S as long, B as short!
    ("HML", "BM_Label", "V", "G", False),
    ("WML", "Momentum_Label", "W", "L", False),
    ("RMW", "OpProf_Label", "R", "W", False),
    ("CMA", "Inv_Label", "C", "A", False),
    ("AT (Asset Turnover)", "AT_Label", "H", "L", False),
    ("SG (Sales Growth)", "SG_Label", "L", "H", False), # Wait, is SG Low minus High?
    ("ACC (Accruals)", "ACC_Label", "C", "A", False), # Wait, conservative vs aggressive?
]

results = []

# Nifty 500 return (Market proxy)
# Average of nifty500 col in the dataset?
# Let's get the first valid nifty500 return for each month (it's the same for all rows in a month)
mkt_rets = {}
for m in last_12:
    mkt = df[df['Month'] == m]['nifty500'].dropna()
    if len(mkt) > 0:
        mkt_rets[m] = mkt.iloc[0]
    else:
        mkt_rets[m] = 0.0

results.append([
    "Rm-Rf (Using Nifty 500)",
    f"{mkt_rets[latest]*100:.2f}",
    f"{calc_compounded(mkt_rets, last_3):.2f}",
    f"{calc_compounded(mkt_rets, last_12):.2f}"
])

for name, col, l, s, is_size in factors:
    if is_size:
        # Size factor is S - B, but we don't size-neutralize the size factor!
        # Just simple value-weighted S vs B
        rets = {}
        for m in last_12:
            m_df = df[df['Month'] == m]
            long_df = m_df[m_df[col] == l]
            short_df = m_df[m_df[col] == s]
            if len(long_df) >= 5 and len(short_df) >= 5:
                long_ret = (long_df['Monthly_Return'] * long_df['prev_Size']).sum() / long_df['prev_Size'].sum()
                short_ret = (short_df['Monthly_Return'] * short_df['prev_Size']).sum() / short_df['prev_Size'].sum()
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

# Convert month to 'April 2026'
dt = datetime.datetime.strptime(latest, "%Y-%m")
header_month = dt.strftime("%B %Y")

with open('factor_table.csv', 'w') as f:
    f.write(f"Factor,{header_month},Last 3 Months,Last 12 Months\n")
    for r in results:
        f.write(",".join(r) + "\n")

print("Done generating factor_table.csv")
