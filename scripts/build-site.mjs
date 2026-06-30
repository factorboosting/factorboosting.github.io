// Assembles the deployable static site into ./dist for Cloudflare Pages.
//
// The repo root is the single canonical source for the site (index.html, the
// backtester, styles, scripts) and also the home of the data pipeline's Data/
// tree. We can't point Pages at the repo root directly (it would upload Data/,
// scripts/, src/, node_modules, …), so this copies ONLY the web-served files into
// a clean dist/ — an allowlist, not a denylist, so nothing big leaks in by default.
//
// Big data never ships: the factor panel lives in Postgres, and the 60.8 MB
// finalMonthlyLabels download is gitignored — link it from Supabase Storage instead.
//
// Run: `node scripts/build-site.mjs` (no dependencies). Cloudflare Pages build
// command = this script; output directory = dist.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

const SITE_FILES = [
  "public/index.html",
  "public/backtester.html",
  "public/team.html",
  "public/styles.css",
  "public/script.js",
  "public/backtester.js",
];

// Web assets under Data/ that the pages reference (images, papers, small CSV
// downloads). Files (single) and directories (recursive) both handled.
const DATA_ASSETS = [
  "Data/Ashoka-opt-logo.webp",
  "Data/scdlds_ashoka_logo.jpeg",
  "Data/dashboard_preview.png",
  "Data/hero_img1.png",
  "Data/hero_img2.png",
  "Data/home_long_only.png",
  "Data/home_long_short.png",
  "Data/Team",
  "Data/Papers",
  "Data/Factor_Data/ff5.csv",
  "Data/Factor_Data/BM_Size.csv",
  "Data/Factor_Data/OP_Size.csv",
  "Data/Factor_Data/INV_Size.csv",
  "Data/Factor_Data/MOM_Size.csv",
  "Data/Factor_Data/co_code_co_name_mapping.csv",
];

function copyInto(rel, isSiteFile = false) {
  const src = path.join(ROOT, rel);
  if (!existsSync(src)) {
    console.warn(`  skip (missing): ${rel}`);
    return;
  }
  // Strip "public/" prefix for the final destination
  const destRel = isSiteFile ? rel.replace(/^public\//, "") : rel;
  const dest = path.join(DIST, destRel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`  + ${rel} -> ${destRel}`);
}

function main() {
  console.log(`Building site into ${path.relative(ROOT, DIST)}/`);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  for (const rel of SITE_FILES) copyInto(rel, true);
  for (const rel of DATA_ASSETS) copyInto(rel, false);
  console.log("Done.");
}

main();
