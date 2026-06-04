import csv
import pandas as pd
import numpy as np

data = []
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            row['Monthly_Return'] = float(row['Monthly_Return'])
            row['prev_Size'] = float(row['prev_Size'])
            if row['Size_Label'] and row['Monthly_Return'] is not None:
                data.append(row)
        except (ValueError, TypeError):
            pass

df = pd.DataFrame(data)
df['Month'] = pd.to_datetime(df['Month'])
df = df[df['Month'] >= '2003-10-01']

def calcVW(group):
    total_w = group['prev_Size'].sum()
    if total_w == 0:
        return group['Monthly_Return'].mean()
    return np.sum(group['Monthly_Return'] * group['prev_Size']) / total_w

months = sorted(df['Month'].unique())
rets_hml = []
rets_wml = []

for m in months:
    m_df = df[df['Month'] == m]
    
    # HML: Value (V) vs Growth (G)
    sv = m_df[(m_df['Size_Label'] == 'S') & (m_df['BM_Label'] == 'V')]
    bv = m_df[(m_df['Size_Label'] == 'B') & (m_df['BM_Label'] == 'V')]
    sg = m_df[(m_df['Size_Label'] == 'S') & (m_df['BM_Label'] == 'G')]
    bg = m_df[(m_df['Size_Label'] == 'B') & (m_df['BM_Label'] == 'G')]
    
    ret_sv = calcVW(sv) if len(sv) > 0 else 0
    ret_bv = calcVW(bv) if len(bv) > 0 else 0
    ret_sg = calcVW(sg) if len(sg) > 0 else 0
    ret_bg = calcVW(bg) if len(bg) > 0 else 0
    
    ret_v = (ret_sv + ret_bv) / 2 if (len(sv) > 0 and len(bv) > 0) else (ret_sv if len(sv) > 0 else ret_bv)
    ret_g = (ret_sg + ret_bg) / 2 if (len(sg) > 0 and len(bg) > 0) else (ret_sg if len(sg) > 0 else ret_bg)
    
    rets_hml.append(ret_v - ret_g)
    
    # WML: Winner (W) vs Loser (L)
    sw = m_df[(m_df['Size_Label'] == 'S') & (m_df['Momentum_Label'] == 'W')]
    bw = m_df[(m_df['Size_Label'] == 'B') & (m_df['Momentum_Label'] == 'W')]
    sl = m_df[(m_df['Size_Label'] == 'S') & (m_df['Momentum_Label'] == 'L')]
    bl = m_df[(m_df['Size_Label'] == 'B') & (m_df['Momentum_Label'] == 'L')]
    
    ret_sw = calcVW(sw) if len(sw) > 0 else 0
    ret_bw = calcVW(bw) if len(bw) > 0 else 0
    ret_sl = calcVW(sl) if len(sl) > 0 else 0
    ret_bl = calcVW(bl) if len(bl) > 0 else 0
    
    ret_win = (ret_sw + ret_bw) / 2 if (len(sw) > 0 and len(bw) > 0) else (ret_sw if len(sw) > 0 else ret_bw)
    ret_los = (ret_sl + ret_bl) / 2 if (len(sl) > 0 and len(bl) > 0) else (ret_sl if len(sl) > 0 else ret_bl)
    
    rets_wml.append(ret_win - ret_los)

nYears = len(months) / 12

def ann_ret(rets):
    cum = np.prod(1 + np.array(rets))
    return (cum ** (1 / nYears)) - 1

print(f"HML (Value-Growth) Ann. Ret: {ann_ret(rets_hml)*100:.2f}%")
print(f"WML (Winner-Loser) Ann. Ret: {ann_ret(rets_wml)*100:.2f}%")
