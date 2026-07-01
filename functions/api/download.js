// Cloudflare Pages Function for /api/download?file=<path> (ported from the legacy
// Next route app/api/download/route.js).
//
// The big / gitignored data files (the 60.8 MB stock-label CSV and the three
// stock-level monthly panels) are not shipped as static assets — they live in
// Supabase Storage. This redirects an allowlisted request to a short-lived signed
// URL for the object, so the browser downloads straight from Storage. Small CSVs
// (ff5, BM/OP/INV/MOM_Size) are static and handled by the frontend directly, never
// reaching this route.
//
// Allowlist-only: an arbitrary ?file= cannot be used to read other objects.

import { UNIVERSE_FILES } from "../../src/server/factor-config.js";

const NIFTY_TOTAL_RETURN_SOURCE_FILE = "Data/NIFTY Total Returns Historical Data.csv";
const NIFTY_50_SOURCE_FILE = "Data/Nifty 50 Historical Data.csv";
const NIFTY_500_SOURCE_FILE = "Data/Nifty 500 Historical Data.csv";

const ALLOWED_FILES = new Set([
  "Data/Factor_Data/ff5.csv",
  "Data/Factor_Data/finalMonthlyLabels_aman.csv",
  NIFTY_TOTAL_RETURN_SOURCE_FILE,
  NIFTY_50_SOURCE_FILE,
  NIFTY_500_SOURCE_FILE,
  ...Object.values(UNIVERSE_FILES),
]);

// Minimal POSIX normalization (no node:path in the Workers runtime): collapse
// "."/".." segments and strip any leading "../" so traversal can't escape, then
// the exact allowlist check is the real guard.
function normalizePosix(input) {
  const parts = input.replaceAll("\\", "/").split("/");
  const stack = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function normalizeRequestedFile(file) {
  if (!file) return null;
  const normalized = normalizePosix(file);
  return ALLOWED_FILES.has(normalized) ? normalized : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const file = normalizeRequestedFile(searchParams.get("file"));
  if (!file) return new Response("Not found", { status: 404 });

  const url = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET || "factor-data";
  if (!url || !key) return new Response("Storage not configured", { status: 500 });

  // Storage object path drops the leading "Data/" (objects are stored bucket-relative).
  const objectPath = file.replace(/^Data\//, "");
  const baseName = objectPath.split("/").pop();
  const encodeStoragePath = (path) => path.split("/").map(encodeURIComponent).join("/");

  // Sign a Storage object and return a redirectable URL that forces an attachment
  // download with the given filename, or null if the object doesn't exist.
  async function signedDownload(objPath, downloadName) {
    const endpoint = `${url}/storage/v1/object/sign/${bucket}/${encodeStoragePath(objPath)}`;
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const { signedURL } = await res.json().catch(() => ({}));
    if (!signedURL) return null;
    const sep = signedURL.includes("?") ? "&" : "?";
    return `${url}/storage/v1${signedURL}${sep}download=${encodeURIComponent(downloadName)}`;
  }

  async function fetchStorageObject(objPath) {
    const endpoint = `${url}/storage/v1/object/${bucket}/${encodeStoragePath(objPath)}`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage fetch failed for ${objPath}: ${res.status}`);
    return res;
  }

  async function pipeResponseBody(res, controller) {
    const reader = res.body?.getReader();
    if (!reader) return;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  function partPath(basePath, index) {
    return `${basePath}.part${String(index).padStart(3, "0")}`;
  }

  async function partitionedDownload(basePath, downloadName) {
    const firstPart = await fetchStorageObject(partPath(basePath, 0));
    if (!firstPart) return null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let part = firstPart;
          for (let index = 0; part; index++) {
            await pipeResponseBody(part, controller);
            part = await fetchStorageObject(partPath(basePath, index + 1));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Disposition": `attachment; filename="${downloadName.replaceAll('"', "")}"`,
        "Content-Type": "application/gzip",
      },
    });
  }

  // Files over Storage's ~50 MB free-tier cap are kept gzipped with a `.gz` suffix
  // or split across `.gz.partNNN` objects when a single object exceeds the bucket's
  // limit. Supabase strips Content-Encoding, so the browser saves gzipped files as
  // `<file>.gz`.
  const plainTarget = await signedDownload(objectPath, baseName);
  if (plainTarget) return Response.redirect(plainTarget, 302);

  const partitionedTarget = await partitionedDownload(`${objectPath}.gz`, `${baseName}.gz`);
  if (partitionedTarget) return partitionedTarget;

  const gzTarget = await signedDownload(`${objectPath}.gz`, `${baseName}.gz`);
  if (gzTarget) return Response.redirect(gzTarget, 302);

  return new Response("Not found", { status: 404 });
}
