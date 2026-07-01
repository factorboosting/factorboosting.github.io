export const RET_CAP_HI = Infinity;
export const RET_CAP_LO = -Infinity;
export const RET_DROP_HI = Infinity;
export const RET_DROP_LO = -Infinity;

export const FACTOR_GROUPS = {
  "Classic (FF5 + Momentum)": {
    Size: { col: "Size_Label", labels: { B: "Big", S: "Small" } },
    "Book-to-Market": {
      col: "BM_Label",
      labels: { G: "Growth", N: "Neutral", V: "Value" },
    },
    "Profitability": {
      col: "OP_Label",
      portfolioCol: "RMW_Portfolio",
      portfolioLabels: {
        R: ["SR", "BR"],
        N: ["SN", "BN"],
        W: ["SW", "BW"],
      },
      labels: { R: "Robust", N: "Neutral", W: "Weak" },
    },
    Investment: {
      col: "INV_Label",
      portfolioCol: "CMA_Portfolio",
      portfolioLabels: {
        A: ["SA", "BA"],
        N: ["SN", "BN"],
        C: ["SC", "BC"],
      },
      labels: { A: "Aggressive", N: "Neutral", C: "Conservative" },
    },
    Momentum: {
      col: "MOM_Label",
      labels: { W: "Winner", N: "Neutral", L: "Loser" },
    },
  },
  "Other Factors": {
    "Asset Turnover": {
      col: "AT_Label",
      labels: { H: "High", N: "Neutral", L: "Low" },
    },
    "Sales Growth": {
      col: "SG_Label",
      labels: { H: "High", N: "Neutral", L: "Low" },
    },
    Accruals: {
      col: "ACC_Label",
      labels: { C: "Conservative", N: "Neutral", A: "Aggressive" },
    },
    Volatility: {
      col: "VOL_Label",
      labels: { L: "Low", N: "Neutral", H: "High" },
    },
    "Short-Term Reversal": {
      col: "STR_Label",
      labels: { L: "Loser", N: "Neutral", H: "Winner" },
    },
  },
};

export const FACTORS = Object.fromEntries(
  Object.values(FACTOR_GROUPS).flatMap((group) => Object.entries(group)),
);

export const BENCHMARK_OPTIONS = {
  nifty500: { col: "nifty500", label: "NIFTY500" },
  nifty50: { col: "nifty50", label: "NIFTY50" },
};

export const UNIVERSE_FILES = {
  all: "Data/Factor_Data/company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv",
  top500: "firm_labels_top500_may_26.csv",
  top300: "firm_labels_top300_may_26.csv",
};

function activeNonSizeFactors(filters = {}) {
  return Object.entries(filters).filter(
    ([factor, labels]) =>
      factor !== "Size" && Array.isArray(labels) && labels.length > 0 && FACTORS[factor],
  );
}

export function getPortfolioFilter(filters = {}) {
  const active = activeNonSizeFactors(filters);
  if (active.length !== 1) return null;

  const [factor, labels] = active[0];
  const def = FACTORS[factor];
  if (!def?.portfolioCol || !def?.portfolioLabels) return null;

  const sizeSet =
    Array.isArray(filters.Size) && filters.Size.length > 0 ? new Set(filters.Size) : null;
  const portfolioLabels = [];
  for (const label of labels) {
    for (const portfolioLabel of def.portfolioLabels[label] || []) {
      if (!sizeSet || sizeSet.has(portfolioLabel[0])) {
        portfolioLabels.push(portfolioLabel);
      }
    }
  }

  return portfolioLabels.length
    ? { col: def.portfolioCol, labels: [...new Set(portfolioLabels)] }
    : null;
}

export function getPortfolioSizeColumn(longFilters = {}, shortFilters = {}) {
  const active = new Set();
  for (const filters of [longFilters, shortFilters]) {
    for (const [factor, labels] of activeNonSizeFactors(filters)) {
      const def = FACTORS[factor];
      if (!def?.portfolioCol || !def?.portfolioLabels) return null;
      active.add(factor);
    }
  }

  if (active.size !== 1) return null;
  const [factor] = active;
  return FACTORS[factor]?.portfolioCol || null;
}
