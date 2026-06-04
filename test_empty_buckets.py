import csv
import pandas as pd

data = []
with open('Data/Factor_Data/finalMonthlyLabels_aman.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['Size_Label'] and row['Monthly_Return']:
            data.append(row)

df = pd.DataFrame(data)
df['Month'] = pd.to_datetime(df['Month'])
df = df[df['Month'] >= '2003-10-01']

for m in sorted(df['Month'].unique()):
    m_df = df[df['Month'] == m]
    sw = m_df[(m_df['Size_Label'] == 'S') & (m_df['Momentum_Label'] == 'W')]
    if len(sw) < 5:
        print(f"{m.strftime('%Y-%m')}: Small Winners = {len(sw)}")
