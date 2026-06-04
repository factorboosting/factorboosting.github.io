import pandas as pd
import numpy as np

df = pd.read_csv('Data/Factor_Data/ff5.csv')
df['Month'] = pd.to_datetime(df['Month'])
df = df.sort_values('Month').reset_index(drop=True)

factors = ['SMB', 'HML', 'WML', 'RMW', 'CMA']
print(f"Data from {df['Month'].min().strftime('%Y-%m')} to {df['Month'].max().strftime('%Y-%m')}")
print(f"Total Months: {len(df)}")

months = len(df)
years = months / 12

for f in factors:
    compounded = np.prod(1 + df[f]) - 1
    ann_ret = (1 + compounded) ** (1 / years) - 1
    
    # annualized vol
    ann_vol = df[f].std() * np.sqrt(12)
    
    # Sharpe
    sharpe = ann_ret / ann_vol if ann_vol > 0 else 0
    
    print(f"{f}: Ann. Ret = {ann_ret*100:.2f}%, Vol = {ann_vol*100:.2f}%, Sharpe = {sharpe:.3f}")
