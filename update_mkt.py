import csv
import re

data = {}
with open('Data_Factor_Data_ff5.csv', 'r') as f:
    for row in csv.DictReader(f):
        if row['Month'] and row['MKT']:
            data[row['Month']] = float(row['MKT'])

months = sorted(list(data.keys()))
latest = '2026-04'
last_3 = ['2026-02', '2026-03', '2026-04']
last_12 = ['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']

def calc_comp(m_list):
    comp = 1.0
    for m in m_list:
        comp *= (1.0 + data[m]/100.0)
    return (comp - 1.0) * 100.0

r_1m = data[latest]
r_3m = calc_comp(last_3)
r_12m = calc_comp(last_12)

def format_val(val):
    sign = "+" if val > 0 else ""
    return f"{sign}{val:.2f}%"

def get_class(val):
    return "positive" if val >= 0 else "negative"

c_1m, c_3m, c_12m = get_class(r_1m), get_class(r_3m), get_class(r_12m)
f_1m, f_3m, f_12m = format_val(r_1m), format_val(r_3m), format_val(r_12m)

# 1. Update factor_table.csv
with open('factor_table.csv', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.startswith('Rm-Rf'):
        lines[i] = f"Rm-Rf,{r_1m:.2f},{r_3m:.2f},{r_12m:.2f}\n"

with open('factor_table.csv', 'w') as f:
    f.writelines(lines)

# 2. Update index.html
with open('index.html', 'r') as f:
    html = f.read()

label = 'Rm-Rf (Using Nifty 500)'
pattern = r'(<td[^>]*>[\s\S]*?' + re.escape(label) + r'[\s\S]*?</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
replacement = r'\g<1>' + f'<td class="{c_1m}">{f_1m}</td>\n                                        <td class="{c_3m}">{f_3m}</td>\n                                        <td class="{c_12m}">{f_12m}</td>'

html = re.sub(pattern, replacement, html, flags=re.DOTALL)

with open('index.html', 'w') as f:
    f.write(html)

print(f"Updated Rm-Rf: 1m={f_1m}, 3m={f_3m}, 12m={f_12m}")
