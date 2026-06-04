import csv
import pandas as pd
import numpy as np

data = []
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            row['Monthly_Return'] = float(row['Monthly_Return'])
            row['prev_Size'] = float(row['prev_Size']) if row['prev_Size'] else 0.0
            row['Size'] = float(row['Size']) if row['Size'] else 0.0
            if row['Size_Label'] and row['Monthly_Return'] is not None:
                data.append(row)
        except (ValueError, TypeError):
            pass

df = pd.DataFrame(data)
df['Month'] = pd.to_datetime(df['Month'])
df = df[df['Month'] >= '2003-10-01']

def calcVW(group):
    if len(group) == 0: return 0
    # Match backtester logic exactly
    weighted = 0
    total_w = 0
    for _, r in group.iterrows():
        w = r['prev_Size']
        if pd.isna(w) or w <= 0:
            w = r['Size']
        if pd.isna(w) or w <= 0:
            continue
        total_w += w
        weighted += r['Monthly_Return'] * w
    if total_w <= 0:
        return group['Monthly_Return'].mean()
    return weighted / total_w

months = sorted(df['Month'].unique())
rets_hml = []
rets_wml = []
rets_smb = []
rets_inv = []
rets_op = []

for m in months:
    m_df = df[df['Month'] == m]
    
    # helper for size neutral
    def get_sn_ret(col, val):
        s = m_df[(m_df['Size_Label'] == 'S') & (m_df[col] == val)]
        b = m_df[(m_df['Size_Label'] == 'B') & (m_df[col] == val)]
        ret_s = calcVW(s) if len(s) > 0 else 0
        ret_b = calcVW(b) if len(b) > 0 else 0
        if len(s) > 0 and len(b) > 0: return (ret_s + ret_b)/2
        elif len(s) > 0: return ret_s
        elif len(b) > 0: return ret_b
        return 0
        
    ret_v = get_sn_ret('BM_Label', 'V')
    ret_g = get_sn_ret('BM_Label', 'G')
    rets_hml.append(ret_v - ret_g)
    
    ret_w = get_sn_ret('Momentum_Label', 'W')
    ret_l = get_sn_ret('Momentum_Label', 'L')
    rets_wml.append(ret_w - ret_l)
    
    ret_a = get_sn_ret('Inv_Label', 'A')
    ret_c = get_sn_ret('Inv_Label', 'C')
    rets_inv.append(ret_a - ret_c)
    
    ret_r = get_sn_ret('OpProf_Label', 'R')
    ret_w_op = get_sn_ret('OpProf_Label', 'W')
    rets_op.append(ret_r - ret_w_op)
    
    b_all = m_df[m_df['Size_Label'] == 'B']
    s_all = m_df[m_df['Size_Label'] == 'S']
    ret_big = calcVW(b_all) if len(b_all) > 0 else 0
    ret_small = calcVW(s_all) if len(s_all) > 0 else 0
    rets_smb.append(ret_big - ret_small)

nYears = len(months) / 12

def ann_ret(rets):
    cum = np.prod(1 + np.array(rets))
    return ((cum ** (1 / nYears)) - 1) if cum > 0 else 0

def ann_vol(rets):
    var = np.var(rets, ddof=1)
    return np.sqrt(var * 12)

def sharpe(rets):
    ar = ann_ret(rets)
    av = ann_vol(rets)
    return ar / av if av > 0 else 0

print(f"Winner - Loser: Ann. Ret: {ann_ret(rets_wml)*100:.2f}%, Sharpe: {sharpe(rets_wml):.3f}")
print(f"Big - Small: Ann. Ret: {ann_ret(rets_smb)*100:.2f}%, Sharpe: {sharpe(rets_smb):.3f}")
print(f"Value - Growth: Ann. Ret: {ann_ret(rets_hml)*100:.2f}%, Sharpe: {sharpe(rets_hml):.3f}")
print(f"Aggressive - Conservative: Ann. Ret: {ann_ret(rets_inv)*100:.2f}%, Sharpe: {sharpe(rets_inv):.3f}")
print(f"Robust - Weak: Ann. Ret: {ann_ret(rets_op)*100:.2f}%, Sharpe: {sharpe(rets_op):.3f}")
