#!/usr/bin/env python3
"""HPC-ready genetic-programming search for factor trading strategies.

This script is the production-style counterpart to the explanatory notebook.
It runs one GP experiment for one seed/configuration and writes a full ledger,
history, split summary, SPA-style validation test, and reproducible strategy
specification.

Example:
  python gp_hpc_runner.py \
    --data-path company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv \
    --output-dir output/gp_hpc_runs \
    --run-name all_ls_value_seed42 \
    --seed 42 \
    --population 300 \
    --generations 75
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


LABEL_SPECS = {
    "size": (["Size_Label_Yearly", "Size_Label_annual", "Size_Label_Monthly", "Size_Label_monthly_mom"], {"S": 1.0, "B": -1.0}),
    "value": (["BM_Label"], {"V": 1.0, "N": 0.0, "G": -1.0}),
    "momentum": (["MOM_Label", "Mom_Label"], {"W": 1.0, "N": 0.0, "L": -1.0}),
    "profitability": (["OP_Label"], {"R": 1.0, "N": 0.0, "W": -1.0}),
    "investment": (["INV_Label"], {"C": 1.0, "N": 0.0, "A": -1.0}),
    "asset_turnover": (["AT_Label"], {"H": 1.0, "N": 0.0, "L": -1.0}),
    "sales_growth": (["SG_Label"], {"H": 1.0, "N": 0.0, "L": -1.0}),
    "accruals": (["ACC_Label"], {"C": 1.0, "N": 0.0, "A": -1.0}),
    "short_term_reversal": (["STR_Label", "Str_Label"], {"L": 1.0, "N": 0.0, "H": -1.0}),
    "volatility": (["BAV_Label", "Vol_Label"], {"L": 1.0, "N": 0.0, "H": -1.0}),
}

NUMERIC_SPECS = {
    "bm_ratio": ["formation_bm_ratio"],
    "mom_signal": ["mom_signal"],
    "vol_signal": ["BAV_signal"],
    "str_signal": ["STR_signal"],
    "op_profitability": ["OpProf"],
    "investment_raw": ["Inv"],
    "asset_turnover_raw": ["AssetTurnover"],
    "sales_growth_raw": ["SalesGrowth"],
    "accruals_raw": ["Accruals_BS"],
}

OPS = {
    "add": 2,
    "sub": 2,
    "mul": 2,
    "div": 2,
    "max": 2,
    "min": 2,
    "neg": 1,
    "abs": 1,
    "sign": 1,
}


@dataclass(frozen=True)
class Config:
    data_path: str
    output_dir: str
    run_name: str
    seed: int
    last_n_months: int | None
    train_frac: float
    valid_frac: float
    selection_fraction: float
    min_holdings: int
    weighting: str
    holding_mode: str
    transaction_cost_bps: float
    population: int
    generations: int
    tournament_size: int
    elite_count: int
    max_tree_depth: int
    max_tree_nodes: int
    mutation_rate: float
    crossover_rate: float
    const_prob: float
    candidate_count: int
    spa_bootstraps: int
    spa_block_length: int


@dataclass(frozen=True)
class Node:
    op: str
    children: tuple["Node", ...] = ()
    value: Any = None


@dataclass
class PreparedData:
    feature_names: list[str]
    raw: pd.DataFrame
    x: np.ndarray
    returns: np.ndarray
    mcap: np.ndarray
    codes: np.ndarray
    months: np.ndarray
    all_months: list[str]
    month_to_indices: dict[str, np.ndarray]


def first_existing(columns: list[str] | pd.Index, candidates: list[str], required: bool = True) -> str | None:
    for col in candidates:
        if col in columns:
            return col
    if required:
        raise KeyError(f"None of these columns exist: {candidates}")
    return None


def load_data(config: Config) -> PreparedData:
    raw = pd.read_csv(config.data_path)
    month_col = first_existing(raw.columns, ["Month_str", "Month"])
    ret_col = first_existing(raw.columns, ["monthly_ret"])
    mcap_col = first_existing(raw.columns, ["lagged_mktcap", "prev_mcap"])
    code_col = first_existing(raw.columns, ["co_code"])

    raw[month_col] = raw[month_col].astype(str).str.slice(0, 7)
    raw[ret_col] = pd.to_numeric(raw[ret_col], errors="coerce")
    raw[mcap_col] = pd.to_numeric(raw[mcap_col], errors="coerce")
    raw = raw.dropna(subset=[month_col, ret_col, mcap_col, code_col]).copy()
    raw = raw[np.isfinite(raw[ret_col]) & np.isfinite(raw[mcap_col])]
    raw = raw[raw[mcap_col] > 0].copy()

    all_months = sorted(raw[month_col].unique())
    if config.last_n_months is not None:
        keep = set(all_months[-config.last_n_months :])
        raw = raw[raw[month_col].isin(keep)].copy()
        all_months = sorted(raw[month_col].unique())

    raw = raw.sort_values([month_col, code_col]).reset_index(drop=True)

    features = pd.DataFrame(index=raw.index)

    for feature_name, (aliases, mapping) in LABEL_SPECS.items():
        col = first_existing(raw.columns, aliases, required=False)
        if col is None:
            features[f"label_{feature_name}"] = 0.0
        else:
            values = raw[col].astype(str).str.upper().str.strip().map(mapping).fillna(0.0)
            features[f"label_{feature_name}"] = values.astype(float)

    for feature_name, aliases in NUMERIC_SPECS.items():
        col = first_existing(raw.columns, aliases, required=False)
        if col is None:
            features[feature_name] = 0.0
        else:
            features[feature_name] = pd.to_numeric(raw[col], errors="coerce")

    features["log_mcap"] = np.log1p(raw[mcap_col].astype(float))

    features_z = pd.DataFrame(index=features.index)
    for col in features.columns:
        x = pd.to_numeric(features[col], errors="coerce")
        mu = x.groupby(raw[month_col]).transform("mean")
        sd = x.groupby(raw[month_col]).transform("std")
        z = (x - mu) / sd.replace(0, np.nan)
        features_z[col] = z.replace([np.inf, -np.inf], np.nan).fillna(0.0).clip(-5, 5)

    months = raw[month_col].to_numpy()
    month_to_indices = {m: np.flatnonzero(months == m) for m in all_months}

    return PreparedData(
        feature_names=list(features_z.columns),
        raw=raw,
        x=features_z.to_numpy(dtype=np.float64),
        returns=raw[ret_col].to_numpy(dtype=np.float64),
        mcap=raw[mcap_col].to_numpy(dtype=np.float64),
        codes=raw[code_col].to_numpy(),
        months=months,
        all_months=all_months,
        month_to_indices=month_to_indices,
    )


def make_time_splits(months: list[str], train_frac: float, valid_frac: float) -> tuple[list[str], list[str], list[str]]:
    n = len(months)
    train_end = int(n * train_frac)
    valid_end = int(n * (train_frac + valid_frac))
    return months[:train_end], months[train_end:valid_end], months[valid_end:]


def node_size(node: Node) -> int:
    return 1 + sum(node_size(child) for child in node.children)


def node_depth(node: Node) -> int:
    if not node.children:
        return 1
    return 1 + max(node_depth(child) for child in node.children)


def expr(node: Node, feature_names: list[str]) -> str:
    if node.op == "feature":
        return feature_names[int(node.value)]
    if node.op == "const":
        return f"{float(node.value):.3f}"
    if len(node.children) == 1:
        return f"{node.op}({expr(node.children[0], feature_names)})"
    return f"{node.op}({expr(node.children[0], feature_names)}, {expr(node.children[1], feature_names)})"


def random_terminal(feature_count: int, const_prob: float) -> Node:
    if random.random() < const_prob:
        return Node("const", value=random.uniform(-2.0, 2.0))
    return Node("feature", value=random.randrange(feature_count))


def random_tree(feature_count: int, max_depth: int, const_prob: float) -> Node:
    if max_depth <= 1 or random.random() < 0.25:
        return random_terminal(feature_count, const_prob)
    op = random.choice(list(OPS.keys()))
    arity = OPS[op]
    return Node(op, tuple(random_tree(feature_count, max_depth - 1, const_prob) for _ in range(arity)))


def all_paths(node: Node, prefix: tuple[int, ...] = ()) -> list[tuple[int, ...]]:
    paths = [prefix]
    for index, child in enumerate(node.children):
        paths.extend(all_paths(child, prefix + (index,)))
    return paths


def get_subtree(node: Node, path: tuple[int, ...]) -> Node:
    cur = node
    for index in path:
        cur = cur.children[index]
    return cur


def replace_subtree(node: Node, path: tuple[int, ...], replacement: Node) -> Node:
    if not path:
        return replacement
    index = path[0]
    children = list(node.children)
    children[index] = replace_subtree(children[index], path[1:], replacement)
    return Node(node.op, tuple(children), node.value)


def crossover(parent_a: Node, parent_b: Node, config: Config) -> Node:
    path_a = random.choice(all_paths(parent_a))
    path_b = random.choice(all_paths(parent_b))
    child = replace_subtree(parent_a, path_a, get_subtree(parent_b, path_b))
    if node_depth(child) > config.max_tree_depth or node_size(child) > config.max_tree_nodes:
        return parent_a
    return child


def mutate(node: Node, feature_count: int, config: Config) -> Node:
    path = random.choice(all_paths(node))
    replacement = random_tree(feature_count, random.randint(1, max(2, config.max_tree_depth // 2)), config.const_prob)
    child = replace_subtree(node, path, replacement)
    if node_depth(child) > config.max_tree_depth or node_size(child) > config.max_tree_nodes:
        return node
    return child


def safe_array(x: np.ndarray) -> np.ndarray:
    return np.nan_to_num(np.asarray(x, dtype=float), nan=0.0, posinf=10.0, neginf=-10.0)


def eval_tree(node: Node, x: np.ndarray) -> np.ndarray:
    if node.op == "feature":
        return x[:, int(node.value)]
    if node.op == "const":
        return np.full(x.shape[0], float(node.value), dtype=float)

    vals = [eval_tree(child, x) for child in node.children]
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        if node.op == "add":
            out = vals[0] + vals[1]
        elif node.op == "sub":
            out = vals[0] - vals[1]
        elif node.op == "mul":
            out = vals[0] * vals[1]
        elif node.op == "div":
            denom = np.where(np.abs(vals[1]) < 1e-6, 1.0, vals[1])
            out = vals[0] / denom
        elif node.op == "max":
            out = np.maximum(vals[0], vals[1])
        elif node.op == "min":
            out = np.minimum(vals[0], vals[1])
        elif node.op == "neg":
            out = -vals[0]
        elif node.op == "abs":
            out = np.abs(vals[0])
        elif node.op == "sign":
            out = np.sign(vals[0])
        else:
            raise ValueError(node.op)
    return np.clip(safe_array(out), -20, 20)


def weighted_average_return(returns: np.ndarray, weights: np.ndarray | None = None) -> float:
    returns = np.asarray(returns, dtype=float)
    ok = np.isfinite(returns)
    if weights is None:
        return float(np.mean(returns[ok])) if ok.any() else np.nan
    weights = np.asarray(weights, dtype=float)
    ok = ok & np.isfinite(weights) & (weights > 0)
    if not ok.any():
        return np.nan
    w = weights[ok] / weights[ok].sum()
    return float(np.sum(w * returns[ok]))


def compute_benchmark(data: PreparedData, months: list[str], weighting: str) -> np.ndarray:
    out = []
    for month in months:
        idx = data.month_to_indices[month]
        weights = data.mcap[idx] if weighting == "value" else None
        out.append(weighted_average_return(data.returns[idx], weights))
    return np.asarray(out, dtype=float)


def simple_set_turnover(current_codes: np.ndarray, previous_codes: np.ndarray | None) -> float:
    if previous_codes is None:
        return 1.0
    current = set(current_codes)
    previous = set(previous_codes)
    if not current and not previous:
        return 0.0
    overlap = len(current & previous)
    return 1.0 - overlap / max(len(current), len(previous), 1)


def backtest_scores(data: PreparedData, scores: np.ndarray, months: list[str], config: Config) -> dict[str, np.ndarray]:
    monthly_returns = []
    long_counts = []
    short_counts = []
    turnovers = []
    prev_long = None
    prev_short = None

    for month in months:
        idx = data.month_to_indices[month]
        s = scores[idx]
        r = data.returns[idx]
        cap = data.mcap[idx]
        codes = data.codes[idx]

        ok = np.isfinite(s) & np.isfinite(r) & np.isfinite(cap) & (cap > 0)
        if ok.sum() < max(2 * config.min_holdings, 10):
            monthly_returns.append(np.nan)
            long_counts.append(0)
            short_counts.append(0)
            turnovers.append(np.nan)
            continue

        loc = np.flatnonzero(ok)
        s_ok = s[loc]
        r_ok = r[loc]
        cap_ok = cap[loc]
        codes_ok = codes[loc]

        n_select = max(config.min_holdings, int(math.ceil(config.selection_fraction * len(loc))))
        n_select = min(n_select, max(1, len(loc) // 2))

        order = np.argsort(s_ok)
        short_pos = order[:n_select]
        long_pos = order[-n_select:]

        long_w = cap_ok[long_pos] if config.weighting == "value" else None
        short_w = cap_ok[short_pos] if config.weighting == "value" else None

        long_ret = weighted_average_return(r_ok[long_pos], long_w)
        short_ret = weighted_average_return(r_ok[short_pos], short_w)
        long_codes = codes_ok[long_pos]
        short_codes = codes_ok[short_pos]

        long_turnover = simple_set_turnover(long_codes, prev_long)
        short_turnover = simple_set_turnover(short_codes, prev_short) if config.holding_mode == "long_short" else 0.0
        turnover = long_turnover + short_turnover
        cost = (config.transaction_cost_bps / 10000.0) * turnover

        if config.holding_mode == "long_short":
            port_ret = long_ret - short_ret - cost
        else:
            port_ret = long_ret - cost

        monthly_returns.append(port_ret)
        long_counts.append(len(long_pos))
        short_counts.append(len(short_pos) if config.holding_mode == "long_short" else 0)
        turnovers.append(turnover)
        prev_long = long_codes
        prev_short = short_codes

    return {
        "returns": np.asarray(monthly_returns, dtype=float),
        "long_counts": np.asarray(long_counts, dtype=float),
        "short_counts": np.asarray(short_counts, dtype=float),
        "turnover": np.asarray(turnovers, dtype=float),
    }


def annualized_return(returns: np.ndarray) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) == 0:
        return np.nan
    wealth = np.prod(1.0 + r)
    if wealth <= 0:
        return -1.0
    return float(wealth ** (12.0 / len(r)) - 1.0)


def annualized_vol(returns: np.ndarray) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2:
        return np.nan
    return float(np.std(r, ddof=1) * math.sqrt(12))


def sharpe_ratio(returns: np.ndarray) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2 or np.std(r, ddof=1) == 0:
        return np.nan
    return float(np.mean(r) / np.std(r, ddof=1) * math.sqrt(12))


def max_drawdown(returns: np.ndarray) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) == 0:
        return np.nan
    wealth = np.cumprod(1.0 + r)
    peak = np.maximum.accumulate(wealth)
    return float(np.min(wealth / peak - 1.0))


def information_ratio(strategy_returns: np.ndarray, benchmark_returns: np.ndarray) -> float:
    active = np.asarray(strategy_returns, dtype=float) - np.asarray(benchmark_returns, dtype=float)
    active = active[np.isfinite(active)]
    if len(active) < 2 or np.std(active, ddof=1) == 0:
        return np.nan
    return float(np.mean(active) / np.std(active, ddof=1) * math.sqrt(12))


def performance_table(strategy_returns: np.ndarray, benchmark_returns: np.ndarray, turnover: np.ndarray | None = None) -> dict[str, float]:
    strategy_returns = np.asarray(strategy_returns, dtype=float)
    benchmark_returns = np.asarray(benchmark_returns, dtype=float)
    active = strategy_returns - benchmark_returns
    return {
        "months": int(np.isfinite(strategy_returns).sum()),
        "ann_return": annualized_return(strategy_returns),
        "ann_vol": annualized_vol(strategy_returns),
        "sharpe": sharpe_ratio(strategy_returns),
        "ann_active_return": float(np.nanmean(active) * 12),
        "ir": information_ratio(strategy_returns, benchmark_returns),
        "max_drawdown": max_drawdown(strategy_returns),
        "avg_turnover": float(np.nanmean(turnover)) if turnover is not None else np.nan,
    }


def fitness_from_metrics(metrics: dict[str, float], node_count: int) -> float:
    ir = metrics["ir"]
    if not np.isfinite(ir):
        return -1e9
    ann_active = metrics["ann_active_return"] if np.isfinite(metrics["ann_active_return"]) else -1.0
    mdd = metrics["max_drawdown"] if np.isfinite(metrics["max_drawdown"]) else -1.0
    avg_turnover = metrics["avg_turnover"] if np.isfinite(metrics["avg_turnover"]) else 2.0
    complexity_penalty = 0.01 * node_count
    drawdown_penalty = max(0.0, abs(mdd) - 0.35) * 2.0
    turnover_penalty = 0.02 * avg_turnover
    return float(ir + 0.25 * ann_active - complexity_penalty - drawdown_penalty - turnover_penalty)


class Evaluator:
    def __init__(self, data: PreparedData, train_months: list[str], valid_months: list[str], test_months: list[str], config: Config):
        self.data = data
        self.train_months = train_months
        self.valid_months = valid_months
        self.test_months = test_months
        self.config = config
        self.benchmarks = {
            "train": compute_benchmark(data, train_months, config.weighting),
            "valid": compute_benchmark(data, valid_months, config.weighting),
            "test": compute_benchmark(data, test_months, config.weighting),
        }

    def months_for_split(self, split_name: str) -> list[str]:
        if split_name == "train":
            return self.train_months
        if split_name == "valid":
            return self.valid_months
        if split_name == "test":
            return self.test_months
        raise ValueError(split_name)

    def benchmark_for_split(self, split_name: str, returns: np.ndarray) -> np.ndarray:
        if self.config.holding_mode == "long_short":
            return np.zeros_like(returns)
        return self.benchmarks[split_name]

    def evaluate_node(self, node: Node, split_name: str) -> tuple[float, dict[str, float], dict[str, np.ndarray]]:
        scores = eval_tree(node, self.data.x)
        bt = backtest_scores(self.data, scores, self.months_for_split(split_name), self.config)
        benchmark = self.benchmark_for_split(split_name, bt["returns"])
        metrics = performance_table(bt["returns"], benchmark, bt["turnover"])
        fit = fitness_from_metrics(metrics, node_size(node))
        return fit, metrics, bt


def tournament_select(scored_population: list[tuple[float, Node]], tournament_size: int) -> Node:
    sample = random.sample(scored_population, min(tournament_size, len(scored_population)))
    sample.sort(key=lambda item: item[0], reverse=True)
    return sample[0][1]


def train_gp(data: PreparedData, evaluator: Evaluator, config: Config) -> tuple[dict[str, Any], pd.DataFrame, pd.DataFrame, dict[str, dict[str, Any]]]:
    population = [random_tree(len(data.feature_names), config.max_tree_depth, config.const_prob) for _ in range(config.population)]
    evaluated: dict[str, dict[str, Any]] = {}
    history = []
    best_valid: dict[str, Any] | None = None

    for generation in range(1, config.generations + 1):
        scored = []
        for node in population:
            expression = expr(node, data.feature_names)
            if expression not in evaluated:
                fit, metrics, _ = evaluator.evaluate_node(node, "train")
                evaluated[expression] = {
                    "node": node,
                    "train_fitness": fit,
                    "train_metrics": metrics,
                    "nodes": node_size(node),
                    "depth": node_depth(node),
                }
            scored.append((evaluated[expression]["train_fitness"], node))

        scored.sort(key=lambda item: item[0], reverse=True)
        best_train_node = scored[0][1]
        valid_fit, valid_metrics, _ = evaluator.evaluate_node(best_train_node, "valid")

        if best_valid is None or valid_fit > best_valid["valid_fitness"]:
            best_valid = {
                "node": best_train_node,
                "expr": expr(best_train_node, data.feature_names),
                "generation": generation,
                "valid_fitness": valid_fit,
                "valid_metrics": valid_metrics,
            }

        history.append(
            {
                "generation": generation,
                "best_train_fitness": scored[0][0],
                "best_train_expr": expr(best_train_node, data.feature_names),
                "best_valid_so_far": best_valid["valid_fitness"],
                "saved_generation": best_valid["generation"],
                "unique_evaluated": len(evaluated),
            }
        )

        print(
            f"gen {generation:03d} | train_fit={scored[0][0]:.4f} "
            f"| valid_best={best_valid['valid_fitness']:.4f} | unique={len(evaluated)}",
            flush=True,
        )

        next_population = [node for _, node in scored[: config.elite_count]]
        while len(next_population) < config.population:
            parent = tournament_select(scored, config.tournament_size)
            child = parent
            if random.random() < config.crossover_rate:
                child = crossover(parent, tournament_select(scored, config.tournament_size), config)
            if random.random() < config.mutation_rate:
                child = mutate(child, len(data.feature_names), config)
            next_population.append(child)
        population = next_population

    ledger_rows = []
    for expression, record in evaluated.items():
        row = {
            "expression": expression,
            "train_fitness": record["train_fitness"],
            "nodes": record["nodes"],
            "depth": record["depth"],
        }
        row.update({f"train_{key}": value for key, value in record["train_metrics"].items()})
        ledger_rows.append(row)

    ledger = pd.DataFrame(ledger_rows).sort_values("train_fitness", ascending=False).reset_index(drop=True)
    return best_valid, pd.DataFrame(history), ledger, evaluated


def active_returns_for_node(evaluator: Evaluator, node: Node, split_name: str) -> np.ndarray:
    _, _, bt = evaluator.evaluate_node(node, split_name)
    benchmark = evaluator.benchmark_for_split(split_name, bt["returns"])
    return bt["returns"] - benchmark


def spa_style_test(candidate_return_map: dict[str, np.ndarray], bootstraps: int, block_length: int, seed: int) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    names = list(candidate_return_map.keys())
    if not names:
        return {"best_strategy": None, "observed_max_t": np.nan, "p_value": np.nan, "t_table": pd.DataFrame()}

    t_len = len(next(iter(candidate_return_map.values())))
    returns = np.vstack([np.nan_to_num(candidate_return_map[name], nan=0.0) for name in names])
    means = returns.mean(axis=1)
    sds = returns.std(axis=1, ddof=1)
    valid = sds > 1e-12
    names = [name for name, ok in zip(names, valid) if ok]
    returns = returns[valid]
    means = means[valid]
    sds = sds[valid]
    if len(names) == 0:
        return {"best_strategy": None, "observed_max_t": np.nan, "p_value": np.nan, "t_table": pd.DataFrame()}

    t_stats = np.sqrt(t_len) * means / sds
    observed = float(np.max(t_stats))
    best_name = names[int(np.argmax(t_stats))]

    centered = returns - means[:, None]
    boot_max = []
    for _ in range(bootstraps):
        idx = []
        while len(idx) < t_len:
            start = int(rng.integers(0, t_len))
            idx.extend([(start + offset) % t_len for offset in range(block_length)])
        idx = np.asarray(idx[:t_len])
        sample = centered[:, idx]
        sample_sd = sample.std(axis=1, ddof=1)
        sample_sd = np.where(sample_sd < 1e-12, np.nan, sample_sd)
        boot_t = np.sqrt(t_len) * sample.mean(axis=1) / sample_sd
        boot_max.append(np.nanmax(boot_t))

    boot_max = np.asarray(boot_max)
    p_value = float(np.mean(boot_max >= observed))
    t_table = pd.DataFrame({"strategy": names, "t_stat": t_stats, "mean_monthly_active": means})
    t_table = t_table.sort_values("t_stat", ascending=False).reset_index(drop=True)

    return {
        "best_strategy": best_name,
        "observed_max_t": observed,
        "p_value": p_value,
        "t_table": t_table,
    }


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-path", required=True)
    parser.add_argument("--output-dir", default="output/gp_hpc_runs")
    parser.add_argument("--run-name", default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--last-n-months", type=int, default=None)
    parser.add_argument("--train-frac", type=float, default=0.60)
    parser.add_argument("--valid-frac", type=float, default=0.20)
    parser.add_argument("--selection-fraction", type=float, default=0.20)
    parser.add_argument("--min-holdings", type=int, default=25)
    parser.add_argument("--weighting", choices=["equal", "value"], default="value")
    parser.add_argument("--holding-mode", choices=["long_short", "long_only"], default="long_short")
    parser.add_argument("--transaction-cost-bps", type=float, default=10.0)
    parser.add_argument("--population", type=int, default=300)
    parser.add_argument("--generations", type=int, default=75)
    parser.add_argument("--tournament-size", type=int, default=5)
    parser.add_argument("--elite-count", type=int, default=8)
    parser.add_argument("--max-tree-depth", type=int, default=6)
    parser.add_argument("--max-tree-nodes", type=int, default=75)
    parser.add_argument("--mutation-rate", type=float, default=0.30)
    parser.add_argument("--crossover-rate", type=float, default=0.70)
    parser.add_argument("--const-prob", type=float, default=0.20)
    parser.add_argument("--candidate-count", type=int, default=100)
    parser.add_argument("--spa-bootstraps", type=int, default=2000)
    parser.add_argument("--spa-block-length", type=int, default=6)
    args = parser.parse_args()

    run_name = args.run_name
    if run_name is None:
        stem = Path(args.data_path).stem[:28].replace(" ", "_")
        run_name = f"{stem}_{args.holding_mode}_{args.weighting}_seed{args.seed}"

    return Config(
        data_path=args.data_path,
        output_dir=args.output_dir,
        run_name=run_name,
        seed=args.seed,
        last_n_months=args.last_n_months,
        train_frac=args.train_frac,
        valid_frac=args.valid_frac,
        selection_fraction=args.selection_fraction,
        min_holdings=args.min_holdings,
        weighting=args.weighting,
        holding_mode=args.holding_mode,
        transaction_cost_bps=args.transaction_cost_bps,
        population=args.population,
        generations=args.generations,
        tournament_size=args.tournament_size,
        elite_count=args.elite_count,
        max_tree_depth=args.max_tree_depth,
        max_tree_nodes=args.max_tree_nodes,
        mutation_rate=args.mutation_rate,
        crossover_rate=args.crossover_rate,
        const_prob=args.const_prob,
        candidate_count=args.candidate_count,
        spa_bootstraps=args.spa_bootstraps,
        spa_block_length=args.spa_block_length,
    )


def main() -> None:
    config = parse_args()
    random.seed(config.seed)
    np.random.seed(config.seed)

    run_dir = Path(config.output_dir) / config.run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    print("Run:", config.run_name)
    print("Config:", json.dumps(asdict(config), indent=2))

    data = load_data(config)
    train_months, valid_months, test_months = make_time_splits(data.all_months, config.train_frac, config.valid_frac)
    evaluator = Evaluator(data, train_months, valid_months, test_months, config)

    print(f"Rows: {len(data.raw):,} | months: {data.all_months[0]} to {data.all_months[-1]} ({len(data.all_months)})")
    print(f"Train: {train_months[0]} to {train_months[-1]} ({len(train_months)})")
    print(f"Valid: {valid_months[0]} to {valid_months[-1]} ({len(valid_months)})")
    print(f"Test : {test_months[0]} to {test_months[-1]} ({len(test_months)})")

    best_valid, history, ledger, evaluated = train_gp(data, evaluator, config)

    best_node = best_valid["node"]
    split_rows = []
    split_returns = {}
    for split_name in ["train", "valid", "test"]:
        fit, metrics, bt = evaluator.evaluate_node(best_node, split_name)
        row = {"split": split_name, "fitness": fit}
        row.update(metrics)
        split_rows.append(row)
        split_returns[split_name] = pd.DataFrame(
            {
                "month": evaluator.months_for_split(split_name),
                "return": bt["returns"],
                "turnover": bt["turnover"],
            }
        )

    summary = pd.DataFrame(split_rows)

    candidate_nodes: list[tuple[str, Node]] = [(best_valid["expr"], best_node)]
    seen = {best_valid["expr"]}
    for expression in ledger["expression"].head(config.candidate_count):
        if expression in seen:
            continue
        candidate_nodes.append((expression, evaluated[expression]["node"]))
        seen.add(expression)

    valid_return_map = {expression: active_returns_for_node(evaluator, node, "valid") for expression, node in candidate_nodes}
    spa = spa_style_test(valid_return_map, config.spa_bootstraps, config.spa_block_length, config.seed)

    ledger.to_csv(run_dir / "candidate_ledger.csv", index=False)
    history.to_csv(run_dir / "training_history.csv", index=False)
    summary.to_csv(run_dir / "split_summary.csv", index=False)
    spa["t_table"].to_csv(run_dir / "spa_validation_tstats.csv", index=False)
    for split_name, returns_df in split_returns.items():
        returns_df.to_csv(run_dir / f"{split_name}_returns.csv", index=False)

    best_spec = {
        "run_name": config.run_name,
        "config": asdict(config),
        "feature_names": data.feature_names,
        "best_expression": best_valid["expr"],
        "best_saved_generation": best_valid["generation"],
        "validation_spa": {
            "best_strategy": spa["best_strategy"],
            "observed_max_t": spa["observed_max_t"],
            "p_value": spa["p_value"],
            "candidate_count": len(candidate_nodes),
        },
        "splits": {
            "train": [train_months[0], train_months[-1], len(train_months)],
            "valid": [valid_months[0], valid_months[-1], len(valid_months)],
            "test": [test_months[0], test_months[-1], len(test_months)],
        },
        "summary": summary.to_dict(orient="records"),
        "elapsed_seconds": time.time() - start,
    }
    (run_dir / "best_strategy_spec.json").write_text(json.dumps(best_spec, indent=2))

    print("\nBest validation expression:")
    print(best_valid["expr"])
    print("\nSplit summary:")
    print(summary.to_string(index=False))
    print("\nSPA validation:")
    print(json.dumps(best_spec["validation_spa"], indent=2))
    print(f"\nWrote run outputs to {run_dir}")


if __name__ == "__main__":
    main()
