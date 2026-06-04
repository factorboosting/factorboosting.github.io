import pandas as pd
import numpy as np

ff5 = pd.read_csv("Data/Factor_Data/ff5.csv")
ff5.columns = ff5.columns.str.strip()
ff5["Month"] = pd.to_datetime(ff5["Month"].astype(str), format="%Y-%m").dt.to_period("M")
for col in ["SMB", "HML", "WML", "RMW", "CMA"]:
    if col in ff5.columns:
        ff5[col] = pd.to_numeric(ff5[col], errors="coerce")
ff5 = ff5.sort_values("Month").reset_index(drop=True)

start = pd.Period("2003-10", freq="M")
end   = pd.Period("2025-12", freq="M")
ff5_plot = ff5[(ff5["Month"] >= start) & (ff5["Month"] <= end)].copy()

FACTORS = ["SMB", "HML", "WML", "RMW", "CMA"]
print(f"\n{'Factor':<8} {'Ann Ret%':>9} {'Ann Vol%':>9} {'Sharpe':>8} {'T-stat':>8} {'N':>6}")
print("-" * 52)
for col in FACTORS:
    if col not in ff5_plot.columns: continue
    s = ff5_plot[col].dropna()
    if len(s) > 1:
        ret   = s.mean() * 12 * 100
        vol   = s.std()  * np.sqrt(12) * 100
        sr    = s.mean() / s.std() * np.sqrt(12)
        tstat = s.mean() / s.std() * np.sqrt(len(s))
        print(f"{col:<8} {ret:>9.2f} {vol:>9.2f} {sr:>8.3f} {tstat:>8.2f} {len(s):>6}")
