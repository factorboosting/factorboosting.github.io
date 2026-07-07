# GP Strategy Search On HPC

This folder contains a script-based version of the explanatory GP notebook.
Use the notebook to understand the method; use these scripts for real HPC runs.

## What The Current Notebook Result Says

The attached notebook ran on the full all-stock file:

- Rows: 553,959
- Months: 2003-10 to 2026-05
- Train: 2003-10 to 2017-04
- Validation: 2017-05 to 2021-10
- Test: 2021-11 to 2026-05

The saved validation rule was:

```text
add(add(min(-0.833, label_momentum), label_asset_turnover), label_size)
```

Its split performance was weak:

```text
train IR: 0.967
valid IR: 0.276
test  IR: 0.220
```

The SPA-style validation test failed:

```text
p-value: 0.276
decision: FAIL at 5%
```

So this is not a strategy we should trust yet. It is only a proof that the
pipeline runs end to end.

## Single HPC Run

```bash
python3 scripts/python-utils/gp_strategy_search/gp_hpc_runner.py \
  --data-path "company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv" \
  --output-dir "output/gp_hpc_runs" \
  --run-name "all_long_short_value_seed101" \
  --seed 101 \
  --holding-mode long_short \
  --weighting value \
  --population 300 \
  --generations 75 \
  --candidate-count 100 \
  --spa-bootstraps 2000
```

Each run writes:

```text
candidate_ledger.csv
training_history.csv
split_summary.csv
spa_validation_tstats.csv
train_returns.csv
valid_returns.csv
test_returns.csv
best_strategy_spec.json
```

## Slurm Array Run

Edit `run_gp_slurm_array.sh` for your server paths, partition/account, and
Python environment. Then submit:

```bash
sbatch scripts/python-utils/gp_strategy_search/run_gp_slurm_array.sh
```

The template runs:

```text
4 seeds x 2 weighting modes x 2 holding modes x 2 universes = 32 jobs
```

## Summarize All Runs

After the array finishes:

```bash
python3 scripts/python-utils/gp_strategy_search/summarize_hpc_runs.py \
  --runs-dir "output/gp_hpc_runs"
```

This writes:

```text
output/gp_hpc_runs/combined_run_summary.csv
```

## Research Rules

Do not accept a strategy only because train performance is high. A candidate
should survive at least:

```text
positive validation IR
positive test IR
reasonable drawdown
reasonable turnover
SPA p-value below 0.05 or 0.10
stability across seeds/universes/weighting modes
```

For a serious paper-quality experiment, run many seeds and then apply stricter
White Reality Check, Hansen SPA, Model Confidence Set, and Deflated Sharpe
Ratio on the combined candidate ledger.
