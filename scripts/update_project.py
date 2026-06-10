import argparse
import subprocess
import os
import datetime
import math
import re
import csv
import zipfile
from collections import defaultdict

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def format_ret(val):
    if math.isnan(val): return "0.00%"
    sign = "+" if val > 0 else ""
    cls = "positive" if val > 0 else "negative" if val < 0 else ""
    return f'<td class="{cls}">{sign}{val:.2f}%</td>'

def calc_portfolio_rets(data_for_month, portfolio_cols):
    # portfolio_cols is a list of column names like ['SV_Portfolio', 'RMW_Portfolio']
    # Returns a dict: { col_name: { port_val: return_float } }
    sums = {c: defaultdict(lambda: {'ret_sum': 0.0, 'w_sum': 0.0, 'count': 0, 'eq_sum': 0.0}) for c in portfolio_cols}
    
    for r in data_for_month:
        try:
            mcap = float(r['lagged_mktcap']) if r['lagged_mktcap'] else 0.0
            ret = float(r['monthly_ret']) if r['monthly_ret'] else 0.0
        except ValueError:
            continue
            
        for c in portfolio_cols:
            pval = r.get(c)
            if pval:
                st = sums[c][pval]
                st['w_sum'] += mcap
                st['ret_sum'] += mcap * ret
                st['count'] += 1
                st['eq_sum'] += ret
                
    result = {c: {} for c in portfolio_cols}
    for c, port_dict in sums.items():
        for pval, st in port_dict.items():
            if st['w_sum'] > 0:
                result[c][pval] = st['ret_sum'] / st['w_sum']
            elif st['count'] > 0:
                result[c][pval] = st['eq_sum'] / st['count']
            else:
                result[c][pval] = 0.0
    return result

def calc_stats(returns, months_count):
    if not returns or len(returns) < months_count:
        return float('nan')
    recent = returns[-months_count:]
    cum = 1.0
    for r in recent:
        cum *= (1 + r)
    return (cum - 1) * 100

def get_file_size(filepath):
    if not os.path.exists(filepath): return "0 MB"
    size_bytes = os.path.getsize(filepath)
    if size_bytes > 1024 * 1024:
        return f"{size_bytes / (1024*1024):.1f} MB"
    return f"{size_bytes / 1024:.0f} KB"

def zip_file(input_path, output_path):
    print(f"Zipping {input_path} to {output_path}...")
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(input_path, os.path.basename(input_path))

