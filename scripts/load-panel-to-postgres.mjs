// Loads the factor panel + benchmark + risk-free + company-name tables into
// Supabase Postgres (migrations 003/004 must be applied first).
//
// It reads the SAME derived snapshots the JS engine uses, so the loaded numbers
// match the legacy engine bit-for-bit (the correctness oracle relies on this):
//   - Data/Derived/backtest-runtime.json  -> manifest + benchmarks + rf + names
//   - Data/Derived/universe-<u>-<chunk>.json (per-year panel chunks)
//
// Chunks are read locally if present; otherwise, set PANEL_SOURCE_SUPABASE_URL +
// PANEL_SOURCE_SERVICE_ROLE_KEY to pull the gzipped chunks from the OLD project's
// Storage bucket (handy when migrating to the new Mumbai project).
//
// Writes go through PostgREST batched upserts using the NEW project's:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (same vars the Worker uses)
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/load-panel-to-postgres.mjs
//   (optional) PANEL_SOURCE_SUPABASE_URL=... PANEL_SOURCE_SERVICE_ROLE_KEY=... to pull chunks from old Storage

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const RUNTIME_FILE = "Data/Derived/backtest-runtime.json";
const STORAGE_BUCKET = process.env.PANEL_SOURCE_STORAGE_BUCKET || "factor-data";
const PANEL_BATCH = Number.parseInt(process.env.PANEL_BATCH || "5000", 10);
const SMALL_BATCH = 1000;
const PANEL_UNIVERSES = new Set(
  (process.env.PANEL_UNIVERSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const REPLACE_UNIVERSES = new Set(
  (process.env.PANEL_REPLACE_UNIVERSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

// SNAPSHOT_COLUMNS name -> factor_panel column name.
const COLUMN_MAP = {
  Co_Code: "co_code",
  _ret: "monthly_ret",
  _size: "mktcap",
  prev_Size: "prev_mktcap",
  Size_Label: "size_label",
  Size_Label_Yearly: "size_label_yearly",
  Size_Label_Monthly: "size_label_monthly",
  Size_Label_OP: "size_label_op",
  Size_Label_INV: "size_label_inv",
  Size_Label_AT: "size_label_at",
  Size_Label_SG: "size_label_sg",
  Size_Label_ACC: "size_label_acc",
  MOM_Label: "mom_label",
  BM_Label: "bm_label",
  OP_Label: "op_label",
  INV_Label: "inv_label",
  RMW_Portfolio: "rmw_portfolio",
  CMA_Portfolio: "cma_portfolio",
  AT_Label: "at_label",
  SG_Label: "sg_label",
  ACC_Label: "acc_label",
  VOL_Label: "vol_label",
  STR_Label: "str_label",
};
const NUMERIC_DB_COLS = new Set(["monthly_ret", "mktcap", "prev_mktcap"]);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}.`);
    process.exit(1);
  }
  return value;
}

const TARGET_URL = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const TARGET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || requireEnv("SUPABASE_KEY");

const SOURCE_URL = (process.env.PANEL_SOURCE_SUPABASE_URL || "").replace(/\/$/, "");
const SOURCE_KEY = process.env.PANEL_SOURCE_SERVICE_ROLE_KEY || "";

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toLabel(value) {
  return value === undefined || value === null ? "" : String(value);
}

async function readChunk(file) {
  const localPath = path.join(process.cwd(), file);
  if (existsSync(localPath)) {
    return JSON.parse(readFileSync(localPath, "utf8"));
  }
  if (!SOURCE_URL || !SOURCE_KEY) {
    throw new Error(
      `Chunk ${file} not found locally and PANEL_SOURCE_SUPABASE_URL/KEY not set. ` +
        `Run \`npm run data:derive\` (needs the source CSVs) or point at the old project's Storage.`,
    );
  }
  const objectPath = file.replace(/^Data[\\/]/, "");
  const candidates = [`${objectPath}.gz`, objectPath];
  const failures = [];
  for (const candidate of candidates) {
    const url = `${SOURCE_URL}/storage/v1/object/${encodeURIComponent(STORAGE_BUCKET)}/${candidate
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
    const res = await fetch(url, {
      headers: { apikey: SOURCE_KEY, Authorization: `Bearer ${SOURCE_KEY}` },
    });
    if (!res.ok) {
      failures.push(`${candidate}: ${res.status}`);
      continue;
    }
    const text = candidate.endsWith(".gz")
      ? gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")
      : await res.text();
    return JSON.parse(text);
  }
  throw new Error(`Failed to download ${objectPath} from source Storage (${failures.join(", ")}).`);
}

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  const url = `${TARGET_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  let res;
  let lastErr;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: TARGET_KEY,
          Authorization: `Bearer ${TARGET_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      await new Promise(r => setTimeout(r, 500)); // Cool down
      break;
    } catch (e) {
      lastErr = e;
      if (attempt === 20) throw e;
      console.log(`  Retry ${attempt} for ${table}...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upsert into ${table} failed (${res.status}): ${body.slice(0, 500)}`);
  }
}

async function deleteUniverseRange(universe, firstMonth, lastMonth) {
  const params = [
    `universe=eq.${encodeURIComponent(universe)}`,
    `month=gte.${encodeURIComponent(firstMonth)}`,
    `month=lte.${encodeURIComponent(lastMonth)}`,
  ].join("&");
  const url = `${TARGET_URL}/rest/v1/factor_panel?${params}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: TARGET_KEY,
      Authorization: `Bearer ${TARGET_KEY}`,
      Prefer: "return=minimal",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Delete factor_panel[${universe} ${firstMonth}..${lastMonth}] failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }
}

async function deleteUniverse(universe, chunks) {
  if (!chunks?.length) {
    await deleteUniverseRange(universe, "0000-00", "9999-99");
    return;
  }
  for (const chunk of chunks) {
    await deleteUniverseRange(universe, chunk.firstMonth, chunk.lastMonth);
    process.stdout.write(`\r  deleted ${universe}: through ${chunk.lastMonth}   `);
  }
  process.stdout.write("\n");
}

async function upsertBatched(table, rows, onConflict, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    await upsert(table, rows.slice(i, i + batchSize), onConflict);
    process.stdout.write(
      `\r  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}   `,
    );
  }
  process.stdout.write("\n");
}

