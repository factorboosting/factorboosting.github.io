import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const ROOT = process.cwd();
const DATA_ROOT = path.join(ROOT, "Data");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

function resolveAllowedPath(parts = []) {
  const requested = parts.join("/");
  const normalized = path.posix
    .normalize(requested.replaceAll("\\", "/"))
    .replace(/^(\.\.(\/|$))+/, "");

  if (normalized.startsWith("Data/")) {
    return path.join(DATA_ROOT, normalized.slice("Data/".length));
  }

  return null;
}

export async function GET(_request, context) {
  const params = await context.params;
  const absolutePath = resolveAllowedPath(params?.staticPath || []);
  if (!absolutePath) return new NextResponse("Not found", { status: 404 });

  try {
    const file = await readFile(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const cacheControl =
      extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable";

    return new NextResponse(file, {
      headers: {
        "Cache-Control": cacheControl,
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
