import crypto from "node:crypto";

const CACHE_TABLE = "backtest_cache";
const memoryCache = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) return null;
  return {
    restUrl: `${url.replace(/\/$/, "")}/rest/v1/${CACHE_TABLE}`,
    key,
  };
}

function isRemoteCacheEnabled() {
  return ["1", "true", "yes"].includes(
    String(process.env.BACKTEST_REMOTE_CACHE || "").toLowerCase(),
  );
}

export function createBacktestCacheKey(input) {
  return crypto.createHash("sha256").update(stableStringify(input)).digest("hex");
}

export async function readCachedBacktest(cacheKey) {
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && memoryHit.expiresAt > Date.now()) {
    return { source: "memory", result: memoryHit.result };
  }

  const config = isRemoteCacheEnabled() ? getSupabaseConfig() : null;
  if (!config) return null;

  try {
    const response = await fetch(
      `${config.restUrl}?cache_key=eq.${encodeURIComponent(
        cacheKey,
      )}&select=result,expires_at&limit=1`,
      {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
        },
      },
    );

    if (!response.ok) return null;
    const rows = await response.json();
    const row = rows?.[0];
    if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) {
      return null;
    }

    memoryCache.set(cacheKey, {
      result: row.result,
      expiresAt: new Date(row.expires_at).getTime(),
    });
    return { source: "supabase", result: row.result };
  } catch {
    return null;
  }
}

export async function writeCachedBacktest(cacheKey, input, result) {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  memoryCache.set(cacheKey, { result, expiresAt });

  const config = isRemoteCacheEnabled() ? getSupabaseConfig() : null;
  if (!config) return;

  try {
    await fetch(config.restUrl, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        cache_key: cacheKey,
        input,
        result,
        expires_at: new Date(expiresAt).toISOString(),
      }),
    });
  } catch {
    // Supabase caching is opportunistic; local server cache still keeps the app fast.
  }
}
