import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createStorageSignedUrl,
  getDataSourceMode,
  readDataFile,
} from "../../../src/server/data-source.js";
import { UNIVERSE_FILES } from "../../../src/server/factor-config.js";

const DATA_ROOT = path.join(process.cwd(), "Data");
const ALLOWED_FILES = new Set([
  "Data/Factor_Data/ff5.csv",
  "Data/Factor_Data/finalMonthlyLabels_aman.csv",
  ...Object.values(UNIVERSE_FILES),
]);

function normalizeRequestedFile(file) {
  if (!file) return null;
  const normalized = path.posix
    .normalize(file.replaceAll("\\", "/"))
    .replace(/^(\.\.(\/|$))+/, "");
  return ALLOWED_FILES.has(normalized) ? normalized : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const file = normalizeRequestedFile(searchParams.get("file"));
  if (!file) return new NextResponse("Not found", { status: 404 });

  if (getDataSourceMode() === "supabase-storage") {
    const signedUrl = await createStorageSignedUrl(file);
    if (signedUrl) {
      return NextResponse.redirect(signedUrl, { status: 302 });
    }

    try {
      const data = await readDataFile(file);
      return new NextResponse(data, {
        headers: {
          "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  try {
    const localPath = path.join(DATA_ROOT, file.replace(/^Data[\\/]/, ""));
    const data = await readFile(localPath);
    return new NextResponse(data, {
      headers: {
        "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
