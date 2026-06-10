import csv
import argparse

parser = argparse.ArgumentParser(description='Convert factor universe.')
parser.add_argument('--input', type=str, default='factor_label_may_26.csv', help='Input CSV file')
parser.add_argument('--output', type=str, default='Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv', help='Output CSV file')
args = parser.parse_args()

input_file = args.input
output_file = args.output

with open(input_file, 'r') as infile, open(output_file, 'w', newline='') as outfile:
    reader = csv.DictReader(infile)
    
    fieldnames = [
        'co_code', 'Month', 'monthly_return', 'eom_mcap', 'prev_mktcap', 
        'Size_Label_Yearly', 'Size_Label_Monthly', 
        'MOM_Label', 'BM_Label', 'OP_Label', 'INV_Label', 'AT_Label', 
        'SG_Label', 'ACC_Label', 'VOL_Label', 'STR_Label',
        'Size_Label_OP', 'Size_Label_INV', 'Size_Label_AT', 'Size_Label_SG', 'Size_Label_ACC'
    ]
    
    writer = csv.DictWriter(outfile, fieldnames=fieldnames)
    writer.writeheader()
    
    for row in reader:
        out_row = {
            'co_code': row.get('co_code', ''),
            'Month': row.get('Month', ''),
            'monthly_return': row.get('monthly_ret', ''),
            'eom_mcap': row.get('lagged_mktcap', ''),
            'prev_mktcap': row.get('lagged_mktcap', ''),
            'Size_Label_Yearly': row.get('Size_Label_Yearly', ''),
            'Size_Label_Monthly': row.get('Size_Label_Monthly', ''),
            'MOM_Label': row.get('MOM_Label', ''),
            'BM_Label': row.get('BM_Label', ''),
            'OP_Label': row.get('OP_Label', ''),
            'INV_Label': row.get('INV_Label', ''),
            'AT_Label': row.get('AT_Label', ''),
            'SG_Label': row.get('SG_Label', ''),
            'ACC_Label': row.get('ACC_Label', ''),
            'VOL_Label': row.get('BAV_Label', ''),
            'STR_Label': row.get('STR_Label', ''),
            'Size_Label_OP': row.get('RMW_Portfolio', '')[:1] if row.get('RMW_Portfolio', '') else '',
            'Size_Label_INV': row.get('CMA_Portfolio', '')[:1] if row.get('CMA_Portfolio', '') else '',
            'Size_Label_AT': row.get('AT_Portfolio', '')[:1] if row.get('AT_Portfolio', '') else '',
            'Size_Label_SG': row.get('SG_Portfolio', '')[:1] if row.get('SG_Portfolio', '') else '',
            'Size_Label_ACC': row.get('ACC_Portfolio', '')[:1] if row.get('ACC_Portfolio', '') else ''
        }
        writer.writerow(out_row)

print("21_stock_level_monthly.csv generated successfully with factor-specific size labels!")
