import os
import gzip
import urllib.request
import urllib.error
from urllib.parse import quote

# The big CSV files that are stored in Supabase Storage and gitignored
FILES_TO_DOWNLOAD = [
    "Data/Factor_Data/finalMonthlyLabels_aman.csv",
    "Data/Updated_Factor_Data/total_universe/21_stock_level_monthly.csv",
    "Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv",
    "Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv"
]

def load_env():
    env_vars = {}
    env_paths = [".env.local", ".env"]
    for env_path in env_paths:
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if key not in env_vars:
                            env_vars[key] = val
    return env_vars

def main():
    env = load_env()
    supabase_url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_KEY")
    bucket = env.get("SUPABASE_STORAGE_BUCKET", "factor-data")

    if not supabase_url or not supabase_key:
        print("Error: Missing SUPABASE_URL or SUPABASE_KEY in .env.local")
        print("Please ensure your .env.local file contains these credentials.")
        return

    # Normalize url (remove trailing slash)
    supabase_url = supabase_url.rstrip('/')
    base_url = f"{supabase_url}/storage/v1/object/{bucket}"

    for file_path in FILES_TO_DOWNLOAD:
        # Storage object paths drop the leading "Data/"
        if file_path.startswith("Data/"):
            object_path = file_path[5:]
        else:
            object_path = file_path
            
        encoded_path = quote(object_path)
        print(f"\nDownloading {file_path} ...")
        
        # Ensure directories exist
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        # Try gzip version first (.gz), then plain
        candidates = [f"{encoded_path}.gz", encoded_path]
        
        success = False
        for candidate in candidates:
            url = f"{base_url}/{candidate}"
            req = urllib.request.Request(url, headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}"
            })
            
            try:
                with urllib.request.urlopen(req) as response:
                    data = response.read()
                    
                    if candidate.endswith('.gz'):
                        print("  Decompressing .gz data...")
                        data = gzip.decompress(data)
                        
                    with open(file_path, 'wb') as f:
                        f.write(data)
                        
                    print(f"  Successfully saved {len(data) / 1024 / 1024:.2f} MB to {file_path}")
                    success = True
                    break
            except urllib.error.HTTPError as e:
                # 404 is expected if the object doesn't exist under this candidate name
                if e.code != 404:
                    print(f"  HTTP Error {e.code} for {candidate}")
            except Exception as e:
                print(f"  Error: {e}")
                
        if not success:
            print(f"  Failed to download {file_path}. It may not exist in the bucket.")

if __name__ == "__main__":
    main()
