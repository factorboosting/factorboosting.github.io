import pandas as pd
import numpy as np
import warnings

# Suppress pandas warning about dateutil
warnings.filterwarnings('ignore', category=UserWarning)

excel_file = "Auctions of 91-Day Government of India Treasury Bills (2).xlsx"
df_excel = pd.read_excel(excel_file, skiprows=9, header=None)

# The column indices are:
# 1: Date of Auction
# 13: Implicit Yield at Cut-off Price (percent)
# 16: Weighted Avg Yield (per cent)
df_excel = df_excel.rename(columns={1: 'Date', 13: 'ImplicitYield', 16: 'WeightedYield'})

# Filter valid rows
df_excel['Date'] = pd.to_datetime(df_excel['Date'], errors='coerce')
df_excel = df_excel.dropna(subset=['Date'])

# Clean up string dashes '-' into NaN
df_excel['ImplicitYield'] = pd.to_numeric(df_excel['ImplicitYield'], errors='coerce')
df_excel['WeightedYield'] = pd.to_numeric(df_excel['WeightedYield'], errors='coerce')

# Logic: Use ImplicitYield (Col 13). If missing, fallback to WeightedYield (Col 16)
def get_final_yield(row):
    if pd.notna(row['ImplicitYield']):
        return row['ImplicitYield']
    return row['WeightedYield']

df_excel['Yield'] = df_excel.apply(get_final_yield, axis=1)

df_excel = df_excel.dropna(subset=['Yield'])

# Extract Month and Year for grouping
df_excel['YearMonth'] = df_excel['Date'].dt.to_period('M')

# Sort by Date
df_excel = df_excel.sort_values(by='Date')

# Group by YearMonth and take the last row
df_last = df_excel.groupby('YearMonth').last().reset_index()

# Convert Yield to monthly decimal (Annualized Percentage -> Monthly Decimal)
df_last['Rf_Monthly'] = df_last['Yield'] / 100 / 12

# Convert YearMonth back to string 'YYYY-MM'
df_last['MonthStr'] = df_last['YearMonth'].dt.strftime('%Y-%m')

# Dictionary of MonthStr -> Rf_Monthly
rf_map = dict(zip(df_last['MonthStr'], df_last['Rf_Monthly']))

# Now load ff5.csv
csv_file = "Data/Factor_Data/ff5.csv"
df_csv = pd.read_csv(csv_file)

# Update Rf column
def get_new_rf(row):
    m = str(row['Month'])
    if m in rf_map and pd.notna(rf_map[m]):
        return rf_map[m]
    # If the file didn't have data, we'll keep NaN so we can backfill
    return np.nan

df_csv['Rf'] = df_csv.apply(get_new_rf, axis=1)

# Backfill and forward fill to cover any remaining gaps
df_csv['Rf'] = df_csv['Rf'].ffill().bfill()

df_csv.to_csv(csv_file, index=False)
print("Updated ff5.csv with correct Implicit Yields successfully.")
