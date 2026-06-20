import sharp from "sharp";

const BASE_W = 856;
const BASE_H = 756;
const SCALE = 2;
const OUT_W = BASE_W * SCALE;
const OUT_H = BASE_H * SCALE;

const COLORS = {
  blue: "#3b82f6",
  green: "#52bd8f",
  orange: "#f59e0b",
  purple: "#8b5cf6",
  pink: "#ec4899",
  red: "#ef4444",
  text: "#111827",
  muted: "#64748b",
  axis: "#94a3b8",
  grid: "#eaf0f6",
  border: "#dfe6ee",
  positive: "#059669",
  negative: "#ef4444",
};

const MONTH_LABELS = [
  "Initial",
  "2017-04",
  "2018-03",
  "2019-02",
  "2020-01",
  "2020-12",
  "2021-11",
  "2022-10",
  "2023-09",
  "2024-08",
  "2025-07",
];

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function text(x, y, value, opts = {}) {
  const {
    size = 12,
    weight = 600,
    fill = COLORS.text,
    anchor = "start",
    baseline = "middle",
    opacity = 1,
  } = opts;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="${baseline}" opacity="${opacity}">${esc(value)}</text>`;
}

function multiline(x, y, lines, opts = {}) {
  const { lineHeight = 11, anchor = "middle", size = 10.5, weight = 800, fill = COLORS.text } = opts;
  const start = y - ((lines.length - 1) * lineHeight) / 2;
  return lines
    .map((line, index) =>
      text(x, start + index * lineHeight, line, { size, weight, fill, anchor, baseline: "middle" }),
    )
    .join("");
}

function card(x, y, w, h, radius = 10) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="#fff" stroke="${COLORS.border}" stroke-width="1"/>`;
}

function numberFill(value) {
  return String(value).trim().startsWith("-") ? COLORS.negative : COLORS.positive;
}

function interpolateSeries(keys, count, amp = 0, phase = 0) {
  const keyed = new Map(keys.map(([index, value]) => [index, value]));
  const values = [];
  for (let i = 0; i < count; i++) {
    let left = keys[0];
    let right = keys[keys.length - 1];
    for (let k = 0; k < keys.length - 1; k++) {
      if (i >= keys[k][0] && i <= keys[k + 1][0]) {
        left = keys[k];
        right = keys[k + 1];
        break;
      }
    }
    const span = Math.max(1, right[0] - left[0]);
    const t = Math.max(0, Math.min(1, (i - left[0]) / span));
    const eased = t * t * (3 - 2 * t);
    const base = left[1] + (right[1] - left[1]) * eased;
    const wiggle =
      keyed.has(i) || i === 0 || i === count - 1
        ? 0
        : Math.sin(i * 0.71 + phase) * amp + Math.sin(i * 1.83 + phase) * amp * 0.34;
    values.push(Math.max(0, base + wiggle));
  }
  return values;
}

