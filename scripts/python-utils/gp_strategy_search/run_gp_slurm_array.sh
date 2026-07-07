#!/bin/bash
#SBATCH --job-name=gp_factor_search
#SBATCH --output=logs/gp_%A_%a.out
#SBATCH --error=logs/gp_%A_%a.err
#SBATCH --time=12:00:00
#SBATCH --cpus-per-task=1
#SBATCH --mem=16G
#SBATCH --array=0-31

set -euo pipefail

# Adjust these for the HPC server.
PROJECT_DIR="${PROJECT_DIR:-/home/Samyak.baid_ug2024/genetic algo}"
DATA_DIR="${DATA_DIR:-$PROJECT_DIR}"
OUT_DIR="${OUT_DIR:-$PROJECT_DIR/output/gp_hpc_runs}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$OUT_DIR"

cd "$PROJECT_DIR"

# Grid:
# 4 seeds x 2 weighting modes x 2 holding modes x 2 universe files = 32 jobs.
SEEDS=(101 202 303 404)
WEIGHTS=(value equal)
MODES=(long_short long_only)
UNIVERSE_NAMES=(all top500)
UNIVERSE_FILES=(
  "$DATA_DIR/company_month_ALL_FACTOR_LABELS_FINAL_COMPACT.csv"
  "$DATA_DIR/firm_labels_top500_may_26.csv"
)

TASK_ID="${SLURM_ARRAY_TASK_ID:-0}"

N_SEEDS=${#SEEDS[@]}
N_WEIGHTS=${#WEIGHTS[@]}
N_MODES=${#MODES[@]}
N_UNIVERSES=${#UNIVERSE_FILES[@]}

seed_idx=$(( TASK_ID % N_SEEDS ))
tmp=$(( TASK_ID / N_SEEDS ))
weight_idx=$(( tmp % N_WEIGHTS ))
tmp=$(( tmp / N_WEIGHTS ))
mode_idx=$(( tmp % N_MODES ))
universe_idx=$(( tmp / N_MODES ))

if [ "$universe_idx" -ge "$N_UNIVERSES" ]; then
  echo "Task id $TASK_ID is outside configured grid."
  exit 1
fi

SEED="${SEEDS[$seed_idx]}"
WEIGHTING="${WEIGHTS[$weight_idx]}"
MODE="${MODES[$mode_idx]}"
UNIVERSE="${UNIVERSE_NAMES[$universe_idx]}"
DATA_PATH="${UNIVERSE_FILES[$universe_idx]}"
RUN_NAME="${UNIVERSE}_${MODE}_${WEIGHTING}_seed${SEED}"

echo "Running $RUN_NAME"
echo "Data: $DATA_PATH"

"$PYTHON_BIN" scripts/python-utils/gp_strategy_search/gp_hpc_runner.py \
  --data-path "$DATA_PATH" \
  --output-dir "$OUT_DIR" \
  --run-name "$RUN_NAME" \
  --seed "$SEED" \
  --holding-mode "$MODE" \
  --weighting "$WEIGHTING" \
  --population 300 \
  --generations 75 \
  --elite-count 8 \
  --tournament-size 5 \
  --max-tree-depth 6 \
  --max-tree-nodes 75 \
  --mutation-rate 0.30 \
  --crossover-rate 0.70 \
  --selection-fraction 0.20 \
  --min-holdings 25 \
  --transaction-cost-bps 10 \
  --candidate-count 100 \
  --spa-bootstraps 2000 \
  --spa-block-length 6
