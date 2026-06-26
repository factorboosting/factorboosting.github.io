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
      labels: { R: "Robust", N: "Neutral", W: "Weak" },
    },
    Investment: {
      col: "INV_Label",
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
  nifty50: { col: "nifty50", label: "NIFTY500" },
  nifty500: { col: "nifty500", label: "Market" },
};

export const UNIVERSE_FILES = {
  all: "file_6_all_labels (1).csv",
  top500: "Data/Updated_Factor_Data/stock_files/21_500stock_level_monthly.csv",
  top300: "Data/Updated_Factor_Data/stock_files/21_300stock_level_monthly.csv",
};
