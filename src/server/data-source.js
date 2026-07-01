import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const DATA_ROOT = path.join(process.cwd(), "Data");
const DEFAULT_BUCKET = "factor-data";
const remoteFileCache = new Map();

export const BACKTEST_RUNTIME_FILE = "Data/Derived/backtest-runtime.json";
export const LEGACY_BENCHMARK_SOURCE_FILE =
  "Data/Factor_Data/company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv";
export const NIFTY_TOTAL_RETURN_SOURCE_FILE = "Data/NIFTY Total Returns Historical Data.csv";
export const NIFTY_50_SOURCE_FILE = "Data/Nifty 50 Historical Data.csv";
export const NIFTY_500_SOURCE_FILE = "Data/Nifty 500 Historical Data.csv";
export const RISK_FREE_SOURCE_FILE = "Data/Factor_Data/ff5.csv";

export function getBacktestUniverseSnapshotFile(universe) {
  return `Data/Derived/universe-${universe}.json`;
}

export function getBacktestUniverseChunkFile(universe, chunkId) {
  return `Data/Derived/universe-${universe}-${chunkId}.json`;
}

function getSupabaseStorageConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

  if (!url || !key) return null;
  return {
    bucket,
    key,
    storageUrl: `${url.replace(/\/$/, "")}/storage/v1/object`,
  };
}

function toDataRelativePath(relativePath) {
  return relativePath.replace(/^Data[\\/]/, "");
}

function encodeObjectPath(objectPath) {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function readLocalDataFile(relativePath) {
  return readFile(path.join(DATA_ROOT, toDataRelativePath(relativePath)), "utf8");
}

async function readSupabaseStorageFile(relativePath) {
  const config = getSupabaseStorageConfig();
  if (!config) {
    throw new Error(
      "Supabase Storage is selected but SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured.",
    );
  }

  const objectPath = toDataRelativePath(relativePath);
  const preferGzip =
    objectPath.endsWith(".csv") || objectPath.startsWith("Derived/universe-");
  const candidates = preferGzip
    ? [`${objectPath}.gz`, objectPath]
    : [objectPath, `${objectPath}.gz`];
  const cacheKey = `${config.bucket}/${objectPath}`;
  if (remoteFileCache.has(cacheKey)) return remoteFileCache.get(cacheKey);

  const failures = [];
  for (const candidate of candidates) {
    const response = await fetch(
      `${config.storageUrl}/${encodeURIComponent(config.bucket)}/${encodeObjectPath(
        candidate,
      )}`,
      {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
        },
      },
    );

    if (!response.ok) {
      failures.push(`${candidate}: ${response.status}`);
      continue;
    }

    const text = candidate.endsWith(".gz")
      ? gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")
      : await response.text();
    remoteFileCache.set(cacheKey, text);
    return text;
  }

  throw new Error(
    `Failed to download ${objectPath} from Supabase Storage (${failures.join(", ")}).`,
  );
}

export function getDataSourceMode() {
  const configuredMode = process.env.DATA_SOURCE;
  if (configuredMode) return configuredMode;
  return getSupabaseStorageConfig() ? "supabase-storage" : "local";
}

export async function readDataFile(relativePath) {
  if (getDataSourceMode() === "supabase-storage") {
    return readSupabaseStorageFile(relativePath);
  }
  try {
    return await readLocalDataFile(relativePath);
  } catch (error) {
    if (error?.code === "ENOENT" && getSupabaseStorageConfig()) {
      return readSupabaseStorageFile(relativePath);
    }
    throw error;
  }
}

export async function readBundledDataFile(relativePath) {
  return readLocalDataFile(relativePath);
}

export async function createStorageSignedUrl(relativePath, expiresIn = 300) {
  const config = getSupabaseStorageConfig();
  if (!config) return null;

  const objectPath = toDataRelativePath(relativePath);
  const response = await fetch(
    `${config.storageUrl}/sign/${encodeURIComponent(
      config.bucket,
    )}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    },
  );

  if (!response.ok) return null;
  const payload = await response.json();
  const signedPath = payload.signedURL || payload.signedUrl;
  if (!signedPath) return null;
  if (signedPath.startsWith("http")) return signedPath;

  const baseUrl = config.storageUrl.replace(/\/object$/, "");
  return `${baseUrl}${signedPath}`;
}

export function getBacktestDataFiles(universeFiles) {
  return [
    BACKTEST_RUNTIME_FILE,
    ...Object.keys(universeFiles).map((universe) =>
      getBacktestUniverseSnapshotFile(universe),
    ),
    RISK_FREE_SOURCE_FILE,
    LEGACY_BENCHMARK_SOURCE_FILE,
    NIFTY_TOTAL_RETURN_SOURCE_FILE,
    NIFTY_50_SOURCE_FILE,
    NIFTY_500_SOURCE_FILE,
    ...Object.values(universeFiles),
  ];
}

export function getBacktestRuntimeFiles(universeFiles) {
  return [BACKTEST_RUNTIME_FILE];
}
