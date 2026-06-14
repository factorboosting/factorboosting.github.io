import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  BACKTEST_RUNTIME_FILE,
  LEGACY_BENCHMARK_SOURCE_FILE,
  RISK_FREE_SOURCE_FILE,
} from "../src/server/data-source.js";
import { UNIVERSE_FILES } from "../src/server/factor-config.js";

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

const bucket = process.env.SUPABASE_STORAGE_BUCKET || "factor-data";
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const UPLOAD_UNIVERSES = new Set(
  (process.env.UPLOAD_UNIVERSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Put them in your shell env or .env.local before running this script.",
  );
  process.exit(1);
}

const root = process.cwd();
const storageBase = `${supabaseUrl.replace(/\/$/, "")}/storage/v1`;

function toDataRelativePath(relativePath) {
  return relativePath.replace(/^Data[\\/]/, "");
}

function encodeObjectPath(objectPath) {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function ensureBucket() {
  const response = await fetch(`${storageBase}/bucket`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
    }),
  });

  const body = await response.text();
  if (
    response.ok ||
    response.status === 409 ||
    (response.status === 400 && body.includes('"statusCode":"409"'))
  ) {
    return;
  }
  throw new Error(`Failed to create bucket ${bucket}: ${response.status} ${body}`);
}

async function uploadFile(relativePath) {
  const objectPath = toDataRelativePath(relativePath);
  const absolutePath = path.join(root, relativePath);
  const fileStat = await stat(absolutePath);
  // Gzip (to a `.gz` object) only when necessary: the per-year panel chunks — the
  // loader reads them back, trying `.gz` first — and any file over Storage's ~50 MB
  // free-tier cap (e.g. finalMonthlyLabels_aman.csv, ~61 MB). Everything else is
  // stored PLAIN, because Supabase strips Content-Encoding: a gzipped object would
  // download as opaque bytes. /api/download serves plain CSVs directly and falls
  // back to the `.gz` object (saved as `<file>.gz`) for the oversized ones.
  const STORAGE_PLAIN_MAX_BYTES = 49 * 1024 * 1024;
  const shouldGzip =
    objectPath.startsWith("Derived/universe-") ||
    fileStat.size >= STORAGE_PLAIN_MAX_BYTES;
  const uploadPath = shouldGzip ? `${objectPath}.gz` : objectPath;
  const body = shouldGzip
    ? gzipSync(await readFile(absolutePath), { level: 9 })
    : createReadStream(absolutePath);
  const contentLength = shouldGzip ? body.length : fileStat.size;
  const contentType = shouldGzip ? "application/gzip" : "text/csv; charset=utf-8";

  const response = await fetch(
    `${storageBase}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(
      uploadPath,
    )}`,
    {
      method: "POST",
      duplex: shouldGzip ? undefined : "half",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
        "x-upsert": "true",
      },
      body,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to upload ${relativePath}: ${response.status} ${body}`);
  }

  console.log(
    `Uploaded ${relativePath} -> ${bucket}/${uploadPath} (${(
      fileStat.size /
      1024 /
      1024
    ).toFixed(1)} MB${shouldGzip ? `, gz ${(contentLength / 1024 / 1024).toFixed(1)} MB` : ""})`,
  );
}

await import("./generate-backtest-derived.mjs");

await ensureBucket();

function getUploadFiles() {
  const runtime = JSON.parse(
    readFileSync(path.join(process.cwd(), BACKTEST_RUNTIME_FILE), "utf8"),
  );
  const selectedUniverses = Object.entries(runtime.universes || {}).filter(
    ([universe]) => !UPLOAD_UNIVERSES.size || UPLOAD_UNIVERSES.has(universe),
  );
  const chunkFiles = selectedUniverses.flatMap(([, universe]) =>
    (universe.chunks || []).map((chunk) => chunk.file),
  );
  const universeFiles = Object.entries(UNIVERSE_FILES)
    .filter(([universe]) => !UPLOAD_UNIVERSES.size || UPLOAD_UNIVERSES.has(universe))
    .map(([, file]) => file);

  if (UPLOAD_UNIVERSES.size) {
    return [BACKTEST_RUNTIME_FILE, ...chunkFiles, ...universeFiles];
  }

  return [
    BACKTEST_RUNTIME_FILE,
    ...chunkFiles,
    RISK_FREE_SOURCE_FILE,
    LEGACY_BENCHMARK_SOURCE_FILE,
    // Big downloadable CSVs served via /api/download (allowlisted in
    // functions/api/download.js). Stored plain; the frontend links to signed URLs.
    "Data/Factor_Data/finalMonthlyLabels_aman.csv",
    ...universeFiles,
  ];
}

for (const file of getUploadFiles()) {
  await uploadFile(file);
}

console.log("Backtester data upload complete.");
