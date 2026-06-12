import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCSV } from "../src/server/csv.js";
import {
  RET_CAP_HI,
  RET_CAP_LO,
  RET_DROP_HI,
  RET_DROP_LO,
  UNIVERSE_FILES,
} from "../src/server/factor-config.js";
import {
  BACKTEST_RUNTIME_FILE,
  getBacktestUniverseChunkFile,
  getBacktestUniverseSnapshotFile,
  LEGACY_BENCHMARK_SOURCE_FILE,
  RISK_FREE_SOURCE_FILE,
} from "../src/server/data-source.js";

const SNAPSHOT_COLUMNS = [
  "Co_Code",
  "_ret",
  "_size",
  "prev_Size",
  "Size_Label",
  "Size_Label_Yearly",
  "Size_Label_Monthly",
  "Size_Label_OP",
  "Size_Label_INV",
  "Size_Label_AT",
  "Size_Label_SG",
  "Size_Label_ACC",
  "MOM_Label",
  "BM_Label",
  "OP_Label",
  "INV_Label",
  "AT_Label",
  "SG_Label",
  "ACC_Label",
  "VOL_Label",
  "STR_Label",
];
const CHUNK_YEAR_SPAN = 1;

function sanitizeReturn(raw) {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return { value: null, action: "drop" };
  }
  if (value <= RET_DROP_LO || value >= RET_DROP_HI) {
    return { value: null, action: "drop" };
  }
  if (value > RET_CAP_HI) return { value: RET_CAP_HI, action: "capped" };
  if (value < RET_CAP_LO) return { value: RET_CAP_LO, action: "capped" };
  return { value, action: "ok" };
}

async function readText(relativePath) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function buildRuntimeData() {
  const rfData = {};
  const benchmarkByMonth = {};
  const names = {};
  const universes = {};

  parseCSV(await readText(RISK_FREE_SOURCE_FILE), (row) => {
    if (row.Month && row.Rf !== undefined && row.Rf !== "") {
      rfData[row.Month.substring(0, 7)] = Number.parseFloat(row.Rf);
    }
  });

  parseCSV(await readText(LEGACY_BENCHMARK_SOURCE_FILE), (row) => {
    const month = row.Month ? row.Month.substring(0, 7) : "";
    const code = row.Co_Code || row.co_code;
    if (code && row.Co_Name) names[code] = row.Co_Name;
    if (!month) return;
    if (!benchmarkByMonth[month]) benchmarkByMonth[month] = {};

    const nifty50 = Number.parseFloat(row.nifty50);
    const nifty500 = Number.parseFloat(row.nifty500);
    if (!Number.isNaN(nifty50)) benchmarkByMonth[month].nifty50 = nifty50;
    if (!Number.isNaN(nifty500)) benchmarkByMonth[month].nifty500 = nifty500;
  });

  for (const [universe, file] of Object.entries(UNIVERSE_FILES)) {
    const snapshot = await buildUniverseSnapshot(universe, file, names);
    const chunks = writeSnapshotChunks(snapshot);

    universes[universe] = {
      file,
      dataQualityStats: snapshot.dataQualityStats,
      firstMonth: snapshot.allMonths[0] || null,
      lastMonth: snapshot.allMonths[snapshot.allMonths.length - 1] || null,
      months: snapshot.allMonths,
      rowCount: snapshot.rowCount,
      snapshotFile: getBacktestUniverseSnapshotFile(universe),
      chunks,
      universe,
    };
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    benchmarkByMonth,
    names,
    rfData,
    universes,
  };
}

