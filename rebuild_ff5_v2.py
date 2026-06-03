import pandas as pd
import csv
import os

print("Loading macro indicators...")
xls = pd.ExcelFile('50 Macroeconomic Indicators.xlsx')
df_weekly = pd.read_excel(xls, sheet_name='Weekly', skiprows=1)
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
    avg_annual_yield = sum(rf_monthly[m]) / len(rf_monthly[m])
    # monthly return in percentage
    rf_monthly[m] = avg_annual_yield / 12.0

print("Loading Nifty 500 returns...")
nifty_returns = {}
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    for row in csv.DictReader(f):
        m = row['Month']
        n = row['nifty500']
        if m and n:
            nifty_returns[m] = float(n) * 100.0 # convert to percentage

old_mkt = {}
try:
    with open('Data_Factor_Data_ff5_backup.csv', 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('MKT') and row['MKT'] != '':
                old_mkt[row['Month']] = float(row['MKT'])
except:
    # If backup doesn't exist, try original
    with open('Data_Factor_Data_ff5.csv', 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('MKT') and row['MKT'] != '':
                old_mkt[row['Month']] = float(row['MKT'])

def load_factor(file_path, col_name):
    res = {}
    try:
        with open(file_path, 'r') as f:
            for row in csv.DictReader(f):
                m = row.get('holding_month') or row.get('Month')
                if m and row.get(col_name) and row.get(col_name) != 'NaN':
                    res[m] = float(row[col_name])
    except Exception as e:
        pass
    return res

smb = load_factor('Data/Updated_Factor_Data/total_universe/1_smb_hml_mine.csv', 'SMB')
hml = load_factor('Data/Updated_Factor_Data/total_universe/1_smb_hml_mine.csv', 'HML')
wml = load_factor('Data/Updated_Factor_Data/total_universe/2_mom_factor_mine.csv', 'WML')
rmw = load_factor('Data/Updated_Factor_Data/total_universe/3_rmw_long_short.csv', 'RMW')
cma = load_factor('Data/Updated_Factor_Data/total_universe/4_cma_long_short.csv', 'CMA')

all_months = sorted(list(set(list(smb.keys()) + list(nifty_returns.keys()) + list(old_mkt.keys()))))
valid_months = [m for m in all_months if m in smb or m in hml] # we only output months where we have factor data

print("Writing Data_Factor_Data_ff5.csv...")
with open('Data_Factor_Data_ff5.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Month', 'SMB', 'HML', 'WML', 'RMW', 'CMA', 'MKT', 'Rf'])
    for m in valid_months:
        
        # Calculate MKT and Rf
        if m in rf_monthly and m in nifty_returns:
            r_f = rf_monthly[m]
            r_m = nifty_returns[m]
            mkt_val = r_m - r_f
            mkt_str = f"{mkt_val:.6f}"
            rf_str = f"{r_f:.6f}"
        else:
            mkt_val = old_mkt.get(m, '')
            mkt_str = f"{mkt_val:.6f}" if mkt_val != '' else ''
            rf_str = ''
            
        row = [
            m,
            f"{smb.get(m, ''):.6f}" if m in smb else '',
            f"{hml.get(m, ''):.6f}" if m in hml else '',
            f"{wml.get(m, ''):.6f}" if m in wml else '',
            f"{rmw.get(m, ''):.6f}" if m in rmw else '',
            f"{cma.get(m, ''):.6f}" if m in cma else '',
            mkt_str,
            rf_str
        ]
        row = [x if x != '' else '' for x in row]
        writer.writerow(row)

print("Done writing Data_Factor_Data_ff5.csv!")