function chunkToRows(universe, chunk) {
  const { columns, monthGroups } = chunk;
  if (!Array.isArray(columns) || !monthGroups) return [];
  const dbCols = columns.map((c) => COLUMN_MAP[c] || null);
  const rows = [];
  for (const [month, group] of Object.entries(monthGroups)) {
    for (const values of group) {
      const row = { universe, month };
      for (let i = 0; i < columns.length; i++) {
        const dbCol = dbCols[i];
        if (!dbCol) continue;
        if (dbCol === "co_code") {
          row.co_code = Number.parseInt(values[i], 10);
        } else if (NUMERIC_DB_COLS.has(dbCol)) {
          row[dbCol] = toNumberOrNull(values[i]);
        } else {
          row[dbCol] = toLabel(values[i]);
        }
      }
      if (!Number.isInteger(row.co_code)) continue;
      rows.push(row);
    }
  }
  return rows;
}

async function main() {
  const runtimePath = path.join(process.cwd(), RUNTIME_FILE);
  if (!existsSync(runtimePath)) {
    throw new Error(`${RUNTIME_FILE} not found. Run \`npm run data:derive\` first.`);
  }
  const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));

  console.log(`Target: ${TARGET_URL}`);
  console.log(
    SOURCE_URL ? `Chunk fallback Storage: ${SOURCE_URL}` : "Chunk source: local Data/Derived only",
  );

  // 1. benchmark_monthly
  const benchRows = Object.entries(runtime.benchmarkByMonth || {}).map(([month, b]) => ({
    month,
    nifty50: b.nifty50 ?? null,
    nifty500: b.nifty500 ?? null,
  }));
  console.log(`\nLoading benchmark_monthly (${benchRows.length} months)`);
  await upsertBatched("benchmark_monthly", benchRows, "month", SMALL_BATCH);

  // 2. rf_monthly
  const rfRows = Object.entries(runtime.rfData || {}).map(([month, rf]) => ({
    month,
    rf: rf ?? null,
  }));
  console.log(`Loading rf_monthly (${rfRows.length} months)`);
  await upsertBatched("rf_monthly", rfRows, "month", SMALL_BATCH);

  // 3. company_names
  const nameRows = Object.entries(runtime.names || {})
    .map(([code, name]) => ({ co_code: Number.parseInt(code, 10), co_name: String(name) }))
    .filter((r) => Number.isInteger(r.co_code));
  console.log(`Loading company_names (${nameRows.length} firms)`);
  await upsertBatched("company_names", nameRows, "co_code", SMALL_BATCH);

  // 4. factor_panel, per universe, per chunk
  for (const [universe, meta] of Object.entries(runtime.universes || {})) {
    if (PANEL_UNIVERSES.size && !PANEL_UNIVERSES.has(universe)) continue;
    const chunks = meta.chunks || [];
    console.log(
      `\nLoading factor_panel[${universe}] (${meta.rowCount?.toLocaleString?.() || "?"} rows across ${chunks.length} chunks)`,
    );
    if (REPLACE_UNIVERSES.has(universe)) {
      console.log(`  deleting existing factor_panel[${universe}] rows first`);
      await deleteUniverse(universe, chunks);
    }
    let loaded = 0;
    let chunkIndex = 0;
    const delay = ms => new Promise(res => setTimeout(res, ms));
    for (const chunkMeta of chunks) {
      const chunk = await readChunk(chunkMeta.file);
      const rows = chunkToRows(universe, chunk);
      await upsertBatched("factor_panel", rows, "universe,month,co_code", PANEL_BATCH);
      await delay(1000); // Wait 1 second between chunks to cool down Supabase
      loaded += rows.length;
      chunkIndex++;
    }
    console.log(`  -> ${universe}: ${loaded.toLocaleString()} rows`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\n" + (err?.stack || err?.message || String(err)));
  process.exit(1);
});