async function buildUniverseSnapshot(universe, file, names) {
  const rows = [];
  const dataQualityStats = { dropped: 0, capped: 0, total: 0 };
  let retCol = null;

  parseCSV(await readText(file), (row) => {
    dataQualityStats.total++;
    if (!retCol) {
      if ("monthly_return" in row) retCol = "monthly_return";
      else if ("monthly_ret" in row) retCol = "monthly_ret";
      else if ("Monthly_Return" in row) retCol = "Monthly_Return";
    }
    if (!retCol) return;

    const sanitized = sanitizeReturn(row[retCol]);
    if (sanitized.action === "drop") {
      dataQualityStats.dropped++;
      return;
    }
    if (sanitized.action === "capped") dataQualityStats.capped++;

    const code = row.co_code || row.Co_Code;
    const month = row.Month ? row.Month.substring(0, 7) : "";
    const normalized = {
      Co_Code: code,
      _month: month,
      _ret: sanitized.value,
      _size: Number.parseFloat(row.mktcap || row.eom_mcap || row.Size || row.lagged_mktcap),
      prev_Size: null,
      Size_Label:
        row.Size_Label ||
        row.Size_Label_Yearly ||
        row.Size_Label_Monthly ||
        row.Size_Label_Monthly_Any ||
        "",
      Size_Label_Yearly: row.Size_Label_Yearly || "",
      Size_Label_Monthly: row.Size_Label_Monthly || row.Size_Label_Monthly_Any || "",
      Size_Label_OP: row.Size_Label_OP || "",
      Size_Label_INV: row.Size_Label_INV || "",
      Size_Label_AT: row.Size_Label_AT || "",
      Size_Label_SG: row.Size_Label_SG || "",
      Size_Label_ACC: row.Size_Label_ACC || "",
      MOM_Label: row.MOM_Label || row.Momentum_Label || "",
      BM_Label: row.BM_Label || "",
      OP_Label: row.OP_Label || row.OpProf_Label || "",
      INV_Label: row.INV_Label || row.Inv_Label || "",
      AT_Label: row.AT_Label || "",
      SG_Label: row.SG_Label || "",
      ACC_Label: row.ACC_Label || "",
      VOL_Label: row.VOL_Label || row.BAV_Label || "",
      STR_Label: row.STR_Label || "",
    };

    if (Number.isNaN(normalized._size) || normalized._size <= 0) normalized._size = 0;

    if (row.prev_mktcap !== undefined && row.prev_mktcap !== "") {
      normalized.prev_Size = Number.parseFloat(row.prev_mktcap);
    } else if (row.lagged_mktcap !== undefined && row.lagged_mktcap !== "") {
      normalized.prev_Size = Number.parseFloat(row.lagged_mktcap);
    } else if (row.prev_Size !== undefined && row.prev_Size !== "") {
      normalized.prev_Size = Number.parseFloat(row.prev_Size);
    }
    if (Number.isNaN(normalized.prev_Size) || normalized.prev_Size <= 0) {
      normalized.prev_Size = null;
    }

    rows.push(normalized);
  });

  const stockMap = new Map();
  for (const row of rows) {
    if (!stockMap.has(row.Co_Code)) stockMap.set(row.Co_Code, []);
    stockMap.get(row.Co_Code).push(row);
  }

  for (const stockRows of stockMap.values()) {
    stockRows.sort((a, b) => a._month.localeCompare(b._month));
    for (let i = 1; i < stockRows.length; i++) {
      if (stockRows[i].prev_Size == null) stockRows[i].prev_Size = stockRows[i - 1]._size;
    }
  }

  const monthGroups = {};
  const requiredColumns = new Set(["Co_Code", "_ret", "_size", "prev_Size"]);
  const columns = SNAPSHOT_COLUMNS.filter(
    (column) =>
      requiredColumns.has(column) ||
      rows.some((row) => row[column] !== undefined && row[column] !== "" && row[column] != null),
  );

  for (const row of rows) {
    if (!row._month) continue;
    if (!monthGroups[row._month]) monthGroups[row._month] = [];
    monthGroups[row._month].push(
      columns.map((column) => (row[column] === undefined ? "" : row[column])),
    );
  }

  const allMonths = Object.keys(monthGroups).sort();
  return {
    version: 1,
    columns,
    universe,
    allMonths,
    dataQualityStats,
    rowCount: rows.length,
    monthGroups,
  };
}

function writeSnapshotChunks(snapshot) {
  const chunks = [];
  const monthsByChunk = new Map();
  for (const month of snapshot.allMonths) {
    const year = Number.parseInt(month.slice(0, 4), 10);
    const startYear = Math.floor(year / CHUNK_YEAR_SPAN) * CHUNK_YEAR_SPAN;
    const chunkId = `${startYear}-${startYear + CHUNK_YEAR_SPAN - 1}`;
    if (!monthsByChunk.has(chunkId)) monthsByChunk.set(chunkId, []);
    monthsByChunk.get(chunkId).push(month);
  }

  for (const [chunkId, months] of [...monthsByChunk.entries()].sort()) {
    const monthGroups = {};
    let rowCount = 0;
    for (const month of months) {
      monthGroups[month] = snapshot.monthGroups[month] || [];
      rowCount += monthGroups[month].length;
    }

    const chunk = {
      version: 1,
      columns: snapshot.columns,
      universe: snapshot.universe,
      firstMonth: months[0],
      lastMonth: months[months.length - 1],
      allMonths: months,
      rowCount,
      monthGroups,
    };
    const file = getBacktestUniverseChunkFile(snapshot.universe, chunkId);
    const outputPath = path.join(process.cwd(), file);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const text = `${JSON.stringify(chunk)}\n`;
    writeFileSync(outputPath, text);

    chunks.push({
      file,
      firstMonth: chunk.firstMonth,
      lastMonth: chunk.lastMonth,
      id: chunkId,
      rowCount,
    });
  }

  const totalMb =
    chunks.reduce((sum, chunk) => {
      const outputPath = path.join(process.cwd(), chunk.file);
      return sum + Buffer.byteLength(readFileSync(outputPath, "utf8"), "utf8");
    }, 0) /
    1024 /
    1024;
  console.log(
    `Generated ${chunks.length} chunks for ${snapshot.universe} (${totalMb.toFixed(
      1,
    )} MB, ${snapshot.rowCount.toLocaleString()} rows)`,
  );

  return chunks;
}

const outputPath = path.join(process.cwd(), BACKTEST_RUNTIME_FILE);
mkdirSync(path.dirname(outputPath), { recursive: true });

const runtimeData = await buildRuntimeData();
writeFileSync(outputPath, `${JSON.stringify(runtimeData)}\n`);

const sizeKb = Buffer.byteLength(JSON.stringify(runtimeData), "utf8") / 1024;
console.log(
  `Generated ${BACKTEST_RUNTIME_FILE} (${sizeKb.toFixed(1)} KB, ${Object.keys(
    runtimeData.universes,
  ).length} universes)`,
);

if (!existsSync(outputPath)) {
  throw new Error(`Failed to generate ${BACKTEST_RUNTIME_FILE}`);
}
