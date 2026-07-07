#!/usr/bin/env python3
"""Summarize many GP HPC runs into one ranking table."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def load_run(run_dir: Path) -> dict | None:
    spec_path = run_dir / "best_strategy_spec.json"
    summary_path = run_dir / "split_summary.csv"
    if not spec_path.exists() or not summary_path.exists():
        return None

    spec = json.loads(spec_path.read_text())
    summary = pd.read_csv(summary_path)
    row: dict = {
        "run_name": spec.get("run_name", run_dir.name),
        "best_expression": spec.get("best_expression"),
        "spa_p_value": spec.get("validation_spa", {}).get("p_value"),
        "spa_observed_max_t": spec.get("validation_spa", {}).get("observed_max_t"),
        "spa_candidate_count": spec.get("validation_spa", {}).get("candidate_count"),
        "elapsed_seconds": spec.get("elapsed_seconds"),
    }

    config = spec.get("config", {})
    for key in [
        "seed",
        "data_path",
        "holding_mode",
        "weighting",
        "population",
        "generations",
        "selection_fraction",
        "transaction_cost_bps",
    ]:
        row[key] = config.get(key)

    for _, split_row in summary.iterrows():
        split = split_row["split"]
        for col in summary.columns:
            if col == "split":
                continue
            row[f"{split}_{col}"] = split_row[col]

    row["accepted_5pct"] = (
        pd.notna(row.get("spa_p_value"))
        and row["spa_p_value"] < 0.05
        and row.get("test_ir", -999) > 0
        and row.get("valid_ir", -999) > 0
    )
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs-dir", required=True)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    runs_dir = Path(args.runs_dir)
    rows = []
    for run_dir in sorted(p for p in runs_dir.iterdir() if p.is_dir()):
        row = load_run(run_dir)
        if row is not None:
            rows.append(row)

    if not rows:
        raise SystemExit(f"No completed runs found under {runs_dir}")

    df = pd.DataFrame(rows)
    sort_cols = [col for col in ["accepted_5pct", "test_ir", "valid_ir", "spa_p_value"] if col in df.columns]
    ascending = [False, False, False, True][: len(sort_cols)]
    df = df.sort_values(sort_cols, ascending=ascending).reset_index(drop=True)

    out = Path(args.out) if args.out else runs_dir / "combined_run_summary.csv"
    df.to_csv(out, index=False)

    print(f"Wrote {out}")
    display_cols = [
        "run_name",
        "accepted_5pct",
        "spa_p_value",
        "valid_ir",
        "test_ir",
        "test_ann_return",
        "test_max_drawdown",
        "best_expression",
    ]
    display_cols = [col for col in display_cols if col in df.columns]
    print(df[display_cols].head(25).to_string(index=False))


if __name__ == "__main__":
    main()
