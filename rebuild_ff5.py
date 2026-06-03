import pandas as pd
import csv
import datetime

print("Loading macroeconomic indicators...")
xls = pd.ExcelFile('50 Macroeconomic Indicators.xlsx')
df_weekly = pd.read_excel(xls, sheet_name='Weekly', skiprows=1)
# Columns: 'Unnamed: 1' is Date, '91-Day Treasury Bill (Primary) Yield (%)' is Col 9.
date_col = df_weekly.columns[1]
tbill_col = df_weekly.columns[9]

rf_monthly = {}
for idx, row in df_weekly.iterrows():
    date_val = row[date_col]
    yield_val = row[tbill_col]
    if pd.isna(date_val) or pd.isna(yield_val) or yield_val == '-':
        continue
    try:
        month_str = date_val.strftime('%Y-%m')
        y_float = float(yield_val)
        if month_str not in rf_monthly:
            rf_monthly[month_str] = []
        rf_monthly[month_str].append(y_float)
    except:
        pass

for m in rf_monthly:
    # average annual yield -> monthly return in decimal
    avg_annual_yield = sum(rf_monthly[m]) / len(rf_monthly[m])
    rf_monthly[m] = (avg_annual_yield / 100.0) / 12.0

print("Loading Nifty 500 returns...")
nifty_returns = {}
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    for row in csv.DictReader(f):
        m = row['Month']
        n = row['nifty500']
        if m and n:
            nifty_returns[m] = float(n)
            
# Load all factors
def load_factor(file_path, col_name):
    res = {}
    try:
        with open(file_path, 'r') as f:
            for row in csv.DictReader(f):
                m = row.get('holding_month') or row.get('Month')
                if m and row.get(col_name) and row.get(col_name) != 'NaN':
                    res[m] = float(row[col_name])
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
    return res

smb = load_factor('Data/Updated_Factor_Data/total_universe/1_smb_hml_mine.csv', 'SMB')
hml = load_factor('Data/Updated_Factor_Data/total_universe/1_smb_hml_mine.csv', 'HML')
wml = load_factor('Data/Updated_Factor_Data/total_universe/2_mom_factor_mine.csv', 'WML')
rmw = load_factor('Data/Updated_Factor_Data/total_universe/3_rmw_long_short.csv', 'RMW')
cma = load_factor('Data/Updated_Factor_Data/total_universe/4_cma_long_short.csv', 'CMA')

all_months = sorted(list(set(list(smb.keys()) + list(nifty_returns.keys()))))
# Filter to months where we have at least Nifty and Rf
valid_months = [m for m in all_months if m in nifty_returns and m in rf_monthly]

# Fama-French starts in ~2001, wait, Nifty500 in my dataset might start in 2001-11
print("Writing Data_Factor_Data_ff5.csv...")
with open('Data_Factor_Data_ff5.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Month', 'SMB', 'HML', 'WML', 'RMW', 'CMA', 'MKT', 'Rf'])
    for m in valid_months:
        r_f = rf_monthly[m]
        r_m = nifty_returns[m]
        mkt = r_m - r_f
        
        row = [
            m,
            f"{smb.get(m, ''):.6f}" if m in smb else '',
            f"{hml.get(m, ''):.6f}" if m in hml else '',
            f"{wml.get(m, ''):.6f}" if m in wml else '',
            f"{rmw.get(m, ''):.6f}" if m in rmw else '',
            f"{cma.get(m, ''):.6f}" if m in cma else '',
            f"{mkt:.6f}",
            f"{r_f:.6f}"
        ]
        # Replace empty strings properly
        row = [x if x != '' else '' for x in row]
        writer.writerow(row)
        
print("Done writing Data_Factor_Data_ff5.csv!")
