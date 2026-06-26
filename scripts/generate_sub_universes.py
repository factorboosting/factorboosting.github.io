import csv
from collections import defaultdict

input_file = 'Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv'
out_500 = 'Data/Updated_Factor_Data/Top_500/21_stock_level_monthly_top500.csv'
out_300 = 'Data/Updated_Factor_Data/Top_300/21_stock_level_monthly_top300.csv'

# Read all rows
rows_by_month = defaultdict(list)
with open(input_file, 'r') as infile:
    reader = csv.DictReader(infile)
    fieldnames = reader.fieldnames
    for row in reader:
        try:
            # Use 'mktcap' since 'eom_mcap' might not exist in the new file
            val = row.get('mktcap') or row.get('eom_mcap') or 0.0
            mcap = float(val)
        except:
            mcap = 0.0
        row['_mcap'] = mcap
        rows_by_month[row['Month']].append(row)

# Sort and filter
with open(out_500, 'w', newline='') as f500, open(out_300, 'w', newline='') as f300:
    w500 = csv.DictWriter(f500, fieldnames=fieldnames)
    w300 = csv.DictWriter(f300, fieldnames=fieldnames)
    w500.writeheader()
    w300.writeheader()
    
    for month in sorted(rows_by_month.keys()):
        # Sort descending by market cap
        month_rows = sorted(rows_by_month[month], key=lambda x: x['_mcap'], reverse=True)
        
        # Top 500
        for r in month_rows[:500]:
            out_r = {k:v for k,v in r.items() if k != '_mcap'}
            w500.writerow(out_r)
            
        # Top 300
        for r in month_rows[:300]:
            out_r = {k:v for k,v in r.items() if k != '_mcap'}
            w300.writerow(out_r)

print("Top 500 and Top 300 datasets generated successfully!")
