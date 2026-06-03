import csv
import re

with open('factor_table.csv', 'r') as f:
    reader = csv.reader(f)
    lines = list(reader)

# skip header
results = {}
for row in lines[1:]:
    if len(row) >= 4:
        results[row[0]] = (row[1], row[2], row[3])

with open('index.html', 'r') as f:
    html = f.read()

def get_class(v):
    if v == '-': return ''
    try:
        val = float(v.strip('%'))
        return "positive" if val >= 0 else "negative"
    except:
        return ""

def format_val(v):
    if v == '-': return '-'
    try:
        val = float(v.strip('%'))
        sign = "+" if val > 0 else ""
        return f"{sign}{val:.2f}%"
    except:
        return v

for factor, (r1, r3, r12) in results.items():
    c1, c3, c12 = get_class(r1), get_class(r3), get_class(r12)
    f1, f3, f12 = format_val(r1), format_val(r3), format_val(r12)
    
    # special case for Rm-Rf since it has HTML
    if factor == 'Rm-Rf (Using Nifty 500)':
        f_name = 'Rm-Rf (Using Nifty 500)'
    else:
        f_name = factor
        
    pattern = r'(<td[^>]*>[\s\S]*?' + re.escape(f_name) + r'[\s\S]*?</td>\s*)<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>.*?</td>'
    replacement = r'\g<1>' + f'<td class="{c1}">{f1}</td>\n                                        <td class="{c3}">{f3}</td>\n                                        <td class="{c12}">{f12}</td>'
    html = re.sub(pattern, replacement, html, flags=re.DOTALL)

with open('index.html', 'w') as f:
    f.write(html)
