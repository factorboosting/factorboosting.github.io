// Cloudflare Pages Function for /api/backtest (same-origin with the static site).
//
// Thin route: GET returns universe metadata (and warms Postgres for the requested
// universe); POST runs the backtest. The heavy aggregation lives in Postgres
// (run_backtest_legs RPC); composition lives in ../../src/worker/backtest-core.js.
// Results are cached in Cloudflare KV (binding BACKTEST_KV) keyed by a stable hash
// of the request, so identical re-runs return from the edge in single-digit ms.
//
// The response envelope matches the legacy Next.js route (app/api/backtest/route.js)
// exactly — { ok, ... } on success, { ok:false, error } on failure — so the frontend
// needs no changes.

import {
  createBacktestCacheKey,
  getUniverseMeta,
  normalizeUniverse,
  runBacktest,
  warmUniverse,
} from "../../src/worker/backtest-core.js";

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const { searchParams } = new URL(request.url);
    const universe = normalizeUniverse(searchParams.get("universe"));
    const meta = await getUniverseMeta(env, universe);
    if (searchParams.get("warm") === "1") {
      await warmUniverse(env, universe);
      return json({ ok: true, warmed: true, ...meta }, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } });
    }
    return json({ ok: true, ...meta }, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Metadata failed" },
      { status: 500 },
    );
  }
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    const input = await request.json();
    input.universe = normalizeUniverse(input.universe);

    const cacheKey = await createBacktestCacheKey(input);
    const kv = env.BACKTEST_KV;

    if (kv) {
      const cached = await kv.get(cacheKey, "json");
      if (cached) {
        return json({ ok: true, cache: "kv", cacheKey, ...cached });
      }
    }

    const result = await runBacktest(env, input);

    if (kv) {
      // Don't block the response on the cache write.
      waitUntil(kv.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS }));
    }

    return json({ ok: true, cache: "server", cacheKey, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 400 },
    );
  }
}
