import pandas as pd
import numpy as np

csv_path = "Data/Factor_Data/ff5.csv"
df = pd.read_csv(csv_path)

# Replace 0.0 with NaN for Rf
df['Rf'] = df['Rf'].replace(0.0, np.nan)

# Forward fill and then backward fill to handle all missing values
df['Rf'] = df['Rf'].ffill().bfill()

df.to_csv(csv_path, index=False)
print("Successfully filled missing values in Rf.")