function pathFor(values, plot) {
  return values
    .map((value, index) => {
      const x = plot.x + (index / (values.length - 1)) * plot.w;
      const y = plot.y + plot.h - ((value - plot.min) / (plot.max - plot.min)) * plot.h;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${Math.max(plot.y, Math.min(plot.y + plot.h, y)).toFixed(1)}`;
    })
    .join(" ");
}

function drawLegend(series, x, y) {
  const gap = 8;
  let cursor = x;
  return series
    .map((s) => {
      const width = s.label.length * 5.8 + 22;
      const dashed = s.dashed ? `stroke-dasharray="5 4"` : "";
      const out = `<rect x="${cursor}" y="${y - 6}" width="12" height="12" fill="none" stroke="${s.color}" stroke-width="2" ${dashed}/>${text(cursor + 17, y, s.label, { size: 10.5, weight: 650, fill: COLORS.muted })}`;
      cursor += width + gap;
      return out;
    })
    .join("");
}

function legendWidth(series) {
  return series.reduce((sum, s) => sum + s.label.length * 5.8 + 22, 0) + (series.length - 1) * 8;
}

function drawChart({ title, subtitle, series, yTicks, labels = MONTH_LABELS, chartY, chartH }) {
  const cardY = chartY;
  const cardH = chartH;
  const plot = {
    x: 36,
    y: cardY + 112,
    w: 784,
    h: cardH - 160,
    min: yTicks[0],
    max: yTicks[yTicks.length - 1],
  };
  const parts = [card(12, cardY, 832, cardH, 11)];
  parts.push(text(36, cardY + 32, title, { size: 18, weight: 850 }));
  parts.push(text(36, cardY + 56, subtitle, { size: 12, weight: 650 }));
  parts.push(`<rect x="752" y="${cardY + 22}" width="12" height="12" rx="2" fill="#fff" stroke="#6b7280"/>`);
  parts.push(text(770, cardY + 28, "Log scale", { size: 12, weight: 650 }));
  parts.push(drawLegend(series, Math.max(420, 820 - legendWidth(series)), cardY + 94));

  for (const tick of yTicks) {
    const y = plot.y + plot.h - ((tick - plot.min) / (plot.max - plot.min)) * plot.h;
    parts.push(`<line x1="${plot.x}" y1="${y.toFixed(1)}" x2="${plot.x + plot.w}" y2="${y.toFixed(1)}" stroke="${COLORS.grid}" stroke-width="1"/>`);
    parts.push(text(plot.x, y, `\u20b9${tick}`, { size: 11.5, weight: 650, fill: COLORS.axis, anchor: "start" }));
  }
  labels.forEach((label, index) => {
    const x = plot.x + (index / (labels.length - 1)) * plot.w;
    parts.push(text(x, plot.y + plot.h + 24, label, { size: 11, weight: 650, fill: COLORS.axis, anchor: "middle" }));
  });
  for (const s of series) {
    const dashed = s.dashed ? `stroke-dasharray="6 5"` : "";
    parts.push(`<path d="${pathFor(s.values, plot)}" fill="none" stroke="${s.color}" stroke-width="${s.stroke || 2.5}" stroke-linejoin="round" stroke-linecap="round" ${dashed}/>`);
  }
  return parts.join("");
}

function drawLongOnlyTable(rows) {
  const h = 290;
  const rowH = 33.5;
  const parts = [card(12, 0, 832, h, 10)];
  parts.push(text(40, 46, "Portfolio", { size: 12.5, weight: 850 }));
  parts.push(text(144, 46, "Factor", { size: 12.5, weight: 850 }));
  parts.push(text(272, 46, "Growth", { size: 12.5, weight: 850, anchor: "middle" }));
  parts.push(text(428, 24, "10-Year", { size: 12.5, weight: 850, anchor: "middle" }));
  parts.push(multiline(376, 55, ["Annual Return"], { size: 11.3 }));
  parts.push(multiline(480, 55, ["Annual", "Volatility"], { size: 11.3, lineHeight: 11 }));
  parts.push(text(584, 55, "Sharpe Ratio", { size: 11.3, weight: 850, anchor: "middle" }));
  parts.push(multiline(688, 46, ["Maximum", "Drawdown"], { size: 11.3, lineHeight: 11 }));
  parts.push(multiline(792, 46, ["Growth", "vs NIFTY"], { size: 11.3, lineHeight: 11 }));
  parts.push(`<line x1="24" y1="78" x2="832" y2="78" stroke="${COLORS.border}" stroke-width="1"/>`);

  rows.forEach((row, index) => {
    const cy = 96 + index * rowH;
    if (index > 0) {
      parts.push(`<line x1="24" y1="${cy - rowH / 2}" x2="832" y2="${cy - rowH / 2}" stroke="#eef2f7" stroke-width="1"/>`);
    }
    parts.push(`<circle cx="28" cy="${cy}" r="4" fill="${row.color}"/>`);
    parts.push(text(40, cy, row.name, { size: 12.8, weight: 850 }));
    parts.push(text(144, cy, row.factor, { size: 12.5, weight: 820 }));
    parts.push(text(272, cy, row.growth, { size: 13.2, weight: 700, anchor: "middle" }));
    parts.push(text(376, cy, row.annual, { size: 13.2, weight: 750, fill: numberFill(row.annual), anchor: "middle" }));
    parts.push(text(480, cy, row.vol, { size: 13.2, weight: 700, anchor: "middle" }));
    parts.push(text(584, cy, row.sharpe, { size: 13.2, weight: 750, fill: numberFill(row.sharpe), anchor: "middle" }));
    parts.push(text(688, cy, row.drawdown, { size: 13.2, weight: 750, fill: COLORS.negative, anchor: "middle" }));
    parts.push(text(792, cy, row.vs, { size: 13.2, weight: 750, fill: numberFill(row.vs), anchor: "middle" }));
  });
  return parts.join("");
}

function drawLongShortTable(rows) {
  const h = 246;
  const rowH = 33.5;
  const parts = [card(12, 0, 832, h, 10)];
  parts.push(text(40, 44, "Portfolio", { size: 12.5, weight: 850 }));
  parts.push(text(150, 44, "Factor", { size: 12.5, weight: 850 }));
  parts.push(text(309, 44, "Growth", { size: 12.5, weight: 850, anchor: "middle" }));
  parts.push(text(547, 24, "10-Year", { size: 12.5, weight: 850, anchor: "middle" }));
  parts.push(text(428, 55, "Annual Return", { size: 11.3, weight: 850, anchor: "middle" }));
  parts.push(text(547, 55, "Annual Volatility", { size: 11.3, weight: 850, anchor: "middle" }));
  parts.push(text(666, 55, "Sharpe Ratio", { size: 11.3, weight: 850, anchor: "middle" }));
  parts.push(multiline(785, 44, ["Maximum", "Drawdown"], { size: 11.3, lineHeight: 11 }));
  parts.push(`<line x1="24" y1="76" x2="832" y2="76" stroke="${COLORS.border}" stroke-width="1"/>`);

  rows.forEach((row, index) => {
    const cy = 94 + index * rowH;
    if (index > 0) {
      parts.push(`<line x1="24" y1="${cy - rowH / 2}" x2="832" y2="${cy - rowH / 2}" stroke="#eef2f7" stroke-width="1"/>`);
    }
    parts.push(`<circle cx="28" cy="${cy}" r="4" fill="${row.color}"/>`);
    parts.push(text(40, cy, row.name, { size: 12.8, weight: 850 }));
    parts.push(text(150, cy, row.factor, { size: 12.5, weight: 820 }));
    parts.push(text(309, cy, row.growth, { size: 13.2, weight: 700, anchor: "middle" }));
    parts.push(text(428, cy, row.annual, { size: 13.2, weight: 750, fill: numberFill(row.annual), anchor: "middle" }));
    parts.push(text(547, cy, row.vol, { size: 13.2, weight: 700, anchor: "middle" }));
    parts.push(text(666, cy, row.sharpe, { size: 13.2, weight: 750, fill: numberFill(row.sharpe), anchor: "middle" }));
    parts.push(text(785, cy, row.drawdown, { size: 13.2, weight: 750, fill: COLORS.negative, anchor: "middle" }));
  });
  return parts.join("");
}

function svg(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${BASE_W} ${BASE_H}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
  </style>
  <g transform="translate(0.5 0.5)">
    ${content}
  </g>
</svg>`;
}

function longOnlyContent() {
  const rows = [
    { name: "Small", factor: "Size", growth: "4.63x", annual: "+16.56%", vol: "24.57%", sharpe: "0.528", drawdown: "-57.11%", vs: "+1.58x", color: COLORS.blue },
    { name: "Value", factor: "Book-to-Market", growth: "6.42x", annual: "+20.44%", vol: "28.96%", sharpe: "0.599", drawdown: "-67.01%", vs: "+2.18x", color: COLORS.green },
    { name: "Robust", factor: "Profitability", growth: "2.93x", annual: "+11.35%", vol: "18.34%", sharpe: "0.379", drawdown: "-36.61%", vs: "+1.00x", color: COLORS.orange },
    { name: "Conservative", factor: "Investment", growth: "3.70x", annual: "+13.98%", vol: "21.63%", sharpe: "0.462", drawdown: "-55.34%", vs: "+1.26x", color: COLORS.purple },
    { name: "Winner", factor: "Momentum", growth: "7.39x", annual: "+22.15%", vol: "21.19%", sharpe: "0.797", drawdown: "-29.95%", vs: "+2.51x", color: COLORS.pink },
    { name: "NIFTY", factor: "Benchmark", growth: "2.94x", annual: "+11.38%", vol: "16.15%", sharpe: "0.409", drawdown: "-29.35%", vs: "+1.00x", color: COLORS.red },
  ];
  const n = 120;
  const series = [
    { label: "Small", color: COLORS.blue, values: interpolateSeries([[0, 100], [20, 170], [43, 88], [58, 220], [77, 250], [96, 540], [107, 465], [119, 449]], n, 11, 0.2) },
    { label: "Value", color: COLORS.green, values: interpolateSeries([[0, 100], [18, 175], [43, 78], [59, 205], [79, 225], [95, 640], [105, 540], [119, 653]], n, 13, 1.3) },
    { label: "Robust", color: COLORS.orange, values: interpolateSeries([[0, 100], [20, 150], [43, 120], [61, 220], [82, 220], [96, 350], [108, 305], [119, 353]], n, 8, 2.1) },
    { label: "Conservative", color: COLORS.purple, values: interpolateSeries([[0, 100], [18, 150], [42, 95], [61, 210], [80, 240], [96, 430], [108, 370], [119, 458]], n, 10, 3.0) },
    { label: "Winner", color: COLORS.pink, values: interpolateSeries([[0, 100], [22, 175], [42, 140], [60, 340], [80, 370], [96, 780], [108, 705], [119, 545]], n, 16, 4.2) },
    { label: "NIFTY", color: COLORS.red, dashed: true, stroke: 2.2, values: interpolateSeries([[0, 100], [22, 135], [42, 105], [60, 210], [82, 225], [96, 300], [108, 295], [119, 294]], n, 5, 5.1) },
  ];
  return `${drawLongOnlyTable(rows)}${drawChart({
    title: "10-Year Portfolio Returns",
    subtitle: "2016-06 \u2192 2026-05 \u00b7 10 years \u00b7 VW",
    series,
    yTicks: [0, 100, 200, 300, 400, 500, 600, 700, 800],
    chartY: 308,
    chartH: 432,
  })}`;
}

function longShortContent() {
  const rows = [
    { name: "SMB", factor: "Size", growth: "1.07x", annual: "+0.65%", vol: "12.54%", sharpe: "-0.330", drawdown: "-35.09%", color: COLORS.blue },
    { name: "HML", factor: "Book-to-Market", growth: "1.99x", annual: "+7.14%", vol: "17.02%", sharpe: "0.163", drawdown: "-51.76%", color: COLORS.green },
    { name: "RMW", factor: "Profitability", growth: "1.03x", annual: "+0.25%", vol: "9.49%", sharpe: "-0.512", drawdown: "-36.22%", color: COLORS.orange },
    { name: "CMA", factor: "Investment", growth: "1.58x", annual: "+4.71%", vol: "7.77%", sharpe: "-0.083", drawdown: "-15.60%", color: COLORS.purple },
    { name: "WML", factor: "Momentum", growth: "4.22x", annual: "+15.49%", vol: "15.63%", sharpe: "0.649", drawdown: "-26.89%", color: COLORS.pink },
  ];
  const n = 120;
  const series = [
    { label: "SMB", color: COLORS.blue, values: interpolateSeries([[0, 100], [18, 118], [38, 92], [58, 96], [77, 90], [92, 112], [108, 118], [119, 116]], n, 5, 0.4) },
    { label: "HML", color: COLORS.green, values: interpolateSeries([[0, 100], [17, 130], [38, 65], [60, 92], [77, 120], [93, 185], [108, 176], [119, 217]], n, 6, 1.1) },
    { label: "RMW", color: COLORS.orange, values: interpolateSeries([[0, 100], [20, 112], [39, 158], [62, 150], [80, 136], [96, 112], [108, 108], [119, 86]], n, 5, 2.2) },
    { label: "CMA", color: COLORS.purple, values: interpolateSeries([[0, 100], [20, 108], [40, 92], [58, 118], [80, 145], [96, 168], [109, 164], [119, 123]], n, 4, 3.4) },
    { label: "WML", color: COLORS.pink, values: interpolateSeries([[0, 100], [20, 140], [39, 250], [52, 210], [66, 285], [82, 270], [95, 378], [108, 355], [119, 250]], n, 10, 4.5) },
  ];
  return `${drawLongShortTable(rows)}${drawChart({
    title: "10-Year Portfolio Returns",
    subtitle: "2016-06 \u2192 2026-05 \u00b7 10 years \u00b7 VW",
    series,
    yTicks: [50, 100, 150, 200, 250, 300, 350, 400, 450],
    chartY: 264,
    chartH: 464,
  })}`;
}

async function render(name, content) {
  const svgText = svg(content);
  await sharp(Buffer.from(svgText)).png().toFile(`Data/${name}.png`);
}

await render("home_long_only", longOnlyContent());
await render("home_long_short", longShortContent());
