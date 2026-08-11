import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  BACKTEST_RUNTIME_FILE,
  LEGACY_BENCHMARK_SOURCE_FILE,
  NIFTY_50_SOURCE_FILE,
  NIFTY_500_SOURCE_FILE,
  NIFTY_TOTAL_RETURN_SOURCE_FILE,
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
const SKIP_DERIVE = ["1", "true", "yes"].includes(
  String(process.env.SKIP_DERIVE || "").toLowerCase(),
);
const UPLOAD_DERIVED_ONLY = ["1", "true", "yes"].includes(
  String(process.env.UPLOAD_DERIVED_ONLY || "").toLowerCase(),
);

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Put them in your shell env or .env.local before running this script.",
  );
  process.exit(1);
}

const root = process.cwd();
const storageBase = `${supabaseUrl.replace(/\/$/, "")}/storage/v1`;
const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;
const RESUMABLE_UPLOAD_MIN_BYTES = 49 * 1024 * 1024;
const PART_UPLOAD_BYTES = 45 * 1024 * 1024;

function toDataRelativePath(relativePath) {
  return relativePath.replace(/^Data[\\/]/, "");
}

function encodeObjectPath(objectPath) {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getResumableEndpoint() {
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname.endsWith(".supabase.co")) {
    const projectRef = parsed.hostname.split(".")[0];
    return `${parsed.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

function encodeTusMetadataValue(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function buildTusMetadata(uploadPath, contentType) {
  return [
    ["bucketName", bucket],
    ["objectName", uploadPath],
    ["contentType", contentType],
    ["cacheControl", "3600"],
  ]
    .map(([key, value]) => `${key} ${encodeTusMetadataValue(value)}`)
    .join(",");
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

async function uploadResumable(uploadPath, body, contentType) {
  const endpoint = getResumableEndpoint();
  const createResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(body.length),
      "Upload-Metadata": buildTusMetadata(uploadPath, contentType),
      "x-upsert": "true",
    },
  });

  if (!createResponse.ok) {
    const errorBody = await createResponse.text().catch(() => "");
    throw new Error(
      `Failed to start resumable upload for ${uploadPath}: ${createResponse.status} ${errorBody}`,
    );
  }

  const location = createResponse.headers.get("location");
  if (!location) throw new Error(`Resumable upload for ${uploadPath} did not return a Location.`);

  const uploadUrl = new URL(location, endpoint).toString();
  let offset = 0;
  while (offset < body.length) {
    const end = Math.min(offset + RESUMABLE_CHUNK_SIZE, body.length);
    const chunk = body.subarray(offset, end);
    const patchResponse = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
      },
      body: chunk,
    });

    if (!patchResponse.ok) {
      const errorBody = await patchResponse.text().catch(() => "");
      throw new Error(
        `Resumable upload failed for ${uploadPath} at ${offset}: ${patchResponse.status} ${errorBody}`,
      );
    }

    const nextOffset = Number.parseInt(
      patchResponse.headers.get("upload-offset") || String(end),
      10,
    );
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      throw new Error(`Resumable upload stalled for ${uploadPath} at ${offset}.`);
    }
    offset = nextOffset;
    process.stdout.write(
      `\rUploaded ${uploadPath}: ${((offset / body.length) * 100).toFixed(1)}%   `,
    );
  }
  process.stdout.write("\n");
}

function getPartPath(uploadPath, index) {
  return `${uploadPath}.part${String(index).padStart(3, "0")}`;
}

async function uploadPart(uploadPath, body, contentType) {
  const response = await fetch(
    `${storageBase}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(uploadPath)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
        "Content-Length": String(body.length),
        "x-upsert": "true",
      },
      body,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to upload ${uploadPath}: ${response.status} ${errorBody}`);
  }
}

async function uploadPartitioned(uploadPath, body, contentType) {
  let partIndex = 0;
  for (let offset = 0; offset < body.length; offset += PART_UPLOAD_BYTES) {
    const partPath = getPartPath(uploadPath, partIndex);
    const part = body.subarray(offset, Math.min(offset + PART_UPLOAD_BYTES, body.length));
    await uploadPart(partPath, part, contentType);
    partIndex++;
    process.stdout.write(
      `\rUploaded ${uploadPath} in ${partIndex} part${partIndex === 1 ? "" : "s"}   `,
    );
  }
  process.stdout.write("\n");
  return partIndex;
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

  if (shouldGzip && contentLength >= RESUMABLE_UPLOAD_MIN_BYTES) {
    let partCount = 0;
    try {
      await uploadResumable(uploadPath, body, contentType);
    } catch (err) {
      const message = err?.message || String(err);
      if (!message.includes("413") && !message.includes("Maximum size exceeded")) {
        throw err;
      }
      console.warn(
        `Resumable upload exceeded the object limit for ${uploadPath}; uploading partitioned parts instead.`,
      );
      partCount = await uploadPartitioned(uploadPath, body, contentType);
    }
    console.log(
      `Uploaded ${relativePath} -> ${bucket}/${uploadPath} (${(
        fileStat.size /
        1024 /
        1024
      ).toFixed(1)} MB, gz ${(contentLength / 1024 / 1024).toFixed(1)} MB${
        partCount ? `, ${partCount} parts` : ", resumable"
      })`,
    );
    return;
  }

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

if (!SKIP_DERIVE) {
  await import("./generate-backtest-derived.mjs");
}

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

  if (UPLOAD_DERIVED_ONLY) {
    return [BACKTEST_RUNTIME_FILE, ...chunkFiles];
  }

  if (UPLOAD_UNIVERSES.size) {
    return [BACKTEST_RUNTIME_FILE, ...chunkFiles, ...universeFiles];
  }

  return [
    BACKTEST_RUNTIME_FILE,
    ...chunkFiles,
    RISK_FREE_SOURCE_FILE,
    LEGACY_BENCHMARK_SOURCE_FILE,
    NIFTY_TOTAL_RETURN_SOURCE_FILE,
    NIFTY_50_SOURCE_FILE,
    NIFTY_500_SOURCE_FILE,
    // Big downloadable CSVs served via /api/download (allowlisted in
    // functions/api/download.js). Stored plain; the frontend links to signed URLs.
    "Data/Factor_Data/finalMonthlyLabels_aman.csv",
    ...universeFiles,
  ];
}

for (const file of getUploadFiles()) {
  if (existsSync(path.join(root, file))) {
    await uploadFile(file);
  } else {
    console.warn(`Skipping missing file: ${file}`);
  }
}

console.log("Backtester data upload complete.");
