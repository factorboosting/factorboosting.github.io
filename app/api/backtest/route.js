import { NextResponse } from "next/server";
import {
  computeBacktest,
  getUniverseMeta,
  normalizeUniverse,
} from "../../../src/server/backtest-engine.js";
import {
  createBacktestCacheKey,
  readCachedBacktest,
  writeCachedBacktest,
} from "../../../src/server/supabase-cache.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(data, init = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const universe = normalizeUniverse(searchParams.get("universe"));
    const meta = await getUniverseMeta(universe);
    if (searchParams.get("warm") === "1") {
      return json({ ok: true, warmed: false, warmupSkipped: true, ...meta });
    }
    return json({ ok: true, ...meta });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Metadata failed" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const input = await request.json();
    input.universe = normalizeUniverse(input.universe);

    const cacheKey = createBacktestCacheKey(input);
    const cached = await readCachedBacktest(cacheKey);
    if (cached) {
      return json({ ok: true, cache: cached.source, cacheKey, ...cached.result });
    }

    const result = await computeBacktest(input);
    await writeCachedBacktest(cacheKey, input, result);

    return json({ ok: true, cache: "server", cacheKey, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 400 },
    );
  }
}
