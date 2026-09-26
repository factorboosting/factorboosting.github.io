/**
 * monthly-update.mjs
 *
 * One-shot script to run every month after you upload new factor-label data.
 * Handles the entire update pipeline in the correct order:
 *
 *   1. generate-backtest-derived  → refresh runtime JSON from latest label CSVs
 *   2. update-download-csvs       → append new months to ff5 + portfolio CSVs,
 *                                   calculate factor returns, carry Rf forward
 *   3. update HTML date labels    → e.g. "Oct 2003 – Jul 2026" → "Aug 2026"
 *   4. build-site                 → rebuild dist/
 *   5. upload-data-to-supabase    → push everything to Supabase storage
 *
 * Usage:
 *   node scripts/monthly-update.mjs
 *   npm run data:monthly-update
 *
 * Optional env vars:
 *   SKIP_SUPABASE=true   - skip Supabase upload (useful for dry-runs)
 *   SKIP_DERIVE=true     - skip the expensive derive step (if already done)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_SUPABASE = ["1", "true", "yes"].includes(
  String(process.env.SKIP_SUPABASE || "").toLowerCase()
);
const SKIP_DERIVE = ["1", "true", "yes"].includes(
  String(process.env.SKIP_DERIVE || "").toLowerCase()
);

function run(label, cmd) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log(`${"─".repeat(60)}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Step 1: Regenerate derived data (runtime JSON + universe chunks)
// ---------------------------------------------------------------------------
if (!SKIP_DERIVE) {
  run(
    "Step 1/5 – Generate backtest runtime data",
    "node scripts/generate-backtest-derived.mjs"
  );
} else {
  console.log("\n⏭  Skipping derive step (SKIP_DERIVE=true)");
}

// ---------------------------------------------------------------------------
// Step 2: Update static download CSVs (portfolios + ff5 factors + Rf)
// ---------------------------------------------------------------------------
run(
  "Step 2/5 – Update downloadable CSVs (portfolios, factors, Rf)",
  "node scripts/update-download-csvs.mjs"
);

// ---------------------------------------------------------------------------
// Step 3: Update HTML date labels in public/index.html
// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(60)}`);
console.log(`▶  Step 3/5 – Update HTML date labels`);
console.log(`${"─".repeat(60)}`);

// Read the last month from ff5.csv (most authoritative source)
const ff5Lines = readFileSync(
  path.join(ROOT, "Data/Factor_Data/ff5.csv"),
  "utf8"
)
  .replace(/\r/g, "")
  .trim()
  .split("\n");
const lastMonth = ff5Lines[ff5Lines.length - 1].split(",")[0]; // e.g. "2026-08"
const [yr, mo] = lastMonth.split("-");
const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];
const latestLabel = `${MONTH_NAMES[parseInt(mo) - 1]} ${yr}`; // e.g. "Aug 2026"

const HTML_FILES = [
  path.join(ROOT, "public/index.html"),
];

// Match patterns like "Jan 2026", "Feb 2026", ... "Dec 2026" or any prior year
const MONTH_PATTERN = new RegExp(
  `(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\\d\\d`,
  "g"
);

let htmlUpdated = 0;
for (const htmlFile of HTML_FILES) {
  let html = readFileSync(htmlFile, "utf8");
  // Only replace occurrences that appear in table headers (as the "latest" label)
  // Strategy: replace any month label that is newer than Oct 2003 and not "Oct 2003" itself
  const updated = html.replace(MONTH_PATTERN, (match) => {
    if (match === "Oct 2003") return match; // keep the start date
    return latestLabel;
  });
  if (updated !== html) {
    writeFileSync(htmlFile, updated, "utf8");
    htmlUpdated++;
    console.log(`  Updated ${path.relative(ROOT, htmlFile)} → "${latestLabel}"`);
  } else {
    console.log(`  No changes needed in ${path.relative(ROOT, htmlFile)}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Rebuild static site
// ---------------------------------------------------------------------------
run("Step 4/5 – Rebuild static site (dist/)", "node scripts/build-site.mjs");

// ---------------------------------------------------------------------------
// Step 5: Upload to Supabase
// ---------------------------------------------------------------------------
if (!SKIP_SUPABASE) {
  run(
    "Step 5/5 – Upload to Supabase storage",
    "node scripts/upload-data-to-supabase-storage.mjs"
  );
} else {
  console.log("\n⏭  Skipping Supabase upload (SKIP_SUPABASE=true)");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"═".repeat(60)}`);
console.log(`✅  Monthly update complete!`);
console.log(`   Latest month : ${lastMonth} (${latestLabel})`);
console.log(`   HTML updated : ${htmlUpdated} file(s)`);
if (SKIP_SUPABASE) {
  console.log(`   Supabase     : SKIPPED (run without SKIP_SUPABASE to upload)`);
} else {
  console.log(`   Supabase     : Uploaded`);
}
console.log(`${"═".repeat(60)}\n`);
console.log(
  `💡 Don't forget to commit and push:\n` +
  `   git add -A && git commit -m "data: update to ${latestLabel}" && git push origin main\n`
);
