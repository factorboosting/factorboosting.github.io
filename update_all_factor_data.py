import csv
import os

SOURCE_DIR = 'Data/Updated_Factor_Data/total_universe/'
DEST_DIR = 'Data/Factor_Data/'

def round_val(val):
    if val == '' or val is None or val == 'NaN':
        return ''
    try:
        return f"{float(val):.4f}"
    except:
        return ''

def process_file(source_file, dest_file, target_cols, date_col_source='Month', date_col_dest='Month'):
    source_path = os.path.join(SOURCE_DIR, source_file)
    dest_path = os.path.join(DEST_DIR, dest_file)
    
    if not os.path.exists(source_path):
        print(f"Skipping {source_file}, does not exist.")
        return
        
    rows = []
    with open(source_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            out_row = {}
            m = row.get(date_col_source, '').strip()
            if not m:
                continue
            out_row[date_col_dest] = m
            
            for col in target_cols[1:]:
                # Note: some files might have slightly different names, but we expect exact match based on new files
                out_row[col] = round_val(row.get(col, ''))
            
            # Check if all data columns (excluding month) are empty
            has_data = any(out_row[c] != '' for c in target_cols[1:])
            
            # For MOM_Size, the first row (2000-11) might be empty, old file included it. Let's include everything
            rows.append(out_row)
            
    # Write to dest
    with open(dest_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=target_cols)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    print(f"Updated {dest_file}")

# 1. BM_Size.csv
# Old: Month,BG,BN,BV,SG,SN,SV,SMB,HML
# New: Month,BG,BN,BV,SG,SN,SV,n_BG,n_BN,n_BV,n_SG,n_SN,n_SV,SMB,HML
process_file('1_smb_hml_mine.csv', 'BM_Size.csv', ['Month', 'BG', 'BN', 'BV', 'SG', 'SN', 'SV', 'SMB', 'HML'])

# 2. INV_Size.csv
# Old: Month,BA,BC,BN,SA,SC,SN,CMA
# New: Month,BA,BC,BN,SA,SC,SN,CMA
process_file('4_cma_long_short.csv', 'INV_Size.csv', ['Month', 'BA', 'BC', 'BN', 'SA', 'SC', 'SN', 'CMA'])

# 3. MOM_Size.csv
# Old: Month,BL,BW,SL,SW,WML
# New: holding_month,BL,BN,BW,SL,SN,SW,WML
process_file('2_mom_factor_mine.csv', 'MOM_Size.csv', ['Month', 'BL', 'BW', 'SL', 'SW', 'WML'], date_col_source='holding_month')

# 4. OP_Size.csv
# Old: Month,BN,BR,BW,SN,SR,SW,RMW
# New: Month,BN,BR,BW,SN,SR,SW,RMW
process_file('3_rmw_long_short.csv', 'OP_Size.csv', ['Month', 'BN', 'BR', 'BW', 'SN', 'SR', 'SW', 'RMW'])

print("All files updated successfully.")
