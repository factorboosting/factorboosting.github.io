import pandas as pd
import math

# 1. Load Excel file
excel_path = "Auctions of 91-Day Government of India Treasury Bills (2).xlsx"
df_excel = pd.read_excel(excel_path)

# Extract relevant data starting from row index 5 (where real data begins)
# Columns: 'Date of Auction' -> col 1, 'Weighted Avg Yield' -> col 16
data_rows = df_excel.iloc[5:]
dates = data_rows.iloc[:, 1]
yields = data_rows.iloc[:, 16]

rf_dict = {}

for date_val, yield_val in zip(dates, yields):
    if pd.isna(date_val) or pd.isna(yield_val):
        continue
    try:
        # Convert date to datetime if it's not already
        dt = pd.to_datetime(date_val)
        month_key = dt.strftime('%Y-%m')
        
        # We want the end of month week's data. If we process sequentially and there's multiple, 
        # we can just take the one with the maximum day.
        # Let's keep track of the latest date seen for each month_key
        if month_key not in rf_dict:
            rf_dict[month_key] = {'date': dt, 'yield': yield_val}
        else:
            if dt > rf_dict[month_key]['date']:
                rf_dict[month_key] = {'date': dt, 'yield': yield_val}
    except Exception as e:
        # skip malformed rows
        pass

# Convert annualized yield percentage to monthly decimal return
monthly_rfs = {}
for m_key, val in rf_dict.items():
    # Yield is something like 5.5471 (which means 5.5471%).
    # We want monthly decimal, so: 5.5471 / 100 / 12
    try:
        y = float(val['yield'])
        monthly_rf = y / 100.0 / 12.0
        monthly_rfs[m_key] = monthly_rf
    except:
        pass

# 2. Update ff5.csv
csv_path = "Data/Factor_Data/ff5.csv"
df_csv = pd.read_csv(csv_path)

# Ensure 'Rf' column exists
if 'Rf' not in df_csv.columns:
    df_csv['Rf'] = 0.0

updated_count = 0
for i, row in df_csv.iterrows():
    month_val = str(row['Month'])
    if month_val in monthly_rfs:
        df_csv.at[i, 'Rf'] = monthly_rfs[month_val]
        updated_count += 1
    else:
        # If missing, we can leave it as 0 or 0.0
        if pd.isna(df_csv.at[i, 'Rf']):
            df_csv.at[i, 'Rf'] = 0.0

df_csv.to_csv(csv_path, index=False)
print(f"Updated {updated_count} rows in ff5.csv with risk-free rates.")
