import csv
import sys

def calculate_compounded_return(returns, is_percent_input=True):
    """
    Calculates compounded return from a list of returns.
    Assumes Fama French factors are given in percent (e.g., 1.5 = 1.5%) if is_percent_input is True.
    If is_percent_input is False, input is in decimals (e.g., 0.015 = 1.5%).
    Always returns the compounded value in percent format.
    """
    divisor = 100.0 if is_percent_input else 1.0
    
    # Filter out empty strings or invalid data
    valid_returns = []
    for r in returns:
        try:
            valid_returns.append(float(r))
        except ValueError:
            pass
            
    if not valid_returns:
        return "NaN"
    
    compounded = 1.0
    for r in valid_returns:
        # Convert to decimals for compounding: (1 + r)
        compounded *= (r / divisor) + 1.0
        
    # Convert back to percent scale for the output string
    compounded = (compounded - 1.0) * 100.0
    return f"{compounded:.2f}"

def main():
    input_file = "Data/Factor_Data/ff5.csv"
    output_file = "factor_table.csv"
    
    try:
        with open(input_file, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            # Read all rows and sort by month (just in case they are not sorted)
            rows = sorted(list(reader), key=lambda x: x.get('Month', ''))
    except FileNotFoundError:
        print(f"Error: Could not find {input_file}. Run this script from the website root.")
        sys.exit(1)
        
    if not rows:
        print("Error: The CSV file is empty.")
        sys.exit(1)

    factor_mapping = {
        'MKT': 'Rm-Rf (Using Nifty 500)',
        'SMB': 'SMB',
        'HML': 'HML',
        'WML': 'WML',
        'RMW': 'RMW',
        'CMA': 'CMA'
    }
    
    # Find which factors exist in the header
    headers = rows[0].keys()
    factors = [f for f in factor_mapping.keys() if f in headers]
    
    last_12_rows = rows[-12:] if len(rows) >= 12 else rows
    last_3_rows = rows[-3:] if len(rows) >= 3 else rows
    last_1_row = rows[-1]
    
    latest_month_str = last_1_row.get('Month', 'Unknown')
    print(f"Generating table for latest month: {latest_month_str}")
    
    results = []
    
    for factor in factors:
        is_mkt = (factor == 'MKT')
        try:
            val_1m = float(last_1_row.get(factor, ''))
            # If it's MKT, it's already a percent. Otherwise, multiply by 100.
            val_1m_str = f"{val_1m:.2f}" if is_mkt else f"{val_1m * 100.0:.2f}"
        except ValueError:
            val_1m_str = "NaN"
            
        last_3_vals = [row.get(factor, '') for row in last_3_rows]
        last_12_vals = [row.get(factor, '') for row in last_12_rows]
        
        val_3m_str = calculate_compounded_return(last_3_vals, is_percent_input=is_mkt)
        val_12m_str = calculate_compounded_return(last_12_vals, is_percent_input=is_mkt)
        
        results.append({
            'Factor': factor_mapping[factor],
            latest_month_str: val_1m_str,
            'Last 3 Months': val_3m_str,
            'Last 12 Months': val_12m_str
        })
        
    # Write to output CSV
    with open(output_file, mode='w', encoding='utf-8', newline='') as f:
        fieldnames = ['Factor', latest_month_str, 'Last 3 Months', 'Last 12 Months']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        
        writer.writeheader()
        for row in results:
            writer.writerow(row)
            
    print(f"\nSuccessfully generated {output_file}")
    print("-" * 60)
    # Simple console table print
    print(f"{'Factor':<25} | {latest_month_str:<10} | {'Last 3 Months':<13} | {'Last 12 Months'}")
    print("-" * 60)
    for r in results:
        print(f"{r['Factor']:<25} | {r[latest_month_str]:<10} | {r['Last 3 Months']:<13} | {r['Last 12 Months']}")
    print("-" * 60)

if __name__ == "__main__":
    main()
