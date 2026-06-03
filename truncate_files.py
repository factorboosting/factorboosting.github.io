import csv
import os

files_to_truncate = [
    'Data_Factor_Data_ff5.csv',
    'Data/Factor_Data/BM_Size.csv',
    'Data/Factor_Data/OP_Size.csv',
    'Data/Factor_Data/INV_Size.csv',
    'Data/Factor_Data/MOM_Size.csv',
    'Data/Factor_Data/finalMonthlyLabels_aman.csv'
]

for filepath in files_to_truncate:
    if not os.path.exists(filepath):
        print(f"Skipping {filepath}, does not exist")
        continue
        
    temp_path = filepath + '.tmp'
    count = 0
    with open(filepath, 'r') as f_in, open(temp_path, 'w', newline='') as f_out:
        reader = csv.reader(f_in)
        writer = csv.writer(f_out)
        
        try:
            header = next(reader)
            writer.writerow(header)
            
            # Find which column is the Month column
            month_idx = None
            for i, h in enumerate(header):
                if h.strip() in ['Month', 'holding_month']:
                    month_idx = i
                    break
                    
            if month_idx is None:
                print(f"Warning: No Month column found in {filepath}")
                continue
                
            for row in reader:
                if not row or len(row) <= month_idx:
                    continue
                month_val = row[month_idx].strip()
                if month_val >= '2003-10':
                    writer.writerow(row)
                    count += 1
        except Exception as e:
            print(f"Error processing {filepath}: {e}")
            
    os.replace(temp_path, filepath)
    print(f"Truncated {filepath}: {count} rows remain (from 2003-10 onwards)")
