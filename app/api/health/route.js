import { NextResponse } from "next/server";
import {
  getBacktestRuntimeFiles,
  getDataSourceMode,
  readDataFile,
} from "../../../src/server/data-source.js";
import { UNIVERSE_FILES } from "../../../src/server/factor-config.js";

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

export async function GET() {
  const files = getBacktestRuntimeFiles(UNIVERSE_FILES);
  const status = {
    ok: false,
    dataSource: getDataSourceMode(),
    supabaseUrlConfigured: Boolean(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    serviceKeyConfigured: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
    ),
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "factor-data",
    checks: {},
  };

  for (const file of files) {
    try {
      const text = await readDataFile(file);
      status.checks[file] = {
        ok: true,
        bytes: Buffer.byteLength(text, "utf8"),
        firstLine: text.split(/\r?\n/, 1)[0]?.slice(0, 80) || "",
      };
    } catch (error) {
      status.checks[file] = {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown data read error",
      };
    }
  }

  status.ok = Object.values(status.checks).every((check) => check.ok);
  return json(status, { status: status.ok ? 200 : 500 });
}