def update_legacy_aman_file(input_csv):
    print("Updating backtester legacy file (finalMonthlyLabels_aman.csv)...")
    co_names = {}
    try:
        with open('Data/Factor_Data/co_code_co_name_mapping.csv', 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                co_code = row.get('Prowess company code')
                co_name = row.get('Company Name')
                if co_code and co_name:
                    co_names[co_code.strip()] = co_name.strip()
    except Exception:
        pass

    nifty_data_global = {} 
    nifty500_data_global = {} 
    old_names = {}
    
    out_file = 'Data/Factor_Data/finalMonthlyLabels_aman.csv'
    try:
        with open(out_file, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                code = row.get('Co_Code') or row.get('co_code')
                month = row.get('Month')
                nifty50 = row.get('nifty50', '')
                nifty500 = row.get('nifty500', '')
                co_name = row.get('Co_Name', '')
                
                if month:
                    if nifty50 and month not in nifty_data_global:
                        nifty_data_global[month] = nifty50
                    if nifty500 and month not in nifty500_data_global:
                        nifty500_data_global[month] = nifty500
                if code and co_name and code not in co_names:
                    old_names[code] = co_name
    except Exception:
        pass

    # Read new file and rewrite the legacy file
    with open(input_csv, 'r') as infile:
        reader = csv.DictReader(infile)
        rows = list(reader)
        
    fieldnames = [
        'Co_Code', 'Month', 'Monthly_Return', 'Size', 'prev_Size', 
        'Momentum_Label', 'BM_Label', 'OpProf_Label', 'Inv_Label', 
        'AT_Label', 'VOL_Label', 'STR_Label', 'Size_Label', 
        'SG_Label', 'ACC_Label', 'nifty50', 'nifty500', 'Co_Name'
    ]
    
    with open(out_file, 'w', newline='') as outfile:
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            code = row.get('co_code', '')
            month = row.get('Month', '')
            co_name = co_names.get(code, old_names.get(code, 'Unknown'))
            
            out_row = {
                'Co_Code': code,
                'Month': month,
                'Monthly_Return': row.get('monthly_ret', ''),
                'Size': row.get('lagged_mktcap', ''),
                'prev_Size': row.get('lagged_mktcap', ''),
                'Momentum_Label': row.get('MOM_Label', ''),
                'BM_Label': row.get('BM_Label', ''),
                'OpProf_Label': row.get('OP_Label', ''),
                'Inv_Label': row.get('INV_Label', ''),
                'AT_Label': row.get('AT_Label', ''),
                'VOL_Label': row.get('BAV_Label', ''),
                'STR_Label': row.get('STR_Label', ''),
                'Size_Label': row.get('Size_Label_Monthly_Any', ''),
                'SG_Label': row.get('SG_Label', ''),
                'ACC_Label': row.get('ACC_Label', ''),
                'nifty50': nifty_data_global.get(month, ''),
                'nifty500': nifty500_data_global.get(month, ''),
                'Co_Name': co_name
            }
            writer.writerow(out_row)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input_csv', help='Path to the new raw monthly CSV file')
    args = parser.parse_args()

    input_csv = args.input_csv
    if not os.path.exists(input_csv):
        print(f"Error: File {input_csv} not found.")
        return

    # 1. Run Data Conversion
    run_cmd(f"python3 convert_universe.py --input '{input_csv}'")
    run_cmd(f"python3 generate_sub_universes.py")
    update_legacy_aman_file(input_csv)

    # Zip the generated files to save bandwidth
    os.makedirs('Data/Downloads', exist_ok=True)
    zip_file('Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv', 'Data/Downloads/factor_labels_all.zip')
    zip_file('Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv', 'Data/Downloads/factor_labels_top500.zip')
    zip_file('Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv', 'Data/Downloads/factor_labels_top300.zip')

    size_all = get_file_size('Data/Downloads/factor_labels_all.zip')
    size_500 = get_file_size('Data/Downloads/factor_labels_top500.zip')
    size_300 = get_file_size('Data/Downloads/factor_labels_top300.zip')

    # 2. Parse Raw CSV to calculate portfolio returns
    print("Parsing CSV for stats...")
    data_by_month = defaultdict(list)
    with open(input_csv, 'r') as f:
        reader = csv.DictReader(f)
        for r in reader:
            data_by_month[r['Month']].append(r)
    
    months = sorted(data_by_month.keys())
    if not months:
        print("No data found in CSV.")
        return
        
    latest_month_str = months[-1]
    # format 2026-05 -> May 2026
    dt = datetime.datetime.strptime(latest_month_str, "%Y-%m")
    display_month = dt.strftime("%B %Y")
    
    # Calculate returns for each factor
    portfolios = {
        'SV_Portfolio': ['SV', 'SN', 'SG', 'BV', 'BN', 'BG'],
        'RMW_Portfolio': ['SR', 'SN', 'SW', 'BR', 'BN', 'BW'],
        'CMA_Portfolio': ['SC', 'SN', 'SA', 'BC', 'BN', 'BA'],
        'AT_Portfolio': ['SH', 'SN', 'SL', 'BH', 'BN', 'BL'], # Assuming AT uses H/N/L
        'SG_Portfolio': ['SH', 'SN', 'SL', 'BH', 'BN', 'BL'],
        'ACC_Portfolio': ['SH', 'SN', 'SL', 'BH', 'BN', 'BL']
    }
    
    portfolio_rets = defaultdict(lambda: defaultdict(list))
    all_cols = list(portfolios.keys())
    
    for m in months:
        m_data = data_by_month[m]
        month_res = calc_portfolio_rets(m_data, all_cols)
        
        for port_col, port_names in portfolios.items():
            for p_name in port_names:
                ret = month_res[port_col].get(p_name, 0.0)
                portfolio_rets[port_col][p_name].append(ret)
                
    # Calculate Factor returns
    factor_rets = defaultdict(list)
    for i, m in enumerate(months):
        m_data = data_by_month[m]
        
        # 1. Standard Fama-French from predefined columns
        sv = portfolio_rets['SV_Portfolio']['SV'][i]
        sn = portfolio_rets['SV_Portfolio']['SN'][i]
        sg = portfolio_rets['SV_Portfolio']['SG'][i]
        bv = portfolio_rets['SV_Portfolio']['BV'][i]
        bn = portfolio_rets['SV_Portfolio']['BN'][i]
        bg = portfolio_rets['SV_Portfolio']['BG'][i]
        factor_rets['SMB'].append((sv+sn+sg)/3 - (bv+bn+bg)/3)
        factor_rets['HML'].append((sv+bv)/2 - (sg+bg)/2)
        
        sr = portfolio_rets['RMW_Portfolio']['SR'][i]
        sw = portfolio_rets['RMW_Portfolio']['SW'][i]
        br = portfolio_rets['RMW_Portfolio']['BR'][i]
        bw = portfolio_rets['RMW_Portfolio']['BW'][i]
        factor_rets['RMW'].append((sr+br)/2 - (sw+bw)/2)
        
        sc = portfolio_rets['CMA_Portfolio']['SC'][i]
        sa = portfolio_rets['CMA_Portfolio']['SA'][i]
        bc = portfolio_rets['CMA_Portfolio']['BC'][i]
        ba = portfolio_rets['CMA_Portfolio']['BA'][i]
        factor_rets['CMA'].append((sc+bc)/2 - (sa+ba)/2)
        
        sh_at = portfolio_rets['AT_Portfolio']['SH'][i]
        sl_at = portfolio_rets['AT_Portfolio']['SL'][i]
        bh_at = portfolio_rets['AT_Portfolio']['BH'][i]
        bl_at = portfolio_rets['AT_Portfolio']['BL'][i]
        factor_rets['AT'].append((sh_at+bh_at)/2 - (sl_at+bl_at)/2)
        
        sh_sg = portfolio_rets['SG_Portfolio']['SH'][i]
        sl_sg = portfolio_rets['SG_Portfolio']['SL'][i]
        bh_sg = portfolio_rets['SG_Portfolio']['BH'][i]
        bl_sg = portfolio_rets['SG_Portfolio']['BL'][i]
        factor_rets['SG'].append((sh_sg+bh_sg)/2 - (sl_sg+bl_sg)/2)
        
        # 2. Dynamic factors: WML, ACC, MKT
        sw_m = sn_m = sl_m = bw_m = bn_m = bl_m = 0.0
        sw_w = sn_w = sl_w = bw_w = bn_w = bl_w = 0.0
        
        sc_a = sn_a = sa_a = bc_a = bn_a = ba_a = 0.0
        sc_aw = sn_aw = sa_aw = bc_aw = bn_aw = ba_aw = 0.0
        
        mkt_ret = None
        
        for r in m_data:
            try:
                mcap = float(r.get('lagged_mktcap', 0)) or 0.0
                ret = float(r.get('monthly_ret', 0)) or 0.0
            except ValueError: continue
            
            # WML (Size + Momentum)
            sz = r.get('Size_Label_Monthly_Any', '')
            mom = r.get('MOM_Label', '')
            
            if sz == 'S' and mom == 'W': sw_m += mcap*ret; sw_w += mcap
            elif sz == 'S' and mom == 'N': sn_m += mcap*ret; sn_w += mcap
            elif sz == 'S' and mom == 'L': sl_m += mcap*ret; sl_w += mcap
            elif sz == 'B' and mom == 'W': bw_m += mcap*ret; bw_w += mcap
            elif sz == 'B' and mom == 'N': bn_m += mcap*ret; bn_w += mcap
            elif sz == 'B' and mom == 'L': bl_m += mcap*ret; bl_w += mcap
            
            # ACC (Size + Accruals)
            acc = r.get('ACC_Label', '')
            if sz == 'S' and acc == 'C': sc_a += mcap*ret; sc_aw += mcap
            elif sz == 'S' and acc == 'N': sn_a += mcap*ret; sn_aw += mcap
            elif sz == 'S' and acc == 'A': sa_a += mcap*ret; sa_aw += mcap
            elif sz == 'B' and acc == 'C': bc_a += mcap*ret; bc_aw += mcap
            elif sz == 'B' and acc == 'N': bn_a += mcap*ret; bn_aw += mcap
            elif sz == 'B' and acc == 'A': ba_a += mcap*ret; ba_aw += mcap
        
        # MKT (from legacy finalMonthlyLabels_aman if present, else empty)
        # Assuming MKT data might not be directly in factor_label_may_26.csv
        # Actually it's simpler to append NaN and let the front end or NA handler display it
        
        sw_r = sw_m/sw_w if sw_w>0 else 0
        sl_r = sl_m/sl_w if sl_w>0 else 0
        bw_r = bw_m/bw_w if bw_w>0 else 0
        bl_r = bl_m/bl_w if bl_w>0 else 0
        factor_rets['WML'].append(((sw_r + bw_r)/2) - ((sl_r + bl_r)/2))
        
        sc_r = sc_a/sc_aw if sc_aw>0 else 0
        sa_r = sa_a/sa_aw if sa_aw>0 else 0
        bc_r = bc_a/bc_aw if bc_aw>0 else 0
        ba_r = ba_a/ba_aw if ba_aw>0 else 0
        factor_rets['ACC'].append(((sc_r + bc_r)/2) - ((sa_r + ba_r)/2))
        factor_rets['MKT'].append(float('nan'))
        
    # ==========================================
    # 2b. Write out the downloadable Factor Data CSVs
    # ==========================================
    print("Writing out updated downloadable CSV files (ff5.csv, etc)...")
    ff5_rows, bm_rows, op_rows, inv_rows, mom_rows = [], [], [], [], []
    for m in months:
        m_data = data_by_month[m]
        
        port_w = defaultdict(float)
        port_v = defaultdict(float)
        mkt = None
        
        for r in m_data:
            try:
                mcap = float(r.get('Size', r.get('lagged_mktcap', 0))) or 0.0
                ret = float(r.get('Monthly_Return', r.get('monthly_ret', 0))) or 0.0
            except ValueError: continue
            
            if r.get('nifty500') and mkt is None:
                try: mkt = float(r['nifty500'])
                except: pass
                
            sz = r.get('Size_Label', r.get('Size_Label_Monthly_Any', ''))
            bm = r.get('BM_Label', '')
            op = r.get('OpProf_Label', r.get('OP_Label', ''))
            inv = r.get('Inv_Label', r.get('INV_Label', ''))
            mom = r.get('Momentum_Label', r.get('MOM_Label', ''))
            
            if sz and bm:
                port_v[f'{sz}{bm}'] += mcap * ret
                port_w[f'{sz}{bm}'] += mcap
            if sz and op:
                port_v[f'{sz}{op}_OP'] += mcap * ret
                port_w[f'{sz}{op}_OP'] += mcap
            if sz and inv:
                port_v[f'{sz}{inv}_INV'] += mcap * ret
                port_w[f'{sz}{inv}_INV'] += mcap
            if sz and mom:
                port_v[f'{sz}{mom}_MOM'] += mcap * ret
                port_w[f'{sz}{mom}_MOM'] += mcap

        def pr(name): return port_v[name]/port_w[name] if port_w[name] > 0 else 0.0
        
        sv, sn, sg_p = pr('SV'), pr('SN'), pr('SG')
        bv, bn, bg_p = pr('BV'), pr('BN'), pr('BG')
        bm_rows.append([m, sv, sn, sg_p, bv, bn, bg_p])
        
        sr, sn_op, sw = pr('SR_OP'), pr('SN_OP'), pr('SW_OP')
        br, bn_op, bw = pr('BR_OP'), pr('BN_OP'), pr('BW_OP')
        op_rows.append([m, sr, sn_op, sw, br, bn_op, bw])
        
        sc, sn_inv, sa = pr('SC_INV'), pr('SN_INV'), pr('SA_INV')
        bc, bn_inv, ba = pr('BC_INV'), pr('BN_INV'), pr('BA_INV')
        inv_rows.append([m, sc, sn_inv, sa, bc, bn_inv, ba])
        
        sw_mom, sn_mom, sl_mom = pr('SW_MOM'), pr('SN_MOM'), pr('SL_MOM')
        bw_mom, bn_mom, bl_mom = pr('BW_MOM'), pr('BN_MOM'), pr('BL_MOM')
        mom_rows.append([m, sw_mom, sn_mom, sl_mom, bw_mom, bn_mom, bl_mom])
        
        smb = (sv+sn+sg_p)/3 - (bv+bn+bg_p)/3
        hml = (sv+bv)/2 - (sg_p+bg_p)/2
        rmw = (sr+br)/2 - (sw+bw)/2
        cma = (sc+bc)/2 - (sa+ba)/2
        wml = ((sw_mom + bw_mom)/2) - ((sl_mom + bl_mom)/2)
        
        ff5_rows.append([m, smb, hml, wml, rmw, cma, mkt if mkt is not None else '', ''])

    with open('Data/Factor_Data/ff5.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Month', 'SMB', 'HML', 'WML', 'RMW', 'CMA', 'MKT', 'Rf'])
        w.writerows(ff5_rows)
    with open('Data/Factor_Data/BM_Size.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Month', 'SV', 'SN', 'SG', 'BV', 'BN', 'BG'])
        w.writerows(bm_rows)
    with open('Data/Factor_Data/OP_Size.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Month', 'SR', 'SN', 'SW', 'BR', 'BN', 'BW'])
        w.writerows(op_rows)
    with open('Data/Factor_Data/INV_Size.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Month', 'SC', 'SN', 'SA', 'BC', 'BN', 'BA'])
        w.writerows(inv_rows)
    with open('Data/Factor_Data/MOM_Size.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Month', 'SW_mom', 'SN_mom', 'SL_mom', 'BW_mom', 'BN_mom', 'BL_mom'])
        w.writerows(mom_rows)

    print("Updating index.html...")
    with open('index.html', 'r') as f:
        html = f.read()
        
    # Replace Month Headers
    # Regex to find: May 2026<br /><span style="...">(Returns %)</span>
    # and replace the month text.
    html = re.sub(r'>\s*[A-Z][a-z]+ \d{4}\s*<br />', f'>{display_month}<br />', html)
    html = re.sub(r'>\s*[A-Z][a-z]+ \d{4}\s*<br', f'>{display_month}<br', html)
    
    # Helper to generate table rows for 2x3 tables
    def build_2x3_tbody(col_name, row_names):
        # row_names is a list of tuples: (Display Name, Portfolio Code)
        tbody = "<tbody>\n"
        for label, code in row_names:
            rets = portfolio_rets[col_name][code]
            r1 = calc_stats(rets, 1)
            r3 = calc_stats(rets, 3)
            r12 = calc_stats(rets, 12)
            tbody += f"  <tr>\n    <td>{label}</td>\n    {format_ret(r1)}\n    {format_ret(r3)}\n    {format_ret(r12)}\n  </tr>\n"
        tbody += "</tbody>"
        return tbody

    def replace_table(tab_marker, col_name, row_names, display_month_str):
        nonlocal html
        if tab_marker not in html:
            return
        parts = html.split(tab_marker)
        if len(parts) < 2: return
        # Find the first <tbody> and </tbody> after the marker
        tbody_start = parts[1].find('<tbody>')
        tbody_end = parts[1].find('</tbody>')
        if tbody_start == -1 or tbody_end == -1: return
        
        # Build the new html section
        new_tbody = build_2x3_tbody(col_name, row_names)
        
        # Replace the month headers inside the table header section
        # The header is between the marker and tbody_start
        header_sec = parts[1][:tbody_start]
        # Replace the month inside the header (e.g. May 2026<br)
        header_sec = re.sub(r'>\s*[A-Z][a-z]+ \d{4}\s*<br', f'>{display_month_str}<br', header_sec)
        
        parts[1] = header_sec + new_tbody + parts[1][tbody_end + 8:]
        html = parts[0] + tab_marker + parts[1]

    # 1. Update B/M Table
    bm_names = [('Small Value', 'SV'), ('Small Neutral', 'SN'), ('Small Growth', 'SG'),
                ('Big Value', 'BV'), ('Big Neutral', 'BN'), ('Big Growth', 'BG')]
    replace_table('<!-- Size and Book-to-Market Tab -->', "SV_Portfolio", bm_names, display_month)

    # 2. Update OP Table
    op_names = [('Small Robust', 'SR'), ('Small Neutral', 'SN'), ('Small Weak', 'SW'),
                ('Big Robust', 'BR'), ('Big Neutral', 'BN'), ('Big Weak', 'BW')]
    replace_table('<!-- Size and Operating Profitability Tab -->', "RMW_Portfolio", op_names, display_month)

    # 3. Update INV Table
    inv_names = [('Small Conservative', 'SC'), ('Small Neutral', 'SN'), ('Small Aggressive', 'SA'),
                 ('Big Conservative', 'BC'), ('Big Neutral', 'BN'), ('Big Aggressive', 'BA')]
    replace_table('<!-- Size and Investment Tab -->', "CMA_Portfolio", inv_names, display_month)
                  
    # 4. Factor Performance Summary
    def get_factor_tr(name, code, tooltip):
        rets = factor_rets[code]
        r1 = calc_stats(rets, 1)
        r3 = calc_stats(rets, 3)
        r12 = calc_stats(rets, 12)
        return f"""
                                    <tr>
                                        <td class="factor-name">
                                            <span class="factor-tooltip-trigger" tabindex="0"
                                                data-tooltip="{tooltip}">
                                                {name}
                                            </span>
                                        </td>
                                        {format_ret(r1)}
                                        {format_ret(r3)}
                                        {format_ret(r12)}
                                        <td>
                                            <a href="backtester.html?factor={code}" class="analyze-link">Analyze &rarr;</a>
                                        </td>
                                    </tr>"""
                                    
    # Find the summary table body and replace its rows
    summary_tbody = "<tbody>"
    summary_tbody += get_factor_tr("MKT (Market Premium)", "MKT", "MKT = Market Return minus Risk-Free Rate.") # Needs MKT calculation
    summary_tbody += get_factor_tr("SMB (Size)", "SMB", "SMB = Small Minus Big.")
    summary_tbody += get_factor_tr("HML (Value)", "HML", "HML = High Minus Low (Book-to-Market).")
    summary_tbody += get_factor_tr("RMW (Profitability)", "RMW", "RMW = Robust Minus Weak.")
    summary_tbody += get_factor_tr("CMA (Investment)", "CMA", "CMA = Conservative Minus Aggressive.")
    summary_tbody += get_factor_tr("AT (Asset Turnover)", "AT", "AT = Asset Turnover.")
    summary_tbody += get_factor_tr("SG (Sales Growth)", "SG", "SG = Sales Growth.")
    # Add WML, etc. if needed
    summary_tbody += "\n                                </tbody>"

    for f_code in ['SMB', 'HML', 'RMW', 'CMA', 'AT', 'SG', 'WML', 'ACC', 'MKT']:
        r1 = calc_stats(factor_rets[f_code], 1)
        r3 = calc_stats(factor_rets[f_code], 3)
        r12 = calc_stats(factor_rets[f_code], 12)
        
        search_str = f'href="backtester.html?factor={f_code}"'
        if search_str in html:
            parts = html.split(search_str)
            pre_str = parts[0]
            tr_start = pre_str.rfind('<tr>')
            if tr_start != -1:
                tr_content = pre_str[tr_start:]
                
                td_parts = tr_content.split('</td>')
                if len(td_parts) >= 4:
                    new_tr = td_parts[0] + '</td>\n                                        ' + \
                             f'{format_ret(r1)}\n                                        {format_ret(r3)}\n                                        {format_ret(r12)}\n                                        ' + \
                             '</td>'.join(td_parts[4:])
                    
                    parts[0] = pre_str[:tr_start] + new_tr
                    html = search_str.join(parts)

    # Downloads section zip update
    html = re.sub(r"downloadFile\(\s*'[^']*',\s*'factor_labels_all.csv'\s*\)", "downloadFile('Data/Downloads/factor_labels_all.zip', 'factor_labels_all.zip')", html)
    html = re.sub(r"downloadFile\(\s*'[^']*',\s*'factor_labels_top500.csv'\s*\)", "downloadFile('Data/Downloads/factor_labels_top500.zip', 'factor_labels_top500.zip')", html)
    html = re.sub(r"downloadFile\(\s*'[^']*',\s*'factor_labels_top300.csv'\s*\)", "downloadFile('Data/Downloads/factor_labels_top300.zip', 'factor_labels_top300.zip')", html)

    # Find the file size columns using regex (e.g., <td>890 KB</td> before the download button)
    # The structure is: <td>Monthly</td>\s*<td>.*?</td>\s*<td>\s*<button class="download-btn" onclick="\s*downloadFile\(\s*'Data/Downloads/factor_labels_all\.zip'
    html = re.sub(r"(<td>Monthly</td>\s*<td>)[^<]+(</td>\s*<td>\s*<button class=\"download-btn\" onclick=\"\s*downloadFile\(\s*'Data/Downloads/factor_labels_all\.zip')", r"\g<1>" + size_all + r"\g<2>", html)
    html = re.sub(r"(<td>Monthly</td>\s*<td>)[^<]+(</td>\s*<td>\s*<button class=\"download-btn\" onclick=\"\s*downloadFile\(\s*'Data/Downloads/factor_labels_top500\.zip')", r"\g<1>" + size_500 + r"\g<2>", html)
    html = re.sub(r"(<td>Monthly</td>\s*<td>)[^<]+(</td>\s*<td>\s*<button class=\"download-btn\" onclick=\"\s*downloadFile\(\s*'Data/Downloads/factor_labels_top300\.zip')", r"\g<1>" + size_300 + r"\g<2>", html)

    with open('index.html', 'w') as f:
        f.write(html)
        
    print("Update complete! Modified index.html and generated zip files.")

if __name__ == "__main__":
    main()
