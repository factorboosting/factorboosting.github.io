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

const ALLOWED_FILES = new Set([
  "Data/Factor_Data/ff5.csv",
  "Data/Factor_Data/finalMonthlyLabels_aman.csv",
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

  // Sign a Storage object and return a redirectable URL that forces an attachment
  // download with the given filename, or null if the object doesn't exist.
  async function signedDownload(objPath, downloadName) {
    const endpoint = `${url}/storage/v1/object/sign/${bucket}/${objPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
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

  // Files over Storage's ~50 MB free-tier cap are kept gzipped with a `.gz` suffix
  // (Supabase strips Content-Encoding, so the browser saves them as `<file>.gz`).
  // Try the plain object first, then fall back to `.gz`.
  const target =
    (await signedDownload(objectPath, baseName)) ||
    (await signedDownload(`${objectPath}.gz`, `${baseName}.gz`));
  if (!target) return new Response("Not found", { status: 404 });
  return Response.redirect(target, 302);
}
